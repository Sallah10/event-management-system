import { NextResponse } from "next/server";
import { redis, capacityKey } from "@/lib/redis";
import { requireStaff } from "@/lib/staff-guard";
import { VENUE_CAPACITY } from "@/config/rules";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";

// ─── REDIS DIAGNOSTICS ────────────────────────────────────────────────────────
// Operational visibility into the rate limiter and the check-in counter.
//
// Was gated on the same INTERNAL_API_KEY that the dashboard was shipping to the
// browser, and it called `redis.keys("flag:*")` - KEYS is O(N) over the entire
// keyspace and blocks the single-threaded Redis server while it runs. On a busy
// event day that is a self-inflicted outage caused by an admin clicking refresh.
// It then fanned out one HTTP round-trip per key via Promise.all.
//
// SCAN with a COUNT of 100 is the non-blocking equivalent, and we cap how many
// we pull. The capacity number is labelled as advisory because it is a Redis
// counter, not the database.
export async function GET() {
  const { error } = await requireStaff("staff");
  if (error) return error;

  try {
    const currentCapacity = Number((await redis.get(capacityKey())) ?? 0);

    // Non-blocking cursor iteration instead of KEYS
    const flagged: { key: string; count: number }[] = [];
    let cursor = "0";
    do {
      const reply = (await redis.scan(
        cursor,
        "MATCH",
        "flag:*",
        "COUNT",
        100,
      )) as unknown as {
        cursor: string;
        keys: string[];
      };
      cursor = String(reply.cursor ?? "0");
      for (const key of reply.keys ?? []) {
        if (flagged.length >= 200) break;
        const count = Number((await redis.get(key)) ?? 0);
        if (count > 0) flagged.push({ key: key.replace(/^flag:/, ""), count });
      }
    } while (cursor !== "0" && flagged.length < 200);

    log.info("admin.redis_stats", { flagged: flagged.length, currentCapacity });

    return NextResponse.json({
      success: true,
      error: null,
      data: {
        currentCheckins: currentCapacity,
        remaining: Math.max(0, VENUE_CAPACITY - currentCapacity),
        capacity: VENUE_CAPACITY,
        // Stated plainly so nobody treats it as authoritative
        advisory:
          "Redis counter, may drift from Postgres by a few on a hard restart.",
        flaggedObservations: flagged,
        truncated: flagged.length >= 200,
      },
    });
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "UNAVAILABLE",
        message: "Redis diagnostics unavailable.",
      },
      { status: 503 },
    );
  }
}
