import { NextResponse } from "next/server";
import { Registrant } from "@/lib/models/Registrant";
import { TOTAL_SLOTS, TECHSHIFT_COURSES } from "@/config/course-matrix";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const apiKey = request.headers.get("x-stats-key");

  if (apiKey !== process.env.PUBLIC_STATS_KEY) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const totalRegistrants = await Registrant.count();
  const totalCheckedIn = await Registrant.count({ where: { checkedIn: true } });
  const awardedCount = await Registrant.count({ where: { status: "awarded" } });

  // Real-time course distribution
  const courseStats = await Promise.all(
    TECHSHIFT_COURSES.map(async (course) => {
      const count = await Registrant.count({
        where: { selectedCourseSlug: course.slug, status: "completed" },
      });
      return { name: course.displayName, applicants: count };
    }),
  );

  return NextResponse.json({
    success: true,
    data: {
      metrics: {
        totalRegistrants,
        physicalAttendance: totalCheckedIn,
        scholarshipsAvailable: TOTAL_SLOTS,
        scholarshipsAwarded: awardedCount,
        utilizationRate: ((awardedCount / TOTAL_SLOTS) * 100).toFixed(1) + "%",
      },
      courseDistribution: courseStats,
      lastUpdated: new Date(),
    },
  });
}
