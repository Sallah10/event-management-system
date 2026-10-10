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

/**
 * OpenAI's Batch API is what this replaced: upload a JSONL file, poll a job for
 * up to 24 hours, download an output file. Gemini has no equivalent shape, so the
 * batch machinery is gone and grading is a bounded, concurrent, in-request loop.
 * The trade is deliberate - a batch job is cheaper per token but needs somewhere
 * to live between requests, and a serverless function has nowhere to keep one.
 * Instead a request grades a capped number of candidates concurrently and is
 * resumable: whatever it does not reach is still pending on the next run.
 */

export function providerName(): GradingProvider {
  return "gemini";
}

export function modelName(): string {
  return process.env.GEMINI_MODEL ?? "gemini-3.8-flash";
}

export function isConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

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
  required: [
    "authenticity",
    "passion",
    "clarity",
    "aiSuspected",
    "reason",
    "confidence",
  ],
} as const;

const TRANSIENT = new Set([408, 429, 500, 502, 503, 504]);
const ATTEMPTS = 3;
const BACKOFF_MS = [600, 1800];

async function callGemini(
  key: string,
  systemInstruction: string,
  job: GradingJob,
): Promise<Response> {
  const request = () =>
    fetch(
      `${GEMINI_ENDPOINT}/models/${encodeURIComponent(modelName())}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: "user", parts: [{ text: job.prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 1024,
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
            // Gemini 3.x flash models think by default, and that thinking is drawn
            // from the output budget. Left on, a 400-token cap was consumed before
            // the JSON started and every grade came back truncated to a fragment.
            // Scoring a short essay is not a reasoning task, so the thinking buys
            // nothing here and costs tokens on every candidate.
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      },
    );

  let response = await request();
  // The free tier serves "high demand" 503s often enough to matter: measured
  // around half of calls during testing. Retrying with a short pause turns that
  // into a brief wait rather than a lost candidate, and whatever is still failing
  // after the last attempt is recorded against that candidate and picked up by
  // the next run.
  for (
    let attempt = 0;
    attempt < ATTEMPTS - 1 && TRANSIENT.has(response.status);
    attempt++
  ) {
    await new Promise((resolve) =>
      setTimeout(resolve, BACKOFF_MS[attempt] ?? 2400),
    );
    const retried = await request();
    if (!TRANSIENT.has(retried.status) || retried.ok) return retried;
    response = retried;
  }
  return response;
}

export async function gradeWithGemini(
  systemInstruction: string,
  job: GradingJob,
): Promise<GradingOutcome> {
  const key = process.env.GEMINI_API_KEY;
  if (!key)
    return { id: job.id, ok: false, content: "", failure: "not_configured" };

  try {
    const response = await callGemini(key, systemInstruction, job);

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
    return {
      id: job.id,
      ok: false,
      content: "",
      failure: (error as Error)?.message ?? "unknown",
    };
  }
}

/**
 * Bounded concurrency rather than Promise.all. Firing every candidate at a model
 * at once is how a grading run turns into a rate-limit failure that has already
 * spent half the quota by the time the first 429 comes back.
 */
export async function gradeAll(
  systemInstruction: string,
  jobs: GradingJob[],
  concurrency = Number(process.env.GRADING_CONCURRENCY ?? 6),
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

  await Promise.all(
    Array.from({ length: Math.min(limit, jobs.length) }, () => worker()),
  );
  return results;
}
