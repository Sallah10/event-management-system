import { NextResponse } from "next/server";
import { Registrant } from "@/lib/models/Registrant";
import sequelize from "@/lib/db";
import { LIMIT_PER_COURSE } from "@/config/course-matrix";
import { verifyToken, getAuthToken } from "@/lib/auth";

export async function POST(request: Request) {
  const t = await sequelize.transaction();

  try {
    // Verify JWT
    const token = getAuthToken(request as any);
    if (!token) {
      await t.rollback();
      return NextResponse.json(
        { success: false, message: "Invalid session" },
        { status: 401 },
      );
    }

    const payload = verifyToken(token);
    if (!payload) {
      await t.rollback();
      return NextResponse.json(
        { success: false, message: "Session expired" },
        { status: 401 },
      );
    }

    const { selectedSlug, answers } = await request.json();
    const { q1, q2, q3 } = answers;

    const student = await Registrant.findOne({
      where: {
        email: payload.email,
        barcodeId: payload.barcodeId,
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

    // Check if already awarded
    if (student.status === "awarded" || student.status === "shortlisted") {
      await t.rollback();
      return NextResponse.json(
        {
          success: false,
          message: "You have already submitted your theory section.",
        },
        { status: 403 },
      );
    }

    // Must be qualified to proceed
    if (student.status !== "qualified") {
      await t.rollback();
      return NextResponse.json(
        {
          success: false,
          message: `Access Denied: You must pass Stage 1 first. Current status: ${student.status}`,
        },
        { status: 403 },
      );
    }

    // Atomic capacity check
    const currentCourseCount = await Registrant.count({
      where: {
        selectedCourseSlug: selectedSlug,
        status: ["awarded", "shortlisted"], // Consistent with course-slots API
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

    // Save answers
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
    console.error("Theory submit error:", error);
    return NextResponse.json(
      { success: false, message: "Server Error" },
      { status: 500 },
    );
  }
}
