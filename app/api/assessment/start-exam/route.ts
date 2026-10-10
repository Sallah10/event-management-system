import { NextResponse } from "next/server";
import { Registrant } from "@/lib/models/Registrant";
import { ensureDatabase } from "@/lib/db";
import { requireCandidate, routeError } from "@/lib/auth";
import { resolveSitting } from "@/lib/exam-sitting";
import { log } from "@/lib/logger";
import { OBJECTIVE_TTL_MINUTES } from "@/config/rules";

export const dynamic = "force-dynamic";

// ─── EXAM START ───────────────────────────────────────────────────────────────
// Stamps the objective clock and hands back the deadline.
//
// FIX: THIS ROUTE AND THE PAPER DISAGREED ABOUT WHEN THE CLOCK STARTED.
//
// The sitting was kept in two places at once. This route wrote a Redis key
// (`start:<barcode>`) and returned `startedAt` from it; the exam page read and
// stamped `objective_started_at` in Postgres. Two clocks for one sitting, and they
// drift:
//
//   * Redis keys expire, and Upstash evicts under memory pressure. The moment the
//     key was gone, this route treated the exam as unstarted and returned a FRESH
//     `startedAt` - a candidate who refreshed after an hour got a new full-length
//     timer on screen while the server, reading the column, was already counting
//     them as late.
//   * `POST /api/assessment/submit` priced lateness from the column. So the client
//     could show 20 minutes remaining and the server would record the finish as
//     late, with nothing on screen to explain it.
//   * The grace-window check in the flag route read the Redis key too, so it
//     disagreed with the paper about whether the candidate had settled in.
//
// Now the database column is the only clock. This route calls the same
// `resolveSitting` the page does, which stamps conditionally (`WHERE started_at IS
// NULL`), so the first call wins and the timestamp is never rewritten - the
// original fix for renewable grace periods still holds, and it holds in the place
// that survives a Redis eviction.
//
// The Redis key is gone rather than kept in sync. Two clocks that agree until one
// of them is evicted is exactly the bug that was just fixed.

export async function POST(request: Request) {
  const route = "assessment.startExam";

  try {
    await ensureDatabase();

    const { session, error } = await requireCandidate(request);
    if (error) return error;

    const { barcodeId } = session;

    const student = await Registrant.findOne({
      where: { barcodeId },
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

    if (student.isFlagged) {
      return NextResponse.json(
        {
          success: false,
          error: "DISQUALIFIED",
          message: "This account is suspended.",
        },
        { status: 403 },
      );
    }

    if (student.objectiveFinishedAt) {
      return NextResponse.json(
        {
          success: false,
          error: "ALREADY_SUBMITTED",
          message: "You've already submitted the objective section.",
        },
        { status: 409 },
      );
    }

    // The same call the server component makes. Idempotent: if the clock is
    // already running, this returns the existing deadline and changes nothing.
    const sitting = await resolveSitting(student, "objective");

    log.info("assessment.started", {
      barcodeId,
      status: student.status,
      deadline: sitting.deadline,
      remainingMs: sitting.remainingMs,
    });

    return NextResponse.json({
      success: true,
      error: null,
      // Reported for the logs and for anything still reading it; `deadline` is
      // what clients should use, because it is the same value the server enforces
      // and it survives a clock skew between this machine and the browser.
      startedAt: new Date(
        new Date(sitting.deadline).getTime() - OBJECTIVE_TTL_MINUTES * 60_000,
      ).getTime(),
      deadline: sitting.deadline,
      remainingMs: sitting.remainingMs,
      expired: sitting.expired,
      minutes: OBJECTIVE_TTL_MINUTES,
    });
  } catch (error) {
    return routeError(route, error);
  }
}
