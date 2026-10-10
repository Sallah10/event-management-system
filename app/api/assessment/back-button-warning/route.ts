import { NextResponse } from "next/server";
import { requireCandidate } from "@/lib/auth";
import { redis, backButtonKey } from "@/lib/redis";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";

// ─── BACK-NAVIGATION WARNING ──────────────────────────────────────────────────
// Fired when the candidate navigates backwards inside the exam. Counted per
// candidate so the page can escalate the messaging, TTL-bounded to the sitting.
//
// Recorded as an observation, not a verdict - same reasoning as /api/assessment/flag.
// A human in the integrity queue decides what a pattern of these means.
const MAX_WARNINGS = 2;

export async function POST(request: Request) {
  const { session, error } = await requireCandidate(request);
  if (error) return error;

  const key = backButtonKey(session.barcodeId);
  const count = Number((await redis.incr(key)) ?? 1);
  if (count === 1) await redis.expire(key, 60 * 60 * 2);

  log.info("assessment.backnav", { barcodeId: session.barcodeId, count });

  return NextResponse.json({
    success: true,
    error: null,
    count,
    maxWarnings: MAX_WARNINGS,
    warning: count < MAX_WARNINGS,
  });
}
