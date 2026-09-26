import { NextResponse } from "next/server";
import { Registrant } from "@/lib/models/Registrant";
import OpenAI from "openai";
import { Op } from "sequelize";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { cookies } from "next/headers";

const USAGE_LOG = path.join(process.cwd(), "ai-usage.log");

function logUsage(
  batchId: string,
  candidateCount: number,
  estimatedCost: string,
) {
  const entry = `[${new Date().toISOString()}] Batch ${batchId}: ${candidateCount} candidates, est. ${estimatedCost}\n`;
  fs.appendFileSync(USAGE_LOG, entry);
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL = process.env.AI_GRADING_MODEL || "gpt-4o-mini";

const GRADING_PROMPT = `You are an AI Admissions Expert for TechShift, a tech scholarship program in Nigeria.

Grade the student's motivation responses on three criteria:
1. Authenticity (1-100): Is this genuinely human-written? Watch for AI-generated patterns.
2. Passion (1-100): Does the student show genuine interest in tech?
3. Viability (1-100): Can they realistically complete the program based on their responses?

Also detect if the response appears AI-generated.

Return valid JSON only with this exact structure, no extra text:
{
  "authenticity": number,
  "passion": number,
  "viability": number,
  "final_score": number,
  "is_ai_suspected": boolean,
  "reason": "brief explanation under 50 words",
  "confidence": "high" | "medium" | "low"
}`;

// ─── POST: SUBMIT BATCH JOB ───────────────────────────────────────────────────
export async function POST(request: Request) {
  try {
    // FIX 1: Auth check — prevent anyone from burning your OpenAI credits
    const cookieStore = await cookies();
    const token = cookieStore.get("staff_access")?.value;
    if (!token || token !== process.env.STAFF_ACCESS_TOKEN) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { success: false, error: "OpenAI API key not configured" },
        { status: 500 },
      );
    }

    // Get all ungraded candidates in one go (Batch API handles the load)
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
      attributes: [
        "id",
        "email",
        "theoryAnswer1",
        "theoryAnswer2",
        "theoryAnswer3",
      ],
    });

    if (candidates.length === 0) {
      return NextResponse.json({
        success: true,
        count: 0,
        message: "No candidates pending grading",
      });
    }

    console.log(`🤖 Preparing batch job for ${candidates.length} candidates`);

    // FIX 2: Validate answers before sending to OpenAI — skip empty submissions
    const validCandidates = candidates.filter((student) => {
      const hasValidAnswers = [
        student.theoryAnswer1,
        student.theoryAnswer2,
        student.theoryAnswer3,
      ].some((a) => a && a.trim().length > 50);

      if (!hasValidAnswers) {
        console.log(`⚠️ Skipping ${student.email} — answers too short`);
        // Flag them but don't waste API tokens
        student.update({ theoryScore: 1, isFlagged: true });
      }

      return hasValidAnswers;
    });

    if (validCandidates.length === 0) {
      return NextResponse.json({
        success: true,
        count: 0,
        message: "No candidates with valid answers to grade",
      });
    }

    // ─── BUILD BATCH JSONL FILE ───────────────────────────────────────────
    // Each line is one request. OpenAI Batch API expects a .jsonl file.
    const batchRequests = validCandidates.map((student) => {
      const essayContent = `
        Question 1: Why do you want to study this track?
        Answer: ${student.theoryAnswer1 || "No answer provided"}

        Question 2: What impact will this have on the Nigerian economy?
        Answer: ${student.theoryAnswer2 || "No answer provided"}

        Question 3: Where do you see yourself in 5 years?
        Answer: ${student.theoryAnswer3 || "No answer provided"}
              `.trim();

      return JSON.stringify({
        custom_id: student.id, // We use the DB id to match results back
        method: "POST",
        url: "/v1/chat/completions",
        body: {
          model: MODEL,
          messages: [
            { role: "system", content: GRADING_PROMPT },
            { role: "user", content: essayContent },
          ],
          response_format: { type: "json_object" },
          temperature: 0.3,
          max_tokens: 300,
        },
      });
    });

    // Write to a temp .jsonl file
    const tmpFile = path.join(os.tmpdir(), `batch-${Date.now()}.jsonl`);
    fs.writeFileSync(tmpFile, batchRequests.join("\n"));

    // ─── UPLOAD FILE TO OPENAI ────────────────────────────────────────────
    const uploadedFile = await openai.files.create({
      file: fs.createReadStream(tmpFile),
      purpose: "batch",
    });

    // Clean up temp file
    fs.unlinkSync(tmpFile);

    // ─── CREATE BATCH JOB ─────────────────────────────────────────────────
    const batch = await openai.batches.create({
      input_file_id: uploadedFile.id,
      endpoint: "/v1/chat/completions",
      completion_window: "24h",
      metadata: {
        description: `TechShift 2026 — ${validCandidates.length} candidates`,
      },
    });

    console.log(`✅ Batch job created: ${batch.id}`);

    // FIX 3: Accurate cost estimate including output tokens
    const totalInputTokens = validCandidates.length * 1500;
    const totalOutputTokens = validCandidates.length * 300;
    const inputCost = (totalInputTokens / 1_000_000) * 0.075; // Batch API rate
    const outputCost = (totalOutputTokens / 1_000_000) * 0.3; // Batch API rate
    const totalCost = (inputCost + outputCost).toFixed(4);

    // Log usage for internal tracking
    logUsage(batch.id, validCandidates.length, totalCost);

    return NextResponse.json({
      success: true,
      batch_id: batch.id, // Save this — you need it to collect results
      status: batch.status,
      candidate_count: validCandidates.length,
      skipped_count: candidates.length - validCandidates.length,
      model: MODEL,
      cost_estimate: `~$${totalCost}`,
      message: `Batch job submitted. Call GET /api/ai-audit?batch_id=${batch.id} to check status and collect results.`,
    });
  } catch (error: any) {
    console.error("AI Audit batch submission error:", error);
    // FIX 4: Never expose error.message to client
    return NextResponse.json(
      {
        success: false,
        error: "Failed to submit batch job. Check server logs.",
      },
      { status: 500 },
    );
  }
}

// ─── GET: CHECK STATUS & COLLECT RESULTS ─────────────────────────────────────
export async function GET(request: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("staff_access")?.value;
    if (!token || token !== process.env.STAFF_ACCESS_TOKEN) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get("batch_id");

    // ─── IF batch_id provided: check status and collect results ───────────
    if (batchId) {
      const batch = await openai.batches.retrieve(batchId);

      if (batch.status !== "completed") {
        return NextResponse.json({
          success: true,
          batch_id: batchId,
          status: batch.status, // "validating" | "in_progress" | "completed" | "failed"
          request_counts: batch.request_counts,
          message: "Batch still processing. Check back later.",
        });
      }

      // Batch is complete — download results
      if (!batch.output_file_id) {
        return NextResponse.json({
          success: false,
          error: "Batch completed but no output file found",
        });
      }

      const fileContent = await openai.files.content(batch.output_file_id);
      const rawText = await fileContent.text();
      const lines = rawText.trim().split("\n").filter(Boolean);

      let successCount = 0;
      let failCount = 0;
      const errors: string[] = [];

      for (const line of lines) {
        try {
          const result = JSON.parse(line);
          const studentId = result.custom_id;
          const choice = result.response?.body?.choices?.[0];

          if (!choice || result.response?.status_code !== 200) {
            failCount++;
            errors.push(`Student ${studentId}: API error`);
            continue;
          }

          const content = choice.message?.content;
          if (!content) {
            failCount++;
            continue;
          }

          const aiData = JSON.parse(content);

          // FIX 5: Use AI's final_score directly instead of recalculating
          // If AI didn't return a valid final_score, calculate as fallback
          const finalScore =
            typeof aiData.final_score === "number" && aiData.final_score > 0
              ? Math.round(aiData.final_score)
              : Math.round(
                  (aiData.authenticity + aiData.passion + aiData.viability) / 3,
                );

          await Registrant.update(
            {
              theoryScore: finalScore,
              isFlagged: aiData.is_ai_suspected || false,
            },
            { where: { id: studentId } },
          );

          console.log(
            `✅ Graded student ${studentId}: Score ${finalScore}${aiData.is_ai_suspected ? " ⚠️ AI SUSPECTED" : ""}`,
          );
          successCount++;
        } catch (parseError) {
          failCount++;
          errors.push(`Parse error on line`);
        }
      }

      return NextResponse.json({
        success: true,
        batch_id: batchId,
        status: "completed",
        graded: successCount,
        failed: failCount,
        errors: errors.length > 0 ? errors : undefined,
      });
    }

    // ─── NO batch_id: return pending/graded stats ─────────────────────────
    const pending = await Registrant.count({
      where: { status: "completed", theoryScore: 0 },
    });

    const graded = await Registrant.count({
      where: { theoryScore: { [Op.gt]: 0 } },
    });

    const totalInputTokens = pending * 1500;
    const totalOutputTokens = pending * 300;
    const inputCost = (totalInputTokens / 1_000_000) * 0.075;
    const outputCost = (totalOutputTokens / 1_000_000) * 0.3;

    return NextResponse.json({
      success: true,
      stats: {
        pending,
        graded,
        total: pending + graded,
        estimated_cost: `~$${(inputCost + outputCost).toFixed(4)}`,
      },
    });
  } catch (error: any) {
    console.error("AI Audit GET error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch stats" },
      { status: 500 },
    );
  }
}
