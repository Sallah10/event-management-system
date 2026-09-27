"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send, TriangleAlert } from "lucide-react";
import { apiFetch } from "@/lib/client/api";
import Countdown from "@/components/exam/Countdown";
import IntegrityObserver from "@/components/exam/IntegrityObserver";
import TechnicalSupport from "@/components/TechnicalSupport";
import { cn } from "@/lib/utils";
import { countWords } from "@/lib/validate";
import { useStoredJson } from "@/lib/client/storage";
import { THEORY_QUESTIONS } from "@/config/theory-questions";
import type { CourseAvailability } from "@/lib/course-availability";

// ─── THEORY PAPER ─────────────────────────────────────────────────────────────
// Rewritten from a 598-line page that was, line for line, the objective page
// again: the same three warning systems, the same `useState(3600)`, the same
// `window.innerWidth < 800` "split screen" detector, the same `alert()` on blur,
// the same `localStorage.clear()` + "DISQUALIFIED" at flagCount >= 3, plus two
// more bespoke ones (a back-button counter that logged the candidate out on the
// second press, and four timed toasts about "ACTIVE MONITORING" at 10s, 20s and
// 2m). Duplicated security code is duplicated security theatre, and the theory
// paper is where a candidate is asked to write 150 words of considered prose —
// the worst possible moment to be interrupted by five competing modals.
//
// What this version does instead:
//   • One visibilitychange listener, in components/exam/IntegrityObserver.tsx.
//   • A server-issued deadline (lib/exam-sitting.ts).
//   • The course picker arrives as a prop, rendered on the server with live seat
//     counts — no spinner, no empty list on a bad connection.
//   • A draft in localStorage, same as the objective paper, for the same reason.
//   • Word counts shown as you type, because the server rejects under-length
//     answers and a candidate should never discover that at submit time.
//
// The "No AI" line is deliberately gone. It was a warning we could not enforce,
// printed on a page we cannot watch, next to essays about economic impact that
// invite a search engine. The server grades with an AI reviewer and staff check
// the output; that is the honest arrangement and it is implemented.

interface TheoryAnswers {
  q1: string;
  q2: string;
  q3: string;
}

interface SubmitResponse {
  message: string;
  /** Server-confirmed track. `courseSlug` was the documented name; the route
   *  actually answers `selectedCourseSlug`, and the mismatch was invisible
   *  because this type was never checked against the route. */
  selectedCourseSlug: string;
  status: string;
  /** True when the paper arrived after the deadline. The server still accepted
   *  it, and says so rather than letting the candidate assume it counted on
   *  time. */
  submittedLate?: boolean;
}

interface TheoryClientProps {
  courses: CourseAvailability[];
  deadline: string;
  minWords: number;
  maxLength: number;
  barcodeId: string;
  preselectedSlug: string | null;
}

const QUESTIONS: { id: keyof TheoryAnswers; label: string; hint: string }[] =
  THEORY_QUESTIONS.map(({ id, label, hint }) => ({ id, label, hint }));

export default function TheoryClient({
  courses,
  deadline,
  minWords,
  maxLength,
  barcodeId,
  preselectedSlug,
}: TheoryClientProps) {
  const router = useRouter();
  const [selectedSlug, setSelectedSlug] = useState(preselectedSlug ?? "");
  const [answers, setAnswers] = useState<TheoryAnswers>({ q1: "", q2: "", q3: "" });
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showValidation, setShowValidation] = useState(false);

  const DRAFT_KEY = `theory_draft_${barcodeId}`;

  // ─── DRAFT ────────────────────────────────────────────────────────────────
  // Read with useSyncExternalStore rather than an effect. See lib/client/storage
  // for why: a lazy useState initialiser runs on the server and mismatches the
  // hydrated markup, and an effect renders the candidate's own answers one frame
  // late — on a paper with a running clock, that reads as "my work has vanished".
  const storedDraft = useStoredJson<TheoryAnswers>(DRAFT_KEY);

  // Adopt the stored draft during render, once per candidate.
  //
  // During SSR and the hydration render, getServerSnapshot answers null, so this
  // does nothing and the markup matches what the server sent. React re-renders
  // with the real value immediately after hydration and the setState below is
  // applied before the first effect runs — so the save effect never sees an empty
  // paper. That is the whole reason it is here rather than in an effect.
  const adoptedKey = useRef<string | null>(null);
  if (adoptedKey.current !== DRAFT_KEY) {
    adoptedKey.current = DRAFT_KEY;
    if (storedDraft && typeof storedDraft === "object") {
      // Merge, so a keystroke that landed while the draft was being read is not
      // overwritten by the older stored copy.
      setAnswers((current) => ({ ...storedDraft, ...current }));
    }
  }

  useEffect(() => {
    // Nothing typed yet. Writing an all-empty paper here would destroy the stored
    // draft during the hydration commit, before the restore above is applied —
    // which is exactly what the previous version of this file did.
    if (!answers.q1 && !answers.q2 && !answers.q3) return;
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(answers));
    } catch {
      // Storage unavailable — answers still submit from React state.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers, barcodeId]);

  const shortAnswers = QUESTIONS.filter(
    (question) => countWords(answers[question.id]) < minWords,
  );
  const canSubmit = Boolean(selectedSlug) && shortAnswers.length === 0;

  const submit = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setConfirming(false);

    const result = await apiFetch<SubmitResponse>("/api/assessment/submit-theory", {
      method: "POST",
      body: JSON.stringify({ selectedSlug, answers }),
    });

    if (result.ok) {
      try {
        window.localStorage.removeItem(DRAFT_KEY);
      } catch {
        // Server has it.
      }
      // No "was it late?" flag is passed through here. The confirmation page reads
      // theory_finished_at and the deadline from the database and works it out
      // itself, because anything the browser is asked to remember about its own
      // punctuality is the candidate's to set.
      router.replace("/assessment/thank-you");
      return;
    }

    if (result.code === "COURSE_FULL") {
      setError(
        "That track filled up while you were writing. Pick another track and submit again — your answers are still here.",
      );
      setSubmitting(false);
      return;
    }
    if (result.code === "ALREADY_SUBMITTED" || result.code === "NOT_QUALIFIED") {
      router.replace("/assessment/result");
      return;
    }
    if (result.code === "DEVICE_MISMATCH") {
      router.replace("/assessment/login");
      return;
    }

    setError(result.message);
    setSubmitting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers, selectedSlug, submitting, router]);

  return (
    <div className="min-h-dvh bg-paper text-ink">
      <header className="sticky top-0 z-30 border-b border-ink/10 bg-paper/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <p className="truncate text-[11px] font-bold uppercase tracking-[0.2em] text-ink-soft">
              Theory section
            </p>
            <p className="text-sm font-semibold">
              {minWords} words minimum per answer
            </p>
          </div>
          <Countdown endAt={deadline} onExpire={submit} />
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-10 px-4 py-8 pb-32 sm:px-6">
        <IntegrityObserver />

        {/* ─── TRACK ──────────────────────────────────────────────────────── */}
        <section>
          <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-ink-soft">
            1. Choose your track
          </h2>
          <p className="mt-2 text-sm text-ink-soft">
            Seats are counted live, including essays awaiting grading.
          </p>
          <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
            {courses.map((course) => {
              const active = selectedSlug === course.slug;
              return (
                <button
                  key={course.slug}
                  onClick={() => !course.isFull && setSelectedSlug(course.slug)}
                  disabled={course.isFull}
                  aria-pressed={active}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-2xl border p-4 text-left transition-colors",
                    active
                      ? "border-ink bg-ink text-paper"
                      : course.isFull
                        ? "cursor-not-allowed border-ink/10 bg-ink/[0.03] opacity-55"
                        : "border-ink/12 bg-white hover:border-ink/35",
                  )}
                >
                  <span className="text-sm font-semibold leading-snug">
                    {course.displayName}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider",
                      active
                        ? "bg-amber text-ink"
                        : course.isFull
                          ? "bg-ink/10 text-ink-soft"
                          : "bg-amber/25 text-ink",
                    )}
                  >
                    {course.isFull ? "Full" : `${course.remaining} seats`}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* ─── ESSAYS ─────────────────────────────────────────────────────── */}
        <section className="space-y-6">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-ink-soft">
            2. Write your answers
          </h2>
          {QUESTIONS.map((question, index) => {
            const words = countWords(answers[question.id]);
            const short = words < minWords;
            return (
              <div
                key={question.id}
                className="rounded-3xl border border-ink/10 bg-white p-6 shadow-sm"
              >
                <label
                  htmlFor={question.id}
                  className="block text-base font-semibold leading-snug"
                >
                  <span className="mr-2 text-amber-deep">
                    {index + 1}.
                  </span>
                  {question.label}
                </label>
                <p className="mt-1.5 text-sm text-ink-soft">{question.hint}</p>
                <textarea
                  id={question.id}
                  value={answers[question.id]}
                  maxLength={maxLength}
                  rows={7}
                  onChange={(event) =>
                    setAnswers((prev) => ({
                      ...prev,
                      [question.id]: event.target.value,
                    }))
                  }
                  className="mt-4 w-full resize-y rounded-2xl border border-ink/12 bg-paper p-4 text-sm leading-relaxed outline-none focus:border-ink/40"
                />
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span
                    className={cn(
                      "font-semibold",
                      short ? "text-ink-soft" : "text-amber-deep",
                    )}
                  >
                    {words < minWords
                      ? `${minWords - words} more word${minWords - words === 1 ? "" : "s"} needed`
                      : "Length met"}
                  </span>
                  <span className="tabular-nums text-ink-soft">
                    {words} words · {answers[question.id].length}/{maxLength}
                  </span>
                </div>
              </div>
            );
          })}
        </section>

        {error && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-2xl border border-amber-deep/30 bg-amber/10 p-4 text-sm font-semibold text-ink"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {error}
          </p>
        )}

        {showValidation && !canSubmit && (
          <p
            role="alert"
            className="rounded-2xl border border-ink/15 bg-white p-4 text-sm"
          >
            {!selectedSlug && "Choose a track to continue. "}
            {shortAnswers.length > 0 && (
              <>
                Still too short: question{" "}
                {shortAnswers.map((q) => q.id.replace("q", "")).join(", ")}. Each
                answer needs at least {minWords} words.
              </>
            )}
          </p>
        )}

        <button
          onClick={() => {
            if (!canSubmit) {
              setShowValidation(true);
              return;
            }
            setConfirming(true);
          }}
          disabled={submitting}
          className="w-full rounded-full bg-amber py-5 text-base font-bold text-ink shadow-sm disabled:opacity-50"
        >
          {submitting ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
              Submitting
            </span>
          ) : (
            <span className="flex items-center justify-center gap-2">
              <Send className="h-5 w-5" aria-hidden />
              Submit application
            </span>
          )}
        </button>
      </main>

      {confirming && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-ink/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-theory"
        >
          <div className="w-full max-w-md rounded-3xl bg-white p-7 shadow-2xl">
            <h2 id="confirm-theory" className="text-lg font-bold">
              Submit this application?
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-soft">
              Your answers cannot be edited afterwards. Choosing{" "}
              <strong className="text-ink">
                {courses.find((c) => c.slug === selectedSlug)?.displayName}
              </strong>{" "}
              now is a statement that you want this track.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setConfirming(false)}
                className="flex-1 rounded-full border border-ink/20 px-4 py-2.5 text-sm font-semibold"
              >
                Keep editing
              </button>
              <button
                onClick={submit}
                disabled={submitting}
                className="flex-1 rounded-full bg-ink px-4 py-2.5 text-sm font-bold text-paper disabled:opacity-50"
              >
                Submit for good
              </button>
            </div>
          </div>
        </div>
      )}

      <TechnicalSupport />
    </div>
  );
}
