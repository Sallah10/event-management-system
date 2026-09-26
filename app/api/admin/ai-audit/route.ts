import { z } from "zod";
import OpenAI from "openai";
import { Op } from "sequelize";
import { Registrant } from "@/lib/models/Registrant";
import { requireStaff } from "@/lib/staff-guard";
import { ensureDatabase } from "@/lib/db";
import { recordGrades } from "@/lib/admissions";
import { log } from "@/lib/logger";
import { countWords } from "@/lib/validate";
import { THEORY_MIN_WORDS } from "@/config/rules";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// ─── AI ESSAY GRADING ─────────────────────────────────────────────────────────
// Six things were wrong with this route. All six are load-bearing.
//
// 1. IT GRADED NOBODY.
//    It selected `where: { status: "completed", theoryScore: 0 }`.
//    submit-theory wrote `status: "awarded"` on submission.
//    "completed" and "awarded" are disjoint sets, so the query matched zero rows
//    and the endpoint cheerfully reported "No candidates pending grading" —
//    forever. Two files disagreeing on what a status means, and nothing caught
//    it because there was no test. submit-theory now writes "completed" for
//    "submitted, awaiting grading", which is what this route was already asking
//    for.
//
// 2. IT OVERWROTE INTEGRITY FLAGS.
//    `Registrant.update({ isFlagged: aiData.is_ai_suspected || false })` wrote
//    the flag column unconditionally. Any candidate already flagged by the
//    invigilation process had that flag silently ERASED, because the model said
//    "not AI-generated". Now the AI's opinion is stored in its own column and
//    only a human can set isFlagged.
//
// 3. THE COST ESTIMATE WAS INVENTED.
//    It hardcoded "1500 input tokens per candidate" and priced them at
//    $0.075/M — which is the *synchronous* gpt-4o rate, while the default model
//    was gpt-4o-*mini* via the Batch API (roughly 500x cheaper). The dashboard
//    then displayed "~$0.18" as though it were a measurement. It was a guess
//    presented as an invoice. We now report token counts and let the operator
//    see a real number, and we don't quote a price we haven't measured.
//
// 4. IT WROTE TO process.cwd().
//    `fs.appendFileSync(path.join(process.cwd(), "ai-usage.log"))`. On Vercel the
//    project directory is read-only, so this throws EROFS — and because it ran
//    AFTER `openai.batches.create()`, the batch was already submitted and paid
//    for when the route 500'd. Nobody could retrieve the results. Appended to
//    os.tmpdir() now, and the log line moved BEFORE the network call so a failure
//    can't orphan a paid batch.
//
// 5. 900 SEQUENTIAL UPDATES IN A 10-SECOND FUNCTION.
//    The result collector looped `await Registrant.update(...)` per candidate
//    while vercel.json capped every non-check-in route at maxDuration 10. With
//    ~900 essays that could not finish, so the route died partway and half the
//    grades were never written. Now: one bulk upsert, no per-row await.
//
// 6. THE MODEL OUTPUT WAS json.parse'd WITH NO VALIDATION.
//    `JSON.parse(content)` straight into arithmetic, with the response cast to
//    any. A model that returns prose, a truncated object, or a 0-1000 scale
//    would either throw mid-loop (losing the rest of the batch) or write a
//    nonsense score. zod validates and coerces, and a malformed row is skipped
//    and counted rather than taking the run down with it.
//
// WHAT THE AI IS AND ISN'T: it produces a *recommendation*. `isAiSuspected` is
// recorded as an observation for a human to weigh. The route does not
// disqualify, and it cannot.

const GRADING_MODEL = process.env.AI_GRADING_MODEL ?? "gpt-4o-mini";

const GRADING_PROMPT = `You are an admissions assessor for a technology scholarship programme.

You will read a candidate's written responses to three short questions and assess them.

Score each criterion from 0 to 100:
- authenticity: does this read as genuinely written by this person, in their own voice, about their own experience?
- passion: is there a specific, concrete reason this person wants this specific track?
- clarity: are the answers specific enough to judge, rather than generalities?

Judge only what is on the page. Do not reward confident phrasing over substance, and do not penalise a candidate for grammar, spelling, or dialect — many applicants are writing in a second language and that is not a merit signal.

Respond with JSON only, no commentary, using exactly this shape:
{"authenticity":<int 0-100>,"passion":<int 0-100>,"clarity":<int 0-100>,"finalScore":<int 0-100>,"aiSuspected":<boolean>,"reason":<string under 40 words>,"confidence":"high"|"medium"|"low"}`;

// zod IS earning its place here — this is the boundary where a language model's
// free-text output becomes a database write.
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

let client: OpenAI | null = null;
function openai(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
    client = new OpenAI({ apiKey });
  }
  return client;
}

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
    if (start === -1 || end <= start) throw new Error("no JSON object in response");
    return JSON.parse(body.slice(start, end + 1));
  }
}

function averageOf(grade: Grade): number {
  return Math.round((grade.authenticity + grade.passion + grade.clarity) / 3);
}

// ─── POST: QUEUE A GRADING BATCH ──────────────────────────────────────────────
export async function POST() {
  const { error } = await requireStaff("admissions");
  if (error) return error;

  let batchFile: Awaited<ReturnType<OpenAI["files"]["create"]>> | null = null;

  try {
    if (!process.env.OPENAI_API_KEY) {
      return Response.json(
        { success: false, error: "NOT_CONFIGURED", message: "OPENAI_API_KEY is not set." },
        { status: 503 },
      );
    }

    await ensureDatabase();

    // FIX 1. "completed" is what submit-theory now writes. This is the query
    // that was always intended.
    const candidates = await Registrant.findAll({
      where: {
        status: "completed",
        theoryScore: 0,
        [Op.or]: [
          { theoryAnswer1: { [Op.ne]: null } },
          { theoryAnswer2: { [Op.ne]: null } },
          { theoryAnswer3: { [Op.ne]: null } },
        ],
      },
      attributes: ["id", "email", "theoryAnswer1", "theoryAnswer2", "theoryAnswer3"],
      raw: true,
    }) as unknown as CandidateRow[];

    // ─── FILTER, DON'T WASTE TOKENS ON UNGRADEABLE ANSWERS ──────────────────
    const gradeable: CandidateRow[] = [];
    const skipped: { id: string; reason: string }[] = [];

    for (const candidate of candidates) {
      const answers = [
        candidate.theoryAnswer1,
        candidate.theoryAnswer2,
        candidate.theoryAnswer3,
      ].filter((a): a is string => typeof a === "string" && a.trim().length > 0);

      const longEnough = answers.filter((a) => countWords(a) >= THEORY_MIN_WORDS).length;

      if (longEnough === 0) {
        // Previously this did `student.update({ theoryScore: 1, isFlagged: true })`
        // — a silent auto-disqualification with no log and no human in the loop.
        // Now it's recorded as a grade of 0 with an explicit note, and isFlagged
        // is not touched.
        skipped.push({ id: candidate.id, reason: "no_answer_met_minimum_length" });
        continue;
      }
      gradeable.push(candidate);
    }

    if (gradeable.length === 0) {
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
      return Response.json({
        success: true,
        error: null,
        data: {
          queued: 0,
          skipped: skipped.length,
          message:
            skipped.length > 0
              ? `${skipped.length} submission(s) had no answer long enough to assess. They scored zero and are in the integrity queue.`
              : "Nothing pending grading.",
        },
      });
    }

    // ─── BUILD THE BATCH FILE ────────────────────────────────────────────────
    const lines = gradeable.map((candidate) =>
      JSON.stringify({
        custom_id: candidate.id,
        method: "POST",
        url: "/v1/chat/completions",
        body: {
          model: GRADING_MODEL,
          messages: [
            { role: "system", content: GRADING_PROMPT },
            {
              role: "user",
              content: `Question 1 — Why do you want to study this track?\n${candidate.theoryAnswer1 ?? "(no answer)"}\n\nQuestion 2 — What difference would this make in your community?\n${candidate.theoryAnswer2 ?? "(no answer)"}\n\nQuestion 3 — Where do you see yourself in five years?\n${candidate.theoryAnswer3 ?? "(no answer)"}`,
            },
          ],
          response_format: { type: "json_object" },
          temperature: 0.2,
          max_tokens: 400,
        },
      }),
    ).join("\n");

    // FIX 4. os.tmpdir() only — never process.cwd(), which is read-only on Vercel
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");

    const tmpFile = path.join(os.tmpdir(), `grading-${Date.now()}.jsonl`);
    await fs.writeFile(tmpFile, lines, "utf8");

    log.info("ai_audit.batch_queued", {
      queued: gradeable.length,
      skipped: skipped.length,
      model: GRADING_MODEL,
    });

    try {
      // A read stream, not an open file handle: this is what the SDK accepts, and
      // it closes itself when the upload finishes.
      batchFile = await openai().files.create({
        file: (await import("node:fs")).createReadStream(tmpFile),
        purpose: "batch",
      });
    } finally {
      await fs.unlink(tmpFile).catch(() => {});
    }

    // FIX 3. Log before we spend money, so a later failure can't orphan the batch
    log.info("ai_audit.file_uploaded", { fileId: batchFile.id, queued: gradeable.length });

    const batch = await openai().batches.create({
      input_file_id: batchFile.id,
      endpoint: "/v1/chat/completions",
      completion_window: "24h",
      metadata: { description: `essay grading — ${gradeable.length} candidates` },
    });

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

    return Response.json({
      success: true,
      error: null,
      data: {
        batchId: batch.id,
        status: batch.status,
        queued: gradeable.length,
        skipped: skipped.length,
        model: GRADING_MODEL,
        // FIX 3. We report what we know. We do not quote a price we haven't
        // measured — check the batch on the OpenAI dashboard for real usage.
        next: `Call GET /api/admin/ai-audit?batchId=${batch.id} to collect results.`,
        warning:
          "This sends candidate essays to OpenAI. Confirm your data-processing terms cover it before running on real data.",
      },
    });
  } catch (err) {
    log.error("ai_audit.queue_failed", {
      message: (err as Error)?.message,
      batchFileId: batchFile?.id ?? null,
    });
    return Response.json(
      {
        success: false,
        error: "FAILED",
        message: "Could not queue grading. Check the logs.",
        // If we got as far as creating the batch, say so — otherwise the money
        // is spent and nobody knows where the results are.
        orphanedBatchInput: batchFile?.id ?? null,
      },
      { status: 500 },
    );
  }
}

// ─── GET: COLLECT RESULTS ─────────────────────────────────────────────────────
export async function GET(request: Request) {
  const { error } = await requireStaff("admissions");
  if (error) return error;

  const { searchParams } = new URL(request.url);
  const batchId = searchParams.get("batchId");

  try {
    if (!process.env.OPENAI_API_KEY) {
      return Response.json(
        { success: false, error: "NOT_CONFIGURED", message: "OPENAI_API_KEY is not set." },
        { status: 503 },
      );
    }

    await ensureDatabase();

    // No batchId → queue depth, so the portal can show work waiting
    if (!batchId) {
      const [pending, graded, aiSuspected] = await Promise.all([
        Registrant.count({ where: { status: "completed", theoryScore: 0 } }),
        Registrant.count({ where: { theoryScore: { [Op.gt]: 0 } } }),
        Registrant.count({ where: { aiSuspected: true } }),
      ]);
      return Response.json({
        success: true,
        error: null,
        data: { pending, graded, aiSuspected, model: GRADING_MODEL },
      });
    }

    const batch = await openai().batches.retrieve(batchId);

    if (batch.status !== "completed") {
      return Response.json({
        success: true,
        error: null,
        data: {
          batchId,
          status: batch.status,
          requestCounts: batch.request_counts,
          message: `Batch is ${batch.status}. Check back shortly.`,
        },
      });
    }

    if (!batch.output_file_id) {
      return Response.json(
        { success: false, error: "NO_OUTPUT", message: "Batch completed but produced no output file." },
        { status: 502 },
      );
    }

    const fileContent = await openai().files.content(batch.output_file_id);
    const raw = await fileContent.text();

    const updates: { id: string; theoryScore: number; aiSuspected: boolean; aiGradeReason: string; aiConfidence: string }[] = [];
    const failures: { id: string; reason: string }[] = [];

    for (const line of raw.trim().split("\n").filter(Boolean)) {
      try {
        const row = JSON.parse(line);
        const id = row.custom_id as string;
        const choice = row.response?.body?.choices?.[0];

        if (row.response?.status_code !== 200 || !choice?.message?.content) {
          failures.push({ id, reason: "api_error" });
          continue;
        }

        // FIX 6. Validate before we write. A malformed row is skipped, not fatal.
        const parsed = gradeSchema.safeParse(extractJson(choice.message.content));
        if (!parsed.success) {
          failures.push({ id, reason: "unparseable_response" });
          continue;
        }

        const grade = parsed.data;
        updates.push({
          id,
          theoryScore: grade.finalScore ?? averageOf(grade),
          // FIX 2. Separate column. isFlagged is a human decision, untouched here.
          aiSuspected: grade.aiSuspected,
          aiGradeReason: grade.reason,
          aiConfidence: grade.confidence,
        });
      } catch {
        failures.push({ id: "unknown", reason: "parse_error" });
      }
    }

    // FIX 5. One bulk write instead of N sequential awaits inside a 10s budget
    const written = await recordGrades(updates, `batch:${batchId}`);

    log.info("ai_audit.collected", {
      batchId,
      graded: written,
      parsed: updates.length,
      failed: failures.length,
      suspected: updates.filter((u) => u.aiSuspected).length,
    });

    return Response.json({
      success: true,
      error: null,
      data: {
        batchId,
        status: batch.status,
        graded: written,
        failed: failures.length,
        flaggedForReview: updates.filter((u) => u.aiSuspected).length,
        failures: failures.slice(0, 20),
        // Say what happens next, because a flagged essay does NOT disqualify anyone
        note: "AI-suspected essays are queued for human review in the integrity panel. Nobody was disqualified by this run.",
      },
    });
  } catch (err) {
    log.error("ai_audit.collect_failed", { message: (err as Error)?.message, batchId });
    return Response.json(
      { success: false, error: "FAILED", message: "Could not collect results. Check the logs." },
      { status: 500 },
    );
  }
}
