import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Mail, Trophy, XCircle } from "lucide-react";
import { CANDIDATE_COOKIE, verifyCandidateSession } from "@/lib/session";
import { Registrant } from "@/lib/models/Registrant";
import { ensureDatabase } from "@/lib/db";
import { PASS_MARK_PERCENT, QUALIFIED_POOL_SIZE } from "@/config/rules";
import { BRAND } from "@/config/branding";

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
    ? "You're in the pool"
    : metPassMark
      ? "You met the pass mark"
      : "You didn't reach the pass mark";

  const body = qualified
    ? "Your score put you inside the qualifying pool. The theory section is open to you now."
    : metPassMark
      ? `You scored ${score}%, which meets the ${PASS_MARK_PERCENT}% pass mark. The pool of ${QUALIFIED_POOL_SIZE} places filled before your turn, so you've been added to the waitlist rather than the shortlist. Your score and finish time are on record, and both are kept — that matters if places are released later.`
      : `You scored ${score}%, below the ${PASS_MARK_PERCENT}% needed to continue. Your score has been recorded.`;

  return (
    <main className="grid min-h-dvh place-items-center bg-paper px-4 py-12 text-ink">
      <div className="w-full max-w-lg">
        <div className="overflow-hidden rounded-3xl border border-ink/10 bg-white shadow-sm">
          <div
            className={`px-8 py-9 text-paper ${
              qualified ? "bg-ink" : "bg-ink/85"
            }`}
          >
            {qualified ? (
              <Trophy className="mb-4 h-8 w-8 text-amber" aria-hidden />
            ) : (
              <XCircle className="mb-4 h-8 w-8 text-amber/70" aria-hidden />
            )}
            <h1 className="text-2xl font-bold leading-tight sm:text-3xl">
              {heading}
            </h1>
          </div>

          <div className="space-y-7 px-8 py-8">
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-2xl bg-paper p-5 text-center">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-ink-soft">
                  Your score
                </p>
                <p className="mt-2 text-4xl font-bold tabular-nums">
                  {score}
                  <span className="text-sm font-semibold text-ink-soft">%</span>
                </p>
                <p className="mt-1 text-[11px] text-ink-soft">
                  pass mark {PASS_MARK_PERCENT}%
                </p>
              </div>

              <div className="rounded-2xl bg-paper p-5 text-center">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-ink-soft">
                  {qualified ? "Pool position" : "Overall position"}
                </p>
                <p className="mt-2 text-4xl font-bold tabular-nums">
                  {rank ? `#${rank}` : "—"}
                </p>
                <p className="mt-1 text-[11px] text-ink-soft">
                  of {QUALIFIED_POOL_SIZE} places
                </p>
              </div>
            </div>

            <p className="text-sm leading-relaxed text-ink-soft">{body}</p>

            {qualified ? (
              <Link
                href="/assessment/theory"
                className="flex w-full items-center justify-center gap-2 rounded-full bg-amber py-5 text-base font-bold text-ink"
              >
                Go to the theory section
                <ArrowRight className="h-5 w-5" aria-hidden />
              </Link>
            ) : (
              <p className="rounded-2xl bg-paper p-4 text-sm leading-relaxed text-ink-soft">
                Questions about your result? Email{" "}
                <a
                  href={`mailto:${BRAND.contactEmail}`}
                  className="font-semibold text-ink underline underline-offset-4"
                >
                  {BRAND.contactEmail}
                </a>{" "}
                with your ticket reference and quote the score above. Please don&apos;t
                include a copy of the paper itself.
              </p>
            )}

            <p className="flex items-center justify-center gap-2 text-xs text-ink-soft">
              <Mail className="h-3.5 w-3.5" aria-hidden />
              {BRAND.organisation} · {BRAND.name}
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
