import { NextResponse } from "next/server";
import { Registrant } from "@/lib/models/Registrant";
import sequelize from "@/lib/db";
import { LIMIT_PER_COURSE } from "@/config/course-matrix";

export async function POST(request: Request) {
  const t = await sequelize.transaction();

  try {
    const { email, barcodeId, selectedSlug, answers } = await request.json();
    const { q1, q2, q3 } = answers;

    const student = await Registrant.findOne({
      where: {
        email: email.toLowerCase().trim(),
        barcodeId: barcodeId.toUpperCase().trim(),
      },
      transaction: t,
      lock: true,
    });
    if (!student) {
      await t.rollback();
      return NextResponse.json(
        { message: "Identity not found" },
        { status: 404 },
      );
    }

    console.log(
      `Checking Status for ${email}: Current Status is [${student.status}]`,
    );

    if (student.status !== "qualified") {
      await t.rollback();
      return NextResponse.json(
        {
          success: false,
          message: `Access Denied: Your current status is ${student.status}. You must pass Stage 1 first.`,
        },
        { status: 403 },
      );
    }
    // Atomic Capacity Check
    const currentCourseCount = await Registrant.count({
      where: {
        selectedCourseSlug: selectedSlug,
        status: ["awarded", "shortlisted"],
      },
      transaction: t,
    });

    if (currentCourseCount >= LIMIT_PER_COURSE) {
      await t.rollback();
      return NextResponse.json(
        { success: false, message: "COURSE_FULL" },
        { status: 400 },
      );
    }

    // Save all 3 answers
    await student.update(
      {
        theoryAnswer1: q1,
        theoryAnswer2: q2,
        theoryAnswer3: q3,
        selectedCourseSlug: selectedSlug,
        status: "awarded",
      },
      { transaction: t },
    );

    await t.commit();
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (t) await t.rollback();
    return NextResponse.json(
      { success: false, message: "Server Error" },
      { status: 500 },
    );
  }
}
