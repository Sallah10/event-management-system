"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send, TriangleAlert } from "lucide-react";
import { apiFetch } from "@/lib/client/api";
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
import { Alert } from "@/components/ui/display";
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
      <header className="sticky top-0 z-30 border-b border-line bg-paper/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-3 sm:px-6">
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="eyebrow truncate">Theory section</p>
            <p className="text-small font-medium text-ink-soft">
              {minWords} words minimum per answer
            </p>
          </div>
          <Countdown endAt={deadline} onExpire={submit} />
        </div>
      </header>

      <main id="main" className="mx-auto flex max-w-3xl flex-col gap-9 px-5 py-8 pb-28 sm:px-6">
        <IntegrityObserver />

        {/* ─── TRACK ──────────────────────────────────────────────────────────
            The heading was an h2 and there was no h1 on this page at all, so
            the document outline started at level two. The section title is the
            h1 now; the step labels are h2. */}
        <section>
          <h1 className="font-display text-h3 text-ink">Choose your track</h1>
          <p className="mt-2 text-small text-ink-soft">
            Seats are counted live, including essays awaiting grading.
          </p>

          <div
            role="group"
            aria-label="Available tracks"
            className="mt-4 grid gap-2 sm:grid-cols-2"
          >
            {courses.map((course) => {
              const active = selectedSlug === course.slug;
              return (
                <button
                  key={course.slug}
                  type="button"
                  onClick={() => !course.isFull && setSelectedSlug(course.slug)}
                  disabled={course.isFull}
                  aria-pressed={active}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-md border px-4 py-3.5 text-left transition-colors duration-[var(--duration-quick)]",
                    active
                      ? "border-ink bg-ink text-paper"
                      : course.isFull
                        ? "cursor-not-allowed border-line bg-paper-sunk opacity-60"
                        : "border-line bg-surface hover:border-line-strong hover:bg-paper-sunk/50",
                  )}
                >
                  <span className="text-small font-medium leading-snug">
                    {course.displayName}
                  </span>
                  <span
                    data-numeric
                    className={cn(
                      "shrink-0 rounded-pill px-2 py-0.5 text-micro font-semibold",
                      active
                        ? "bg-amber text-ink"
                        : course.isFull
                          ? "bg-line text-ink-soft"
                          : "bg-amber/25 text-amber-deep",
                    )}
                  >
                    {course.isFull ? "Full" : `${course.remaining} seats`}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* ─── ESSAYS ─────────────────────────────────────────────────────────
            Each essay is a labelled field with its own word count beneath it,
            because "am I long enough" is the question a candidate asks on every
            one of these and the answer should not require counting. */}
        <section className="flex flex-col gap-5">
          <h2 className="font-display text-h3 text-ink">Write your answers</h2>
          {QUESTIONS.map((question, index) => {
            const words = countWords(answers[question.id]);
            const short = words < minWords;
            const missing = minWords - words;
            return (
              <div
                key={question.id}
                className="rounded-lg border border-line bg-surface p-5 sm:p-6"
              >
                <label
                  htmlFor={question.id}
                  className="flex gap-2.5 text-body font-medium leading-snug text-ink"
                >
                  <span aria-hidden data-numeric className="shrink-0 text-amber-deep">
                    {index + 1}.
                  </span>
                  {question.label}
                </label>
                <p className="mt-1.5 pl-7 text-small text-ink-soft">{question.hint}</p>

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
                  aria-describedby={`${question.id}-count`}
                  className="mt-4 w-full resize-y rounded-md border border-line-strong bg-paper px-3.5 py-3 text-body leading-relaxed transition-colors placeholder:text-ink-faint"
                />

                <div
                  id={`${question.id}-count`}
                  className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-small"
                >
                  <span
                    className={cn("font-medium", short ? "text-ink-soft" : "text-positive")}
                  >
                    {short
                      ? `${missing} more word${missing === 1 ? "" : "s"} needed`
                      : "Length met"}
                  </span>
                  <span data-numeric className="tabular-nums text-ink-faint">
                    {words} words · {answers[question.id].length}/{maxLength}
                  </span>
                </div>
              </div>
            );
          })}
        </section>

        {error ? (
          <Alert tone="caution" icon={TriangleAlert}>
            {error}
          </Alert>
        ) : null}

        {showValidation && !canSubmit ? (
          <p
            role="alert"
            className="rounded-md border border-line-strong bg-surface px-4 py-3 text-small text-ink"
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
        ) : null}

        <Button
          size="lg"
          variant="accent"
          onClick={() => {
            if (!canSubmit) {
              setShowValidation(true);
              return;
            }
            setConfirming(true);
          }}
          disabled={submitting}
          className="w-full"
        >
          {submitting ? (
            <>
              <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" />
              Submitting
            </>
          ) : (
            <>
              <Send aria-hidden />
              Submit application
            </>
          )}
        </Button>
      </main>

      {/* Radix rather than a hand-rolled overlay — see the note in ExamClient
          about the missing focus trap. */}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="font-display text-h4 text-ink">
              Submit this application?
            </DialogTitle>
            <DialogDescription className="text-small leading-relaxed text-ink-soft">
              Your answers cannot be edited afterwards. Choosing{" "}
              <strong className="font-semibold text-ink">
                {courses.find((c) => c.slug === selectedSlug)?.displayName}
              </strong>{" "}
              now is a statement that you want this track.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <DialogClose asChild>
              <Button variant="outline" className="w-full sm:w-auto">
                Keep editing
              </Button>
            </DialogClose>
            <Button onClick={submit} disabled={submitting} className="w-full sm:w-auto">
              Submit for good
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TechnicalSupport />
    </div>
  );
}
