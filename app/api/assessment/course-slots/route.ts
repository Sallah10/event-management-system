import { NextResponse } from "next/server";
import { Registrant } from "@/lib/models/Registrant";
import { TECHSHIFT_COURSES, LIMIT_PER_COURSE } from "@/config/course-matrix";
import sequelize from "@/lib/db";
import { Op } from "sequelize";

export async function GET() {
  try {
    await sequelize.authenticate();

    // Count how many "completed" or "qualified" students have picked each course
    const counts = await Registrant.findAll({
      attributes: [
        "selectedCourseSlug",
        [sequelize.fn("COUNT", sequelize.col("id")), "count"],
      ],
      where: {
        status: ["awarded", "shortlisted"],
        selectedCourseSlug: { [Op.ne]: null },
      },
      group: ["selectedCourseSlug"],
      raw: true,
    });

    const availability = TECHSHIFT_COURSES.map((course) => {
      const match = (counts as any).find(
        (c: any) => c.selectedCourseSlug === course.slug,
      );
      const taken = match ? parseInt(match.count) : 0;
      return {
        ...course,
        remaining: Math.max(0, LIMIT_PER_COURSE - taken),
        isFull: taken >= LIMIT_PER_COURSE,
      };
    });

    return NextResponse.json({ success: true, availability });
  } catch (error: any) {
    console.error("Course Slots Error:", error.message);
    return NextResponse.json({
      success: false,
      message: "Error fetching slots",
    });
  }
}
