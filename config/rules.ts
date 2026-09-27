import { COURSES } from "@/config/course-matrix";
import questions from "@/config/questions.json";

// ─── BUSINESS RULES ───────────────────────────────────────────────────────────
// Single source of truth. Every number the README talks about is defined here
// and read from here, so the documentation can't drift from the behaviour again.
//
// The old config/event-settings.ts declared QUALIFIED_POOL_SIZE: 910,
// VENUE_CAPACITY: 3500 and COURSE_LIMIT: 42 — and was imported by exactly one
// file, which was itself a dead "copy" file. Nothing read it. The 3500 cap was a
// hardcoded literal in check-in/route.ts, the 42 came from a different constant
// in course-matrix.ts, and 910 was enforced NOWHERE: the only real gate into the
// theory paper was a per-candidate 80% score, so the 5,000th candidate to score
// 85% would still have been let through. Meanwhile the README advertised a
// "910 Wall" and the admin dashboard displayed a "QUALIFIED (910)" tile.

/** Total scholarships available across every course. */
export const TOTAL_SLOTS = Number(process.env.TOTAL_SLOTS ?? 546);

/**
 * How many candidates may proceed from the objective section to the theory
 * paper. Ranked by score DESC, then finish time ASC — a genuine race for the
 * seats, not a per-person threshold.
 */
export const QUALIFIED_POOL_SIZE = Number(process.env.QUALIFIED_POOL_SIZE ?? 910);

/** Hard stop on venue attendance. Check-in refuses beyond this. */
export const VENUE_CAPACITY = Number(process.env.VENUE_CAPACITY ?? 3500);

/** Objective section time limit, in minutes. */
export const OBJECTIVE_TTL_MINUTES = Number(process.env.OBJECTIVE_TTL_MINUTES ?? 30);

/** Theory section time limit, in minutes. */
export const THEORY_TTL_MINUTES = Number(process.env.THEORY_TTL_MINUTES ?? 45);

/** Minimum word count for a theory answer to be gradeable. */
export const THEORY_MIN_WORDS = Number(process.env.THEORY_MIN_WORDS ?? 50);

/** How many questions the objective paper contains. Counted, never hardcoded. */
export const TOTAL_QUESTIONS = questions.length;

/**
 * Objective pass mark, as a percentage.
 *
 * This lives here rather than next to the answer key because the candidate's
 * rules page has to state the same number the server enforces — and a client
 * component cannot import a `server-only` module.
 *
 * The NEXT_PUBLIC_ fallback exists for that reason and carries a real caveat: in
 * a client bundle, `process.env.OBJECTIVE_PASS_MARK` is inlined as `undefined` at
 * build time, so a browser only ever sees the NEXT_PUBLIC_ value. If you set the
 * server variable to something other than 80, set the public one to match, or the
 * rules page will quote a number that isn't the one being applied. This is the
 * usual cost of telling the user a rule in advance, and it is why the server
 * re-checks everything regardless of what the page said.
 */
export const PASS_MARK_PERCENT = Number(
  process.env.OBJECTIVE_PASS_MARK ?? process.env.NEXT_PUBLIC_OBJECTIVE_PASS_MARK ?? 80,
);

/**
 * Per-course scholarship cap. Derived rather than hand-maintained so adding a
 * course can't leave 13 hardcoded 42s lying around.
 */
export const LIMIT_PER_COURSE = Math.floor(TOTAL_SLOTS / COURSES.length);

/** Statuses that mean "this candidate holds a scholarship seat". */
export const AWARDED_STATUSES = ["awarded", "shortlisted"] as const;

/** Statuses that count toward a filled course seat. */
export const SEAT_HOLDING_STATUSES = ["awarded", "shortlisted"] as const;

/**
 * Statuses that mean "this candidate has finished the whole process", for
 * reporting. `waitlisted` and `eliminated` are terminal for this cohort but the
 * candidate is not "completed" — they sat the paper and the outcome was no.
 */
export const TERMINAL_STATUSES = [
  "waitlisted",
  "eliminated",
  "shortlisted",
  "awarded",
] as const;

/** Full ordered pipeline, for the admissions board. */
export const PIPELINE = [
  { key: "registered", label: "Registered", blurb: "Signed up via WordPress" },
  { key: "attended", label: "Attended", blurb: "Checked in at the venue" },
  { key: "qualified", label: "In the pool", blurb: "Inside the top 910" },
  { key: "completed", label: "Theory in", blurb: "Essay submitted, awaiting grading" },
  { key: "shortlisted", label: "Shortlisted", blurb: "Graded, seat offered" },
  { key: "awarded", label: "Awarded", blurb: "Seat confirmed, synced to LMS" },
  { key: "waitlisted", label: "Waitlisted", blurb: "Met the pass mark, outside the pool" },
  { key: "eliminated", label: "Not qualified", blurb: "Below the pass mark" },
] as const;

export type PipelineStatus = (typeof PIPELINE)[number]["key"];

/**
 * Statuses a person may put a candidate into when standing them down.
 *
 * This belongs here rather than in lib/admissions.ts, next to the transition
 * table that enforces it, because the review panel needs to render exactly this
 * list — and it cannot import it from there. lib/admissions.ts imports Sequelize
 * and lib/db, which calls `requireEnv("DATABASE_URL")` at module scope, so a
 * client component importing it to read one array would take the whole database
 * client into the browser bundle and fail the build on a missing env var.
 *
 * The list had already drifted once: the panel offered three of these four,
 * hardcoded, and nothing compared the two. Now there is one list, and the panel
 * labels each entry from PIPELINE above.
 */
export const RELEASABLE_STATUSES = [
  "waitlisted",
  "eliminated",
  "attended",
  "completed",
] as const satisfies readonly PipelineStatus[];

/** Course slugs are validated against this — never trusted from the client. */
export function isValidCourseSlug(slug: unknown): slug is string {
  return (
    typeof slug === "string" &&
    COURSES.some((course) => course.slug === slug)
  );
}
