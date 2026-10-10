import "server-only";

import answerKey from "@/config/answer-key.json";
import {
  PASS_MARK_PERCENT,
  TOTAL_QUESTIONS as PUBLIC_TOTAL,
} from "@/config/rules";

// ─── SCORING (SERVER ONLY) ────────────────────────────────────────────────────
// `import "server-only"` is the important line. The Next.js build replaces that
// module with a stub that THROWS the moment a client component imports it, so the
// answer key physically cannot reach the browser bundle again.
//
// The original bug: config/questions.json carried a `correct` field per question
// and app/assessment/exam/page.tsx was "use client" and imported it directly.
// Every correct answer for all 60 questions shipped in the JS bundle - a
// candidate only had to open DevTools and score 100% on the objective section,
// which is the exact section that decides whether they reach the theory paper.
//
// config/questions.json  → public:  id, question, options   (safe to ship)
// config/answer-key.json  → private: id → correct answer     (server only)

export { PASS_MARK_PERCENT };

export const TOTAL_QUESTIONS = Object.keys(answerKey).length;

// If the two files ever disagree on how many questions there are, the paper is
// broken in a way nobody would notice: candidates would be marked against a
// different number of questions than the one they were shown. This is a
// programmer error, not a runtime condition, so it throws at import.
if (TOTAL_QUESTIONS !== PUBLIC_TOTAL) {
  throw new Error(
    `config/answer-key.json has ${TOTAL_QUESTIONS} entries but config/questions.json has ${PUBLIC_TOTAL}. ` +
      "They must cover exactly the same question ids.",
  );
}

export interface ScoreResult {
  correct: number;
  total: number;
  percent: number;
  passed: boolean;
  /** False when the client didn't answer every question - counted, not trusted. */
  complete: boolean;
}

export function scoreAnswers(
  answers: Record<string, string> | null | undefined,
): ScoreResult {
  const key = answerKey as Record<string, string>;
  const submitted = answers ?? {};

  let correct = 0;
  let answered = 0;

  for (const [questionId, expected] of Object.entries(key)) {
    const given = submitted[questionId];
    if (typeof given === "string" && given.length > 0) answered += 1;
    if (given === expected) correct += 1;
  }

  const total = Object.keys(key).length;
  const percent = total === 0 ? 0 : Math.round((correct / total) * 100);

  return {
    correct,
    total,
    percent,
    passed: percent >= PASS_MARK_PERCENT,
    complete: answered === total,
  };
}
