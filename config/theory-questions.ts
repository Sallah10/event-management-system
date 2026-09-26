// ─── THEORY PAPER QUESTIONS ───────────────────────────────────────────────────
// The three essay prompts, in one place.
//
// WHY THIS IS A SEPARATE FILE
// The prompts used to live inside components/exam/TheoryClient.tsx as a local
// const. That is fine until somebody else needs to know what a candidate was
// actually asked — which is precisely the situation the admissions review panel
// is in. A reviewer looking at "Question 2" needs the text of question 2, and the
// only copy was inside a `"use client"` component, so the only ways to get it were
// to paste it a second time into the review UI or to duplicate the component.
//
// A second copy of a question list is not a small duplication. The paper asks one
// thing and the reviewer reads another, and nothing anywhere complains, because
// both files typecheck. Grading against the wrong prompt is untraceable after the
// fact: the candidate answered correctly and the panel marked them down for it.
//
// `column` is the database field the answer lands in. It lives here too, because
// the mapping from prompt to storage is the part that must not drift.
import { countWords } from "@/lib/validate";

export interface TheoryQuestion {
  /** Matches the keys of TheoryAnswers in TheoryClient. */
  id: "q1" | "q2" | "q3";
  /** Registrant column this answer is stored in. */
  column: "theoryAnswer1" | "theoryAnswer2" | "theoryAnswer3";
  label: string;
  hint: string;
}

export const THEORY_QUESTIONS: readonly TheoryQuestion[] = [
  {
    id: "q1",
    column: "theoryAnswer1",
    label: "Why do you want to study this track?",
    hint: "What specifically in this field holds your attention?",
  },
  {
    id: "q2",
    column: "theoryAnswer2",
    label: "What impact do you expect this training to have in your industry?",
    hint: "Think about the work, not the certificate.",
  },
  {
    id: "q3",
    column: "theoryAnswer3",
    label: "Where do you see yourself five years from now?",
    hint: "Be specific about the kind of work and the kind of employer.",
  },
];

/**
  * Word count, server-side, for the review panel.
   *
   * The submission route already enforces a minimum word count, so anything below it
   * never reaches a grader. This exists so the reviewer can see at a glance which
   * answers were written to the minimum and which were not — a two-word essay that
   * passed because it was over the line and a 600-word one do not deserve the same
   * read, and a panel grading at speed will not spot the difference from a wall of
   * text alone.
   *
   * It delegates to `countWords` rather than counting here, because it used to be a
   * second implementation: `split(/\s+/).length`, against the route's
   * `filter(Boolean).length`. The two disagreed on leading whitespace, so a marker
   * could be shown a count one higher than the gate that produced it. One
   * definition of a word, imported from the one place that defines it.
   */
export function essayWordCount(text: string | null | undefined): number {
  return countWords(text ?? "");
}
