import { cookies } from "next/headers";
import type { Metadata } from "next";
import { CANDIDATE_COOKIE, verifyCandidateSession } from "@/lib/session";
import { Registrant } from "@/lib/models/Registrant";
import { ensureDatabase } from "@/lib/db";
import { isLate } from "@/lib/exam-sitting";
import ThankYouView from "@/components/assessment/ThankYouView";

export const dynamic = "force-dynamic";

// Private to the candidate's session; never indexed.
export const metadata: Metadata = {
  title: "Submission received",
  robots: { index: false, follow: false },
};

// ─── CONFIRMATION ─────────────────────────────────────────────────────────────
// A server component now, where it used to be a client component that knew
// nothing.
//
// It was asked to confirm a submission, and it had no way of finding out whether
// one had been made. Everything on it was static: the event name was hardcoded to
// last year's summit, the "return to homepage" button pointed at a hardcoded
// domain, and the four social buttons pointed at a hardcoded organisation's
// accounts. So a deployment of this for a different cohort showed the previous
// cohort's name and sent every candidate to somebody else's website.
//
// Lateness is now read from the database rather than passed through the URL or
// sessionStorage. Both of those are the candidate's to set: `?late=1` in the
// address bar or a sessionStorage key would have let anyone produce a "your
// submission was on time" screen for a paper that was not, which is a small lie
// but exactly the sort of one this system exists not to tell. The comparison is
// the same one the submit route made, against the same columns.
export default async function ThankYouPage() {
  const store = await cookies();
  const session = await verifyCandidateSession(store.get(CANDIDATE_COOKIE)?.value);

  let submittedLate = false;
  let track: string | null = null;

  if (session) {
    await ensureDatabase();
    const student = await Registrant.findOne({
      where: { email: session.email, barcodeId: session.barcodeId },
      attributes: [
        "theoryStartedAt",
        "theoryFinishedAt",
        "selectedCourseSlug",
        "objectiveScore",
        "objectiveRank",
        "status",
      ],
    });

    if (student) {
      // `isLate` recomputes against the clock as it stands now, which is the right
      // question here: if they submitted on time, the deadline is still in the
      // past, so this is only ever true when the finish really was past it.
      submittedLate = Boolean(student.theoryFinishedAt) && isLate(student, "theory");
      track = student.selectedCourseSlug;
    }
  }

  return <ThankYouView submittedLate={submittedLate} track={track} />;
}
