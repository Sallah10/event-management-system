import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import questions from "@/config/questions.json";
import { PASS_MARK_PERCENT } from "@/config/rules";
import { CANDIDATE_COOKIE, verifyCandidateSession } from "@/lib/session";
import { Registrant } from "@/lib/models/Registrant";
import { ensureDatabase } from "@/lib/db";
import { resolveSitting } from "@/lib/exam-sitting";
import ExamClient from "@/components/exam/ExamClient";
import type { ExamQuestion } from "@/components/exam/ExamClient";

export const dynamic = "force-dynamic";

// A sitting is private to the candidate holding the cookie. Keep every exam screen
// out of the index; robots.ts also disallows the path, and this covers a crawler
// that arrives by a shared link.
export const metadata: Metadata = {
  title: "Objective paper",
  robots: { index: false, follow: false },
};

// ─── OBJECTIVE PAPER (SERVER) ─────────────────────────────────────────────────
// This used to be a client component that took the candidate's identity from
// `localStorage.getItem("user_email")` and its clock from `useState(1800)`.
// Two separate lies in two lines of code:
//
// • The identity was browser state. Anything the browser asserts about who you
//   are, the browser can be made to assert differently. The session cookie is
//   httpOnly and signed, so it is the only thing here that the candidate cannot
//   edit. Every gate below reads it, and the submit route re-reads it - the page
//   check is convenience, not security.
//
// • The clock started at mount. See lib/exam-sitting.ts.
//
// The page also now redirects rather than rendering an exam to someone who has
// already submitted, has been suspended, or has already been awarded. Previously
// all three produced a live paper with a working timer.

export default async function ExamPage() {
  const store = await cookies();
  const session = await verifyCandidateSession(store.get(CANDIDATE_COOKIE)?.value);

  if (!session) redirect("/assessment/login");

  await ensureDatabase();

  const student = await Registrant.findOne({
    where: { email: session.email, barcodeId: session.barcodeId },
  });

  // A valid session pointing at a row that is gone is not a candidate any more.
  if (!student) redirect("/assessment/login");

  // Order matters. Already finished beats everything: a refresh after submitting
  // must land on the result, not on a fresh paper.
  if (student.objectiveFinishedAt) redirect("/assessment/result");

  if (student.isFlagged) redirect("/assessment/login?reason=suspended");

  if (student.status === "shortlisted" || student.status === "awarded") {
    redirect("/assessment/thank-you");
  }

  // Theory is only open to people who are in the pool. A waitlisted candidate
  // who hand-types /assessment/theory lands here, and gets sent to the result
  // page where the actual outcome is stated.
  if (student.status === "waitlisted" || student.status === "eliminated") {
    redirect("/assessment/result");
  }

  if (student.status === "completed") redirect("/assessment/theory");

  const sitting = await resolveSitting(student, "objective");

  return (
    <ExamClient
      questions={questions as ExamQuestion[]}
      deadline={sitting.deadline}
      passMark={PASS_MARK_PERCENT}
      barcodeId={student.barcodeId}
    />
  );
}
