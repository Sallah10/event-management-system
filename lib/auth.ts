import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  CANDIDATE_COOKIE,
  candidateCookieOptions,
  hashDeviceKey,
  readDeviceKey,
  signCandidateSession,
  verifyCandidateSession,
  type CandidateSession,
} from "@/lib/session";
import { logMetrics } from "@/lib/logger";

// ─── CANDIDATE AUTH (Node runtime) ────────────────────────────────────────────
// Route-handler conveniences on top of lib/session.ts. The session format and
// all crypto live in session.ts so the Edge proxy and these handlers can never
// drift apart.

export type { CandidateSession };

/** Pull the session cookie off a Request (works in route handlers and pages). */
export function getCandidateToken(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  const match = header.match(new RegExp(`(?:^|;\\s*)${CANDIDATE_COOKIE}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export async function getCandidateSession(
  request: Request,
): Promise<CandidateSession | null> {
  return verifyCandidateSession(getCandidateToken(request));
}

/**
 * Route guard. Returns either a session or a ready-to-return 401 — so no route
 * can forget to handle the null case, which is how the old flag/status routes
 * ended up with three different secret fallbacks.
 */
export async function requireCandidate(
  request: Request,
): Promise<{ session: CandidateSession; error?: never } | { session?: never; error: NextResponse }> {
  const session = await getCandidateSession(request);
  if (!session) {
    return {
      error: NextResponse.json(
        { success: false, message: "Session expired. Please sign in again." },
        { status: 401 },
      ),
    };
  }
  return { session };
}

export async function setCandidateCookie(
  payload: Omit<CandidateSession, "typ">,
): Promise<string> {
  const token = await signCandidateSession(payload);
  const store = await cookies();
  store.set(CANDIDATE_COOKIE, token, candidateCookieOptions);
  return token;
}

export async function clearCandidateCookie(): Promise<void> {
  const store = await cookies();
  store.set(CANDIDATE_COOKIE, "", { ...candidateCookieOptions, maxAge: 0 });
}

export { readDeviceKey, hashDeviceKey };

// ─── ROUTE ERROR SHAPE ────────────────────────────────────────────────────────
// One helper so no handler ever has to invent its own error envelope, and so
// internal error messages can't leak by accident (the old code had to be
// individually patched for this in 5 places and still missed some).

export function routeError(
  route: string,
  error: unknown,
  status = 500,
  publicMessage = "Something went wrong. Please try again.",
): NextResponse {
  logMetrics.routeError(route, error);
  return NextResponse.json({ success: false, message: publicMessage }, { status });
}
