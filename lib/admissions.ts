import { createHash } from "node:crypto";
import { Op, QueryTypes } from "sequelize";
import sequelize, { ensureDatabase } from "@/lib/db";
import { Registrant } from "@/lib/models/Registrant";
import { AdmissionDecision } from "@/lib/models/AdmissionDecision";
import {
  isValidCourseSlug,
  LIMIT_PER_COURSE,
  RELEASABLE_STATUSES,
  SEAT_HOLDING_STATUSES,
} from "@/config/rules";
import { COURSES } from "@/config/course-matrix";
import { log } from "@/lib/logger";

// ─── ADMISSIONS DOMAIN LOGIC ──────────────────────────────────────────────────
// Everything that changes a candidate's status goes through this file, so that
// three things are always true at once: the status is legal, the seat count is
// respected, and somebody wrote down who did it and why.
//
// THE RULE THE OLD CODE BROKE
// The status column was a bare enum and five different routes wrote to it. The
// objective submit route wrote "completed" to mean "didn't get in". The theory
// route wrote "completed" to mean "essay handed in". The AI grader read
// "completed" to mean "essay handed in". So "completed" meant two things and the
// grader acted on the wrong one: candidates who had never written an essay were
// selected for grading, with theoryScore 0 as the only evidence, and a human
// reading the queue had no way to tell that apart from a real submission.
//
// A status is a promise about what happens next. This module is the only place
// that makes one.

export interface DecisionOutcome {
  ok: boolean;
  error?: string;
  message?: string;
  status?: string;
}

/** Legal moves, and who may make them. */
export const TRANSITIONS: Record<
  string,
  { from: readonly string[]; role: "staff" | "admissions" }
> = {
  // A human reviews a candidate the invigilation process or the AI flagged.
  flag: {
    from: ["registered", "attended", "qualified", "completed", "waitlisted"],
    role: "admissions",
  },

  // Lifting a flag. Added because flagging is now a person's decision rather than
  // an automatic punishment - and a decision a person makes wrongly is a decision
  // they have to be able to take back. The old client-only "flag" was cleared by
  // clearing localStorage, which changed nothing on the server, so a candidate
  // wrongly accused of cheating stayed accused for the rest of the event with no
  // way for anyone to fix it. It goes through the same audit log as the flag
  // itself, because "who cleared this and why" is exactly the question somebody
  // will ask later.
  unflag: {
    from: ["registered", "attended", "qualified", "completed", "waitlisted"],
    role: "admissions",
  },

  // Graded, seat offered.
  shortlist: { from: ["completed"], role: "admissions" },

  // Seat confirmed.
  award: { from: ["completed", "shortlisted"], role: "admissions" },

  // Standing down, or correcting a status. Always a human's call.
  release: {
    from: ["registered", "attended", "qualified", "completed", "shortlisted"],
    role: "admissions",
  },

  // Moving a course allocation on an already-decided candidate.
  allocate: {
    from: ["shortlisted", "awarded", "completed"],
    role: "admissions",
  },
};

// The table is exported so it can be asserted against (tests/rules.test.ts) and
// read in one place. It is a statement of policy: exporting it does not export
// `decide`, so nothing can act on it - it can only be inspected.
export type DecisionAction = keyof typeof TRANSITIONS;

/**
 * Statuses a person may put a candidate into with `release`.
 *
 * The list itself is in config/rules.ts, because the review panel renders the
 * same options and cannot import this module - see the note there.
 */
const RELEASABLE: readonly string[] = RELEASABLE_STATUSES;

/**
 * Apply a status change, enforcing the seat cap and writing the audit row.
 *
 * Every call is transactional, and the audit row is written in the SAME
 * transaction as the status change. A decision that exists without a record of
 * who made it is worse than no decision at all, so the two cannot diverge: if
 * the insert fails, the update rolls back with it.
 */
export async function decide(
  registrantId: string,
  action: DecisionAction,
  actor: DecisionActor,
  options: { note?: string; courseSlug?: string; status?: string } = {},
): Promise<DecisionOutcome> {
  const rule = TRANSITIONS[action];
  if (!rule) return { ok: false, error: "UNKNOWN_ACTION" };

  await ensureDatabase();

  return sequelize.transaction(async (t) => {
    const student = await Registrant.findByPk(registrantId, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!student) return { ok: false, error: "NOT_FOUND" };

    if (actor.role !== rule.role && actor.role !== "admissions") {
      return { ok: false, error: "FORBIDDEN" };
    }

    // Captured before the update. Reading `student.status` afterwards returns the
    // NEW value, which would file the audit row as "awarded → awarded" and lose
    // the only piece of information anyone will ever need about this decision.
    const fromStatus = student.status as string;

    // Promotions must come from a legal state. Corrections (`release`,
    // `allocate`) may land on a status the candidate already holds, because their
    // whole job is to fix a status that was set wrongly.
    if (
      (action === "shortlist" || action === "award") &&
      !rule.from.includes(fromStatus)
    ) {
      return {
        ok: false,
        error: "ILLEGAL_TRANSITION",
        message: `Cannot ${action} a candidate whose status is "${fromStatus}".`,
      };
    }

    if (
      action === "release" &&
      options.status &&
      !RELEASABLE.includes(options.status)
    ) {
      return { ok: false, error: "INVALID_TARGET_STATUS" };
    }

    // ─── SEAT CAP ────────────────────────────────────────────────────────────
    // Enforced here, at the only place a seat is created. The theory submit route
    // also checks it, and it has to - that route takes a seat from the public
    // internet - but a check in the UI is a check someone can forget.
    let nextCourse = student.selectedCourseSlug;
    if (options.courseSlug) {
      if (!isValidCourseSlug(options.courseSlug)) {
        return { ok: false, error: "INVALID_COURSE" };
      }
      nextCourse = options.courseSlug;
    }

    if (action === "shortlist" || action === "award") {
      const slug = nextCourse ?? student.selectedCourseSlug;
      if (!slug) {
        return {
          ok: false,
          error: "NO_COURSE",
          message: "Pick a course track before awarding a seat.",
        };
      }

      // Serialise per course, exactly as the theory route does, or fifty
      // simultaneous awards all read "41 taken" and all commit.
      await sequelize.query("SELECT pg_advisory_xact_lock(:key)", {
        replacements: { key: courseLockKey(slug) },
        type: QueryTypes.SELECT,
        transaction: t,
      });

      const taken = await Registrant.count({
        where: {
          selectedCourseSlug: slug,
          status: { [Op.in]: [...SEAT_HOLDING_STATUSES] },
          id: { [Op.ne]: student.id },
        },
        transaction: t,
      });

      if (taken >= LIMIT_PER_COURSE) {
        const course = COURSES.find((c) => c.slug === slug);
        return {
          ok: false,
          error: "COURSE_FULL",
          message: `${course?.displayName ?? slug} is full (${LIMIT_PER_COURSE} seats).`,
        };
      }
    }

    const toStatus =
      action === "shortlist"
        ? "shortlisted"
        : action === "award"
          ? "awarded"
          : action === "release"
            ? (options.status ?? "waitlisted")
            : fromStatus;

    await student.update(
      {
        status: toStatus as Registrant["status"],
        selectedCourseSlug: nextCourse,
        decidedAt: new Date(),
        decidedBy: actor.name,
        decisionNote: options.note?.slice(0, 2000) ?? null,
      },
      { transaction: t },
    );

    if (action === "flag" || action === "unflag") {
      await student.update(
        { isFlagged: action === "flag" },
        { transaction: t },
      );
    }

    // The record of the decision, in the same transaction as the decision.
    await AdmissionDecision.create(
      {
        registrantId: student.id,
        fromStatus,
        toStatus,
        actorRole: actor.role,
        actor: actor.name,
        note: options.note?.slice(0, 2000) ?? null,
        context: {
          objectiveScore: student.objectiveScore,
          objectiveRank: student.objectiveRank,
          theoryScore: student.theoryScore,
          course: nextCourse,
          aiSuspected: student.aiSuspected,
        },
      },
      { transaction: t },
    );

    return { ok: true, status: toStatus };
  });
}

/**
 * Stable 64-bit advisory-lock key per course slug.
 *
 * This lives here, not in each route that needs it, because a duplicated lock-key
 * function is a silent failure: if the two copies ever diverge, the locks stop
 * colliding, both routes believe they are serialised, and the seat cap is
 * oversold again - with no error anywhere.
 */
export function courseLockKey(slug: string): string {
  const digest = createHash("sha256").update(slug).digest();
  return digest.readBigInt64BE(0).toString();
}

/** Who pressed the button. Recorded verbatim in the audit log. */
export interface DecisionActor {
  role: string;
  name: string;
}

export interface GradeUpdate {
  id: string;
  theoryScore: number;
  aiSuspected: boolean;
  aiGradeReason: string;
  aiConfidence: string;
}

export const THEORY_SCORE_MAX = 100;

/**
 * Record a HUMAN grade.
 *
 * Separate from `recordGrades` on purpose. The AI route writes the score AND the
 * model's own notes; a person reading an essay must not be recorded as having
 * overwritten the model's reasoning, and the model's `aiSuspected` opinion must
 * survive a human disagreeing with it. If they were one function, a human
 * correcting a score would have to remember to re-send the AI fields to keep them
 * intact, and the first person who forgot would silently erase the record of why
 * the essay was ever questioned.
 *
 * So: human grades write the score and the grader, and touch nothing the model
 * said. The audit row records the score before and after, because "the panel
 * changed this from 40 to 75" is the single most questioned fact in any
 * scholarship process.
 */
export async function saveHumanGrade(
  registrantId: string,
  theoryScore: number,
  actor: DecisionActor,
  note?: string,
): Promise<DecisionOutcome & { previousScore?: number }> {
  if (
    !Number.isInteger(theoryScore) ||
    theoryScore < 0 ||
    theoryScore > THEORY_SCORE_MAX
  ) {
    return { ok: false, error: "INVALID_SCORE" };
  }

  await ensureDatabase();

  return sequelize.transaction(async (t) => {
    const student = await Registrant.findByPk(registrantId, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!student) return { ok: false, error: "NOT_FOUND" };

    const fromStatus = student.status as string;
    const previousScore = student.theoryScore;

    await student.update(
      {
        theoryScore,
        theoryGradedAt: new Date(),
        theoryGradedBy: actor.name,
      },
      { transaction: t },
    );

    // fromStatus and toStatus are equal on purpose: a grade is not a status
    // change, and pretending otherwise would fill the decision log with
    // "completed → completed" rows and bury the real transitions.
    await AdmissionDecision.create(
      {
        registrantId: student.id,
        fromStatus,
        toStatus: fromStatus,
        actorRole: actor.role,
        actor: actor.name,
        note: note?.slice(0, 2000) ?? null,
        context: {
          previousTheoryScore: previousScore ?? null,
          theoryScore,
          course: student.selectedCourseSlug,
          aiSuspected: student.aiSuspected,
          grader: actor.name,
        },
      },
      { transaction: t },
    );

    log.info("admissions.grade_recorded", {
      by: actor.name,
      registrantId,
      previousScore: previousScore ?? null,
      theoryScore,
    });

    return {
      ok: true,
      status: fromStatus,
      previousScore: previousScore ?? undefined,
    };
  });
}

/**
 * Write a whole batch of AI grades in ONE statement.
 *
 * The old collector looped `await Registrant.update(...)` per candidate while
 * vercel.json capped the function at 10 seconds. At 900 essays that could not
 * finish, so the route died partway and a random fraction of the grades was
 * silently never written - the batch was marked complete on OpenAI's side, so
 * there was nothing to retry from.
 *
 * `unnest` turns four parallel arrays into a virtual table, so Postgres does the
 * row-by-row matching in one pass:
 *
 *     UPDATE registrants r SET ... FROM unnest(ARRAY[...], ARRAY[...]) AS v(...)
 *     WHERE r.id = v.id
 *
 * 900 rows, one round trip, one statement, atomic. No N+1, no partial write.
 */
export async function recordGrades(
  updates: GradeUpdate[],
  gradedBy = "model-grading",
): Promise<number> {
  if (updates.length === 0) return 0;
  await ensureDatabase();

  // ─── THE UNPACKING ─────────────────────────────────────────────────────────
  // FIX: THIS ALWAYS RETURNED ZERO.
  //
  // node-postgres + QueryTypes.UPDATE resolves to `[instance, rowCount]` - see
  // dialect/postgres/query.js, which returns
  //     [this.instance || rows, rowCount]
  // The old line destructured the FIRST element and looked for `rowCount` on it,
  // which is undefined, so the `?? 0` fallback fired every single time. The
  // grades were being written correctly; the function then reported that zero
  // rows had been written.
  //
  // That is the worst shape of bug: the operator sees "0 of 900 graded" after a
  // successful batch, has no way to tell the write failed, and re-runs it. The
  // count is the second element.
  const [, rowCount] = await sequelize.query(
    `UPDATE registrants r
        SET theory_score     = v.score::int,
            ai_suspected     = v.suspected::boolean,
            ai_grade_reason  = v.reason::text,
            ai_confidence    = v.conf::text,
            theory_graded_at = NOW(),
            theory_graded_by = :gradedBy
       FROM unnest(
              ARRAY[:ids]::uuid[],
              ARRAY[:scores]::int[],
              ARRAY[:suspected]::boolean[],
              ARRAY[:reasons]::text[],
              ARRAY[:conf]::text[]
            ) AS v(id, score, suspected, reason, conf)
      WHERE r.id = v.id`,
    {
      replacements: {
        ids: updates.map((u) => u.id),
        scores: updates.map((u) => u.theoryScore),
        suspected: updates.map((u) => u.aiSuspected),
        reasons: updates.map((u) => u.aiGradeReason || null),
        conf: updates.map((u) => u.aiConfidence || null),
        gradedBy,
      },
      type: QueryTypes.UPDATE,
    },
  );

  const written = Number(rowCount ?? 0);
  if (written !== updates.length) {
    // A short write means some registrants were not in the table any more, or a
    // duplicate id appeared in the batch. Either way it is worth a line in the
    // log rather than a shrug - the operator decides whether to re-run.
    log.warn("admissions.grades_partial", {
      submitted: updates.length,
      written,
      gradedBy,
    });
  }
  return written;
}
