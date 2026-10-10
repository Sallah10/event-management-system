import { z } from "zod";
import { Op } from "sequelize";
import { Registrant } from "@/lib/models/Registrant";
import { requireStaff } from "@/lib/staff-guard";
import { ensureDatabase } from "@/lib/db";
import { recordGrades } from "@/lib/admissions";
import { log } from "@/lib/logger";
import { countWords } from "@/lib/validate";
import { THEORY_MIN_WORDS } from "@/config/rules";
import {
  gradeAll,
  isConfigured,
  modelName,
  providerName,
  type GradingJob,
} from "@/lib/grading-provider";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// ─── AI ESSAY GRADING ─────────────────────────────────────────────────────────
// Six things were wrong with this route. All six are load-bearing, and all six
// still hold.
//
// 1. IT GRADED NOBODY.
//    It selected `where: { status: "completed", theoryScore: 0 }`.
//    submit-theory wrote `status: "awarded"` on submission.
//    "completed" and "awarded" are disjoint sets, so the query matched zero rows
//    and the endpoint cheerfully reported "No candidates pending grading" -
//    forever. Two files disagreeing on what a status means, and nothing caught
//    it because there was no test. submit-theory now writes "completed" for
//    "submitted, awaiting grading", which is what this route was already asking
//    for.
//
// 2. IT OVERWROTE INTEGRITY FLAGS.
//    `Registrant.update({ isFlagged: aiData.is_ai_suspected || false })` wrote
//    the flag column unconditionally. Any candidate already flagged by the
//    invigilation process had that flag silently ERASED, because the model said
//    "not AI-generated". The model's opinion now goes in its own column and only
//    a human can set isFlagged.
//
// 3. THE COST ESTIMATE WAS INVENTED.
//    It hardcoded "1500 input tokens per candidate" and priced them against a
//    rate that did not match the model actually in use, then the dashboard
//    displayed the result as though it were a measurement. It was a guess
//    presented as an invoice. We report counts and let the operator see a real
//    number; we do not quote a price we have not measured.
//
// 4. IT WROTE TO process.cwd().
//    `fs.appendFileSync(path.join(process.cwd(), "ai-usage.log"))`. On Vercel the
//    project directory is read-only, so this throws EROFS - and because it ran
//    AFTER the batch had been submitted and paid for, the route 500'd with the
//    results unreachable. There is no usage log file here at all now.
//
// 5. 900 SEQUENTIAL UPDATES IN A 10-SECOND FUNCTION.
//    The result collector looped `await Registrant.update(...)` per candidate
//    while vercel.json capped every non-check-in route at maxDuration 10. With
//    ~900 essays that could not finish, so the route died partway and half the
//    grades were never written. One bulk upsert, no per-row await.
//
// 6. THE MODEL OUTPUT WAS json.parse'd WITH NO VALIDATION.
//    `JSON.parse(content)` straight into arithmetic, with the response cast to
//    any. A model that returns prose, a truncated object, or a 0-1000 scale
//    instead of 0-100 would take down the run or write a nonsense score. zod
//    validates and coerces, and a malformed row is skipped and counted rather
//    than taking the run down with it.
//
// WHAT THE AI IS AND ISN'T: it produces a *recommendation*. `aiSuspected` is
// recorded as an observation for a human to weigh. The route does not disqualify,
// and it cannot.
//
// PROVIDER: Gemini. This used to drive the OpenAI Batch API - upload a JSONL file,
// poll for up to 24 hours, download an output file. Gemini has no equivalent
// shape, and a serverless function has nowhere to keep a job between requests
// anyway, so grading is now a bounded concurrent loop inside one request. It
// processes a capped number of candidates per call and is resumable: whatever it
// does not reach is still pending and picked up by the next run.

const GRADING_PROMPT = `You are an admissions assessor for a technology scholarship programme.

You will read a candidate's written responses to three short questions and assess them.

Score each criterion from 0 to 100:
- authenticity: does this read as genuinely written by this person, in their own voice, about their own experience?
- passion: is there a specific, concrete reason this person wants this specific track?
- clarity: are the answers specific enough to judge, rather than generalities?

Judge only what is on the page. Do not reward confident phrasing over substance, and do not penalise a candidate for grammar, spelling, or dialect - many applicants are writing in a second language and that is not a merit signal.

Respond with JSON only, no commentary, using exactly this shape:
{"authenticity":<int 0-100>,"passion":<int 0-100>,"clarity":<int 0-100>,"finalScore":<int 0-100>,"aiSuspected":<boolean>,"reason":<string under 40 words>,"confidence":"high"|"medium"|"low"}`;

const gradeSchema = z.object({
  authenticity: z.coerce.number().int().min(0).max(100).catch(0),
  passion: z.coerce.number().int().min(0).max(100).catch(0),
  clarity: z.coerce.number().int().min(0).max(100).catch(0),
  finalScore: z.coerce.number().int().min(0).max(100).optional(),
  aiSuspected: z.coerce.boolean().catch(false),
  reason: z.string().max(400).catch(""),
  confidence: z.enum(["high", "medium", "low"]).catch("low"),
});

type Grade = z.infer<typeof gradeSchema>;

const GRADING_LIMIT = Number(process.env.GRADING_CHUNK_SIZE ?? 40);

interface CandidateRow {
  id: string;
  email: string;
  theoryAnswer1: string | null;
  theoryAnswer2: string | null;
  theoryAnswer3: string | null;
}

/** Pull a JSON blob out of a model response that may be wrapped in prose or fences. */
function extractJson(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : content).trim();
  try {
    return JSON.parse(body);
  } catch {
    // Fall back to the first balanced object in the string
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start === -1 || end <= start)
      throw new Error("no JSON object in response");
    return JSON.parse(body.slice(start, end + 1));
  }
}

function averageOf(grade: Grade): number {
  return Math.round((grade.authenticity + grade.passion + grade.clarity) / 3);
}

function promptFor(candidate: CandidateRow): string {
  return `Question 1 - Why do you want to study this track?\n${candidate.theoryAnswer1 ?? "(no answer)"}\n\nQuestion 2 - What difference would this make in your community?\n${candidate.theoryAnswer2 ?? "(no answer)"}\n\nQuestion 3 - Where do you see yourself in five years?\n${candidate.theoryAnswer3 ?? "(no answer)"}`;
}

// ─── POST: GRADE THE PENDING QUEUE ─────────────────────────────────────────────
export async function POST() {
  const { error } = await requireStaff("admissions");
  if (error) return error;

  if (!isConfigured()) {
    return Response.json(
      {
        success: false,
        error: "NOT_CONFIGURED",
        message: "GEMINI_API_KEY is not set.",
      },
      { status: 503 },
    );
  }

  try {
    await ensureDatabase();

    // FIX 1. "completed" is what submit-theory now writes. This is the query
    // that was always intended.
    const candidates = (await Registrant.findAll({
      where: {
        status: "completed",
        theoryScore: 0,
        [Op.or]: [
          { theoryAnswer1: { [Op.ne]: null } },
          { theoryAnswer2: { [Op.ne]: null } },
          { theoryAnswer3: { [Op.ne]: null } },
        ],
      },
      attributes: [
        "id",
        "email",
        "theoryAnswer1",
        "theoryAnswer2",
        "theoryAnswer3",
      ],
      raw: true,
    })) as unknown as CandidateRow[];

    // ─── FILTER, DON'T WASTE TOKENS ON UNGRADEABLE ANSWERS ──────────────────
    const gradeable: CandidateRow[] = [];
    const skipped: { id: string; reason: string }[] = [];

    for (const candidate of candidates) {
      const answers = [
        candidate.theoryAnswer1,
        candidate.theoryAnswer2,
        candidate.theoryAnswer3,
      ].filter(
        (a): a is string => typeof a === "string" && a.trim().length > 0,
      );

      const longEnough = answers.filter(
        (a) => countWords(a) >= THEORY_MIN_WORDS,
      ).length;

      if (longEnough === 0) {
        // Previously this did `student.update({ theoryScore: 1, isFlagged: true })`
        // - a silent auto-disqualification with no log and no human in the loop.
        // Now it's recorded as a grade of 0 with an explicit note, and isFlagged
        // is not touched.
        skipped.push({
          id: candidate.id,
          reason: "no_answer_met_minimum_length",
        });
        continue;
      }
      gradeable.push(candidate);
    }

    // Recording the skipped rows is not optional bookkeeping: leaving them at
    // theoryScore 0 means every future run re-fetches them and re-reports them.
    if (skipped.length > 0) {
      await recordGrades(
        skipped.map((s) => ({
          id: s.id,
          theoryScore: 0,
          aiSuspected: false,
          aiGradeReason: s.reason,
          aiConfidence: "low",
        })),
      );
    }

    const chunk = gradeable.slice(0, Math.max(1, GRADING_LIMIT));
    if (chunk.length === 0) {
      return Response.json({
        success: true,
        error: null,
        data: {
          provider: providerName(),
          model: modelName(),
          graded: 0,
          queued: 0,
          skipped: skipped.length,
          remaining: 0,
          message:
            skipped.length > 0
              ? `${skipped.length} submission(s) had no answer long enough to assess. They scored zero and are in the integrity queue.`
              : "Nothing pending grading.",
        },
      });
    }

    const jobs: GradingJob[] = chunk.map((candidate) => ({
      id: candidate.id,
      prompt: promptFor(candidate),
    }));

    log.info("ai_audit.started", {
      queued: chunk.length,
      skipped: skipped.length,
      provider: providerName(),
      model: modelName(),
    });

    const outcomes = await gradeAll(GRADING_PROMPT, jobs);

    const updates: {
      id: string;
      theoryScore: number;
      aiSuspected: boolean;
      aiGradeReason: string;
      aiConfidence: string;
    }[] = [];
    const failures: { id: string; reason: string }[] = [];

    for (const outcome of outcomes) {
      if (!outcome.ok) {
        failures.push({
          id: outcome.id,
          reason: outcome.failure ?? "api_error",
        });
        continue;
      }

      // FIX 6. Validate before we write. A malformed row is skipped, not fatal.
      const parsed = gradeSchema.safeParse(extractJson(outcome.content));
      if (!parsed.success) {
        failures.push({ id: outcome.id, reason: "unparseable_response" });
        continue;
      }

      const grade = parsed.data;
      updates.push({
        id: outcome.id,
        theoryScore: grade.finalScore ?? averageOf(grade),
        // FIX 2. Separate column. isFlagged is a human decision, untouched here.
        aiSuspected: grade.aiSuspected,
        aiGradeReason: grade.reason,
        aiConfidence: grade.confidence,
      });
    }

    // FIX 5. One bulk write instead of N sequential awaits inside a time budget.
    const written = await recordGrades(
      updates,
      `run:${new Date().toISOString()}`,
    );

    const remaining = await Registrant.count({
      where: { status: "completed", theoryScore: 0 },
    });

    log.info("ai_audit.graded", {
      graded: written,
      parsed: updates.length,
      failed: failures.length,
      suspected: updates.filter((u) => u.aiSuspected).length,
    });

    return Response.json({
      success: true,
      error: null,
      data: {
        provider: providerName(),
        model: modelName(),
        graded: written,
        failed: failures.length,
        skipped: skipped.length,
        remaining,
        flaggedForReview: updates.filter((u) => u.aiSuspected).length,
        failures: failures.slice(0, 20),
        warning:
          "This sends candidate essays to the configured model provider. Confirm your data-processing terms cover it before running on real data.",
        note: "AI-suspected essays are queued for human review in the integrity panel. Nobody was disqualified by this run.",
      },
    });
  } catch (err) {
    log.error("ai_audit.failed", { message: (err as Error)?.message });
    return Response.json(
      {
        success: false,
        error: "FAILED",
        message: "Could not grade the queue. Check the logs.",
      },
      { status: 500 },
    );
  }
}

// ─── GET: QUEUE DEPTH ─────────────────────────────────────────────────────────
// This used to collect a completed batch. Grading is synchronous now, so there is
// no job to poll - the same route reports what is still outstanding instead, which
// is the only thing an operator actually needs between runs.
export async function GET() {
  const { error } = await requireStaff("admissions");
  if (error) return error;

  try {
    await ensureDatabase();

    const [pending, graded, aiSuspected] = await Promise.all([
      Registrant.count({ where: { status: "completed", theoryScore: 0 } }),
      Registrant.count({ where: { theoryScore: { [Op.gt]: 0 } } }),
      Registrant.count({ where: { aiSuspected: true } }),
    ]);

    return Response.json({
      success: true,
      error: null,
      data: {
        pending,
        graded,
        aiSuspected,
        provider: providerName(),
        model: modelName(),
        configured: isConfigured(),
        chunkSize: GRADING_LIMIT,
      },
    });
  } catch (err) {
    log.error("ai_audit.stats_failed", { message: (err as Error)?.message });
    return Response.json(
      {
        success: false,
        error: "FAILED",
        message: "Could not read queue depth.",
      },
      { status: 500 },
    );
  }
}
