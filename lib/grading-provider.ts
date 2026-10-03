import "server-only";

export type GradingProvider = "gemini";

export interface GradingJob {
  id: string;
  prompt: string;
}

export interface GradingOutcome {
  id: string;
  ok: boolean;
  content: string;
  failure?: string;
}

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta";

export function providerName(): GradingProvider {
  return "gemini";
}

export function modelName(): string {
  return process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
}

export function isConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

/**
 * OpenAI's Batch API is what this replaced: upload a JSONL file, poll a job for
 * up to 24 hours, download an output file. Gemini has no equivalent shape, so the
 * batch machinery is gone and grading is a bounded, concurrent, in-request loop.
 * The trade is deliberate — a batch job is cheaper per token but needs somewhere
 * to live between requests, and a Vercel function has nowhere to keep one. Instead
 * the request grades a capped number of candidates concurrently and is resumable:
 * whatever it does not reach is still pending on the next run.
 */
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    authenticity: { type: "INTEGER" },
    passion: { type: "INTEGER" },
    clarity: { type: "INTEGER" },
    finalScore: { type: "INTEGER" },
    aiSuspected: { type: "BOOLEAN" },
    reason: { type: "STRING" },
    confidence: { type: "STRING", enum: ["high", "medium", "low"] },
  },
  required: ["authenticity", "passion", "clarity", "aiSuspected", "reason", "confidence"],
} as const;

export async function gradeWithGemini(
  systemInstruction: string,
  job: GradingJob
): Promise<GradingOutcome> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { id: job.id, ok: false, content: "", failure: "not_configured" };

  try {
    const response = await fetch(
      `${GEMINI_ENDPOINT}/models/${encodeURIComponent(modelName())}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: "user", parts: [{ text: job.prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 400,
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
          },
        }),
      }
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return {
        id: job.id,
        ok: false,
        content: "",
        failure: `http_${response.status}:${detail.slice(0, 160)}`,
      };
    }

    const payload = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      promptFeedback?: { blockReason?: string };
    };

    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return {
        id: job.id,
        ok: false,
        content: "",
        failure: payload.promptFeedback?.blockReason ?? "empty_response",
      };
    }

    return { id: job.id, ok: true, content: text };
  } catch (error) {
    return { id: job.id, ok: false, content: "", failure: (error as Error)?.message ?? "unknown" };
  }
}

/**
 * Bounded concurrency rather than Promise.all. Firing 900 requests at a model at
 * once is how a grading run turns into a rate-limit failure that has already spent
 * half the quota by the time the first 429 comes back.
 */
export async function gradeAll(
  systemInstruction: string,
  jobs: GradingJob[],
  concurrency = Number(process.env.GRADING_CONCURRENCY ?? 6)
): Promise<GradingOutcome[]> {
  const limit = Math.max(1, Math.min(concurrency, 12));
  const results: GradingOutcome[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < jobs.length) {
      const index = cursor;
      cursor += 1;
      const job = jobs[index];
      if (!job) return;
      results.push(await gradeWithGemini(systemInstruction, job));
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, () => worker()));
  return results;
}