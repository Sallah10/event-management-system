import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SignJWT } from "jose";
import {
  CANDIDATE_TTL_SECONDS,
  STAFF_TTL_SECONDS,
  hashDeviceKey,
  readDeviceKey,
  safeEqual,
  signCandidateSession,
  signStaffSession,
  verifyCandidateSession,
  verifyStaffSession,
} from "@/lib/session";

// ─── SESSIONS ─────────────────────────────────────────────────────────────────
// The original code had four different hardcoded fallback JWT secrets across six
// files. If the env var was missing, some routes broke and others silently
// accepted tokens signed with a string published in this repository — fail-open
// on a security boundary. `lib/env.ts` now throws instead.
//
// The tests below are about the boundary that replaced it: that a token is only
// accepted if it is signed by us, unexpired, of the expected type, and carries
// the fields the route is about to use.

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

const candidate = {
  email: "candidate@example.com",
  barcodeId: "TS26-ABCD1234",
  deviceKey: "a".repeat(32),
  status: "registered",
};

/** An unsigned JWT, as in `alg: none`. */
function unsignedToken(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.`;
}

describe("candidate sessions", () => {
  it("round-trips the fields the exam routes depend on", async () => {
    const session = await verifyCandidateSession(await signCandidateSession(candidate));

    assert.ok(session);
    assert.equal(session.typ, "candidate");
    assert.equal(session.email, candidate.email);
    assert.equal(session.barcodeId, candidate.barcodeId);
    assert.equal(session.deviceKey, candidate.deviceKey);
  });

  it("expires in line with the configured sitting length", async () => {
    // Two hours: long enough to sit both papers, short enough that a cookie left
    // on a library computer is not a valid identity tomorrow.
    assert.equal(CANDIDATE_TTL_SECONDS, 2 * 60 * 60);

    const token = await signCandidateSession(candidate);
    const { payload } = await verifyWithKey(token);
    const lifetime = (payload.exp as number) - (payload.iat as number);
    assert.equal(lifetime, CANDIDATE_TTL_SECONDS);
  });

  it("rejects an expired token", async () => {
    const expired = await new SignJWT({ ...candidate, typ: "candidate" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 10 * 60 * 60)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(SECRET);

    assert.equal(await verifyCandidateSession(expired), null);
  });

  it("rejects a token signed with a different secret", async () => {
    const foreign = await new SignJWT({ ...candidate, typ: "candidate" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("2h")
      .sign(new TextEncoder().encode("a-different-secret-entirely-000000000"));

    assert.equal(await verifyCandidateSession(foreign), null);
  });

  it("rejects an unsigned token", async () => {
    // `alg: none` with an admin payload. The verifier pins `algorithms`, so this
    // never reaches signature checking as a valid token.
    assert.equal(
      await verifyCandidateSession(
        unsignedToken({ typ: "candidate", email: "victim@example.com", barcodeId: "TS26-00000000" }),
      ),
      null,
    );
  });

  it("rejects a token whose algorithm is not the one we sign with", async () => {
    // Same secret, different algorithm. Pinning the algorithm list is what stops
    // this being accepted.
    const hs512 = await new SignJWT({ ...candidate, typ: "candidate" })
      .setProtectedHeader({ alg: "HS512" })
      .setIssuedAt()
      .setExpirationTime("2h")
      .sign(SECRET);

    assert.equal(await verifyCandidateSession(hs512), null);
  });

  it("rejects a tampered payload", async () => {
    const token = await signCandidateSession(candidate);
    const [header, , signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...candidate, typ: "candidate", email: "attacker@example.com" }),
    ).toString("base64url");

    assert.equal(await verifyCandidateSession(`${header}.${forged}.${signature}`), null);
  });

  it("rejects a candidate token where a staff token is expected", async () => {
    // The confused-deputy case: a candidate's own valid cookie, presented to a
    // staff route. `typ` is what separates the two, and it is checked on both
    // sides rather than only on issue.
    const token = await signCandidateSession(candidate);
    assert.equal(await verifyStaffSession(token), null);
  });

  it("rejects a staff token where a candidate token is expected", async () => {
    const token = await signStaffSession("admissions", "Reviewer");
    assert.equal(await verifyCandidateSession(token), null);
  });

  it("rejects a token missing the fields a route would use", async () => {
    // A token that verifies but has no barcode is not a session. Returning null
    // means the route redirects to login instead of querying for `undefined`.
    const incomplete = await new SignJWT({ typ: "candidate" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("2h")
      .sign(SECRET);

    assert.equal(await verifyCandidateSession(incomplete), null);
  });

  it("returns null for absent, empty and malformed tokens", async () => {
    for (const value of [undefined, null, "", "not-a-token", "a.b", "a.b.c.d"]) {
      assert.equal(await verifyCandidateSession(value), null);
    }
  });
});

describe("staff sessions", () => {
  it("round-trips a role and a name", async () => {
    for (const role of ["staff", "admissions"] as const) {
      const session = await verifyStaffSession(await signStaffSession(role, "Ada"));
      assert.ok(session);
      assert.equal(session.role, role);
      assert.equal(session.name, "Ada");
    }
  });

  it("rejects a role that is not one of ours", async () => {
    // `role: "admin"` must not pass as staff, and must not pass as admissions
    // either — the two roles see different PII.
    const forged = await new SignJWT({ typ: "staff", role: "admin", name: "Ada" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(SECRET);

    assert.equal(await verifyStaffSession(forged), null);
  });

  it("outlives a candidate session, because an event day is longer than a sitting", () => {
    assert.ok(STAFF_TTL_SECONDS > CANDIDATE_TTL_SECONDS);
  });
});

describe("readDeviceKey", () => {
  const request = (value: string | null) =>
    new Request("https://example.test", {
      headers: value === null ? {} : { "x-device-key": value },
    });

  it("accepts a key of plausible length", () => {
    const key = "b".repeat(32);
    assert.equal(readDeviceKey(request(key)), key);
    // Whitespace around a header value is not part of the value.
    assert.equal(readDeviceKey(request(`  ${key}  `)), key);
  });

  it("rejects an absent, tiny or oversized key", () => {
    // Below 16 is not a UUID; above 128 is abuse. Both are refused before any
    // hashing, so an attacker cannot make the server hash arbitrary megabytes.
    assert.equal(readDeviceKey(request(null)), null);
    assert.equal(readDeviceKey(request("")), null);
    assert.equal(readDeviceKey(request("a".repeat(15))), null);
    assert.equal(readDeviceKey(request("a".repeat(129))), null);
  });
});

describe("hashDeviceKey", () => {
  it("is deterministic, so a returning browser still matches", async () => {
    const key = "c".repeat(32);
    assert.equal(await hashDeviceKey(key), await hashDeviceKey(key));
  });

  it("does not store the key", async () => {
    // The stored value is a hash, so a database dump does not hand over the keys
    // that would let somebody forge a device binding.
    const key = "d".repeat(32);
    const hash = await hashDeviceKey(key);
    assert.equal(hash.includes(key), false);
    assert.equal(hash.length, 64); // hex sha256
    assert.match(hash, /^[0-9a-f]{64}$/);
  });

  it("separates different keys", async () => {
    assert.notEqual(await hashDeviceKey("e".repeat(32)), await hashDeviceKey("f".repeat(32)));
  });
});

describe("safeEqual", () => {
  it("compares equal values as equal", () => {
    assert.equal(safeEqual("123456", "123456"), true);
    assert.equal(safeEqual("", ""), true);
  });

  it("rejects differences of length, content and prefix", () => {
    // The 6-digit staff PIN is the reason this exists: a 10^6 search space is
    // small enough that a timing leak is worth closing.
    assert.equal(safeEqual("123456", "123457"), false);
    assert.equal(safeEqual("123456", "12345"), false);
    assert.equal(safeEqual("123456", "654321"), false);
    assert.equal(safeEqual("123456", ""), false);
  });

  it("rejects non-strings rather than coercing them", () => {
    for (const value of [null, undefined, 123456, {}, []]) {
      assert.equal(safeEqual(value as unknown as string, "123456"), false);
      assert.equal(safeEqual("123456", value as unknown as string), false);
    }
  });

  it("handles values containing multi-byte characters", () => {
    // Compared byte-wise, so a length difference in bytes must not be read as
    // equality by truncating the loop.
    assert.equal(safeEqual("café", "café"), true);
    assert.equal(safeEqual("café", "cafe"), false);
  });
});

/** Decode without verifying, for assertions about the token's own claims. */
async function verifyWithKey(token: string) {
  const { jwtVerify } = await import("jose");
  return jwtVerify(token, SECRET, { algorithms: ["HS256"] });
}
