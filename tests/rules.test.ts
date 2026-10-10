import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { COURSES } from "@/config/course-matrix";
import {
  AWARDED_STATUSES,
  LIMIT_PER_COURSE,
  PASS_MARK_PERCENT,
  PIPELINE,
  RELEASABLE_STATUSES,
  SEAT_HOLDING_STATUSES,
  TERMINAL_STATUSES,
  TOTAL_QUESTIONS,
  TOTAL_SLOTS,
  isValidCourseSlug,
} from "@/config/rules";
import { TRANSITIONS } from "@/lib/admissions";

// ─── THE RULES OF THE ROUND ───────────────────────────────────────────────────
// config/rules.ts is the one file that says what a seat is, how long a paper runs
// and which status means what. Everything else reads it. That only holds if the
// numbers are consistent with each other, and nothing was checking: the seat cap
// is `TOTAL_SLOTS / COURSES.length`, so a course added without a matching slot
// silently changes what every candidate is competing for.
//
// These are cheap assertions about a file that decides who gets a scholarship.

const keys = PIPELINE.map((stage) => stage.key);

describe("the pipeline", () => {
  it("names every status the code uses, once each", () => {
    assert.equal(new Set(keys).size, keys.length, "a status is listed twice");

    // The queue endpoint whitelists filters against its own copy of this list.
    // If the two drift, a tab shows nothing and looks like an empty queue.
    for (const status of [
      "registered",
      "attended",
      "qualified",
      "completed",
      "waitlisted",
      "eliminated",
      "shortlisted",
      "awarded",
    ]) {
      assert.ok(
        keys.includes(status as (typeof keys)[number]),
        `${status} is not in PIPELINE`,
      );
    }
  });

  it("gives every status a label and a description", () => {
    for (const stage of PIPELINE) {
      assert.ok(stage.label.length > 0, `${stage.key} has no label`);
      assert.ok(stage.blurb.length > 0, `${stage.key} has no blurb`);
    }
  });

  it("puts the happy path in order, with the two outs at the end", () => {
    // waitlisted and eliminated are outcomes rather than stages, so they are
    // listed last and no transition may lead *into* them except `release`.
    const path = keys.filter(
      (key) => !["waitlisted", "eliminated"].includes(key),
    );
    assert.deepEqual(path, [
      "registered",
      "attended",
      "qualified",
      "completed",
      "shortlisted",
      "awarded",
    ]);
  });
});

describe("seat accounting", () => {
  it("divides the seats between the courses without inventing any", () => {
    // Rounding down is the safe direction: the cap must never promise more seats
    // than exist.
    assert.equal(LIMIT_PER_COURSE, Math.floor(TOTAL_SLOTS / COURSES.length));
    assert.ok(LIMIT_PER_COURSE >= 1, "a course with no seats at all");
    assert.ok(LIMIT_PER_COURSE * COURSES.length <= TOTAL_SLOTS);
  });

  it("agrees with itself about who holds a seat", () => {
    // These two lists were separate declarations of the same idea.
    assert.deepEqual([...AWARDED_STATUSES], [...SEAT_HOLDING_STATUSES]);
  });

  it("treats the two outs as terminal", () => {
    for (const status of TERMINAL_STATUSES) {
      assert.ok(
        keys.includes(status),
        `${status} is terminal but not a pipeline status`,
      );
    }
    for (const status of ["waitlisted", "eliminated"]) {
      assert.ok(
        (TERMINAL_STATUSES as readonly string[]).includes(status),
        `${status} is one of the outcomes and should be terminal`,
      );
    }
  });
});

describe("the pass mark", () => {
  it("is a real percentage of a real paper", () => {
    assert.ok(PASS_MARK_PERCENT > 0, "nobody passes at zero");
    assert.ok(
      PASS_MARK_PERCENT <= 100,
      "every paper passes, including a blank one",
    );
    assert.ok(TOTAL_QUESTIONS > 0);
  });

  it("does not make the paper unwinnable at the top end", () => {
    // Guards a fat-fingered 1000 or a stray decimal that quietly fails everyone.
    assert.equal(Number.isInteger(PASS_MARK_PERCENT), true);
  });
});

describe("isValidCourseSlug", () => {
  it("accepts every course on offer", () => {
    for (const course of COURSES) {
      assert.equal(isValidCourseSlug(course.slug), true);
    }
  });

  it("rejects anything that is not exactly one of them", () => {
    // This is the check in front of a course column that ends up in an LMS
    // export, so it is a whitelist and nothing else.
    for (const value of [
      "",
      "aws",
      "AWS-CERTIFIED-CLOUD-PRACTITIONER-13",
      "aws-certified-cloud-practitioner-13 ",
      "aws-certified-cloud-practitioner-13; DROP TABLE registrants",
      "../../etc/passwd",
      null,
      undefined,
      42,
      {},
      ["aws-certified-cloud-practitioner-13"],
    ]) {
      assert.equal(
        isValidCourseSlug(value),
        false,
        `${String(value)} should be rejected`,
      );
    }
  });
});

describe("the decision table", () => {
  it("only names statuses the pipeline knows", () => {
    // A typo in a `from` list silently disables the action it belongs to: the
    // status never matches, so the button always fails.
    for (const [action, rule] of Object.entries(TRANSITIONS)) {
      for (const status of rule.from) {
        assert.ok(
          keys.includes(status as (typeof keys)[number]),
          `${action} allows unknown "${status}"`,
        );
      }
    }
  });

  it("reaches a seat only from a graded paper", () => {
    // shortlist and award are the only actions that create a seat, and neither
    // may start from a status where no essay exists - the original bug was
    // `registered` being shortlistable, so a candidate who never sat the theory
    // paper was offered a place with theoryScore 0 as the only evidence.
    assert.deepEqual([...TRANSITIONS.shortlist.from], ["completed"]);
    for (const from of TRANSITIONS.award.from) {
      assert.ok(
        ["completed", "shortlisted"].includes(from),
        `award from "${from}" would seat an ungraded candidate`,
      );
    }
  });

  it("never awards a candidate who is already decided", () => {
    assert.equal(TRANSITIONS.award.from.includes("awarded"), false);
    assert.equal(TRANSITIONS.shortlist.from.includes("awarded"), false);
  });

  it("lets flag and unflag apply to the same people", () => {
    // A flag you cannot lift is a punishment, not a review. They were added
    // together for that reason, and they must stay in step.
    assert.deepEqual([...TRANSITIONS.flag.from], [...TRANSITIONS.unflag.from]);
    assert.equal(TRANSITIONS.unflag.role, TRANSITIONS.flag.role);
  });

  it("reserves every seat-creating and integrity action to admissions", () => {
    // Check-in staff run the door. They have no business shortlisting, awarding,
    // or deciding whether somebody cheated.
    for (const action of [
      "shortlist",
      "award",
      "release",
      "flag",
      "unflag",
      "allocate",
    ]) {
      assert.equal(
        TRANSITIONS[action].role,
        "admissions",
        `${action} is not admissions-only`,
      );
    }
  });

  it("only offers release targets that are real statuses", () => {
    for (const status of RELEASABLE_STATUSES) {
      assert.ok(
        keys.includes(status),
        `release offers "${status}", which is not a status`,
      );
    }
  });

  it("does not let release create a seat", () => {
    // `release` stands somebody down. If shortlisted or awarded were allowed as
    // targets it would be a second, unchecked way to hand out scholarships.
    for (const status of RELEASABLE_STATUSES) {
      assert.equal(
        (AWARDED_STATUSES as readonly string[]).includes(status),
        false,
        `release could award a seat via "${status}"`,
      );
    }
  });

  it("can move an allocation only on a candidate who has one", () => {
    for (const from of TRANSITIONS.allocate.from) {
      assert.notEqual(from, "registered");
      assert.notEqual(from, "qualified");
    }
  });
});
