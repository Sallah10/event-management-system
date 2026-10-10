import "dotenv/config";

const key = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL ?? "gemini-3.8-flash";

if (!key) {
  console.log("GEMINI_API_KEY is not set. Grading will refuse every request.");
  process.exit(0);
}

const responseSchema = {
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
};

console.log(`model: ${model}`);

const TRANSIENT = new Set([408, 429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function post() {
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            { text: "You are an admissions assessor. Respond with JSON only." },
          ],
        },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: 'Assess this answer and return the graded object: "I want to study frontend development because my cousin taught me HTML and I built a small site for our community centre."',
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1024,
          responseMimeType: "application/json",
          responseSchema,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    },
  );
}

let attempts = 0;
let result = await post();
attempts += 1;
while (!result.ok && TRANSIENT.has(result.status) && attempts < 3) {
  await sleep([600, 1800][attempts - 1] ?? 2400);
  result = await post();
  attempts += 1;
}

console.log(
  `HTTP ${result.status} after ${attempts} attempt${attempts > 1 ? "s" : ""}`,
);

if (!result.ok) {
  console.log((await result.text()).slice(0, 500));
  process.exit(1);
}

const payload = await result.json();
const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
console.log(`response: ${text ?? "(none)"}`);

if (!text) {
  console.log(
    `blocked or empty: ${payload?.promptFeedback?.blockReason ?? "unknown"}`,
  );
  process.exit(1);
}

const parsed = extractJson(text);
const required = [
  "authenticity",
  "passion",
  "clarity",
  "aiSuspected",
  "reason",
  "confidence",
];
const missing = required.filter((field) => !(field in parsed));
const wasFenced = text.trim().startsWith("{") === false;

console.log(
  `keys: ${Object.keys(parsed).length}, missing: ${missing.length ? missing.join(", ") : "none"}`,
);
console.log(
  `raw response was plain JSON: ${wasFenced === false ? "yes" : "no - wrapped in prose"}`,
);
console.log(
  missing.length
    ? "Structured output is not being honoured."
    : "Recovered, and all required fields are present.",
);

function extractJson(content) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : content).trim();
  try {
    return JSON.parse(body);
  } catch {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start === -1 || end <= start)
      throw new Error("no JSON object in response");
    return JSON.parse(body.slice(start, end + 1));
  }
}
