import { NextResponse } from "next/server";
import { decide, type DecisionAction } from "@/lib/admissions";
import { requireStaff } from "@/lib/staff-guard";
import { cleanText } from "@/lib/validate";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";

// ─── ADMISSIONS DECISION ──────────────────────────────────────────────────────
// The one endpoint behind every button in /admissions. It does not contain any
// rules of its own: it validates the request, hands it to `decide()` in
// lib/admissions.ts, and reports what happened.
//
// That indirection is the point. The old system had five routes writing five
// different statuses with five different ideas about who was allowed to, and the
// seat cap was enforced in some of them. A decision is a transaction and an audit
// row, and there is exactly one function that produces those. A new button cannot
// forget to write the audit row, because there is no other way to write a status.
//
// `action` is validated against a fixed list rather than reaching into
// TRANSITIONS, so this route cannot be talked into calling an action that does
// not exist, and the response vocabulary is the same everywhere.

const ACTIONS: DecisionAction[] = [
  "flag",
  "unflag",
  "shortlist",
  "award",
  "release",
  "allocate",
];

/** Statuses a correction may put somebody into. Mirrors lib/admissions.ts. */
const RELEASABLE = ["waitlisted", "eliminated", "attended", "completed"] as const;

export async function POST(request: Request) {
  const { session, error } = await requireStaff("admissions");
  if (error) return error;

  let body: {
    registrantId?: unknown;
    action?: unknown;
    note?: unknown;
    courseSlug?: unknown;
    status?: unknown;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "BAD_REQUEST", message: "Invalid request." },
      { status: 400 },
    );
  }

  const registrantId = cleanText(body.registrantId, 64);
  const action = body.action as DecisionAction;

  if (!registrantId || !ACTIONS.includes(action)) {
    return NextResponse.json(
      { success: false, error: "BAD_REQUEST", message: "Unknown candidate or action." },
      { status: 400 },
    );
  }

  // A decision with no note is allowed — most of them are obvious — but a flag or
  // a release without one is not. Those are the two an appeal would be about, and
  // "we don't know why" is not an answer anybody can act on.
  const note = cleanText(body.note, 2000);
  if ((action === "flag" || action === "unflag" || action === "release") && note.length < 5) {
    return NextResponse.json(
      {
        success: false,
        error: "NOTE_REQUIRED",
        message: "Say why, in a few words. This is the record an appeal will be judged against.",
      },
      { status: 400 },
    );
  }

  const status =
    action === "release" && typeof body.status === "string"
      ? (body.status as (typeof RELEASABLE)[number])
      : undefined;
  if (status && !(RELEASABLE as readonly string[]).includes(status)) {
    return NextResponse.json(
      { success: false, error: "BAD_REQUEST", message: "Unknown target status." },
      { status: 400 },
    );
  }

  const courseSlug =
    typeof body.courseSlug === "string" && body.courseSlug
      ? cleanText(body.courseSlug, 64)
      : undefined;

  const outcome = await decide(
    registrantId,
    action,
    { role: session.role, name: session.name },
    { note, courseSlug, status },
  );

  if (!outcome.ok) {
    // 409 for a conflict the caller can resolve by doing something else (course
    // full, illegal transition), 403 for a permission problem, 404 for nothing
    // there. The message is safe to show: every string in `decide()` was written
    // for the person who pressed the button.
    const status_code =
      outcome.error === "NOT_FOUND"
        ? 404
        : outcome.error === "FORBIDDEN"
          ? 403
          : 409;

    log.warn("admissions.decision_rejected", {
      by: session.name,
      action,
      registrantId,
      reason: outcome.error,
    });

    return NextResponse.json(
      {
        success: false,
        error: outcome.error,
        message: outcome.message ?? "That decision is not available right now.",
      },
      { status: status_code },
    );
  }

  // The happy path gets a log line too, not just the refusals. A decision log
  // that only records failures cannot answer "did we award this seat?", and the
  // database row is a status change with no record of the HTTP request that
  // triggered it.
  log.info("admissions.decision_applied", {
    by: session.name,
    role: session.role,
    action,
    registrantId,
    toStatus: outcome.status,
  });

  return NextResponse.json({
    success: true,
    error: null,
    message: `Recorded: ${action}`,
    data: { status: outcome.status, action },
  });
}
