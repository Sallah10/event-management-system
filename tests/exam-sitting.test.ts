import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { OBJECTIVE_TTL_MINUTES, THEORY_TTL_MINUTES } from "@/config/rules";
import { computeDeadline, isLate, sittingStartedAtMs, sittingTtlMs } from "@/lib/exam-sitting";
import type { Registrant } from "@/lib/models/Registrant";

// ─── SITTING CLOCKS ───────────────────────────────────────────────────────────
// Both papers used to open with `useState(1800)` and `useState(3600)`. The
// countdown began when React mounted, not when the candidate started working, so
// every refresh, crash, sleep or second device handed back a full sitting — and
// because the client held the only clock, `POST /submit` accepted a paper at any
// hour of any day.
//
// The clock is now a database column. What is worth testing here is the
// arithmetic, because it is one comparison operator away from being wrong and
// nothing else in the system would notice.

/** The smallest thing `isLate` and `sittingStartedAtMs` need: a `.get()`. */
function candidate(values: Partial<Record<string, Date | null>>): Registrant {
  return { get: (field: string) => values[field] ?? null } as unknown as Registrant;
}

const START = new Date("2026-04-18T09:00:00.000Z");

describe("sittingTtlMs", () => {
  it("converts the configured minutes for each stage", () => {
    assert.equal(sittingTtlMs("objective"), OBJECTIVE_TTL_MINUTES * 60_000);
    assert.equal(sittingTtlMs("theory"), THEORY_TTL_MINUTES * 60_000);
  });

  it("gives each stage a real limit", () => {
    // A zero or negative TTL would make every submission late, or none.
    assert.ok(OBJECTIVE_TTL_MINUTES > 0);
    assert.ok(THEORY_TTL_MINUTES > 0);
  });
});

describe("computeDeadline", () => {
  it("is the start time plus the stage's limit", () => {
    const { deadline } = computeDeadline(START, "objective", START);
    assert.equal(
      new Date(deadline).getTime(),
      START.getTime() + OBJECTIVE_TTL_MINUTES * 60_000,
    );
  });

  it("does not depend on when it is asked", () => {
    // The whole point of the rewrite: the deadline is a property of the sitting,
    // not of the request. Asking twice must give the same answer.
    const early = computeDeadline(START, "objective", new Date("2026-04-18T09:05:00Z"));
    const late = computeDeadline(START, "objective", new Date("2026-04-18T11:55:00Z"));
    assert.equal(early.deadline, late.deadline);
  });

  it("counts down, and reports time remaining", () => {
    const fiveMinutesIn = new Date(START.getTime() + 5 * 60_000);
    const { remainingMs, expired } = computeDeadline(START, "objective", fiveMinutesIn);

    assert.equal(remainingMs, (OBJECTIVE_TTL_MINUTES - 5) * 60_000);
    assert.equal(expired, false);
  });

  it("is expired exactly on the deadline, not a millisecond before it", () => {
    const onTime = new Date(START.getTime() + OBJECTIVE_TTL_MINUTES * 60_000);
    const oneMsEarly = new Date(onTime.getTime() - 1);

    assert.equal(computeDeadline(START, "objective", oneMsEarly).expired, false);
    assert.equal(computeDeadline(START, "objective", onTime).expired, true);
  });

  it("never reports negative time remaining", () => {
    // The client renders a countdown from this. A negative value would show
    // "-0:04:31" and, depending on the formatting, could read as time remaining.
    const longAfter = new Date(START.getTime() + 24 * 60 * 60_000);
    const { remainingMs, expired } = computeDeadline(START, "objective", longAfter);

    assert.equal(remainingMs, 0);
    assert.equal(expired, true);
  });

  it("runs the two stages on separate clocks", () => {
    const objective = computeDeadline(START, "objective", START);
    const theory = computeDeadline(START, "theory", START);
    assert.notEqual(objective.deadline, theory.deadline);
  });
});

describe("isLate", () => {
  it("is false while there is time left", () => {
    const student = candidate({ objectiveStartedAt: new Date() });
    assert.equal(isLate(student, "objective"), false);
  });

  it("is true once the limit has passed", () => {
    const startedAt = new Date(Date.now() - (OBJECTIVE_TTL_MINUTES + 1) * 60_000);
    const student = candidate({ objectiveStartedAt: startedAt });
    assert.equal(isLate(student, "objective"), true);
  });

  it("reads the clock for the stage it is asked about", () => {
    // A finished objective section must not make a theory paper late, and vice
    // versa: they are two sittings, started at two different times.
    const longAgo = new Date(Date.now() - 10 * 60 * 60_000);
    const student = candidate({ objectiveStartedAt: longAgo, theoryStartedAt: new Date() });

    assert.equal(isLate(student, "objective"), true);
    assert.equal(isLate(student, "theory"), false);
  });

  it("is false when the clock was never started", () => {
    // A candidate who has not opened the paper has no deadline, so cannot be late.
    // Reporting them as late would be a claim about a sitting that never began.
    const student = candidate({ objectiveStartedAt: null });
    assert.equal(isLate(student, "objective"), false);
  });
});

describe("sittingStartedAtMs", () => {
  it("reads a started clock", () => {
    const student = candidate({ theoryStartedAt: START });
    assert.equal(sittingStartedAtMs(student, "theory"), START.getTime());
  });

  it("reads an unstarted clock as 0, so callers need no null check", () => {
    // The flag route compares this against a grace window; a null there would
    // have to be special-cased at every comparison, and 0 correctly reads as
    // "not sitting", which is outside every grace window.
    const student = candidate({ objectiveStartedAt: null });
    assert.equal(sittingStartedAtMs(student, "objective"), 0);
  });
});
