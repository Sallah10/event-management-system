import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TICKET_BODY_LENGTH, TICKET_PREFIX, makeTicket, normaliseTicket } from "@/lib/tickets";

// ─── TICKET NORMALISATION ─────────────────────────────────────────────────────
// lib/tickets.ts is the fix for a check-in endpoint that accepted a scan of
// "TS26-%%%" and checked in the first TS26 registrant in the table, because three
// of its five matching strategies interpolated the scanned string straight into
// an `ILIKE` pattern. These cases exist to keep that fix from being undone by a
// well-meaning "just make the matcher more tolerant" change, which is how it went
// wrong the first time.

describe("normaliseTicket", () => {
  it("accepts a canonical ticket", () => {
    const result = normaliseTicket(`${TICKET_PREFIX}-ABCD1234`);
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.value, `${TICKET_PREFIX}-ABCD1234`);
  });

  it("tolerates the ways a QR code actually gets scanned", () => {
    // Lowercase, missing hyphen, extra hyphen, surrounding whitespace. All of
    // these are scanner behaviour, not tampering, and a candidate should not be
    // turned away at the door for them.
    for (const input of [
      `${TICKET_PREFIX.toLowerCase()}-abcd1234`,
      `${TICKET_PREFIX}abcd1234`,
      `${TICKET_PREFIX}-abcd-1234`,
      `  ${TICKET_PREFIX}-ABCD1234  `,
      `TS 26 - ABCD 1234`,
    ]) {
      const result = normaliseTicket(input);
      assert.equal(result.ok, true, `expected ${input} to be accepted`);
      assert.equal(result.ok && result.value, `${TICKET_PREFIX}-ABCD1234`);
    }
  });

  it("strips characters that are not alphanumeric, so wildcards cannot survive", () => {
    // The regression that matters. `%%%` and `_` were the exploit: they are not
    // alphanumeric, so they are removed before the prefix and body are read, and
    // what is left can only ever be compared for equality. This test is the
    // reason the matcher is a regex and not a LIKE.
    for (const input of [
      `${TICKET_PREFIX}-%%%`,
      `${TICKET_PREFIX}-%%%%`,
      `${TICKET_PREFIX}-____`,
      `${TICKET_PREFIX}-%_%_%_`,
      `${TICKET_PREFIX}-ABCD_234`,
    ]) {
      const result = normaliseTicket(input);
      assert.equal(result.ok, false, `expected ${input} to be rejected`);
    }
  });

  it("rejects a wildcard payload that claims a valid prefix", () => {
    // Specifically: the response must not be the "use manual check-in" one that a
    // well-formed prefix produces, because that branch is what an operator reads
    // as "scanned fine, just not registered" and acts on.
    const result = normaliseTicket(`${TICKET_PREFIX}-%%%%`);
    assert.equal(result.ok, false);
  });

  it("rejects a body of the wrong length", () => {
    for (const body of ["ABC", "ABCD123", "ABCD123456"]) {
      const result = normaliseTicket(`${TICKET_PREFIX}-${body}`);
      assert.equal(result.ok, false, `expected a ${body.length}-character body to be rejected`);
    }
  });

  it("rejects another cohort's prefix", () => {
    // TICKET_PREFIX is configurable now, so this is a real operational case: a
    // ticket printed for last year is not this year's ticket, and the desk needs
    // to be told to check rather than silently told the code is unrecognised.
    const result = normaliseTicket("TS25-ABCD1234");
    assert.equal(result.ok, false);
  });

  it("rejects a non-string rather than coercing it", () => {
    // `String(value)` here would turn `null` into "null" and any object into
    // "[object Object]", both of which are noise in a scanner's response.
    for (const input of [null, undefined, 42, {}, [], true]) {
      const result = normaliseTicket(input);
      assert.equal(result.ok, false);
    }
  });

  it("rejects empty and whitespace-only scans with a usable reason", () => {
    for (const input of ["", "   ", "-", "---"]) {
      const result = normaliseTicket(input);
      assert.equal(result.ok, false);
      assert.ok(result.reason.length > 0);
    }
  });

  it("gives the operator a different instruction depending on what was wrong", () => {
    // Two failure modes, two different actions: a misread of a real ticket needs
    // "scan again", an unregistered code needs "check manually". One generic
    // "invalid" string makes the desk guess.
    const reasonOf = (result: ReturnType<typeof normaliseTicket>) =>
      result.ok ? "" : result.reason;

    const nearMiss = reasonOf(normaliseTicket(`${TICKET_PREFIX}-XYZ`));
    const wrongScheme = reasonOf(normaliseTicket("HELLO-1234"));

    assert.notEqual(nearMiss, "");
    assert.notEqual(wrongScheme, "");
    assert.notEqual(nearMiss, wrongScheme);
  });
});

describe("makeTicket", () => {
  it("produces something normaliseTicket accepts", () => {
    // The round trip is what seeding and any future fixture depends on.
    for (const seed of [0, 1, 255, 4096, 0xdeadbeef]) {
      const ticket = makeTicket(seed);
      assert.equal(ticket.length, TICKET_PREFIX.length + 1 + TICKET_BODY_LENGTH);
      const result = normaliseTicket(ticket);
      assert.equal(result.ok, true, `${ticket} should be accepted`);
      assert.equal(result.ok && result.value, ticket);
    }
  });

  it("pads small seeds to a fixed width, so ids cannot be distinguished by length", () => {
    assert.equal(makeTicket(1), `${TICKET_PREFIX}-00000001`);
    assert.equal(makeTicket(0), `${TICKET_PREFIX}-00000000`);
  });
});
