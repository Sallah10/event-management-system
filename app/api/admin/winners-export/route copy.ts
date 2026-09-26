import { NextResponse } from "next/server";
import { Registrant } from "@/lib/models/Registrant";
import sequelize from "@/lib/db";

export async function GET(request: Request) {
  // 1. Security Check
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.split(" ")[1];

  if (token !== process.env.INTERNAL_SYNC_TOKEN) {
    return NextResponse.json({ message: "Unauthorized Sync" }, { status: 401 });
  }

  try {
    await sequelize.authenticate();

    // 2. Fetch the winners using CORRECT Attribute Names
    const winners = await Registrant.findAll({
      // Look for anyone who is 'completed' OR 'awarded' (won the race)
      where: {
        status: ["completed", "awarded", "shortlisted"],
      },
      order: [
        ["objectiveScore", "DESC"],
        ["objectiveFinishedAt", "ASC"],
      ],
      attributes: [
        "name",
        "email",
        "phone",
        "selectedCourseSlug",
        "objectiveScore",
        "objectiveFinishedAt",
      ],
      raw: true,
    });

    console.log(`📤 Exporting ${winners.length} winners to LMS...`);

    // 3. Return the response
    return NextResponse.json({
      success: true,
      winners: winners,
    });
  } catch (error: any) {
    console.error("WINNERS EXPORT ERROR:", error.message);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 },
    );
  }
}
