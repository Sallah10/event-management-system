import { NextResponse } from "next/server";
import { Registrant } from "@/lib/models/Registrant";

export async function GET(request: Request) {
  // Auth check
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.split(" ")[1];

  if (!token || token !== process.env.INTERNAL_SYNC_TOKEN) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    const winners = await Registrant.findAll({
      where: {
        status: ["completed", "awarded", "shortlisted"],
        isFlagged: false, // FIX: exclude AI-suspected candidates
      },
      order: [
        ["theoryScore", "DESC"], // primary ranking — AI graded theory
        ["objectiveScore", "DESC"], // secondary — objective exam
        ["objectiveFinishedAt", "ASC"], // tiebreaker — fastest finisher
      ],
      attributes: [
        "name",
        "email",
        "phone",
        "selectedCourseSlug",
        "objectiveScore",
        "theoryScore", // FIX: was missing
        "objectiveFinishedAt",
        "isFlagged",
        "status",
      ],
      raw: true,
    });

    console.log(`📤 Exporting ${winners.length} winners to LMS`);

    return NextResponse.json({
      success: true,
      count: winners.length,
      winners,
    });
  } catch (error: any) {
    console.error("WINNERS EXPORT ERROR:", error.name, error.message);
    // FIX: never expose error.message to client
    return NextResponse.json(
      { success: false, error: "Export failed. Check server logs." },
      { status: 500 },
    );
  }
}
