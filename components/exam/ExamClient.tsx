"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  Send,
  ShieldQuestion,
} from "lucide-react";
import { apiFetch } from "@/lib/client/api";
import { useStoredJson } from "@/lib/client/storage";
import Countdown from "@/components/exam/Countdown";
import IntegrityObserver from "@/components/exam/IntegrityObserver";
import TechnicalSupport from "@/components/TechnicalSupport";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// ─── OBJECTIVE PAPER ──────────────────────────────────────────────────────────
// Rewritten from the version that rendered all 60 questions as one scrolling
// column of radio buttons, with `useState(1800)` for the clock, three
// overlapping warning systems, and an `alert()` on every blur.
//
// What changed, and why it is not just cosmetics:
//
// • ONE QUESTION PER SCREEN, with a numbered palette. Sixty stacked radios meant
//   the candidate had to scroll past 59 answered questions to check the last one,
//   and "which have I done?" was a visual archaeology task. The palette answers
//   it instantly and is the thing a marker would want to see anyway.
//
// • DRAFTS SURVIVE A REFRESH. Answers are written to localStorage as they are
//   given, and restored on mount. Previously a crash, a refresh or a flat
//   battery discarded up to an hour of work. A lost exam is not a security
//   control, it is a bug, and it punished exactly the candidates on the worst
//   connections. The draft is keyed by ticket and cleared on submit.
//
// • NO FAKE DISQUALIFICATION. See components/exam/IntegrityObserver.tsx for the
//   three false-positive paths that were removed - phone-width "split screen",
//   a blocking alert, and a localStorage wipe that declared DISQUALIFIED while
//   the database row was untouched.
//
// • The clock is a server-issued deadline (lib/exam-sitting.ts), not a count
//   from mount.
//
// • Unanswered questions are stated at submission rather than silently scored as
//   wrong. The server records the score either way; the candidate is told.

export interface ExamQuestion {
  id: string;
  question: string;
  options: Record<string, string>;
}

interface SubmitResponse {
  score: number;
  correct: number;
  total: number;
  rank: number | null;
  poolSize: number;
  qualified: boolean;
  metPassMark: boolean;
  allQuestionsAnswered: boolean;
  message: string;
}

interface ExamClientProps {
  questions: ExamQuestion[];
  /** Server-computed. Never derived from mount time. */
  deadline: string;
  passMark: number;
  barcodeId: string;
}

const DRAFT_KEY = (barcodeId: string) => `exam_draft_${barcodeId}`;

export default function ExamClient({
  questions,
  deadline,
  passMark,
  barcodeId,
}: ExamClientProps) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [index, setIndex] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [observations, setObservations] = useState(0);

  // ─── DRAFT ────────────────────────────────────────────────────────────────
  // The server has no draft store, so localStorage is the only copy of these
  // answers until submission.
  const storedDraft = useStoredJson<Record<string, string>>(DRAFT_KEY(barcodeId));

  // Adopt the stored draft during render, once per candidate. See the identical
  // block in TheoryClient, and lib/client/storage.ts for why reading it in an
  // effect was wrong: the candidate would see their own answers appear a frame
  // late, and the save effect below would have already overwritten the stored copy
  // with an empty paper.
  //
  // `adoptedKey` is state, not a ref, on purpose. A ref read or write during
  // render is a compiler no-no: refs are mutable state that render is not supposed
  // to depend on, and the value it holds is not part of the render's inputs. This
  // comparison genuinely is an input - "have I already merged this draft?" - so it
  // belongs in state, and adjusting state during render is the documented pattern
  // for reacting to a changed input without an effect.
  const [adoptedKey, setAdoptedKey] = useState<string | null>(null);
  if (adoptedKey !== DRAFT_KEY(barcodeId)) {
    setAdoptedKey(DRAFT_KEY(barcodeId));
    if (storedDraft && typeof storedDraft === "object") {
      // Merge, so a click that landed while the draft was being read survives.
      setAnswers((current) => ({ ...storedDraft, ...current }));
    }
  }

  useEffect(() => {
    // Nothing answered yet: writing now would destroy the stored draft during the
    // hydration commit, before the restore above is applied.
    if (Object.values(answers).every((value) => !value)) return;
    try {
      window.localStorage.setItem(DRAFT_KEY(barcodeId), JSON.stringify(answers));
    } catch {
      // Storage full or disabled. The answers still live in React state and will
      // submit fine; they just won't survive a refresh.
    }
  }, [answers, barcodeId]);


  const answered = useMemo(
    () => Object.keys(answers).filter((id) => answers[id]).length,
    [answers],
  );
  const current = questions[index];
  const selected = current ? answers[current.id] : undefined;

  // ─── SUBMIT ───────────────────────────────────────────────────────────────
  const submit = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setConfirming(false);

    const result = await apiFetch<SubmitResponse>("/api/assessment/submit", {
      method: "POST",
      body: JSON.stringify({ answers, tabSwitches: observations }),
    });

    if (result.ok) {
      try {
        window.localStorage.removeItem(DRAFT_KEY(barcodeId));
      } catch {
        // Nothing to do - the server has the score either way.
      }
      router.replace("/assessment/result");
      return;
    }

    // ALREADY_SUBMITTED means the paper is in. Anything else is a real failure
    // and the candidate must be able to retry, so we never navigate away here.
    if (result.code === "ALREADY_SUBMITTED") {
      router.replace("/assessment/result");
      return;
    }
    if (result.code === "DEVICE_MISMATCH" || result.code === "DISQUALIFIED") {
      router.replace("/assessment/login");
      return;
    }

    setError(result.message);
    setSubmitting(false);
  }, [answers, observations, submitting, barcodeId, router]);

  const onExpire = useCallback(() => {
    void submit();
  }, [submit]);

  const onObservation = useCallback(() => {
    setObservations((n) => n + 1);
  }, []);

  if (!current) return null;

  const remainingCount = questions.length - answered;

  return (
    <div className="min-h-dvh bg-paper text-ink">
      {/* ─── BAR ─────────────────────────────────────────────────────────────
          Sticky, and the only element on the page allowed a backdrop blur:
          a candidate scrolling 60 questions needs the clock and the count to
          stay put. The blur is on a near-opaque paper, not a translucent one,
          so the text underneath it never shows through. */}
      <header className="sticky top-0 z-30 border-b border-line bg-paper/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-3 sm:px-6">
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="eyebrow truncate">Objective section</p>
            <p data-numeric className="text-small font-medium tabular-nums text-ink-soft">
              {answered} of {questions.length} answered
            </p>
          </div>
          <Countdown endAt={deadline} onExpire={onExpire} />
        </div>
        {/* Progress as a 2px rule rather than a 4px bar: enough to read at a
            glance, not enough to become the loudest thing on the page. */}
        <div className="h-0.5 w-full bg-line/60">
          <div
            className="h-full bg-amber transition-[width] duration-500 ease-[var(--ease-out-quint)]"
            style={{ width: `${(answered / questions.length) * 100}%` }}
          />
        </div>
      </header>

      <main id="main" className="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-8 sm:px-6">
        <IntegrityObserver onObservation={onObservation} />

        {/* ─── QUESTION ──────────────────────────────────────────────────────
            The question is the h1 on this screen. It was an h1 before too, but
            competing with a `text-xl font-semibold` on a card; set as display
            serif at reading size it is now obviously the subject of the page,
            and the answer options are set one step down from it. */}
        <section className="rounded-lg border border-line bg-surface p-6 sm:p-7">
          <p className="eyebrow">
            Question {index + 1} of {questions.length}
          </p>
          <h1 className="mt-3 font-display text-h3 text-pretty text-ink">
            {current.question}
          </h1>

          <fieldset className="mt-6 flex flex-col gap-2">
            <legend className="sr-only">Choose one answer</legend>
            {Object.entries(current.options).map(([key, text]) => {
              const active = selected === key;
              return (
                <label
                  key={key}
                  className={cn(
                    "flex cursor-pointer items-start gap-3.5 rounded-md border px-4 py-3.5 transition-colors duration-[var(--duration-quick)]",
                    active
                      ? "border-ink bg-ink text-paper"
                      : "border-line bg-surface hover:border-line-strong hover:bg-paper-sunk/50",
                  )}
                >
                  <input
                    type="radio"
                    name={current.id}
                    value={key}
                    checked={active}
                    onChange={() =>
                      setAnswers((prev) => ({ ...prev, [current.id]: key }))
                    }
                    className="sr-only"
                  />
                  {/* The letter is the affordance. Amber when chosen, hairline
                      otherwise - a filled circle per option would be 4 more
                      shapes competing with the text. */}
                  <span
                    aria-hidden
                    className={cn(
                      "mt-px grid size-6 shrink-0 place-items-center rounded-xs border text-micro font-semibold",
                      active
                        ? "border-amber bg-amber text-ink"
                        : "border-line-strong text-ink-soft",
                    )}
                  >
                    {key}
                  </span>
                  <span className="text-body leading-relaxed">{text}</span>
                </label>
              );
            })}
          </fieldset>
        </section>

        {/* ─── PALETTE ────────────────────────────────────────────────────────
            The single most useful control on the page: "which have I done?"
            answered 60 questions at a glance. It is a group of small squares,
            not pills, and the legend is written out because the amber fill
            alone is not a legend. */}
        <section className="rounded-lg border border-line bg-surface p-5">
          <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="eyebrow">All questions</h2>
            <p className="flex items-center gap-3 text-micro text-ink-faint">
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="size-2.5 rounded-xs bg-amber" />
                Answered
              </span>
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="size-2.5 rounded-xs border border-line-strong bg-paper-sunk" />
                Not yet
              </span>
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {questions.map((question, i) => {
              const done = Boolean(answers[question.id]);
              const here = i === index;
              return (
                <button
                  key={question.id}
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={`Question ${i + 1}${done ? ", answered" : ", not answered"}`}
                  aria-current={here ? "true" : undefined}
                  data-numeric
                  className={cn(
                    "size-9 rounded-xs text-small font-medium tabular-nums transition-colors duration-[var(--duration-instant)]",
                    here
                      ? "bg-ink text-paper ring-1 ring-ink ring-offset-2 ring-offset-surface"
                      : done
                        ? "bg-amber text-ink hover:brightness-105"
                        : "border border-line bg-paper-sunk text-ink-faint hover:border-line-strong hover:text-ink",
                  )}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
        </section>

        {error ? (
          <p
            role="alert"
            className="rounded-md border border-critical/35 bg-critical-wash px-4 py-3 text-small font-medium text-ink"
          >
            {error}
          </p>
        ) : null}

        {/* ─── NAVIGATION ────────────────────────────────────────────────────
            Back is quiet, forward is the loud one, and the loud one changes to
            "Submit" only on the last question. A candidate should never be
            unsure whether "Next" will submit. */}
        <div className="flex items-center justify-between gap-3 pb-8">
          <Button
            variant="outline"
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            disabled={index === 0}
          >
            <ArrowLeft aria-hidden /> Back
          </Button>

          {index === questions.length - 1 ? (
            <Button variant="accent" onClick={() => setConfirming(true)} disabled={submitting}>
              {submitting ? (
                <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" />
              ) : (
                <Send aria-hidden />
              )}
              Submit paper
            </Button>
          ) : (
            <Button onClick={() => setIndex((i) => Math.min(questions.length - 1, i + 1))}>
              Next <ArrowRight aria-hidden />
            </Button>
          )}
        </div>
      </main>

      {/* ─── CONFIRM ──────────────────────────────────────────────────────────
          This was a hand-rolled `role="dialog"` div with no focus trap, no
          Esc-to-close and no focus restoration - a keyboard user could tab
          straight out of the overlay into the page behind it, and the browser
          back gesture would leave it open. It now uses the Radix primitive,
          which does all three. */}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2.5 font-display text-h4 text-ink">
              <ShieldQuestion aria-hidden className="size-5 text-amber-deep" />
              Submit this paper?
            </DialogTitle>
            <DialogDescription className="text-small leading-relaxed text-ink-soft">
              You cannot change your answers afterwards, and the paper cannot be
              reopened.
            </DialogDescription>
          </DialogHeader>

          {remainingCount === 0 ? (
            <p className="flex items-center gap-2 rounded-md border border-positive/30 bg-positive/8 px-3.5 py-3 text-small font-medium text-ink">
              <Check aria-hidden className="size-4 text-positive" />
              All {questions.length} questions answered.
            </p>
          ) : (
            <p className="rounded-md border border-caution/35 bg-caution/10 px-3.5 py-3 text-small leading-relaxed text-ink">
              <strong className="font-semibold">
                {remainingCount} unanswered {remainingCount === 1 ? "question" : "questions"}.
              </strong>{" "}
              Unanswered questions are marked wrong. The pass mark is {passMark}%.
            </p>
          )}

          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <DialogClose asChild>
              <Button variant="outline" className="w-full sm:w-auto">
                Keep working
              </Button>
            </DialogClose>
            <Button onClick={submit} disabled={submitting} className="w-full sm:w-auto">
              {submitting ? "Submitting…" : "Submit for good"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* A candidate whose setup has broken needs a way to say so. This used to
          exist and had been orphaned by the rewrite above, which is how a
          working feature dies: nobody notices when it stops being imported. */}
      <TechnicalSupport />
    </div>
  );
}
