import { NextResponse } from "next/server";
import { Registrant } from "@/lib/models/Registrant";
import sequelize from "@/lib/db";
import { Op } from "sequelize";
import questions from "@/config/questions.json";
import { verifyToken, getAuthToken } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    // Verify JWT token
    const token = getAuthToken(request as any);
    if (!token) {
      return NextResponse.json(
        { success: false, message: "Invalid session." },
        { status: 401 },
      );
    }

    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json(
        { success: false, message: "Session expired." },
        { status: 401 },
      );
    }

    const { answers, tabSwitches } = await request.json();

    const student = await Registrant.findOne({
      where: {
        email: payload.email,
        barcodeId: payload.barcodeId,
      },
    });

    if (!student) {
      return NextResponse.json(
        { success: false, message: "Invalid session." },
        { status: 403 },
      );
    }

    // Check if already submitted
    if (student.objectiveFinishedAt) {
      return NextResponse.json(
        {
          success: false,
          message: "You have already submitted this assessment.",
        },
        { status: 403 },
      );
    }

    // Check flag count (you need to implement flag counting in DB)
    if (student.isFlagged) {
      return NextResponse.json(
        {
          success: false,
          message: "DISQUALIFIED: Academic integrity violation detected.",
        },
        { status: 403 },
      );
    }

    // SCORING
    let score = 0;
    questions.forEach((q: any) => {
      if (answers[q.id] === q.correct) score += 1;
    });

    const finalPercentage = Math.round((score / questions.length) * 100);
    const isQualified = finalPercentage >= 80;

    // Update student
    await student.update({
      objectiveScore: finalPercentage,
      objectiveFinishedAt: new Date(),
      isFlagged: student.isFlagged || tabSwitches > 3,
      status: isQualified ? "qualified" : "completed",
    });

    // Get submission rank
    let submissionNumber = null;
    if (isQualified) {
      submissionNumber = await Registrant.count({
        where: {
          status: ["qualified", "shortlisted", "awarded"], // Only qualified statuses
          objectiveFinishedAt: { [Op.ne]: null },
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        score: finalPercentage,
        submissionRank: submissionNumber,
        qualified: isQualified,
        message: isQualified
          ? "Congratulations! Proceed to Theory section."
          : "Join the waitlist for the next TechShift scholarship stream",
      },
    });
  } catch (error: any) {
    console.error("Submit error:", error);
    return NextResponse.json(
      { success: false, message: "Server Error" },
      { status: 500 },
    );
  }
}
