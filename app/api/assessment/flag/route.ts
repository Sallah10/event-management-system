import { NextResponse } from "next/server";
import { Registrant } from "@/lib/models/Registrant";
import { ensureDatabase } from "@/lib/db";
import { requireCandidate, routeError } from "@/lib/auth";
import { redis, flagKey } from "@/lib/redis";
import { sittingStartedAtMs } from "@/lib/exam-sitting";
import { logMetrics } from "@/lib/logger";

export const dynamic = "force-dynamic";

// ─── INTEGRITY FLAG ───────────────────────────────────────────────────────────
// This route let the CLIENT decide whether an academic-integrity violation
// happened. There was no server-side detection of anything: the trigger was a
// bare POST with a free-text `reason`, and three of them set
// `isFlagged = true` - a permanent database write with no un-flag path anywhere
// in the codebase. A candidate could also reset the 30-second grace window at
// will by re-calling /api/assessment/start-exam before each flag, because the
// window was read from a Redis key the client could rewrite.
//
// The deeper truth: everything this route was fed came from browser event
// listeners (blur, visibilitychange, resize). Those are signals, not evidence -
// a candidate alt-tabbing to read a textbook and a candidate switching to a
// second monitor to look at notes produce identical events.
//
// So the split is:
//
//   THIS ENDPOINT  records an *observation*. It counts, it timestamps, it
//                  stores the client-supplied reason, and it returns what the
//                  candidate should be told. It does NOT disqualify anyone.
//
//   THE INTEGRITY QUEUE  (in the admissions portal) is where a human decides.
//                  That's the only thing that writes isFlagged now.
//
// The candidate-facing messaging is unchanged, because from their side the
// warning ladder should feel the same.
const MAX_WARNINGS = 3;
const GRACE_MS = 30_000;

export async function POST(request: Request) {
  const route = "assessment.flag";

  try {
    await ensureDatabase();

    const { session, error } = await requireCandidate(request);
    if (error) return error;

    let reason = "unspecified";
    try {
      const body = await request.json();
      if (typeof body?.reason === "string" && body.reason.trim()) {
        // JSON-encoded by the logger, so a newline can't forge a log line
        reason = body.reason.trim().slice(0, 200);
      }
    } catch {
      // A missing body is still an observation; record it with the default reason
    }

    const { barcodeId } = session;

    // Already disqualified by a human? Say so plainly and stop counting.
    const student = await Registrant.findOne({
      where: { barcodeId },
      // objectiveStartedAt is loaded for the grace window below. It used to come
      // from Redis, so the attribute list was just ["isFlagged"].
      attributes: ["isFlagged", "objectiveStartedAt"],
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
          warning: true,
          forceLogout: true,
          message: "This account has been suspended. Speak to an invigilator.",
        },
        { status: 403 },
      );
    }

    // ─── GRACE WINDOW ────────────────────────────────────────────────────────
    // Read from the database column, not from the Redis start key this used to
    // read. A Redis key that has expired or been evicted reads as "never
    // started", so a candidate sitting an hour into their paper had no grace
    // period at all and was counted from their very first focus loss. The column
    // cannot evaporate, and it is the same clock the paper counts down.
    //
    // Still read-only: this route never stamps a start. A candidate who has not
    // opened the paper has no sitting, and starting one here would shorten their
    // exam at the moment they were suspected of something.
    const startedAt = sittingStartedAtMs(student, "objective");
    const inGrace = startedAt > 0 && Date.now() - startedAt < GRACE_MS;

    if (inGrace) {
      logMetrics.flag(barcodeId, reason, 0);
      return NextResponse.json({
        success: true,
        error: null,
        grace: true,
        warning: false,
        flagCount: 0,
        message: "You're still in the grace period. Settle in first.",
      });
    }

    // ─── COUNT ───────────────────────────────────────────────────────────────
    const key = flagKey(barcodeId);
    const count = Number((await redis.incr(key)) ?? 1);
    if (count === 1) await redis.expire(key, 60 * 60 * 60);

    logMetrics.flag(barcodeId, reason, count);

    const remaining = MAX_WARNINGS - count;

    return NextResponse.json({
      success: true,
      error: null,
      grace: false,
      warning: count < MAX_WARNINGS,
      flagCount: count,
      maxWarnings: MAX_WARNINGS,
      remaining,
      forceLogout: false,
      message:
        remaining > 0
          ? `Focus left the exam window. ${remaining} warning${remaining === 1 ? "" : "s"} left before your session is paused for review.`
          : "That's the last warning. Your session is now flagged for review by an invigilator.",
    });
  } catch (error) {
    return routeError(route, error);
  }
}
