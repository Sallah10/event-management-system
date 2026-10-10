import { NextResponse } from "next/server";
import { requireCandidate } from "@/lib/auth";
import { ensureDatabase } from "@/lib/db";
import { getCourseAvailability } from "@/lib/course-availability";
import { LIMIT_PER_COURSE } from "@/config/rules";

export const dynamic = "force-dynamic";

// ─── COURSE AVAILABILITY ──────────────────────────────────────────────────────
// Was `export async function GET()` with no auth of any kind - anyone could read
// live per-course scholarship uptake for all 13 tracks. It also called
// `sequelize.authenticate()` on every call, which is a connection checkout and a
// round-trip that accomplishes nothing, and it returned HTTP 200 on failure with
// `{ success: false }`, so the client could not tell "no seats left" apart from
// "the database is down" - which on the theory page means a candidate is told a
// full course is open.
//
// Now: session required, failures return a real status code, and the query lives
// in lib/course-availability.ts so the theory page renders the same numbers
// server-side instead of re-fetching them after mount.
export async function GET(request: Request) {
  const { error } = await requireCandidate(request);
  if (error) return error;

  try {
    await ensureDatabase();
    const availability = await getCourseAvailability();

    return NextResponse.json({
      success: true,
      error: null,
      data: { availability, capacity: LIMIT_PER_COURSE },
    });
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "UNAVAILABLE",
        message: "Course list unavailable.",
      },
      { status: 503 },
    );
  }
}
