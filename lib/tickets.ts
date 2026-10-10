// ─── TICKET FORMAT ────────────────────────────────────────────────────────────
// Pure functions, no I/O - which is why they're unit-testable (see
// `npm run test:unit`) and why the check-in route can be reasoned about without
// a database.
//
// WHY THE OLD MATCHER IS GONE
//
// The original check-in ran five escalating "strategies" to tolerate however the
// QR happened to be encoded. Strategies 2, 4 and 5 all built a SQL LIKE pattern
// from the scanned string:
//
//   strategy 2:  ILIKE '%' + cleanId.replace(/-/g, "") + '%'
//   strategy 4:  ILIKE '%' + cleanId.replace(/[^A-Z0-9]/gi, "") + '%'
//   strategy 5:  ILIKE '%' + suffix.replace("-", "") + '%'
//
// Strategies 2 and 5 only stripped hyphens, so SQL wildcards survived into the
// pattern. A scan of "TS26-%%%" is 8 characters, clears the `length < 8` guard,
// and becomes `ILIKE '%TS26%%%'` - which matches the first TS26 registrant in the
// table. Underscores work the same way. So the endpoint that was supposed to
// prove a candidate physically attended could be used to check in an arbitrary
// attendee, and every response leaked that person's full name.
//
// The fix is not "escape the wildcards" - it's to stop guessing. A ticket is
// `TS26-` + 8 hex characters. We normalise the handful of real-world variations
// (lowercase, missing or extra hyphen, stray whitespace) into that one canonical
// shape and then do an exact match against a unique index. If it doesn't match,
// a human at the desk handles it. That's both safer and faster: one indexed
// equality lookup instead of up to five sequential queries, three of which were
// unindexed `ILIKE '%...%'` full table scans.

import { BRAND } from "@/config/branding";

// "TS26" is two facts about one cohort baked into a regex: a short programme
// prefix and the year. The next cohort is a different prefix, and a repository
// that hardcodes the current one has a `.env` change to make before it can be
// used for anything else. The default is unchanged, so existing TS26 tickets keep
// validating - a format change that silently invalidates a few thousand printed
// tickets is not one to make as a side effect of tidying up a constant.
export const TICKET_PREFIX = (
  process.env.TICKET_PREFIX ?? "TS26"
).toUpperCase();
export const TICKET_BODY_LENGTH = Number(process.env.TICKET_BODY_LENGTH ?? 8);
const TICKET_PATTERN = new RegExp(
  `^${TICKET_PREFIX}-?[0-9A-F]{${TICKET_BODY_LENGTH}}$`,
  "i",
);

export type TicketResult =
  | { ok: true; value: string }
  | { ok: false; reason: string };

/**
 * Canonicalise a scanned string to `TS26-XXXXXXXX`.
 * Accepts: " ts26 abcd1234 ", "TS26-abcd1234", "TS26ABCD1234", "ts26-abcd-1234"
 * Rejects: anything with a non-alphanumeric body, wrong length, or wrong prefix.
 */
export function normaliseTicket(input: unknown): TicketResult {
  if (typeof input !== "string") {
    return { ok: false, reason: "No barcode provided." };
  }

  const stripped = input.replace(/[^A-Za-z0-9]/g, "");

  if (stripped.length === 0) {
    return { ok: false, reason: "No barcode provided." };
  }

  if (!TICKET_PATTERN.test(stripped)) {
    // Give the operator something actionable instead of "invalid format"
    const looksRight = stripped.toUpperCase().startsWith(TICKET_PREFIX);
    return {
      ok: false,
      reason: looksRight
        ? `This does not look like a ${BRAND.shortName} ticket. Check the code and scan again, or use manual check-in.`
        : "Unrecognised code. Use manual check-in at the desk.",
    };
  }

  const body = stripped.slice(TICKET_PREFIX.length).toUpperCase();
  return { ok: true, value: `${TICKET_PREFIX}-${body}` };
}

/** Build a ticket for seeding and tests. */
export function makeTicket(seed: number): string {
  return `${TICKET_PREFIX}-${seed.toString(16).toUpperCase().padStart(TICKET_BODY_LENGTH, "0")}`;
}
