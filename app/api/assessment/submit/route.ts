import { NextResponse } from "next/server";
import { Registrant } from "@/lib/models/Registrant";
import { scoreAnswers } from "@/lib/answer-key";
import { PASS_MARK_PERCENT } from "@/config/rules";
import { computeObjectiveRank } from "@/lib/ranking";
import {
  requireCandidate,
  hashDeviceKey,
  readDeviceKey,
  routeError,
} from "@/lib/auth";
import { ensureDatabase } from "@/lib/db";
import { isLate } from "@/lib/exam-sitting";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";

// ─── OBJECTIVE SUBMISSION ─────────────────────────────────────────────────────
// FIXES vs the original:
//
// 1. IT RANKED WITH A COUNT. It returned `submissionNumber = Registrant.count(...)`
//    as `submissionRank`. A COUNT is not a rank - it's "how many people have
//    submitted so far", which is a different number and grows monotonically.
//    Now uses computeObjectiveRank(), which is an actual rank.
//
// 2. THE "910 WALL" DID NOT EXIST. The README and the admin dashboard both
//    advertised a top-910 cut. The only gate was `score >= 80`, so the 5,000th
//    candidate to score 85% sailed through. Now enforced properly.
//
// 3. THE DEVICE CHECK HAD A DOUBLE-HASH BUG.
//    It ran `hashDeviceKey(readDeviceKey(request) ?? session.deviceKey)`. If the
//    client sent the header, the stored hash and the fresh hash of the header
//    agreed and all was well. If it did NOT send the header - a dropped header,
//    a proxy stripping it, a client that never set one - the fallback hashed the
//    already-hashed session value, compared it to itself, and every such
//    submission was rejected as DEVICE_MISMATCH. A security check that fires
//    when the security-relevant thing is absent. Now the header is compared when
//    present, and the session's own binding is trusted when it isn't.
//
// 4. `tabSwitches` DECIDED DISQUALIFICATION. `isFlagged: tabSwitches > 3` meant a
//    candidate could post `tabSwitches: 0` and keep a clean record. Client
//    telemetry is now recorded as telemetry and is NOT used to auto-disqualify -
//    that decision belongs to a human in the integrity queue. It IS persisted now
//    (registrants.tab_switches), because "we log it and ignore it" is only useful
//    if a human can later read it.
//
// 5. "completed" MEANT TWO THINGS.
//    `status: rank.hasSeat ? "qualified" : "completed"` recorded "didn't make the
//    pool" using the same value the theory route used for "essay submitted". The
//    AI grader selects `status: "completed"`, so every waitlisted candidate who
//    never wrote an essay would have been sent for grading. Split into
//    qualified / waitlisted / eliminated.

export async function POST(request: Request) {
  const route = "assessment.submit";

  try {
    await ensureDatabase();

    const { session, error } = await requireCandidate(request);
    if (error) return error;

    // ─── DEVICE BINDING ──────────────────────────────────────────────────────
    // Compare only when the client actually sent the key. See FIX 3.
    const headerKey = readDeviceKey(request);
    if (headerKey) {
      const presented = await hashDeviceKey(headerKey);
      if (session.deviceKey && presented !== session.deviceKey) {
        log.warn("assessment.submit.device_mismatch", {
          barcodeId: session.barcodeId,
        });
        return NextResponse.json(
          {
            success: false,
            error: "DEVICE_MISMATCH",
            message: "This exam was started on a different device.",
          },
          { status: 403 },
        );
      }
    }

    const deviceKey =
      session.deviceKey ?? (headerKey ? await hashDeviceKey(headerKey) : "");

    let body: { answers?: Record<string, string>; tabSwitches?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: "BAD_REQUEST",
          message: "Invalid submission.",
        },
        { status: 400 },
      );
    }

    // ─── LOAD + GUARD ────────────────────────────────────────────────────────
    const student = await Registrant.findOne({
      where: { email: session.email, barcodeId: session.barcodeId },
    });

    if (!student) {
      return NextResponse.json(
        {
          success: false,
          error: "INVALID_SESSION",
          message: "Invalid session.",
        },
        { status: 403 },
      );
    }

    if (student.objectiveFinishedAt) {
      return NextResponse.json(
        {
          success: false,
          error: "ALREADY_SUBMITTED",
          message: "You have already submitted this assessment.",
        },
        { status: 409 },
      );
    }

    if (student.isFlagged) {
      return NextResponse.json(
        {
          success: false,
          error: "DISQUALIFIED",
          message: "This account is suspended. Speak to an invigilator.",
        },
        { status: 403 },
      );
    }

    // ─── SCORE (server-side, answer key never leaves the server) ─────────────
    const result = scoreAnswers(body.answers);

    // Client-reported focus-loss count. Recorded, never trusted, never decisive.
    const reportedTabSwitches = Number.isInteger(body.tabSwitches)
      ? Math.max(0, Math.min(999, body.tabSwitches as number))
      : 0;

    const finishedAt = new Date();

    // FIX 6. THE CLOCK IS NOW KNOWN TO THE SERVER.
    // Until this, the only timer in the system was `useState(1800)` in a client
    // component, so "the exam lasts 30 minutes" was enforced by nothing. A
    // candidate could have sat the paper, walked away for a week, and submitted
    // when they liked - the server had no start time to compare against, and this
    // route accepted the answers at any hour.
    //
    // It still ACCEPTS a late paper rather than rejecting it. Discarding a
    // finished paper because a tab was open past the bell costs the candidate
    // everything they wrote to prevent a small infraction, and the honest
    // consequence of being late is already priced into the rank: finishedAt is
    // the real time of submission, and lib/ranking.ts breaks ties on it. Lateness
    // is recorded here so staff can see it, and ranked, not enforced by data loss.
    const late = isLate(student, "objective");
    if (late) {
      log.warn("assessment.submitted_late", {
        barcodeId: student.barcodeId,
        startedAt: student.objectiveStartedAt,
        submittedAt: finishedAt,
      });
    }

    // Persist first, then rank. Ranking has to include this candidate's own row
    // or the number is always one short.
    await student.update({
      objectiveScore: result.percent,
      objectiveFinishedAt: finishedAt,
      tabSwitches: reportedTabSwitches,
      ...(deviceKey ? { deviceId: deviceKey } : {}),
    });

    const rank = await computeObjectiveRank({
      score: result.percent,
      finishedAt,
      passMark: PASS_MARK_PERCENT,
      excludeId: student.id,
    });

    // FIX 5. Three distinct outcomes, three distinct statuses. Everyone keeps
    // their score and finish time, so a later appeal or a re-run is possible.
    const nextStatus = rank.hasSeat
      ? ("qualified" as const)
      : result.percent >= PASS_MARK_PERCENT
        ? ("waitlisted" as const)
        : ("eliminated" as const);

    await student.update({
      status: nextStatus,
      objectiveRank: rank.rank,
    });

    log.info("assessment.submitted", {
      barcodeId: student.barcodeId,
      score: result.percent,
      rank: rank.rank,
      status: nextStatus,
      reportedTabSwitches,
      late,
    });

    return NextResponse.json({
      success: true,
      data: {
        score: result.percent,
        correct: result.correct,
        total: result.total,
        rank: rank.rank,
        poolSize: rank.poolSize,
        qualified: rank.hasSeat,
        metPassMark: result.percent >= PASS_MARK_PERCENT,
        allQuestionsAnswered: result.complete,
        submittedLate: late,
        message: rank.hasSeat
          ? "You're in. Proceed to the theory section."
          : result.percent >= PASS_MARK_PERCENT
            ? "You met the pass mark, but the pool filled before your turn. You've been added to the waitlist."
            : `You scored ${result.percent}%, below the ${PASS_MARK_PERCENT}% needed to continue. Your score has been recorded.`,
      },
    });
  } catch (error) {
    return routeError(route, error);
  }
}
