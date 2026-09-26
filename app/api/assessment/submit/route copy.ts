import { NextResponse } from "next/server";
import { Registrant } from "@/lib/models/Registrant";
import sequelize from "@/lib/db";
import { Op } from "sequelize";
import questions from "@/config/questions.json";

export async function POST(request: Request) {
  try {
    const { email, barcodeId, answers, tabSwitches, deviceId } =
      await request.json();

    const student = await Registrant.findOne({
      where: {
        email: email.toLowerCase().trim(),
        barcodeId: barcodeId.toUpperCase().trim(),
      },
    });

    if (!student)
      return NextResponse.json(
        { success: false, message: "Invalid session." },
        { status: 403 },
      );

    // SECURITY: Multiple Device Check
    if (student.deviceId && student.deviceId !== deviceId) {
      return NextResponse.json(
        {
          success: false,
          message: "DISQUALIFIED: Multiple device login detected.",
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

    // MANAGEMENT RULE: 80% CUTOFF
    const isQualified = finalPercentage >= 80;

    await student.update({
      objectiveScore: finalPercentage,
      objectiveFinishedAt: new Date(),
      isFlagged: tabSwitches > 3, // Flag if they switched tabs more than 3 times
      status: isQualified ? "qualified" : "completed",
    });

    const submissionNumber = await Registrant.count({
      where: { status: ["qualified", "completed", "shortlisted", "awarded"] },
    });

    return NextResponse.json({
      success: true,
      data: {
        score: finalPercentage,
        submissionRank: submissionNumber,
        qualified: isQualified,
        message: isQualified
          ? "Congratulations! You just completed the objective session. Now proceed with the Theory."
          : // : "You did not reach the 80% pass mark. You have been added to the waitlist for the next stream.",
            " Join the waitlist for the next TechShift scholarship stream ",
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: "Server Error" },
      { status: 500 },
    );
  }
}
