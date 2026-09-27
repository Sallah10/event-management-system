import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Mail } from "lucide-react";
import { CANDIDATE_COOKIE, verifyCandidateSession } from "@/lib/session";
import { Registrant } from "@/lib/models/Registrant";
import { ensureDatabase } from "@/lib/db";
import { PASS_MARK_PERCENT, QUALIFIED_POOL_SIZE } from "@/config/rules";
import { BRAND } from "@/config/branding";
import { Button } from "@/components/ui/button";

// ─── OBJECTIVE RESULT (SERVER) ────────────────────────────────────────────────
// The score on this page used to come from `localStorage.getItem("latest_result")`
// — a JSON blob the previous page wrote. Two things wrong with that:
//
// 1. It is the candidate's own browser telling them their result. Editing one
//    character in devtools turns "below the pass mark" into "Congratulations".
//    Nothing about the database changed. The number had to be moved back to being
//    read from the server, which is the only place it was ever true.
//
// 2. The page also linked to a real, private Google Form for the "next stream
//    waitlist" — an external URL, in a public repository, pointing at somebody's
//    private document. Removed. The contact address now comes from BRAND.
//
// It also renders a "REMEMBER!" overlay with a rules list and a "START THEORY
// NOW" button that was dead code, commented-out score panels, and a claim in the
// body — "Ranking is FIRST COME, FIRST SERVE not based on scores" — which is the
// exact opposite of how lib/ranking.ts ranks. It ranks by score first, then by
// finish time. So the page was stating a falsehood about the one rule candidates
// care about most, in the place they were most likely to read carefully.
//
// Presentation: a result is a document, so it is set as one. The two figures are
// now a bordered pair on a hairline rather than two sunk tiles, and the
// pass/fail distinction is carried by the wording and the single action below
// rather than by a dark banner and a trophy icon.

export const dynamic = "force-dynamic";

export default async function ResultPage() {
  const store = await cookies();
  const session = await verifyCandidateSession(store.get(CANDIDATE_COOKIE)?.value);

  if (!session) redirect("/assessment/login");

  await ensureDatabase();

  const student = await Registrant.findOne({
    where: { email: session.email, barcodeId: session.barcodeId },
  });

  if (!student) redirect("/assessment/login");

  // Past the objective paper there is nothing to report here.
  if (!student.objectiveFinishedAt) redirect("/assessment/exam");
  if (
    student.status === "completed" ||
    student.status === "shortlisted" ||
    student.status === "awarded"
  ) {
    redirect("/assessment/thank-you");
  }

  const score = student.objectiveScore ?? 0;
  const rank = student.objectiveRank;
  const qualified = student.status === "qualified";
  const metPassMark = score >= PASS_MARK_PERCENT;

  const heading = qualified
    ? "You're in the pool."
    : metPassMark
      ? "You met the pass mark."
      : "You didn't reach the pass mark.";

  const body = qualified
    ? "Your score put you inside the qualifying pool. The theory section is open to you now."
    : metPassMark
      ? `You scored ${score}%, which meets the ${PASS_MARK_PERCENT}% pass mark. The pool of ${QUALIFIED_POOL_SIZE} places filled before your turn, so you've been added to the waitlist rather than the shortlist. Your score and finish time are on record, and both are kept — that matters if places are released later.`
      : `You scored ${score}%, below the ${PASS_MARK_PERCENT}% needed to continue. Your score has been recorded.`;

  return (
    <main
      id="main"
      className="flex min-h-dvh items-center justify-center bg-paper px-5 py-16 sm:px-8"
    >
      <div className="w-full max-w-lg">
        <p className="rule eyebrow">Objective paper</p>

        <h1 className="mt-3 font-display text-h1 text-balance text-ink">
          {heading}
        </h1>

        {/* The two figures that matter, side by side on a shared rule. */}
        <dl className="mt-8 grid grid-cols-2 border-y border-line">
          <div className="flex flex-col gap-1 py-5 pr-6">
            <dt className="eyebrow">Your score</dt>
            <dd>
              <span
                data-numeric
                className="font-display text-h2 leading-none tabular-nums text-ink"
              >
                {score}
                <span className="text-lead text-ink-soft">%</span>
              </span>
              <span className="mt-1.5 block text-small text-ink-soft">
                pass mark {PASS_MARK_PERCENT}%
              </span>
            </dd>
          </div>
          <div className="flex flex-col gap-1 border-l border-line py-5 pl-6">
            <dt className="eyebrow">
              {qualified ? "Pool position" : "Overall position"}
            </dt>
            <dd>
              <span
                data-numeric
                className="font-display text-h2 leading-none tabular-nums text-ink"
              >
                {rank ? `#${rank}` : "—"}
              </span>
              <span className="mt-1.5 block text-small text-ink-soft">
                of {QUALIFIED_POOL_SIZE} places
              </span>
            </dd>
          </div>
        </dl>

        <p className="measure mt-6 text-lead text-pretty text-ink-soft">{body}</p>

        {qualified ? (
          <Button asChild size="lg" variant="accent" className="mt-7 w-full">
            <Link href="/assessment/theory">
              Go to the theory section
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        ) : (
          <p className="measure mt-7 border-l-2 border-line-strong pl-4 text-small leading-relaxed text-ink-soft">
            Questions about your result? Email{" "}
            <a
              href={`mailto:${BRAND.contactEmail}`}
              className="font-medium text-ink underline decoration-line-strong underline-offset-4 transition-colors hover:decoration-ink"
            >
              {BRAND.contactEmail}
            </a>{" "}
            with your ticket reference and quote the score above. Please don&apos;t
            include a copy of the paper itself.
          </p>
        )}

        <p className="mt-8 flex items-center gap-2 border-t border-line pt-5 text-small text-ink-faint">
          <Mail aria-hidden className="size-4" />
          {BRAND.organisation} · {BRAND.name}
        </p>
      </div>
    </main>
  );
}
