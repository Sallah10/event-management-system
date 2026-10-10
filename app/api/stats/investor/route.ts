import { NextResponse } from "next/server";
import { Op, fn, col } from "sequelize";
import { Registrant } from "@/lib/models/Registrant";
import { ensureDatabase } from "@/lib/db";
import { requireStaff } from "@/lib/staff-guard";
import { COURSES } from "@/config/course-matrix";
import {
  TOTAL_SLOTS,
  LIMIT_PER_COURSE,
  VENUE_CAPACITY,
  QUALIFIED_POOL_SIZE,
  AWARDED_STATUSES,
  SEAT_HOLDING_STATUSES,
} from "@/config/rules";

export const dynamic = "force-dynamic";

// ─── IMPACT FIGURES ───────────────────────────────────────────────────────────
// Aggregate numbers only - no names, no emails, no barcodes. That's deliberate:
// this is the shape of data you can safely show to a sponsor, a journalist or a
// funder, and keeping it aggregate is what makes that guarantee checkable rather
// than a promise.
//
// THE AUTH WAS THE PROBLEM, NOT THE DATA.
// It was gated on a header compared against PUBLIC_STATS_KEY, and nothing in the
// repo ever sent that header - there was no client, no dashboard widget, no
// script. So the endpoint had a secret and zero callers: either it was going to
// be called by something outside this repo holding a shared key, or it was
// never going to be called at all. A shared header key on an endpoint nobody
// calls is not access control.
//
// It is now a staff-authenticated route, alongside every other number the
// organisation reports. If you want a genuinely public impact page, do it by
// adding a cache layer in front of this - not by loosening the gate on a
// credential that may already be in a log somewhere.
//
// It also ran 13 sequential COUNT queries (one per course) plus three more, on
// every call, with no index on selected_course_slug. Now: three grouped queries.

export async function GET() {
  const { error } = await requireStaff("staff");
  if (error) return error;

  try {
    await ensureDatabase();

    const slugs = COURSES.map((course) => course.slug);

    const [totalRegistrants, totalCheckedIn, statusRows, courseRows, flagged] =
      await Promise.all([
        Registrant.count(),
        Registrant.count({ where: { checkedIn: true } }),
        Registrant.findAll({
          attributes: ["status", [fn("COUNT", col("id")), "count"]],
          group: ["status"],
          raw: true,
        }) as unknown as Promise<{ status: string; count: number }[]>,
        Registrant.findAll({
          attributes: ["selectedCourseSlug", [fn("COUNT", col("id")), "count"]],
          where: {
            selectedCourseSlug: { [Op.in]: slugs },
            status: { [Op.in]: [...SEAT_HOLDING_STATUSES] },
          },
          group: ["selectedCourseSlug"],
          raw: true,
        }) as unknown as Promise<
          { selectedCourseSlug: string; count: number }[]
        >,
        Registrant.count({ where: { isFlagged: true } }),
      ]);

    const byStatus = new Map(
      statusRows.map((r) => [String(r.status), Number(r.count)]),
    );
    const awarded = AWARDED_STATUSES.reduce(
      (sum, status) => sum + (byStatus.get(status) ?? 0),
      0,
    );

    const perCourse = COURSES.map((course) => ({
      slug: course.slug,
      name: course.displayName,
      applicants: Number(
        courseRows.find((r) => String(r.selectedCourseSlug) === course.slug)
          ?.count ?? 0,
      ),
      capacity: LIMIT_PER_COURSE,
    }));

    return NextResponse.json({
      success: true,
      error: null,
      data: {
        metrics: {
          totalRegistrants,
          physicalAttendance: totalCheckedIn,
          venueCapacity: VENUE_CAPACITY,
          scholarshipsAvailable: TOTAL_SLOTS,
          scholarshipsAwarded: awarded,
          utilisationPercent:
            TOTAL_SLOTS === 0
              ? 0
              : Math.round((awarded / TOTAL_SLOTS) * 1000) / 10,
          qualifiedPool: QUALIFIED_POOL_SIZE,
          underIntegrityReview: flagged,
        },
        courseDistribution: perCourse,
        lastUpdated: new Date().toISOString(),
        note: "Aggregate figures only. No candidate-identifying data is returned by this route.",
      },
    });
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "UNAVAILABLE",
        message: "Impact figures unavailable.",
      },
      { status: 503 },
    );
  }
}
