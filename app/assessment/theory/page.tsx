import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CANDIDATE_COOKIE, verifyCandidateSession } from "@/lib/session";
import { Registrant } from "@/lib/models/Registrant";
import { ensureDatabase } from "@/lib/db";
import { resolveSitting } from "@/lib/exam-sitting";
import { getCourseAvailability } from "@/lib/course-availability";
import { THEORY_MIN_WORDS } from "@/config/rules";
import TheoryClient from "@/components/exam/TheoryClient";

// ─── THEORY PAPER (SERVER) ────────────────────────────────────────────────────
// Was a 598-line client component. All that has changed here is who decides
// whether this page renders, and where the numbers come from:
//
// • Identity comes from the signed session cookie, never localStorage.
// • The clock is stamped once in objective/theory_started_at and the deadline is
//   computed from it (lib/exam-sitting.ts), so a refresh no longer buys a new
//   hour.
// • Course availability is queried here and handed down as a prop, so the picker
//   renders with live seat counts on first paint. The old page rendered six grey
//   skeletons and then fetched — and on a failed fetch left the candidate staring
//   at a spinner forever, because `setLoading(false)` was only called on success.
//
// The gate is strict: only `qualified` candidates reach the theory paper. In
// practice the proxy already blocks this route, but a page that renders an
// application form to someone who is not entitled to one is a bad thing to rely
// on a middleware check for, and the middleware check can be misconfigured.

export const dynamic = "force-dynamic";

const THEORY_MAX_LENGTH = 1000;

export default async function TheoryPage() {
  const store = await cookies();
  const session = await verifyCandidateSession(store.get(CANDIDATE_COOKIE)?.value);

  if (!session) redirect("/assessment/login");

  await ensureDatabase();

  const student = await Registrant.findOne({
    where: { email: session.email, barcodeId: session.barcodeId },
  });

  if (!student) redirect("/assessment/login");
  if (student.isFlagged) redirect("/assessment/login?reason=suspended");

  // Theory submitted already: the outcome page, not the form again.
  if (student.status === "completed") redirect("/assessment/thank-you");
  if (student.status === "shortlisted" || student.status === "awarded") {
    redirect("/assessment/thank-you");
  }

  // Anyone who is not in the pool has already got their objective outcome.
  if (student.status !== "qualified") redirect("/assessment/result");

  if (!student.objectiveFinishedAt) redirect("/assessment/exam");

  const [sitting, courses] = await Promise.all([
    resolveSitting(student, "theory"),
    getCourseAvailability(),
  ]);

  return (
    <TheoryClient
      courses={courses}
      deadline={sitting.deadline}
      minWords={THEORY_MIN_WORDS}
      maxLength={THEORY_MAX_LENGTH}
      barcodeId={student.barcodeId}
      preselectedSlug={sitting.selectedCourseSlug}
    />
  );
}
