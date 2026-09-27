import { NextResponse } from "next/server";
import { saveHumanGrade } from "@/lib/admissions";
import { requireStaff } from "@/lib/staff-guard";
import { cleanText } from "@/lib/validate";

export const dynamic = "force-dynamic";

// ─── SAVE A HUMAN GRADE ───────────────────────────────────────────────────────
// One candidate, one score, one name against it.
//
// The AI batch route exists for the 900-essay sweep. This exists because a model
// proposing grades and a panel confirming them are different acts, and a reviewer
// correcting a score must leave the model's own reasoning on the record rather
// than replace it. The score range is validated here as an integer, not coerced:
// Number("85") from a text box is a number, Number("") is 0, and an empty field
// silently zeroing a candidate is exactly the sort of quiet wrong answer this
// codebase keeps having to undo.

export async function POST(request: Request) {
  const { session, error } = await requireStaff("admissions");
  if (error) return error;

  let body: { registrantId?: unknown; theoryScore?: unknown; note?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "BAD_REQUEST", message: "Invalid request." },
      { status: 400 },
    );
  }

  const registrantId = cleanText(body.registrantId, 64);
  const raw = body.theoryScore;

  // Reject rather than coerce. A missing or non-numeric score is a mistake worth
  // surfacing, not a zero.
  if (!registrantId || (typeof raw !== "number" && typeof raw !== "string")) {
    return NextResponse.json(
      { success: false, error: "BAD_REQUEST", message: "Candidate and score required." },
      { status: 400 },
    );
  }

  const parsed = typeof raw === "number" ? raw : Number(raw.trim());
  if (!Number.isInteger(parsed)) {
    return NextResponse.json(
      {
        success: false,
        error: "BAD_REQUEST",
        message: "Score must be a whole number between 0 and 100.",
      },
      { status: 400 },
    );
  }

  const outcome = await saveHumanGrade(
    registrantId,
    parsed,
    { role: session.role, name: session.name },
    cleanText(body.note, 2000),
  );

  if (!outcome.ok) {
    return NextResponse.json(
      {
        success: false,
        error: outcome.error,
        message:
          outcome.error === "NOT_FOUND"
            ? "That candidate is not in the system."
            : "That score is not valid.",
      },
      { status: outcome.error === "NOT_FOUND" ? 404 : 400 },
    );
  }

  return NextResponse.json({
    success: true,
    error: null,
    message: "Grade recorded.",
    data: {
      theoryScore: parsed,
      previousScore: outcome.previousScore ?? null,
      gradedBy: session.name,
    },
  });
}
