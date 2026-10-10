"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Award,
  Ban,
  CheckCircle2,
  FileText,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  X,
} from "lucide-react";
import { apiFetch, type ApiResult } from "@/lib/client/api";
import { COURSES } from "@/config/course-matrix";
import { PIPELINE, RELEASABLE_STATUSES } from "@/config/rules";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Alert, EmptyState, Spinner, Stat } from "@/components/ui/display";

// ─── CANDIDATE PANEL ──────────────────────────────────────────────────────────
// What a reviewer sees when they open one candidate: their objective result, their
// essays, what the model thought, a box to type a score in, and the five decisions
// that are legal from here.
//
// ON THE TWO BADGES
// "Flagged" and "AI: high" sit next to each other on purpose and are never merged.
// A flag means a person has looked at this candidate and suspended them. An AI
// note means a model has an opinion and nobody has checked it. The old code
// collapsed them into `isFlagged`, so a model's suspicion became an accusation
// with no reviewer attached, and the only way to clear it was to clear
// localStorage - which did nothing on the server.
//
// ON FETCHING ESSAYS
// The essays arrive from /api/internal/candidate-answers when the panel opens,
// not with the queue. Loading 900 sets of essays to render a list of names would
// put every applicant's PII in one response and in the browser's memory for the
// whole session. Fetching per candidate also means each read is logged, so "who
// read this applicant's work" is answerable - which is the question a candidate
// has a right to ask.
//
// PRESENTATION ONLY. Nothing in the decision path below changed: the human grade
// still goes to /api/admissions/grade, the decisions still go through
// /api/admissions/decision with the note attached, and the model opinion still has
// no path to a status of its own.
//
// What changed is the surface it sits on. The panel was a rounded-3xl white card
// holding two more rounded-2xl cards, a hand-rolled `Stat` and a hand-rolled
// `ActionButton`, five controls with `outline-none` and a hand-rolled
// `focus:border-ink/50` instead of a focus ring, a `text-[11px]` essay in a tight
// box, and a person's name as an <h2> under the page's <h1> - so the heading
// outline said "Decisions › Priya Raman › Essays", which is a document structure
// nobody chose. It is now `Card` for the frame, `Stat` for the figures, `Field`
// for the three inputs (so none of them can lose its label), `Button` for all
// eleven actions, `Alert` for the model note and the error, and the name is a
// <p> in the display serif: it is the most important thing on the panel, and it is
// not a section of the page.

export interface QueueRow {
  id: string;
  name: string;
  barcodeId: string;
  status: string;
  checkedIn: boolean;
  objectiveScore: number | null;
  objectiveRank: number | null;
  objectiveFinishedAt: string | null;
  theoryScore: number | null;
  theoryGradedAt: string | null;
  theoryGradedBy: string | null;
  aiSuspected: boolean | null;
  aiGradeReason: string | null;
  aiConfidence: string | null;
  tabSwitches: number | null;
  selectedCourseSlug: string | null;
  course: string | null;
  courseSlug: string | null;
  isFlagged: boolean;
  decisionNote: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
}

interface Essay {
  q: number;
  column: string;
  question: string;
  answer: string;
  words: number;
}

interface Detail {
  registrant: { email: string | null };
  answers: Essay[];
  minWords: number;
}

interface GradeResult {
  theoryScore: number;
  previousScore: number | null;
  gradedBy: string;
}

interface Props {
  candidate: QueueRow;
  onClose: () => void;
  onDecided: (message: string) => void;
}

type Action = "shortlist" | "award" | "release" | "flag" | "unflag" | "allocate";

/**
 * What each button says afterwards.
 *
 * Every decision here is irreversible in the interface - the list refreshes and
 * the panel closes, so nobody gets a "are you sure" they can cancel after seeing
 * that the seat counter moved. The confirmation therefore has to say what
 * happened, not just "OK". "Shortlisted" is a fact about a real person holding a
 * real place; a generic toast gives them nothing to check their work against.
 */
const DECISION_COPY: Record<Action, string> = {
  shortlist: "Shortlisted - a seat is now held for this candidate.",
  award: "Awarded. The seat is confirmed.",
  allocate: "Course track updated.",
  release: "Stood down. The reason is on the record.",
  flag: "Flagged for review.",
  unflag: "Flag cleared.",
};

export default function CandidatePanel({ candidate, onClose, onDecided }: Props) {
  const [essays, setEssays] = useState<Essay[] | null>(null);
  const [minWords, setMinWords] = useState(0);
  // Not from the list response on purpose; see the header.
  const [email, setEmail] = useState<string | null>(null);
  const [loadingEssays, setLoadingEssays] = useState(true);
  const [score, setScore] = useState<string>(
    candidate.theoryGradedAt && candidate.theoryScore !== null ? String(candidate.theoryScore) : "",
  );
  const [note, setNote] = useState(candidate.decisionNote ?? "");
  const [course, setCourse] = useState(candidate.courseSlug ?? "");
  // Which status a `release` lands in. Default is waitlisted because that is what
  // "stand this down" means in the pipeline: they sat the paper, they were
  // considered, they did not get a seat. Anything else is a correction and has to
  // be chosen deliberately.
  const [releaseStatus, setReleaseStatus] = useState("waitlisted");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch and apply are separate, so the effect can set state in a promise
  // callback: cancellable, and a response that lands after the reviewer has closed
  // the panel is discarded rather than written to a dead component.
  const fetchEssays = useCallback(
    () =>
      apiFetch<Detail>(
        `/api/internal/candidate-answers?registrantId=${encodeURIComponent(candidate.id)}`,
      ),
    [candidate.id],
  );

  const applyEssays = useCallback((result: ApiResult<Detail>) => {
    if (result.ok) {
      setEssays(result.data.answers);
      setMinWords(result.data.minWords);
      setEmail(result.data.registrant.email);
    } else {
      setError(result.message);
    }
    setLoadingEssays(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchEssays().then((result) => {
      if (cancelled) return;
      applyEssays(result);
    });
    return () => {
      cancelled = true;
    };
  }, [applyEssays, fetchEssays]);

  const reloadEssays = async () => {
    setLoadingEssays(true);
    applyEssays(await fetchEssays());
  };

  const saveGrade = async () => {
    const parsed = Number(score.trim());
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
      setError("Score must be a whole number between 0 and 100.");
      return;
    }
    setBusy("grade");
    setError(null);
    const result = await apiFetch<GradeResult>("/api/admissions/grade", {
      method: "POST",
      body: JSON.stringify({ registrantId: candidate.id, theoryScore: parsed, note }),
    });
    setBusy(null);
    if (result.ok) {
      setError(null);
      onDecided(
        result.data.previousScore !== null
          ? `Grade saved: ${result.data.previousScore} → ${result.data.theoryScore}.`
          : `Grade saved: ${result.data.theoryScore}.`,
      );
    } else {
      setError(result.message);
    }
  };

  const act = async (action: Action) => {
    setBusy(action);
    setError(null);
    const result = await apiFetch("/api/admissions/decision", {
      method: "POST",
      body: JSON.stringify({
        registrantId: candidate.id,
        action,
        note,
        courseSlug: course || undefined,
        // Only `release` needs a target. The rest derive their status from the
        // action itself, and sending one would be ignored at best.
        status: action === "release" ? releaseStatus : undefined,
      }),
    });
    setBusy(null);
    // The envelope's `message` is a server string, but the success wording is
    // chosen here so the panel can say what it actually did to this candidate.
    if (result.ok) onDecided(DECISION_COPY[action]);
    else setError(result.message);
  };

  const heldSeat = candidate.status === "shortlisted" || candidate.status === "awarded";

  return (
    <Card>
      <section
        aria-label={`Reviewing ${candidate.name}`}
        className="flex flex-col gap-6 p-5 sm:p-6"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {/* A name is not a section of the page, so it is not a heading: as an
                <h2> it put every candidate in the document outline between the
                page title and the one section that really is a section. Styled as
                the loudest thing on the panel, set in the display serif, and out
                of the outline. */}
            <p className="font-display text-h3 leading-tight text-balance text-ink">
              {candidate.name}
            </p>
            <p className="mt-1 font-mono text-micro text-ink-soft">
              {/* Ticket is enough to identify the row and is in the list response.
                  The email address arrives with the per-candidate record, which is
                  a logged read - the queue deliberately does not carry the whole
                  cohort's addresses, so this line fills in a moment after the
                  panel opens rather than being there on first paint. */}
              {candidate.barcodeId}
              {email ? ` · ${email}` : ""}
            </p>

            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary">{candidate.status}</Badge>
              {candidate.isFlagged && (
                <Badge variant="destructive">
                  <ShieldAlert aria-hidden />
                  Flagged
                </Badge>
              )}
              {candidate.aiSuspected && (
                <Badge variant="accent">
                  <Sparkles aria-hidden />
                  AI: {candidate.aiConfidence ?? "flagged"}
                </Badge>
              )}
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={onClose}
            aria-label="Close"
          >
            <X aria-hidden />
          </Button>
        </div>

        {/* Three figures on a hairline. `Stat` sets them in the display serif with
            tabular digits, which matters here because a reviewer's eye moves
            between this panel and the queue and the numbers have to line up. The
            status is a chip in the header instead of a fourth figure: it is a
            state, not a measurement, and at 38px a word like "shortlisted" has
            nowhere to go on a phone. */}
        <div className="grid grid-cols-3 gap-4 border-y border-line py-5">
          <Stat
            label="Objective"
            value={
              candidate.objectiveScore !== null
                ? `${candidate.objectiveScore}%`
                : "-"
            }
          />
          <Stat
            label="Rank"
            value={candidate.objectiveRank ? `#${candidate.objectiveRank}` : "-"}
          />
          <Stat
            label="Theory"
            value={
              candidate.theoryGradedAt ? String(candidate.theoryScore) : "-"
            }
            hint={candidate.theoryGradedAt ? undefined : "ungraded"}
          />
        </div>

        {candidate.aiSuspected && (
          <Alert
            tone="caution"
            icon={Sparkles}
            title={`Model note · ${candidate.aiConfidence ?? "no confidence given"}`}
          >
            <p>{candidate.aiGradeReason ?? "No reason recorded."}</p>
            <p className="mt-2 text-micro text-ink-faint">
              This is a suggestion from a language model, not a finding. It has not
              been reviewed by a person and it does not affect this
              candidate&apos;s status on its own.
            </p>
          </Alert>
        )}

        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="eyebrow">Essays</h2>
            {/* Useful because the AI batch can be run while this panel is open: the
                panel then shows what the model said without being reopened. */}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={reloadEssays}
              disabled={loadingEssays}
            >
              {loadingEssays ? (
                <Loader2
                  aria-hidden
                  className="animate-spin motion-reduce:animate-none"
                />
              ) : (
                <RefreshCw aria-hidden />
              )}
              Reload
            </Button>
          </div>

          {loadingEssays && (
            <p className="flex items-center gap-2 text-small text-ink-soft">
              <Spinner label="Loading submissions" />
              <span aria-hidden>Loading submissions…</span>
            </p>
          )}

          {!loadingEssays && essays?.length === 0 && (
            <EmptyState icon={FileText} title="No essays on file">
              This candidate has not submitted a theory paper.
            </EmptyState>
          )}

          <div className="flex flex-col gap-6">
            {essays?.map((essay) => {
              // A graded-length answer and one written to the minimum are not the same
              // thing to read, and at grading speed they look identical in a wall of
              // text. Marking the short ones saves a reviewer from discovering it
              // halfway down a paragraph.
              const thin = minWords > 0 && essay.words > 0 && essay.words < minWords * 1.5;
              return (
                /* Separated by a hairline rather than boxed in a card. Nested
                   rounded panels around text make a wall of floating chips; a
                   column of essays wants a measure and a rule. */
                <article key={essay.q} className="border-t border-line pt-4">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <p className="eyebrow">Question {essay.q}</p>
                    <p data-numeric className="text-micro tabular-nums text-ink-faint">
                      {essay.words} words
                      {minWords > 0 && essay.words > 0
                        ? ` · minimum ${minWords}`
                        : ""}
                    </p>
                  </div>
                  <p className="mt-1.5 text-small font-medium text-ink">
                    {essay.question}
                  </p>
                  {thin && (
                    <p className="mt-1.5 text-small font-medium text-amber-deep">
                      Short answer - read this one closely.
                    </p>
                  )}
                  {/* Long-form PII, and the one block on this panel a human
                      actually reads line by line. It was `text-sm` in a narrow
                      box; it is now body size at the editorial measure, which is
                      the difference between grading a paper and squinting at it. */}
                  <p className="measure mt-3 whitespace-pre-wrap text-body text-ink">
                    {essay.answer || "- no answer -"}
                  </p>
                </article>
              );
            })}
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <Field label="Theory score (0–100)">
            {({ id }) => (
              <div className="flex items-center gap-2">
                <Input
                  id={id}
                  value={score}
                  onChange={(event) =>
                    setScore(event.target.value.replace(/[^0-9]/g, ""))
                  }
                  inputMode="numeric"
                  maxLength={3}
                  placeholder="-"
                  className="w-28 shrink-0 tabular-nums"
                />
                <Button
                  type="button"
                  onClick={saveGrade}
                  disabled={busy !== null}
                >
                  {busy === "grade" ? (
                    <Loader2
                      aria-hidden
                      className="animate-spin motion-reduce:animate-none"
                    />
                  ) : (
                    <CheckCircle2 aria-hidden />
                  )}
                  Save grade
                </Button>
              </div>
            )}
          </Field>

          <Field label="Course track">
            {({ id }) => (
              <Select
                id={id}
                value={course}
                onChange={(value) => setCourse(value)}
                placeholder="No track selected"
                options={COURSES.map((item) => ({
                  value: item.slug,
                  label: item.displayName,
                }))}
              />
            )}
          </Field>
        </div>

        <Field
          label="Reason"
          hint="Required for a flag or a release."
        >
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
            />
          )}
        </Field>

        {error && (
          <Alert tone="critical" icon={AlertTriangle} role="alert">
            {error}
          </Alert>
        )}

        {/* One named group, so a screen reader announces these as the decisions
            available on this candidate rather than as five unlabelled buttons
            sitting under a text field. The one amber button in the panel is the
            action that creates a seat - the reserved action the design system
            rations. */}
        <div className="flex flex-col gap-2.5 border-t border-line pt-5">
          <p className="eyebrow">Decision</p>
          <div
            role="group"
            aria-label="Decisions for this candidate"
            className="flex flex-wrap gap-2"
          >
            {heldSeat ? (
              <Button
                type="button"
                variant="accent"
                onClick={() => act("award")}
                disabled={busy !== null}
              >
                <Award aria-hidden />
                Award seat
              </Button>
            ) : (
              <Button
                type="button"
                variant="accent"
                onClick={() => act("shortlist")}
                disabled={busy !== null}
              >
                <CheckCircle2 aria-hidden />
                Shortlist
              </Button>
            )}
            {heldSeat && (
              <Button
                type="button"
                variant="outline"
                onClick={() => act("allocate")}
                disabled={busy !== null || !course}
              >
                <CheckCircle2 aria-hidden />
                Change track
              </Button>
            )}
            {candidate.status === "completed" && (
              <Button
                type="button"
                variant="outline"
                onClick={() => act("release")}
                disabled={busy !== null}
              >
                <Ban aria-hidden />
                Stand down
              </Button>
            )}
            {candidate.isFlagged ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => act("unflag")}
                disabled={busy !== null}
              >
                <X aria-hidden />
                Clear flag
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() => act("flag")}
                disabled={busy !== null}
              >
                <ShieldAlert aria-hidden />
                Flag for review
              </Button>
            )}
          </div>
        </div>

        {candidate.status === "completed" && (
          <Field label="Stand down to" className="max-w-xl">
            {({ id }) => (
              <Select
                id={id}
                value={releaseStatus}
                onChange={(value) => setReleaseStatus(value)}
                placeholder="Stand down to…"
                options={RELEASABLE_STATUSES.map((status) => {
                  const stage = PIPELINE.find((entry) => entry.key === status);
                  return {
                    value: status,
                    label: stage
                      ? `${stage.label} - ${stage.blurb.toLowerCase()}`
                      : status,
                  };
                })}
              />
            )}
          </Field>
        )}

        {candidate.decidedBy && (
          <p className="border-t border-line pt-4 text-small text-ink-soft">
            Last decision: {candidate.status} by {candidate.decidedBy}
            {candidate.decidedAt ? (
              <>
                {" on "}
                <time dateTime={candidate.decidedAt}>
                  {new Date(candidate.decidedAt).toLocaleDateString()}
                </time>
              </>
            ) : null}
            .
            {candidate.decisionNote ? ` - “${candidate.decisionNote}”` : ""}
          </p>
        )}
      </section>
    </Card>
  );
}
