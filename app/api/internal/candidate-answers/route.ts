import { NextResponse } from "next/server";
import { Registrant } from "@/lib/models/Registrant";
import { AdmissionDecision } from "@/lib/models/AdmissionDecision";
import { ensureDatabase } from "@/lib/db";
import { requireStaff } from "@/lib/staff-guard";
import { isValidEmail, cleanText } from "@/lib/validate";
import { THEORY_QUESTIONS, essayWordCount } from "@/config/theory-questions";
import { THEORY_MIN_WORDS } from "@/config/rules";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";

// ─── SINGLE CANDIDATE RECORD ──────────────────────────────────────────────────
// "Show me this person's file." One row of PII and three free-text essays.
//
// It was gated on `authorization: Bearer ${INTERNAL_SYNC_TOKEN}` — a single
// static bearer token, in a header, with no expiry, no audience and no
// revocation. Any machine holding it could read any candidate's entire
// application, by email, forever, and there was no audit of who looked. The
// token lived in an env file that has also been committed to at least one
// branch's history on this project, which is the part that makes a
// "rotate it eventually" comment untrue.
//
// Now it requires a staff session, it requires the admissions role (this is not
// a check-in-desk function), it takes the candidate's barcode rather than their
// email address, and every read is logged. An endpoint that hands out personal
// data should be annoying to use and obvious in the logs — that is the whole
// control.

export async function GET(request: Request) {
  const { session, error } = await requireStaff("admissions");
  if (error) return error;

  const { searchParams } = new URL(request.url);

  // Three ways in, because staff hold all three at the desk: the review panel
  // already has the row's id, the desk has a printed ticket, and sometimes a
  // candidate is standing there with their confirmation email open on a phone.
  const id = cleanText(searchParams.get("registrantId") ?? "", 64);
  const lookup = cleanText(
    searchParams.get("barcode") ?? searchParams.get("email") ?? "",
    120,
  );

  if (!id && !lookup) {
    return NextResponse.json(
      { success: false, error: "BAD_REQUEST", message: "Provide a ticket code or email." },
      { status: 400 },
    );
  }

  try {
    await ensureDatabase();

    const byEmail = lookup.includes("@") && isValidEmail(lookup.toLowerCase());
    if (lookup.includes("@") && !byEmail) {
      return NextResponse.json(
        { success: false, error: "BAD_REQUEST", message: "That is not a valid email address." },
        { status: 400 },
      );
    }

    const registrant = await Registrant.findOne({
      // id wins when both are present: it is unambiguous, and an email that has
      // been edited on the candidate's profile must not silently resolve the panel
      // to a different person.
      where: id
        ? { id }
        : byEmail
          ? { email: lookup.toLowerCase() }
          : { barcodeId: lookup },
      attributes: [
        "id",
        "barcodeId",
        "name",
        "email",
        "phone",
        "checkedIn",
        "status",
        "objectiveScore",
        "objectiveRank",
        "objectiveFinishedAt",
        "theoryAnswer1",
        "theoryAnswer2",
        "theoryAnswer3",
        "theoryScore",
        "theoryGradedAt",
        "theoryGradedBy",
        "aiSuspected",
        "aiGradeReason",
        "aiConfidence",
        "isFlagged",
        "tabSwitches",
        "selectedCourseSlug",
        "decidedAt",
        "decidedBy",
        "decisionNote",
        "createdAt",
      ],
      raw: true,
    });

    if (!registrant) {
      // 404, not 403: the caller is authorised, the record just isn't there.
      return NextResponse.json(
        { success: false, error: "NOT_FOUND", message: "No candidate with that identifier." },
        { status: 404 },
      );
    }

    const row = registrant as unknown as Record<string, unknown>;

    // The decision history, so "why did this person not get a seat" is answerable
    // from the screen rather than from someone's memory six months later.
    const history = await AdmissionDecision.findAll({
      where: { registrantId: String(row.id) },
      order: [["createdAt", "DESC"]],
      limit: 50,
      raw: true,
    });

    // The essays, paired with the prompt they answered. The reviewer is grading an
    // answer to a question, so the question has to travel with it; the raw columns
    // alone are three paragraphs with no way to tell which prompt each one is for.
    // THEORY_MIN_WORDS is reported per answer so a two-line answer that scraped
    // past the minimum is visible as such rather than looking like a short but
    // considered response.
    const answers = THEORY_QUESTIONS.map((question) => {
      const text = typeof row[question.column] === "string" ? (row[question.column] as string) : "";
      return {
        q: Number(question.id.slice(1)),
        column: question.column,
        question: question.label,
        answer: text,
        words: essayWordCount(text),
      };
    });

    log.warn("admin.pii.read", {
      actor: session.name,
      role: session.role,
      // The identifier, not the payload: enough to audit, not enough to be a
      // second copy of the PII in your logs.
      lookupBy: id ? "id" : byEmail ? "email" : "barcode",
      essayCount: answers.filter((a) => a.words > 0).length,
    });

    return NextResponse.json({
      success: true,
      error: null,
      data: {
        registrant,
        answers,
        history,
        minWords: THEORY_MIN_WORDS,
      },
    });
  } catch {
    return NextResponse.json(
      { success: false, error: "UNAVAILABLE", message: "Record unavailable." },
      { status: 503 },
    );
  }
}
