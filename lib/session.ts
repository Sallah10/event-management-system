import { SignJWT, jwtVerify } from "jose";
import { requireEnv } from "@/lib/env";

// ─── SESSIONS ─────────────────────────────────────────────────────────────────
// Why `jose` and not `jsonwebtoken`: this module is imported by proxy.ts, which
// runs on the Edge runtime. `jsonwebtoken` and `node:crypto` don't exist there,
// which is exactly why the old proxy could only *base64-decode* the JWT and
// never verify it — so anyone could hand-craft a token to get a fresh
// rate-limit bucket per request. `jose` is WebCrypto-only, so the same
// verification runs in the proxy AND in the route handlers, from one module.
//
// Two token types, distinguished by `typ`. A candidate token can therefore never
// be replayed as a staff token (a classic confused-deputy bug).

export const CANDIDATE_COOKIE = "auth_token";
export const STAFF_COOKIE = "staff_session";

export type StaffRole = "staff" | "admissions";

export interface CandidateSession {
  typ: "candidate";
  email: string;
  barcodeId: string;
  /** Hash of the browser-held device key. Never the key itself. */
  deviceKey: string;
  status: string;
}

export interface StaffSession {
  typ: "staff";
  role: StaffRole;
  name: string;
}

export const CANDIDATE_TTL_SECONDS = 2 * 60 * 60; // 2h — one exam sitting
export const STAFF_TTL_SECONDS = 12 * 60 * 60; // 12h — one event day

let cachedSecret: Uint8Array | null = null;
function secret(): Uint8Array {
  if (!cachedSecret) {
    cachedSecret = new TextEncoder().encode(requireEnv("JWT_SECRET"));
  }
  return cachedSecret;
}

// ─── CANDIDATE SESSIONS ───────────────────────────────────────────────────────

export async function signCandidateSession(
  payload: Omit<CandidateSession, "typ">,
): Promise<string> {
  return new SignJWT({ ...payload, typ: "candidate" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${CANDIDATE_TTL_SECONDS}s`)
    .sign(secret());
}

export async function verifyCandidateSession(
  token: string | undefined | null,
): Promise<CandidateSession | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (payload.typ !== "candidate") return null;
    if (typeof payload.email !== "string" || typeof payload.barcodeId !== "string") {
      return null;
    }
    return {
      typ: "candidate",
      email: payload.email,
      barcodeId: payload.barcodeId,
      deviceKey: typeof payload.deviceKey === "string" ? payload.deviceKey : "",
      status: typeof payload.status === "string" ? payload.status : "",
    };
  } catch {
    return null;
  }
}

// ─── STAFF SESSIONS ───────────────────────────────────────────────────────────

export async function signStaffSession(role: StaffRole, name: string): Promise<string> {
  return new SignJWT({ typ: "staff", role, name })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${STAFF_TTL_SECONDS}s`)
    .sign(secret());
}

export async function verifyStaffSession(
  token: string | undefined | null,
): Promise<StaffSession | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (payload.typ !== "staff") return null;
    if (payload.role !== "staff" && payload.role !== "admissions") return null;
    return {
      typ: "staff",
      role: payload.role,
      name: typeof payload.name === "string" ? payload.name : "staff",
    };
  } catch {
    return null;
  }
}

// ─── COOKIE HELPERS ───────────────────────────────────────────────────────────

export const candidateCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
  maxAge: CANDIDATE_TTL_SECONDS,
};

export const staffCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  // "lax" not "strict": staff follow links from the WP admin into the portal.
  // The cookie is still httpOnly and still needs a valid signed token.
  sameSite: "lax" as const,
  path: "/",
  maxAge: STAFF_TTL_SECONDS,
};

// ─── DEVICE BINDING ───────────────────────────────────────────────────────────
// HONEST VERSION OF WHAT THIS DOES — the old code called a hash of
// (User-Agent | Accept | Accept-Language | x-forwarded-for) "device
// fingerprinting". Two problems: every header is attacker-controlled, and
// because the caller's IP was in the hash, a candidate walking from Wi-Fi to
// mobile data was rejected as "a second device" and locked out of their own exam.
//
// What we do instead: the browser generates a random key on first visit and
// persists it. We store only sha256(key + server-side pepper).
//
// What this DOES buy you: one sitting is bound to one browser profile, so
// casually copying the ticket to another laptop/tab stops working.
//
// What this does NOT buy you (say this out loud in an interview): it is not
// DRM. Clearing site data or opening a private window mints a new key, and the
// previous key is then orphaned. Treat it as friction, not a security boundary —
// the real boundary is the checked-in gate plus the invigilator process.

const DEVICE_KEY_HEADER = "x-device-key";

export function readDeviceKey(request: Request): string | null {
  const value = request.headers.get(DEVICE_KEY_HEADER);
  if (!value) return null;
  const trimmed = value.trim();
  // A UUID from crypto.randomUUID(); anything wildly larger is abuse
  if (trimmed.length < 16 || trimmed.length > 128) return null;
  return trimmed;
}

export async function hashDeviceKey(deviceKey: string): Promise<string> {
  const pepper = requireEnv("DEVICE_PEPPER");
  const data = new TextEncoder().encode(`${pepper}:${deviceKey}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─── CONSTANT-TIME COMPARISON ─────────────────────────────────────────────────
// 12 secret comparisons in the original used `===` / `!==`, which
// short-circuits on the first differing byte and leaks length + prefix
// through timing. Most were high-entropy tokens where that is theoretical, but
// one of them was the 6-digit staff PIN — a 10^6 search space.
//
// Implemented by hand rather than via node:crypto so it also runs on the Edge.

export function safeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;

  const encoder = new TextEncoder();
  const bytesA = encoder.encode(a);
  const bytesB = encoder.encode(b);

  // Compare a fixed number of bytes so the loop length doesn't leak the length
  // of the secret. `diff` accumulates; the early `length` check is on the
  // attacker-supplied value only.
  const length = Math.max(bytesA.length, bytesB.length);
  let diff = bytesA.length ^ bytesB.length;

  for (let i = 0; i < length; i += 1) {
    diff |= (bytesA[i] ?? 0) ^ (bytesB[i] ?? 0);
  }

  return diff === 0;
}
