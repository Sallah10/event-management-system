import { NextRequest, NextResponse } from "next/server"; // Use NextRequest
import { Registrant } from "@/lib/models/Registrant";
import sequelize from "@/lib/db";
import { LIMIT_PER_COURSE, TOTAL_SLOTS } from "@/config/course-matrix";

// Remove the import from "https" - that was the culprit!

export async function GET(request: NextRequest) {
  // Get API Key from headers correctly
  const apiKey = request.headers.get("x-api-key");

  if (apiKey !== process.env.INTERNAL_API_KEY) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    await sequelize.authenticate();

    const [total, checkedIn, qualified, recent] = await Promise.all([
      Registrant.count(),
      Registrant.count({ where: { checkedIn: true } }),
      Registrant.count({
        where: { status: ["qualified", "completed", "shortlisted", "awarded"] },
      }),
      Registrant.findAll({
        where: { checkedIn: true },
        order: [["updatedAt", "DESC"]],
        limit: 100,
        attributes: [
          "name",
          "email",
          "selectedCourseSlug",
          "updatedAt",
          "barcodeId",
        ],
      }),
    ]);

    return NextResponse.json({
      success: true,
      summary: { total, checkedIn, qualified },
      config: {
        serverTotalSlots: TOTAL_SLOTS,
        serverLimitPerCourse: LIMIT_PER_COURSE,
      },
      recent,
    });
  } catch (error: any) {
    console.error("STATS ERROR:", error);
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 },
    );
  }
}
