import { NextResponse } from "next/server";
import { QueryTypes } from "sequelize";
import sequelize, { ensureDatabase } from "@/lib/db";
import { requireStaff } from "@/lib/staff-guard";
import { cleanText } from "@/lib/validate";
import { COURSES } from "@/config/course-matrix";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";

// ─── ADMISSIONS QUEUE ─────────────────────────────────────────────────────────
// The list view behind /admissions. It did not exist; the portal had no way to
// show anybody anything.
//
// TWO THINGS THIS DELIBERATELY DOES NOT RETURN, even to an authenticated
// admissions officer:
//
// 1. ESSAY TEXT. A queue is a list of people. Every essay in one response is
//    megabytes of PII for a screen that shows a name, a score and three buttons.
//    Essays come from /api/internal/candidate-answers, per candidate, so a
//    reviewer has to ask for the ones they are actually reading — and each of
//    those reads is logged, which is what makes the access defensible.
//
// 2. EMAILS. The queue is a working list, not an export. Email is on the detail
//    endpoint for the same reason.
//
// BUG: the column was selected anyway. The comment above said the queue does not
// return email addresses, and `SELECT r.email` returned every email address in
// the filtered set to anyone who could load the list — so the control described
// here existed only in a comment, and the one screen a reviewer looks at all day
// was the one that handed out the whole cohort's contact details in a single
// response. Email now comes from the per-candidate detail call, which is logged.
// The list shows name and ticket, which is all it needs to identify a row.
//
// FILTERING
// `status` accepts a comma-separated list, constrained to statuses the pipeline
// actually defines. The filter is a whitelist rather than being passed through to
// an operator, because an unvalidated status string in a Sequelize `where` is a
// footgun, and because the set of statuses is small and known.

const KNOWN_STATUSES = [
  "registered",
  "attended",
  "qualified",
  "waitlisted",
  "eliminated",
  "completed",
  "shortlisted",
  "awarded",
] as const;

const PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export async function GET(request: Request) {
  const { session, error } = await requireStaff("admissions");
  if (error) return error;

  try {
    await ensureDatabase();

    const params = new URL(request.url).searchParams;

    const requested = (params.get("status") ?? "completed")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const statuses = requested.filter((value): value is (typeof KNOWN_STATUSES)[number] =>
      (KNOWN_STATUSES as readonly string[]).includes(value),
    );

    // An entirely unrecognised filter returns nothing rather than everything. A
    // typo showing the full attendee list to someone who asked for the grading
    // queue is the wrong failure direction.
    if (statuses.length === 0) {
      return NextResponse.json({
        success: true,
        error: null,
        data: { rows: [], total: 0, page: 1, pageSize: PAGE_SIZE, unknownStatus: true },
      });
    }

    const page = Math.max(1, Number(params.get("page") ?? 1) || 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Number(params.get("pageSize") ?? PAGE_SIZE) || PAGE_SIZE),
    );

    // `flaggedOnly` is a first-class filter rather than a status, because a
    // suspension is orthogonal to where somebody is in the pipeline: a flagged
    // candidate may be registered, qualified, or completed.
    const flaggedOnly = params.get("flagged") === "true";
    const search = cleanText(params.get("q"), 60);
    const ungradedOnly = params.get("graded") === "false";

    // Search is escaped for LIKE and passed as one bound parameter. `%` and `_`
    // from a candidate's own name must not become wildcards, and `\` must be
    // escaped too or the ESCAPE clause stops working.
    const like = `%${search.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;

    // One WHERE clause, used by both queries below. It was previously inline in
    // the SELECT, which is what made it impossible to count the same set of
    // people with a second query without copying it and hoping the two copies
    // stayed in step.
    const where = `
        WHERE r.status IN (:statuses)
          ${flaggedOnly ? "AND r.is_flagged = true" : ""}
          ${ungradedOnly ? "AND r.theory_graded_at IS NULL" : ""}
          ${
            search
              ? "AND (r.name ILIKE :like ESCAPE '\\\\' OR r.barcode_id ILIKE :like ESCAPE '\\\\')"
              : ""
          }`;

    // COUNT(*) OVER() counts the whole filtered set before LIMIT is applied, so
    // the total comes from the same round trip as the page.
    //
    // BUG: it wasn't there. The response was typed `{ rows, total: number }` and
    // the value was read as `const { rows, total } = result` — but no column
    // supplied it, so `total` was `undefined` on every response and the queue
    // header read "50 of undefined". The `as` cast is what hid it: it asserted a
    // shape the query did not produce, and the type checker had no way to know.
    // Type assertions on a raw query result are a claim, not a check.
    const [result] = (await sequelize.query(
      `SELECT r.id, r.name, r.barcode_id AS "barcodeId",
              r.status, r.checked_in AS "checkedIn",
              r.objective_score AS "objectiveScore",
              r.objective_rank AS "objectiveRank",
              r.objective_finished_at AS "objectiveFinishedAt",
              r.theory_score AS "theoryScore",
              r.theory_graded_at AS "theoryGradedAt",
              r.theory_graded_by AS "theoryGradedBy",
              r.ai_suspected AS "aiSuspected",
              r.ai_grade_reason AS "aiGradeReason",
              r.ai_confidence AS "aiConfidence",
              r.tab_switches AS "tabSwitches",
              r.selected_course_slug AS "selectedCourseSlug",
              r.is_flagged AS "isFlagged",
              r.decision_note AS "decisionNote",
              r.decided_at AS "decidedAt",
              r.decided_by AS "decidedBy",
              COUNT(*) OVER() AS "total"
         FROM registrants r
         ${where}
        ORDER BY
          -- Awaiting grading first, and within that the strongest objective
          -- scores first: the order a reviewer should work in.
          CASE WHEN r.theory_graded_at IS NULL THEN 0 ELSE 1 END,
          r.objective_score DESC NULLS LAST,
          r.objective_rank ASC NULLS LAST,
          r.created_at ASC
        LIMIT :limit OFFSET :offset`,
      {
        replacements: { statuses, like, limit: pageSize, offset: (page - 1) * pageSize },
        type: QueryTypes.SELECT,
      },
    )) as [{ rows: Record<string, unknown>[]; total: number | null }, unknown];

    const rows = result.rows;

    // Past the last page there are no rows, and a window function on no rows
    // returns no total. Answering `0` there would tell a reviewer the queue is
    // empty when it has 200 people in it, so page past the end costs one extra
    // count query. Inside the range, the window value is used and nothing extra
    // is asked of the database.
    let total = Number(rows[0]?.total ?? 0);
    if (rows.length === 0 && page > 1) {
      const [counted] = (await sequelize.query(
        `SELECT COUNT(*) AS "total" FROM registrants r ${where}`,
        { replacements: { statuses, like }, type: QueryTypes.SELECT },
      )) as [{ total: string | number }, unknown];
      total = Number(counted?.total ?? 0);
    }

    log.info("admissions.queue_viewed", {
      by: session.name,
      statuses,
      page,
      returned: rows.length,
    });

    return NextResponse.json({
      success: true,
      error: null,
      data: {
        rows: rows.map((row) => ({
          ...row,
          // Slug -> label, so the UI never has to carry the course matrix.
          course: COURSES.find((c) => c.slug === row.selectedCourseSlug)?.displayName ?? null,
          courseSlug: row.selectedCourseSlug ?? null,
        })),
        total,
        page,
        pageSize,
      },
    });
  } catch (error) {
    log.error("admissions.queue_error", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      { success: false, error: "UNAVAILABLE", message: "Queue unavailable." },
      { status: 503 },
    );
  }
}
