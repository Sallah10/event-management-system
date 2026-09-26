import { Op } from "sequelize";
import { Registrant } from "@/lib/models/Registrant";
import { QUALIFIED_POOL_SIZE } from "@/config/rules";

// ─── RANKING ──────────────────────────────────────────────────────────────────
// The README used to claim a "910 Wall": only the top 910 objective scorers may
// proceed to the theory paper. Nothing implemented that. The only real gate was
//
//     const isQualified = finalPercentage >= 80;
//
// …which is a per-candidate threshold, not a pool. Three thousand candidates
// scoring 85% would all have been let through. The route also returned
// `submissionNumber = await Registrant.count(...)` and labelled it
// `submissionRank` — a COUNT is not a rank, and the admin dashboard showed a
// "QUALIFIED (910)" tile for a rule that didn't exist.
//
// This module is that rule, properly:
//
//   rank = 1 + (number of candidates strictly ahead of you)
//
// "Ahead of" means a higher objective score, or an equal score with a strictly
// earlier finish. The `id` tiebreak only matters if two submissions share both
// score and timestamp to the millisecond, but without it the rank isn't
// deterministic and the same candidate could get two different answers.
//
// Note the ordering: finish time only breaks ties on score. Someone who scores
// 100% in the last second outranks someone who scores 90% in the first, which
// is the intended "fastest finger" behaviour and worth saying out loud in an
// interview, because it's a business decision, not a technical one.

export interface RankResult {
  rank: number;
  total: number;
  poolSize: number;
  /** Inside the pool AND at or above the pass mark. */
  hasSeat: boolean;
  passMark: number;
}

export async function computeObjectiveRank(input: {
  score: number;
  finishedAt: Date;
  passMark: number;
  poolSize?: number;
  excludeId?: string;
}): Promise<RankResult> {
  const poolSize = input.poolSize ?? QUALIFIED_POOL_SIZE;

  // Everything that finished the objective section, minus the candidate themself
  const where: Record<string, unknown> = {
    objectiveFinishedAt: { [Op.ne]: null },
  };
  if (input.excludeId) where.id = { [Op.ne]: input.excludeId };

  const ahead = await Registrant.count({
    where: {
      ...where,
      [Op.or]: [
        // strictly better score
        { objectiveScore: { [Op.gt]: input.score } },
        // same score, got there first
        {
          objectiveScore: input.score,
          objectiveFinishedAt: { [Op.lt]: input.finishedAt },
        },
      ],
    },
  });

  const total = ahead + 1;

  return {
    rank: total,
    total,
    poolSize,
    hasSeat: total <= poolSize && input.score >= input.passMark,
    passMark: input.passMark,
  };
}

/**
 * Live pool pressure, for the admin board. Counts everyone inside the pool so
 * far, and how many seats are left.
 */
export async function getPoolPressure(poolSize = QUALIFIED_POOL_SIZE) {
  const [finished, insidePool] = await Promise.all([
    Registrant.count({ where: { objectiveFinishedAt: { [Op.ne]: null } } }),
    Registrant.count({ where: { status: "qualified" } }),
  ]);

  return {
    poolSize,
    finished,
    insidePool,
    remaining: Math.max(0, poolSize - insidePool),
  };
}
