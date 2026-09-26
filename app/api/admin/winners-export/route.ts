import { NextResponse } from "next/server";
import { Op } from "sequelize";
import { Registrant } from "@/lib/models/Registrant";
import { ensureDatabase } from "@/lib/db";
import { requireStaff } from "@/lib/staff-guard";
import { SEAT_HOLDING_STATUSES, TOTAL_SLOTS } from "@/config/rules";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";

// ─── WINNERS EXPORT ───────────────────────────────────────────────────────────
// The feed the scholarship is fulfilled from. Every row in here becomes a seat,
// an enrolment, and a decision somebody has to stand behind, so the query has to
// be exactly the set of people who actually won.
//
// WHAT WAS WRONG
//     status: ["completed", "awarded", "shortlisted"]
//
// "completed" — in the old model that meant "theory submitted". The theory
// submit route also wrote status: "awarded" the moment an essay was handed in,
// so this filter was an attempt to catch the overlap, and it did the opposite:
// it exported everyone who had submitted an essay, graded or not, flagged or not,
// short of the top of the list. With the new status model "completed" is
// unambiguous, and including it here would export the entire ungraded pool as
// scholarship winners. The filter is now the two statuses that mean "holds a
// seat", and nothing else.
//
// Two more things that mattered:
//   • `isFlagged: false` was doing double duty as a data-quality filter, which
//     reads as "we don't award scholarships to anyone under review" — a policy
//     nobody agreed to. Flagged candidates are now EXPORTED with a flag
//     alongside, so a human decides. Silently dropping them is how a candidate
//     finds out from a third party.
//   • The comparison was `token !== process.env.INTERNAL_SYNC_TOKEN`. With the
//     variable unset, `token !== undefined` is true for any string, so it failed
//     closed — but it meant a deployed instance with no INTERNAL_SYNC_TOKEN
//     simply could not be exported, with no explanation. It is a staff
//     capability now, tied to the decision log rather than a shared secret.

const COLUMNS = [
  "barcodeId",
  "name",
  "email",
  "phone",
  "selectedCourseSlug",
  "objectiveScore",
  "objectiveRank",
  "theoryScore",
  "objectiveFinishedAt",
  "theoryGradedAt",
  "status",
  "isFlagged",
  "aiSuspected",
  "decidedAt",
  "decidedBy",
];

export async function GET() {
  const { error } = await requireStaff("admissions");
  if (error) return error;

  try {
    await ensureDatabase();

    const winners = (await Registrant.findAll({
      where: { status: { [Op.in]: [...SEAT_HOLDING_STATUSES] } },
      order: [
        // Scholarship merit, then objective, then who got there first.
        ["theoryScore", "DESC"],
        ["objectiveScore", "DESC"],
        ["objectiveFinishedAt", "ASC"],
      ],
      attributes: COLUMNS,
      raw: true,
    })) as unknown as Record<string, unknown>[];

    const confirmed = winners.filter((w) => w.status === "awarded").length;
    const pending = winners.filter((w) => w.status === "shortlisted").length;
    const underReview = winners.filter((w) => w.isFlagged === true).length;

    // Exporting a full register of names, emails, phone numbers and grades is
    // exactly the event a log aggregator should record.
    log.info("admin.winners_export", {
      total: winners.length,
      confirmed,
      pending,
      underReview,
    });

    return NextResponse.json({
      success: true,
      error: null,
      data: {
        count: winners.length,
        confirmed,
        pending,
        underReview,
        // Said out loud, because an export that quietly includes people under
        // integrity review is a decision the operator should have made knowing.
        advisory:
          underReview > 0
            ? `${underReview} winner(s) are under integrity review. Resolve those before fulfilling.`
            : null,
        totalSeats: TOTAL_SLOTS,
        generatedAt: new Date().toISOString(),
        winners,
      },
    });
  } catch {
    return NextResponse.json(
      { success: false, error: "UNAVAILABLE", message: "Export unavailable. Check the logs." },
      { status: 503 },
    );
  }
}
