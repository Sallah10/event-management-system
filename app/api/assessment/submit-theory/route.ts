import { NextResponse } from "next/server";
import { Op, QueryTypes } from "sequelize";
import { Registrant } from "@/lib/models/Registrant";
import sequelize, { ensureDatabase } from "@/lib/db";
import { requireCandidate } from "@/lib/auth";
import { courseLockKey } from "@/lib/admissions";
import { isLate } from "@/lib/exam-sitting";
import { log } from "@/lib/logger";
import { countWords } from "@/lib/validate";
import {
  isValidCourseSlug,
  LIMIT_PER_COURSE,
  SEAT_HOLDING_STATUSES,
  THEORY_MIN_WORDS,
} from "@/config/rules";
import { COURSES } from "@/config/course-matrix";

export const dynamic = "force-dynamic";

// ─── THEORY SUBMISSION + COURSE ALLOCATION ────────────────────────────────────
// This route had three separate ways to hand out a scholarship that the rules
// said shouldn't exist. All three are fixed here.
//
// BUG 1 - THE COURSE CAP COULD BE SKIPPED ENTIRELY.
//   `selectedSlug` came straight from the request body and was never checked
//   against COURSES. The capacity check was
//   `count(where: { selectedCourseSlug: selectedSlug })`. Send
//   `selectedSlug: "x-" + crypto.randomUUID()` and the count is always 0, so the
//   42-per-course limit never applies, you get `status: "awarded"`, and you've
//   also written an unbounded stream of junk values into
//   registrants.selected_course_slug - which is the exact column the
//   course-slots endpoint GROUP BYs. One unauthenticated-shaped request,
//   unlimited seats.
//
// BUG 2 - THE CAP COULD BE OVERSOLD BY CONCURRENCY.
//   Even with a valid slug, the check was a plain `COUNT(*)` at READ COMMITTED
//   (lib/db.ts set no isolation level). Fifty simultaneous submissions all read
//   "41 taken", all passed, all committed. The `lock: true` on line 39 didn't
//   help: it locked the *submitting student's own row*, so two students chasing
//   the same 42nd seat locked two different rows and excluded nobody.
//
//   Fix is a per-course PostgreSQL advisory lock, taken as the first statement in
//   the transaction. Every submission for the same course serialises on the same
//   lock key; different courses stay fully parallel. `pg_advisory_xact_lock` is
//   scoped to the transaction, so Postgres releases it on commit OR rollback -
//   no leak, no cleanup job, and it can't outlive a crashed connection the way a
//   session lock could.
//
// BUG 3 - EMPTY ANSWERS WERE ACCEPTED AND MARKED "awarded".
//   `const { q1, q2, q3 } = answers` with no validation. Submitting
//   `{}` wrote three `undefined` answers and flipped the candidate to
//   `awarded` - which is the status the winners export treats as a scholarship
//   winner. Meanwhile the AI grader had its own 50-character minimum and would
//   skip them, so they'd be exported as a winner with no grade.
//
// BUG 4 - A TRANSACTION WAS OPENED BEFORE AUTHENTICATION.
//   `sequelize.transaction()` was line 8, ahead of the token check. Five
//   concurrent unauthenticated POSTs would occupy all five pool connections and
//   every legitimate candidate would then queue behind them.
//
// BUG 5 - "awarded" WAS SET ON SUBMISSION, NOT ON AWARDING.
//   A candidate who merely turned in the essay was recorded as a winner. Status
//   now moves to "completed" (theory submitted, awaiting grading) and only the
//   admissions portal can promote someone to shortlisted/awarded. This also
//   repairs the AI grader, which selected `status: "completed"` and was
//   therefore grading nobody at all, because nothing ever produced "completed"
//   from this route.

const THEORY_QUESTIONS = 3;
export async function POST(request: Request) {
  // Auth happens BEFORE any connection is taken. See BUG 4.
  const { session, error } = await requireCandidate(request);
  if (error) return error;

  let body: { selectedSlug?: unknown; answers?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "BAD_REQUEST", message: "Invalid submission." },
      { status: 400 },
    );
  }

  // ─── VALIDATE THE COURSE ───────────────────────────────────────────────────
  // BUG 1. Validated against the canonical list, never trusted from the client.
  if (!isValidCourseSlug(body.selectedSlug)) {
    log.warn("assessment.theory.invalid_slug", {
      barcodeId: session.barcodeId,
    });
    return NextResponse.json(
      {
        success: false,
        error: "INVALID_COURSE",
        message: "Pick one of the available tracks before submitting.",
      },
      { status: 400 },
    );
  }
  const selectedSlug = body.selectedSlug;

  // ─── VALIDATE THE ANSWERS ─────────────────────────────────────────────────
  // BUG 3. The grader's own minimum, applied at the door - and applied to ALL
  // three answers, not "at least one".
  //
  // The first version of this fix read
  //     const wordy = texts.filter((t) => words(t) >= MIN);
  //     if (wordy.length === 0) reject "Each answer needs at least 50 words"
  // so a candidate could answer Q1 with 50 words and Q2 and Q3 with "no" and
  // still be accepted, while the error message told them the opposite. The
  // grader then scored the two one-word answers, averaged them into a real
  // number, and that number went into a scholarship decision. The check now
  // names the question that failed, so a candidate can fix it.
  const answers = body.answers ?? {};
  const texts: string[] = [];
  for (let i = 1; i <= THEORY_QUESTIONS; i += 1) {
    const raw = answers[`q${i}`];
    if (typeof raw !== "string" || raw.trim().length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "INCOMPLETE",
          message: `Question ${i} is blank. Every question needs an answer.`,
        },
        { status: 400 },
      );
    }

    const words = countWords(raw);
    if (words < THEORY_MIN_WORDS) {
      return NextResponse.json(
        {
          success: false,
          error: "TOO_SHORT",
          message: `Question ${i} needs at least ${THEORY_MIN_WORDS} words - you have ${words}. A one-line answer can't be assessed fairly.`,
        },
        { status: 400 },
      );
    }

    texts.push(raw.trim());
  }

  await ensureDatabase();

  // ─── ALLOCATE THE SEAT ────────────────────────────────────────────────────
  const outcome = await sequelize.transaction(async (t) => {
    // BUG 2. Serialise everyone targeting this course, before we count.
    // The lock is taken on the transaction's own connection, via sequelize.query
    // with `transaction: t` - a Transaction object has no .query() method, which
    // is why the first version of this fix threw a TypeError on every single
    // submission and 500'd.
    await sequelize.query("SELECT pg_advisory_xact_lock(:key)", {
      replacements: { key: courseLockKey(selectedSlug) },
      type: QueryTypes.SELECT,
      transaction: t,
    });

    const student = await Registrant.findOne({
      where: { email: session.email, barcodeId: session.barcodeId },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!student) {
      return {
        status: 404 as const,
        error: "INVALID_SESSION",
        message: "Invalid session.",
      };
    }

    if (student.status === "completed") {
      return {
        status: 409 as const,
        error: "ALREADY_SUBMITTED",
        message: "Your theory section is already in and awaiting grading.",
      };
    }

    if (student.status !== "qualified") {
      return {
        status: 403 as const,
        error: "NOT_QUALIFIED",
        message: `You must pass the objective section first. Current status: ${student.status}.`,
      };
    }

    // Now safe: no other submission for this course is between its count and its
    // commit.
    const taken = await Registrant.count({
      where: {
        selectedCourseSlug: selectedSlug,
        status: { [Op.in]: [...SEAT_HOLDING_STATUSES, "completed"] },
      },
      transaction: t,
    });

    if (taken >= LIMIT_PER_COURSE) {
      const course = COURSES.find((c) => c.slug === selectedSlug);
      return {
        status: 409 as const,
        error: "COURSE_FULL",
        message: `${course?.displayName ?? "That track"} is full (${LIMIT_PER_COURSE} seats). Please pick another track.`,
      };
    }

    // BUG 5. "completed" = submitted, not awarded.
    //
    // FIX: the finish time is recorded, and so is lateness.
    //
    // The objective route has done this since it was rewritten; the theory route
    // did not, so a theory paper handed in an hour past the deadline was stored
    // identically to one handed in on time, and the only trace that anything was
    // ever late was a log line nobody reads. There was nowhere to record it: no
    // theory_finished_at column existed, and theory_graded_at is the wrong
    // timestamp by a week.
    //
    // A late essay is still accepted. Discarding a candidate's finished work
    // because a tab was open past the bell costs the scholarship scheme a real
    // applicant and protects nothing that a recorded finish time does not already
    // protect. The marker sees that it was late, and the finish time is what any
    // later tie-break is ordered by.
    const submittedAt = new Date();
    const late = isLate(student, "theory");

    await student.update(
      {
        theoryAnswer1: texts[0],
        theoryAnswer2: texts[1],
        theoryAnswer3: texts[2],
        selectedCourseSlug: selectedSlug,
        status: "completed",
        theoryFinishedAt: submittedAt,
      },
      { transaction: t },
    );

    if (late) {
      // Warn, not error: it is an operational signal for the invigilation lead,
      // not a rejection.
      log.warn("assessment.theory.submitted_late", {
        barcodeId: session.barcodeId,
        selectedSlug,
        startedAt: student.get("theoryStartedAt") ?? null,
        finishedAt: submittedAt.toISOString(),
      });
    }

    return {
      status: 200 as const,
      error: null,
      message: "Theory submitted.",
      late,
    };
  });

  if (outcome.error) {
    log.info("assessment.theory.rejected", {
      barcodeId: session.barcodeId,
      reason: outcome.error,
    });
    return NextResponse.json(
      { success: false, error: outcome.error, message: outcome.message },
      { status: outcome.status },
    );
  }

  log.info("assessment.theory.submitted", {
    barcodeId: session.barcodeId,
    selectedSlug,
    late: outcome.late,
  });

  return NextResponse.json({
    success: true,
    error: null,
    message: outcome.message,
    data: {
      selectedCourseSlug: selectedSlug,
      submittedLate: outcome.late ?? false,
    },
  });
}
