import assert from "node:assert/strict";
import { describe, it } from "node:test";

import answerKey from "@/config/answer-key.json";
import questions from "@/config/questions.json";
import { PASS_MARK_PERCENT, TOTAL_QUESTIONS } from "@/config/rules";
import { TOTAL_QUESTIONS as KEY_LENGTH, scoreAnswers } from "@/lib/answer-key";

// ─── OBJECTIVE SCORING ────────────────────────────────────────────────────────
// The answer key used to carry a `correct` field per question inside
// config/questions.json, which the exam page - then a client component -
// imported directly. Every correct answer for the section that decides who
// reaches the theory paper was readable in DevTools, so a candidate could score
// 100% without reading a single question.
//
// The key now lives in its own file behind `import "server-only"`, and these
// tests import it the way the server does. They are the regression check for that
// split: if someone merges the two files back together, the paper is open again.

type Key = Record<string, string>;

const key = answerKey as Key;
const ids = Object.keys(key);
const correctFor = (id: string) => ({ [id]: key[id] });

/** An answer sheet of `total` questions with exactly `correct` of them right. */
function sheet(correct: number, total = ids.length): Record<string, string> {
  const answers: Record<string, string> = {};
  ids.slice(0, total).forEach((id, index) => {
    // Alternate through right and wrong answers, so `correct` is exact and the
    // wrong ones are genuinely wrong rather than merely unanswered.
    const right = index < correct;
    const wrong =
      ["A", "B", "C", "D"].find((option) => option !== key[id]) ?? "A";
    answers[id] = right ? key[id] : wrong;
  });
  assert.equal(Object.keys(answers).length, total);
  return answers;
}

describe("the answer key", () => {
  it("covers exactly the questions candidates are shown", () => {
    // lib/answer-key.ts throws at import if this disagrees, so reaching this
    // assertion at all means the counts match. Asserted anyway: the throw protects
    // the count, not the ids.
    assert.equal(KEY_LENGTH, questions.length);
    assert.equal(KEY_LENGTH, TOTAL_QUESTIONS);
    for (const question of questions) {
      assert.ok(key[question.id], `no answer recorded for ${question.id}`);
    }
  });

  it("records one real option per question, and never inside the public file", () => {
    for (const [id, answer] of Object.entries(key)) {
      assert.match(
        answer,
        /^[A-D]$/,
        `${id} has an answer that is not an option`,
      );
    }
    // The public file is shipped to the browser. If a `correct` key reappears in
    // it, the paper is open again no matter what the server does with the key.
    for (const question of questions as Record<string, unknown>[]) {
      assert.equal(
        "correct" in question,
        false,
        `${question.id} exposes its answer`,
      );
    }
  });
});

describe("scoreAnswers", () => {
  it("scores a perfect paper", () => {
    const result = scoreAnswers(sheet(ids.length));
    assert.equal(result.correct, ids.length);
    assert.equal(result.percent, 100);
    assert.equal(result.passed, true);
    assert.equal(result.complete, true);
  });

  it("scores a zero paper as failed, not as a pass by omission", () => {
    // The rule that matters: a wrong answer and a blank answer both score zero,
    // and both are counted in the denominator. An earlier version dropped
    // unanswered questions from the total, so a candidate who answered 2 of 60 and
    // got both right was marked 100% and passed.
    const result = scoreAnswers(sheet(0));
    assert.equal(result.correct, 0);
    assert.equal(result.percent, 0);
    assert.equal(result.passed, false);
  });

  it("counts a blank paper as incomplete", () => {
    const result = scoreAnswers({});
    assert.equal(result.correct, 0);
    assert.equal(result.total, ids.length);
    assert.equal(result.complete, false);
  });

  it("computes completeness on the server, from the answers it was given", () => {
    // `complete` used to be sent by the client as a boolean, which is a request,
    // not a fact. It is now derived here, so a candidate cannot assert that they
    // answered everything.
    const partial = sheet(10, 20);
    const result = scoreAnswers(partial);
    assert.equal(result.complete, false);
    assert.equal(result.total, ids.length);
  });

  it("treats an empty string as unanswered", () => {
    const answers = sheet(ids.length);
    const first = ids[0];
    answers[first] = "";
    const result = scoreAnswers(answers);
    assert.equal(result.correct, ids.length - 1);
    assert.equal(result.complete, false);
  });

  it("ignores answers to questions that do not exist", () => {
    // Otherwise a candidate could pad a sheet with `q9999: <right answer>` to
    // inflate a count computed as "answers received / questions".
    const result = scoreAnswers({ ...sheet(0), q9999: "A", q10000: "B" });
    assert.equal(result.correct, 0);
    assert.equal(result.total, ids.length);
    assert.equal(result.percent, 0);
  });

  it("handles a missing or null answer sheet", () => {
    for (const input of [null, undefined]) {
      const result = scoreAnswers(input);
      assert.equal(result.correct, 0);
      assert.equal(result.percent, 0);
      assert.equal(result.passed, false);
      assert.equal(result.complete, false);
    }
  });

  it("passes on the configured mark, and fails one point below it", () => {
    // Build sheets either side of the threshold. `percent` is rounded, so the
    // boundary is asserted through the score that produced it rather than by
    // arithmetic that assumes no rounding.
    const passMark = Math.ceil((ids.length * PASS_MARK_PERCENT) / 100);
    const at = scoreAnswers(sheet(passMark));
    const below = scoreAnswers(sheet(passMark - 1));

    assert.equal(at.percent >= PASS_MARK_PERCENT, true);
    assert.equal(at.passed, true);
    assert.equal(below.passed, false);
  });

  it("does not accept an answer that differs only in case or padding", () => {
    // Strict equality, on purpose. Case-folding would mean a candidate submitting
    // "a" for all 60 questions matches every "A" answer in the key, which is a
    // way of scoring marks without reading the paper.
    const id = ids[0];
    const expected = key[id];
    const flipped = expected === "A" ? "a" : expected.toLowerCase();

    assert.notEqual(flipped, expected);
    assert.equal(scoreAnswers(correctFor(id)).correct, 1);
    assert.equal(scoreAnswers({ [id]: flipped }).correct, 0);
    assert.equal(scoreAnswers({ [id]: ` ${expected} ` }).correct, 0);
  });

  it("reports a percentage that is a whole number in range", () => {
    for (const correct of [0, 1, 7, Math.floor(ids.length / 2), ids.length]) {
      const { percent } = scoreAnswers(sheet(correct));
      assert.equal(Number.isInteger(percent), true);
      assert.ok(percent >= 0 && percent <= 100, `${percent} out of range`);
    }
  });
});
