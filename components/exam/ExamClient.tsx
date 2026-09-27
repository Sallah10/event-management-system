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
//   three false-positive paths that were removed — phone-width "split screen",
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
  // comparison genuinely is an input — "have I already merged this draft?" — so it
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
        // Nothing to do — the server has the score either way.
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

  return (
    <div className="min-h-dvh bg-paper text-ink">
      {/* ─── BAR ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-ink/10 bg-paper/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <p className="truncate text-[11px] font-bold uppercase tracking-[0.2em] text-ink-soft">
              Objective section
            </p>
            <p className="text-sm font-semibold tabular-nums">
              {answered} of {questions.length} answered
            </p>
          </div>
          <Countdown endAt={deadline} onExpire={onExpire} />
        </div>
        <div className="h-1 w-full bg-ink/5">
          <div
            className="h-full bg-amber transition-[width] duration-500"
            style={{ width: `${(answered / questions.length) * 100}%` }}
          />
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-8 px-4 py-8 sm:px-6">
        <IntegrityObserver onObservation={onObservation} />

        {/* ─── QUESTION ──────────────────────────────────────────────────── */}
        <section className="rounded-3xl border border-ink/10 bg-white p-6 shadow-sm sm:p-8">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-ink-soft">
            Question {index + 1} of {questions.length}
          </p>
          <h1 className="mt-3 text-xl font-semibold leading-snug sm:text-2xl">
            {current.question}
          </h1>

          <fieldset className="mt-6 space-y-2.5">
            <legend className="sr-only">Choose one answer</legend>
            {Object.entries(current.options).map(([key, text]) => {
              const active = selected === key;
              return (
                <label
                  key={key}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition-colors",
                    active
                      ? "border-ink bg-ink text-paper"
                      : "border-ink/12 bg-paper hover:border-ink/35",
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
                  <span
                    className={cn(
                      "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border text-xs font-bold",
                      active ? "border-amber bg-amber text-ink" : "border-ink/25",
                    )}
                  >
                    {key}
                  </span>
                  <span className="text-sm leading-relaxed">{text}</span>
                </label>
              );
            })}
          </fieldset>
        </section>

        {/* ─── PALETTE ────────────────────────────────────────────────────── */}
        <section className="rounded-3xl border border-ink/10 bg-white p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-ink-soft">
              All questions
            </p>
            <p className="text-[11px] font-semibold text-ink-soft">
              Amber = answered
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {questions.map((question, i) => {
              const done = Boolean(answers[question.id]);
              const here = i === index;
              return (
                <button
                  key={question.id}
                  onClick={() => setIndex(i)}
                  aria-label={`Question ${i + 1}${done ? ", answered" : ", not answered"}`}
                  aria-current={here ? "true" : undefined}
                  className={cn(
                    "h-9 w-9 rounded-xl text-xs font-bold tabular-nums transition-colors",
                    here
                      ? "bg-ink text-paper"
                      : done
                        ? "bg-amber text-ink"
                        : "bg-ink/5 text-ink-soft hover:bg-ink/12",
                  )}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
        </section>

        {error && (
          <p
            role="alert"
            className="rounded-2xl border border-red-300 bg-red-50 p-4 text-sm font-semibold text-red-900"
          >
            {error}
          </p>
        )}

        {/* ─── NAVIGATION ────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3 pb-10">
          <button
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            disabled={index === 0}
            className="flex items-center gap-2 rounded-full border border-ink/15 px-5 py-2.5 text-sm font-semibold disabled:opacity-35"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden /> Back
          </button>

          {index === questions.length - 1 ? (
            <button
              onClick={() => setConfirming(true)}
              disabled={submitting}
              className="flex items-center gap-2 rounded-full bg-amber px-6 py-2.5 text-sm font-bold text-ink shadow-sm disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Send className="h-4 w-4" aria-hidden />
              )}
              Submit paper
            </button>
          ) : (
            <button
              onClick={() => setIndex((i) => Math.min(questions.length - 1, i + 1))}
              className="flex items-center gap-2 rounded-full bg-ink px-6 py-2.5 text-sm font-bold text-paper"
            >
              Next <ArrowRight className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
      </main>

      {/* ─── CONFIRM ───────────────────────────────────────────────────────── */}
      {confirming && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-ink/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-submit"
        >
          <div className="w-full max-w-md rounded-3xl bg-white p-7 shadow-2xl">
            <h2
              id="confirm-submit"
              className="flex items-center gap-2 text-lg font-bold"
            >
              <ShieldQuestion className="h-5 w-5 text-amber-deep" aria-hidden />
              Submit this paper?
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-soft">
              You cannot change your answers afterwards, and the paper cannot be
              reopened.
            </p>
            <p className="mt-4 rounded-2xl bg-paper p-4 text-sm">
              {questions.length - answered === 0 ? (
                <span className="flex items-center gap-2 font-semibold">
                  <Check className="h-4 w-4 text-amber-deep" aria-hidden />
                  All {questions.length} questions answered.
                </span>
              ) : (
                <>
                  <strong className="font-bold">
                    {questions.length - answered} unanswered
                  </strong>{" "}
                  {questions.length - answered === 1 ? "question" : "questions"}.
                  Unanswered questions are marked wrong. The pass mark is{" "}
                  {passMark}%.
                </>
              )}
            </p>
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setConfirming(false)}
                className="flex-1 rounded-full border border-ink/20 px-4 py-2.5 text-sm font-semibold"
              >
                Keep working
              </button>
              <button
                onClick={submit}
                disabled={submitting}
                className="flex-1 rounded-full bg-ink px-4 py-2.5 text-sm font-bold text-paper disabled:opacity-50"
              >
                {submitting ? "Submitting…" : "Submit for good"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* A candidate whose setup has broken needs a way to say so. This used to
          exist and had been orphaned by the rewrite above, which is how a
          working feature dies: nobody notices when it stops being imported. */}
      <TechnicalSupport />
    </div>
  );
}
