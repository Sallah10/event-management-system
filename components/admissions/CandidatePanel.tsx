"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Award,
  Ban,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  X,
} from "lucide-react";
import { apiFetch, type ApiResult } from "@/lib/client/api";
import { COURSES } from "@/config/course-matrix";
import { PIPELINE, RELEASABLE_STATUSES } from "@/config/rules";
import { cn } from "@/lib/utils";

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
// localStorage — which did nothing on the server.
//
// ON FETCHING ESSAYS
// The essays arrive from /api/internal/candidate-answers when the panel opens,
// not with the queue. Loading 900 sets of essays to render a list of names would
// put every applicant's PII in one response and in the browser's memory for the
// whole session. Fetching per candidate also means each read is logged, so "who
// read this applicant's work" is answerable — which is the question a candidate
// has a right to ask.

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
 * Every decision here is irreversible in the interface — the list refreshes and
 * the panel closes, so nobody gets a "are you sure" they can cancel after seeing
 * that the seat counter moved. The confirmation therefore has to say what
 * happened, not just "OK". "Shortlisted" is a fact about a real person holding a
 * real place; a generic toast gives them nothing to check their work against.
 */
const DECISION_COPY: Record<Action, string> = {
  shortlist: "Shortlisted — a seat is now held for this candidate.",
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
    <section
      aria-label={`Reviewing ${candidate.name}`}
      className="rounded-3xl border border-ink/15 bg-white p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{candidate.name}</h2>
          <p className="font-mono text-xs text-ink-soft">
            {/* Ticket is enough to identify the row and is in the list response.
                The email address arrives with the per-candidate record, which is
                a logged read — the queue deliberately does not carry the whole
                cohort's addresses, so this line fills in a moment after the
                panel opens rather than being there on first paint. */}
            {candidate.barcodeId}
            {email ? ` · ${email}` : ""}
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="rounded-full border border-ink/15 p-2"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Objective" value={candidate.objectiveScore !== null ? `${candidate.objectiveScore}%` : "—"} />
        <Stat
          label="Rank"
          value={candidate.objectiveRank ? `#${candidate.objectiveRank}` : "—"}
        />
        <Stat
          label="Theory"
          value={candidate.theoryGradedAt ? String(candidate.theoryScore) : "ungraded"}
        />
        <Stat label="Status" value={candidate.status} />
      </dl>

      {candidate.aiSuspected && (
        <div className="mt-4 rounded-2xl border border-amber-deep/40 bg-amber/10 p-4">
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            Model note · {candidate.aiConfidence ?? "no confidence given"}
          </p>
          <p className="mt-1 text-sm">{candidate.aiGradeReason ?? "No reason recorded."}</p>
          <p className="mt-2 text-[11px] text-ink-soft">
            This is a suggestion from a language model, not a finding. It has not
            been reviewed by a person and it does not affect this candidate&apos;s
            status on its own.
          </p>
        </div>
      )}

      <div className="mt-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-xs font-bold uppercase tracking-widest text-ink-soft">
            Essays
          </h3>
          {/* Useful because the AI batch can be run while this panel is open: the
              panel then shows what the model said without being reopened. */}
          <button
            onClick={reloadEssays}
            disabled={loadingEssays}
            className="flex items-center gap-1.5 rounded-full border border-ink/15 px-3 py-1 text-[11px] font-semibold disabled:opacity-50"
          >
            {loadingEssays ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="h-3 w-3" aria-hidden />
            )}
            Reload
          </button>
        </div>
        {loadingEssays && (
          <p className="mt-3 flex items-center gap-2 text-sm text-ink-soft">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading submissions…
          </p>
        )}
        {!loadingEssays && essays?.length === 0 && (
          <p className="mt-3 text-sm text-ink-soft">
            No essays on file. This candidate has not submitted a theory paper.
          </p>
        )}
        <div className="mt-3 space-y-4">
          {essays?.map((essay) => {
            // A graded-length answer and one written to the minimum are not the same
            // thing to read, and at grading speed they look identical in a wall of
            // text. Marking the short ones saves a reviewer from discovering it
            // halfway down a paragraph.
            const thin = minWords > 0 && essay.words > 0 && essay.words < minWords * 1.5;
            return (
              <article key={essay.q} className="rounded-2xl border border-ink/10 p-4">
                <p className="text-[11px] font-bold uppercase tracking-wide text-ink-soft">
                  Question {essay.q} · {essay.words} words
                  {minWords > 0 && essay.words > 0 && (
                    <span className="ml-1 font-normal normal-case">
                      (minimum {minWords})
                    </span>
                  )}
                </p>
                <p className="mt-1 text-sm font-semibold">{essay.question}</p>
                {thin && (
                  <p className="mt-1 text-[11px] font-semibold text-amber-deep">
                    Short answer — read this one closely.
                  </p>
                )}
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink/90">
                  {essay.answer || "— no answer —"}
                </p>
              </article>
            );
          })}
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor="score" className="text-xs font-bold uppercase tracking-widest text-ink-soft">
            Theory score (0–100)
          </label>
          <div className="flex gap-2">
            <input
              id="score"
              value={score}
              onChange={(event) => setScore(event.target.value.replace(/[^0-9]/g, ""))}
              inputMode="numeric"
              maxLength={3}
              placeholder="—"
              className="w-24 rounded-full border border-ink/20 px-4 py-2 text-sm tabular-nums outline-none focus:border-ink/50"
            />
            <button
              onClick={saveGrade}
              disabled={busy !== null}
              className="flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-paper disabled:opacity-50"
            >
              {busy === "grade" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
              )}
              Save grade
            </button>
          </div>
          {candidate.theoryGradedBy && (
            <p className="text-[11px] text-ink-soft">
              Last graded by {candidate.theoryGradedBy}.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <label htmlFor="track" className="text-xs font-bold uppercase tracking-widest text-ink-soft">
            Course track
          </label>
          <select
            id="track"
            value={course}
            onChange={(event) => setCourse(event.target.value)}
            className="w-full rounded-full border border-ink/20 bg-white px-4 py-2 text-sm outline-none focus:border-ink/50"
          >
            <option value="">No track selected</option>
            {COURSES.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.displayName}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <label htmlFor="note" className="text-xs font-bold uppercase tracking-widest text-ink-soft">
          Reason
        </label>
        <textarea
          id="note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          placeholder="Required for a flag or a release."
          className="w-full resize-y rounded-2xl border border-ink/20 p-3 text-sm outline-none focus:border-ink/50"
        />
        {error && (
          <p role="alert" className="text-sm font-semibold text-red-800">
            {error}
          </p>
        )}
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {heldSeat ? (
          <ActionButton
            label="Award seat"
            icon={Award}
            onClick={() => act("award")}
            disabled={busy !== null}
            primary
          />
        ) : (
          <ActionButton
            label="Shortlist"
            icon={CheckCircle2}
            onClick={() => act("shortlist")}
            disabled={busy !== null}
            primary
          />
        )}
        {heldSeat && (
          <ActionButton
            label="Change track"
            icon={CheckCircle2}
            onClick={() => act("allocate")}
            disabled={busy !== null || !course}
          />
        )}
        {candidate.status === "completed" && (
          <ActionButton
            label="Stand down"
            icon={Ban}
            onClick={() => act("release")}
            disabled={busy !== null}
          />
        )}
        {candidate.isFlagged ? (
          <ActionButton
            label="Clear flag"
            icon={X}
            onClick={() => act("unflag")}
            disabled={busy !== null}
          />
        ) : (
          <ActionButton
            label="Flag for review"
            icon={ShieldAlert}
            onClick={() => act("flag")}
            disabled={busy !== null}
          />
        )}
      </div>

      {candidate.status === "completed" && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label
            htmlFor="releaseStatus"
            className="text-[11px] font-bold uppercase tracking-widest text-ink-soft"
          >
            Stand down to
          </label>
          <select
            id="releaseStatus"
            value={releaseStatus}
            onChange={(event) => setReleaseStatus(event.target.value)}
            className="rounded-full border border-ink/20 bg-white px-3 py-1 text-xs"
          >
            {/* Options come from RELEASABLE_STATUSES, the same list the decision
                route validates against, labelled from PIPELINE. This used to be
                three hand-written <option>s that had already fallen out of step
                with the server's four — an option the API rejects is worse than
                one that is not there, because the reviewer only finds out after
                the click. */}
            {RELEASABLE_STATUSES.map((status) => {
              const stage = PIPELINE.find((entry) => entry.key === status);
              return (
                <option key={status} value={status}>
                  {stage ? `${stage.label} — ${stage.blurb.toLowerCase()}` : status}
                </option>
              );
            })}
          </select>
        </div>
      )}

      {candidate.decidedBy && (
        <p className="mt-4 text-[11px] text-ink-soft">
          Last decision: {candidate.status} by {candidate.decidedBy}
          {candidate.decidedAt ? ` on ${new Date(candidate.decidedAt).toLocaleDateString()}` : ""}.
          {candidate.decisionNote ? ` — “${candidate.decisionNote}”` : ""}
        </p>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-paper px-3 py-2">
      <dt className="text-[10px] font-bold uppercase tracking-widest text-ink-soft">
        {label}
      </dt>
      <dd className="text-sm font-bold tabular-nums">{value}</dd>
    </div>
  );
}

function ActionButton({
  label,
  icon: Icon,
  onClick,
  disabled,
  primary,
}: {
  label: string;
  icon: typeof Award;
  onClick: () => void;
  disabled: boolean;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-40",
        primary
          ? "bg-ink text-paper hover:bg-ink/90"
          : "border border-ink/20 hover:border-ink/50",
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label}
    </button>
  );
}
