import { NextResponse } from "next/server";
import { Registrant } from "@/lib/models/Registrant";
import { ensureDatabase } from "@/lib/db";
import { getCandidateSession, routeError } from "@/lib/auth";
import { QUALIFIED_POOL_SIZE, OBJECTIVE_TTL_MINUTES } from "@/config/rules";

// ─── SESSION STATUS ───────────────────────────────────────────────────────────
// THIS ROUTE USED TO NOT EXIST.
//
// The file lived at app/assessment/status/route.ts, which Next serves at
// /assessment/status. Both the exam and theory pages called
// fetch("/api/assessment/status") — a 404. The client checked `status === 401`,
// a 404 isn't 401, res.json() then threw on the HTML error body, and the catch
// block logged "Session check failed" and moved on. Net effect: the entire
// server-side session gate was dead code and the only thing standing between a
// stranger and the exam was `localStorage.getItem("user_email")`, which anyone
// can set in DevTools.
//
// It lives at /api/assessment/status now, returns real 401s, and is backed by
// the same verification as every other route.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const route = "assessment.status";

  try {
    await ensureDatabase();

    const session = await getCandidateSession(request);
    if (!session) {
      return NextResponse.json(
        { success: false, message: "No valid session." },
        { status: 401 },
      );
    }

    const student = await Registrant.findOne({
      where: { barcodeId: session.barcodeId },
      attributes: [
        "status",
        "isFlagged",
        "objectiveScore",
        "objectiveFinishedAt",
        "selectedCourseSlug",
        "theoryScore",
      ],
    });

    if (!student) {
      return NextResponse.json(
        { success: false, message: "Registration not found." },
        { status: 404 },
      );
    }

    // Where this candidate currently sits in the pipeline, so the client can
    // route them instead of guessing.
    return NextResponse.json({
      success: true,
      status: student.status,
      isFlagged: student.isFlagged,
      objectiveScore: student.objectiveScore,
      objectiveFinishedAt: student.objectiveFinishedAt,
      theoryScore: student.theoryScore,
      selectedCourseSlug: student.selectedCourseSlug,
      // Surfaced so the client can explain *why* a seat is or isn't available
      rules: {
        passMark: 80,
        poolSize: QUALIFIED_POOL_SIZE,
        examMinutes: OBJECTIVE_TTL_MINUTES,
      },
    });
  } catch (error) {
    return routeError(route, error);
  }
}
