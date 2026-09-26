import { NextResponse } from "next/server";
import { Op, fn, col } from "sequelize";
import { Registrant } from "@/lib/models/Registrant";
import { ensureDatabase } from "@/lib/db";
import { requireStaff } from "@/lib/staff-guard";
import { getPoolPressure } from "@/lib/ranking";
import { COURSES } from "@/config/course-matrix";
import {
  LIMIT_PER_COURSE,
  TOTAL_SLOTS,
  VENUE_CAPACITY,
  QUALIFIED_POOL_SIZE,
  PIPELINE,
} from "@/config/rules";

export const dynamic = "force-dynamic";

// ─── LIVE EVENT STATS ─────────────────────────────────────────────────────────
// THE BIGGEST AUTH PROBLEM IN THE REPO.
//
// The dashboard called this with
//     "x-api-key": process.env.NEXT_PUBLIC_INTERNAL_API_KEY
// and the route compared that header against process.env.INTERNAL_API_KEY.
// Any variable prefixed NEXT_PUBLIC_ is inlined into the client bundle at build
// time — that is what the prefix MEANS. So the shared secret protecting a
// response containing 100 rows of name + email + barcodeId was published in the
// JavaScript, and .env carried two copies of it (INTERNAL_API_KEY and
// NEXT_PUBLIC_INTERNAL_API_KEY) free to drift apart. It also returned
// `error.message` to the client on failure.
//
// Now: staff session cookie only, role-gated, and the response tells the truth
// about where the numbers come from. Note the attendance count is read from
// Postgres, not Redis: the Redis counter is a fast display value that can drift
// if a serverless instance dies between the UPDATE and the INCR, so it is never
// the number you make a decision on.
export async function GET() {
  const { error } = await requireStaff("staff");
  if (error) return error;

  try {
    await ensureDatabase();

    const slugs = COURSES.map((course) => course.slug);

    const [total, checkedIn, finishedObjective, flagged, awaitingGrading, courseRows, pool] =
      await Promise.all([
        Registrant.count(),
        Registrant.count({ where: { checkedIn: true } }),
        Registrant.count({ where: { objectiveFinishedAt: { [Op.ne]: null } } }),
        Registrant.count({ where: { isFlagged: true } }),
        Registrant.count({ where: { status: "completed", theoryScore: 0 } }),
        Registrant.findAll({
          attributes: ["selectedCourseSlug", [fn("COUNT", col("id")), "taken"]],
          where: {
            selectedCourseSlug: { [Op.in]: slugs },
            status: { [Op.in]: ["awarded", "shortlisted", "completed"] },
          },
          group: ["selectedCourseSlug"],
          raw: true,
        }),
        getPoolPressure(),
      ]);

    // One aggregate query for the whole pipeline instead of a count per status
    const pipelineRows = (await Registrant.findAll({
      attributes: ["status", [fn("COUNT", col("id")), "count"]],
      group: ["status"],
      raw: true,
    })) as unknown as { status: string; count: number }[];
    const byStatus = new Map(pipelineRows.map((r) => [String(r.status), Number(r.count)]));

    const recent = await Registrant.findAll({
      where: { checkedIn: true },
      order: [["updatedAt", "DESC"]],
      limit: 25,
      attributes: ["id", "name", "email", "selectedCourseSlug", "status", "updatedAt", "barcodeId"],
      raw: true,
    });

    const takenBySlug = new Map(
      (courseRows as unknown as { selectedCourseSlug: string; taken: number }[]).map((r) => [
        String(r.selectedCourseSlug),
        Number(r.taken ?? 0),
      ]),
    );

    return NextResponse.json({
      success: true,
      error: null,
      data: {
        summary: {
          total,
          checkedIn,
          attendanceRate: total === 0 ? 0 : Math.round((checkedIn / total) * 100),
          venueCapacity: VENUE_CAPACITY,
          venueRemaining: Math.max(0, VENUE_CAPACITY - checkedIn),
        },
        pool: {
          size: QUALIFIED_POOL_SIZE,
          finished: pool.finished,
          insidePool: pool.insidePool,
          remaining: pool.remaining,
        },
        scholarships: {
          total: TOTAL_SLOTS,
          perCourse: LIMIT_PER_COURSE,
          awarded: byStatus.get("awarded") ?? 0,
          shortlisted: byStatus.get("shortlisted") ?? 0,
        },
        queue: {
          finishedObjective,
          awaitingGrading,
          flagged,
        },
        pipeline: PIPELINE.map((stage) => ({
          ...stage,
          count: byStatus.get(stage.key) ?? 0,
        })),
        courses: COURSES.map((course) => {
          const used = takenBySlug.get(course.slug) ?? 0;
          return {
            slug: course.slug,
            displayName: course.displayName,
            taken: used,
            capacity: LIMIT_PER_COURSE,
            remaining: Math.max(0, LIMIT_PER_COURSE - used),
            fillRate: Math.round((used / LIMIT_PER_COURSE) * 100),
          };
        }),
        recent,
      },
    });
  } catch {
    return NextResponse.json(
      { success: false, error: "UNAVAILABLE", message: "Stats unavailable." },
      { status: 503 },
    );
  }
}
