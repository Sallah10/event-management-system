import "server-only";

import { Registrant } from "@/lib/models/Registrant";
import {
  OBJECTIVE_TTL_MINUTES,
  THEORY_TTL_MINUTES,
} from "@/config/rules";
import { log } from "@/lib/logger";

// ─── SITTING CLOCKS ───────────────────────────────────────────────────────────
// FIX: THE TIME LIMITS WERE NOT TIME LIMITS.
//
// Both papers opened with `const [timeLeft, setTimeLeft] = useState(1800)` and
// `useState(3600)`. The countdown therefore started when React mounted, not when
// the candidate started working. Every one of these handed back a full sitting:
// a page refresh, a crashed tab, a sleep cycle, a phone locking, an accidental
// close, a second device. The server had no start time at all, so it could not
// even notice — the only durable timestamp was objective_finished_at, written
// after the fact.
//
// Worse, the client was the sole holder of the clock, so the limit could not be
// enforced: `POST /api/assessment/submit` accepted a submission at any hour of
// any day. Anyone could have sat the paper once, walked away for a week, come
// back, and used the full window again.
//
// This module is the single place a deadline is computed, and it is computed
// from a database column. The client is told the deadline; it never invents one.
//
//   deadline = objective_started_at + OBJECTIVE_TTL_MINUTES
//
// objective_started_at is stamped once, on first view, and never rewritten, so
// the sitting survives a refresh, a crash, a redeploy, or an attempt to extend.

export type SittingStage = "objective" | "theory";

export interface Sitting {
  student: Registrant;
  /** ISO string, safe to hand straight to a client component. */
  deadline: string;
  /** Milliseconds left at the time this was computed. */
  remainingMs: number;
  expired: boolean;
  /** Only present on the theory stage. */
  selectedCourseSlug: string | null;
}

/** Where the clock for a given stage is stored, and how long it runs. */
const STAGE = {
  objective: {
    startedAtField: "objectiveStartedAt" as const,
    minutes: OBJECTIVE_TTL_MINUTES,
  },
  theory: {
    startedAtField: "theoryStartedAt" as const,
    minutes: THEORY_TTL_MINUTES,
  },
} as const;

/** How long a stage runs, in milliseconds. */
export function sittingTtlMs(stage: SittingStage): number {
  return STAGE[stage].minutes * 60_000;
}

/** When a sitting started, as a timestamp, or null when it has not been stamped. */
function startedAtOf(student: Registrant, stage: SittingStage): Date | null {
  return student.get(STAGE[stage].startedAtField) as Date | null;
}

export interface Deadline {
  /** ISO string, safe to hand straight to a client component. */
  deadline: string;
  /** Milliseconds left at the time this was computed. Never negative. */
  remainingMs: number;
  expired: boolean;
}

/**
 * The deadline arithmetic, on its own.
 *
 * It used to sit inline in `resolveSitting`, which meant the only way to check it
 * was to have a database. Deadline maths is exactly the kind of thing that is
 * wrong by one comparison operator — `>` against `>=` decides whether a candidate
 * who submitted on the second is late or not — and it was the part of this module
 * most worth being sure of.
 *
 * `now` is a parameter so a test can place itself exactly on the boundary.
 */
export function computeDeadline(
  startedAt: Date,
  stage: SittingStage,
  now: Date = new Date(),
): Deadline {
  const deadlineMs = new Date(startedAt).getTime() + sittingTtlMs(stage);
  const remainingMs = deadlineMs - now.getTime();

  return {
    deadline: new Date(deadlineMs).toISOString(),
    remainingMs: Math.max(0, remainingMs),
    expired: remainingMs <= 0,
  };
}

/**
 * Load a candidate's sitting, stamping the start time on first view.
 *
 * `student` must already be loaded by the caller (the caller usually needs it for
 * authorisation anyway). The stamp is a conditional UPDATE, so two concurrent
 * first requests cannot produce two different start times — the loser of the race
 * re-reads the winner's value.
 */
export async function resolveSitting(
  student: Registrant,
  stage: SittingStage,
): Promise<Sitting> {
  const { startedAtField, minutes } = STAGE[stage];

  let startedAt = startedAtOf(student, stage);

  if (!startedAt) {
    const now = new Date();
    const [stamped] = await Registrant.update(
      { [startedAtField]: now },
      {
        // `IS NULL` in the WHERE is the whole trick: this only ever writes once
        // per sitting, no matter how many tabs race to open the paper.
        where: { id: student.id, [startedAtField]: null },
      },
    );

    if (stamped > 0) {
      startedAt = now;
      student.set(startedAtField, now);
      log.info("exam.sitting_started", {
        barcodeId: student.barcodeId,
        stage,
        ttlMinutes: minutes,
      });
    } else {
      // Someone else won the race. Read their value rather than guessing.
      await student.reload();
      startedAt = startedAtOf(student, stage);
      if (!startedAt) startedAt = now;
    }
  }

  const { deadline, remainingMs, expired } = computeDeadline(startedAt, stage);

  return {
    student,
    deadline,
    remainingMs,
    expired,
    selectedCourseSlug: student.selectedCourseSlug ?? null,
  };
}

/**
 * Has this sitting run out? Used by the submit routes so the server can say so
 * independently of whatever the client believes.
 *
 * The callers accept a late submission rather than rejecting it — throwing away
 * a candidate's finished paper because a tab was open for ninety seconds past
 * the bell is worse than the infraction it prevents — but they record the finish
 * time as the real `now`, so ranking already accounts for being late. Lateness is
 * priced, not punished by data loss.
 */
export function isLate(student: Registrant, stage: SittingStage): boolean {
  const startedAt = startedAtOf(student, stage);
  if (!startedAt) return false;
  return Date.now() > new Date(startedAt).getTime() + sittingTtlMs(stage);
}

/**
 * Read a sitting clock WITHOUT starting it.
 *
 * Deliberately separate from `resolveSitting`, which stamps on first call. Some
 * routes need to know how long a candidate has been sitting without being the
 * thing that starts the clock — the flag route wants to know whether the grace
 * period has passed, and a candidate who has not opened the paper has no grace
 * period to be inside of. Calling `resolveSitting` from there would start their
 * exam at the moment they were suspected of something, which shortens their paper
 * for no reason anyone could explain to them.
 *
 * Returns 0 when the clock has not started, so callers can treat "no start time"
 * and "started at the epoch" the same way, which is what the grace-window
 * arithmetic wants.
 */
export function sittingStartedAtMs(student: Registrant, stage: SittingStage): number {
  const startedAt = startedAtOf(student, stage);
  return startedAt ? new Date(startedAt).getTime() : 0;
}
