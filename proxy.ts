import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { redis, rateLimitKey } from "@/lib/redis";
import {
  CANDIDATE_COOKIE,
  STAFF_COOKIE,
  verifyCandidateSession,
  verifyStaffSession,
} from "@/lib/session";

// ─── EDGE PROXY ───────────────────────────────────────────────────────────────
// Runs on the Edge runtime, so this file can only use WebCrypto APIs. That's why
// sessions are verified with `jose` here rather than `jsonwebtoken`.
//
// WHAT THIS ACTUALLY DOES (all four of these were broken or missing before):
//
//  1. Real page gating. `/assessment/exam`, `/assessment/theory` and
//     `/assessment/result` are now verified HERE, at the edge, from a signed
//     httpOnly cookie. Previously their only gate was
//     `localStorage.getItem("user_email")` in the client bundle — a value any
//     visitor can type into DevTools. The client-side check that was supposed
//     to back it up called `/api/assessment/status`, which 404'd.
//
//  2. Staff role separation. `/admin/*` needs `staff`, `/admissions/*` needs
//     `admissions`. Previously one shared `STAFF_ACCESS_TOKEN` opened the
//     check-in scanner, the PII search AND the OpenAI batch job.
//
//  3. Rate limits keyed on a VERIFIED identity. The old code did
//     `JSON.parse(atob(token.split(".")[1]))` with no signature check, so an
//     attacker set a random `email` claim per request and got a brand-new
//     bucket every time — the limit was decorative.
//
//  4. Coverage. The previous matcher ran the function on every /api route but
//     only rate-limited two of them. Admin, internal-sync, register and qr
//     routes fell straight through to `NextResponse.next()`.

const RATE_LIMITS = {
  checkin: { max: 60, window: 60 },
  assessmentRead: { max: 60, window: 60 },
  assessmentWrite: { max: 300, window: 60 },
  register: { max: 600, window: 60 },
  staffRead: { max: 120, window: 60 },
  staffWrite: { max: 30, window: 60 },
  sensitive: { max: 10, window: 60 },
} as const;

function clientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function tooMany(ttl: number, message = "Too many requests. Please slow down."): NextResponse {
  return NextResponse.json(
    { success: false, error: "RATE_LIMITED", message: `${message} Try again in ${ttl}s.` },
    { status: 429, headers: { "Retry-After": String(Math.max(1, ttl)) } },
  );
}

/**
 * Fallback counters, used only when Redis is unreachable outside production.
 * Per-instance and lost on restart - which is the point: in dev the alternative
 * is that a network blip makes the app unusable, and in dev the limiter is not
 * a security boundary.
 */
const localCounters = new Map<string, { count: number; expiresAt: number }>();
let warnedLocalFallback = false;

function localHit(key: string, max: number, window: number): number | null {
  const now = Date.now();
  const entry = localCounters.get(key);

  if (!entry || entry.expiresAt <= now) {
    localCounters.set(key, { count: 1, expiresAt: now + window * 1000 });
    return null;
  }

  entry.count += 1;
  if (localCounters.size > 5000) {
    for (const [k, v] of localCounters) if (v.expiresAt <= now) localCounters.delete(k);
  }
  return entry.count > max ? Math.ceil((entry.expiresAt - now) / 1000) : null;
}

/**
 * Fixed-window counter. INCR first so concurrent requests can't all read null.
 *
 * Redis being *absent* is handled at construction (lib/redis.ts falls back to an
 * in-memory store). Redis being *present but unreachable* was not handled, and
 * that is the case that broke local development: a 10s connect timeout to
 * Upstash turned every write into a 503, so a developer could not sign in.
 * Production still fails closed - a rate limiter that silently stops limiting
 * is worse than one that refuses writes - but only in production.
 */
async function hit(key: string, max: number, window: number): Promise<number | null> {
  try {
    const current = await redis.incr(key);
    if (current === 1) await redis.expire(key, window);
    if (current > max) {
      const ttl = await redis.ttl(key);
      return ttl;
    }
    return null;
  } catch (error) {
    if (process.env.NODE_ENV === "production") throw error;

    if (!warnedLocalFallback) {
      warnedLocalFallback = true;
      console.warn(
        "[proxy] Rate-limit store unreachable; counting locally for this dev session. " +
          "If you did not expect this, check UPSTASH_REDIS_REST_URL / _TOKEN in .env.local. " +
          `(${(error as Error)?.message})`,
      );
    }
    return localHit(key, max, window);
  }
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const method = request.method;

  // ─── STAFF GATE ────────────────────────────────────────────────────────────
  try {
    const isAdminArea = path.startsWith("/admin");
    const isAdmissionsArea = path.startsWith("/admissions");

    if ((isAdminArea || isAdmissionsArea) && path !== "/admin/login") {
      const session = await verifyStaffSession(request.cookies.get(STAFF_COOKIE)?.value);

      if (!session) {
        return NextResponse.redirect(new URL("/admin/login", request.url));
      }

      // Two areas, two roles, checked symmetrically.
      //
      // The old check was one-directional: it stopped `staff` from opening
      // /admissions, and did nothing at all to stop `admissions` from opening
      // /admin. So the separation was half a separation — an admissions officer
      // could read the attendance dashboard, and the comment above it claimed a
      // rule that the code did not implement.
      //
      // Each side bounces to the other role's home with a reason in the query, so
      // the officer lands somewhere real and can see why.
      if (isAdmissionsArea && session.role !== "admissions") {
        return NextResponse.redirect(
          new URL("/admin/dashboard?denied=admissions", request.url),
        );
      }
      if (isAdminArea && session.role !== "staff") {
        return NextResponse.redirect(
          new URL("/admissions?denied=staff", request.url),
        );
      }
    }
  } catch (error) {
    console.error("[proxy] staff gate error", error);
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }

  // ─── CANDIDATE PAGE GATE ───────────────────────────────────────────────────
  try {
    const guarded = ["/assessment/exam", "/assessment/theory", "/assessment/result"];
    if (guarded.some((route) => path === route || path.startsWith(`${route}/`))) {
      const session = await verifyCandidateSession(
        request.cookies.get(CANDIDATE_COOKIE)?.value,
      );

      if (!session) {
        const login = new URL("/assessment/login", request.url);
        login.searchParams.set("reason", "session");
        return NextResponse.redirect(login);
      }
    }
  } catch (error) {
    console.error("[proxy] candidate gate error", error);
    return NextResponse.redirect(new URL("/assessment/login", request.url));
  }

  // ─── RATE LIMITING ─────────────────────────────────────────────────────────
  // Only on writes. Hammering a read costs us a DB round-trip too, but blocking
  // a candidate mid-exam because they refreshed is worse than allowing it.
  if (method !== "GET" && method !== "HEAD") {
    try {
      const ip = clientIp(request);
      const isApi = path.startsWith("/api/");

      if (path === "/api/check-in") {
        const ttl = await hit(
          rateLimitKey("checkin", ip),
          RATE_LIMITS.checkin.max,
          RATE_LIMITS.checkin.window,
        );
        if (ttl !== null) return tooMany(ttl);
      }

      if (path === "/api/register") {
        // The in-handler limit is per-IP; this is a coarse global ceiling so a
        // burst of WordPress traffic can't flatten the function.
        const ttl = await hit(
          rateLimitKey("register", "global"),
          RATE_LIMITS.register.max,
          RATE_LIMITS.register.window,
        );
        if (ttl !== null) return tooMany(ttl, "Registration is busy.");
      }

      if (isApi && path.startsWith("/api/assessment/")) {
        // Verified identity — this is what makes the limit actually mean something
        const session = await verifyCandidateSession(
          request.cookies.get(CANDIDATE_COOKIE)?.value,
        );
        const identity = session?.barcodeId ?? `ip:${ip}`;

        const isHeavyWrite =
          path.includes("/submit") || path.includes("/flag") || path.includes("/start-exam");
        const limit = isHeavyWrite ? RATE_LIMITS.assessmentWrite : RATE_LIMITS.assessmentRead;

        const ttl = await hit(
          rateLimitKey("assessment", identity),
          limit.max,
          limit.window,
        );
        if (ttl !== null) return tooMany(ttl);
      }

      if (isApi && (path.startsWith("/api/admin/") || path.startsWith("/api/internal/"))) {
        const staff = await verifyStaffSession(request.cookies.get(STAFF_COOKIE)?.value);
        const isExport = path.includes("export") || path.includes("candidate-answers");
        const limit = isExport ? RATE_LIMITS.sensitive : RATE_LIMITS.staffWrite;

        const ttl = await hit(
          rateLimitKey("staff", staff?.name ?? `ip:${ip}`),
          limit.max,
          limit.window,
        );
        if (ttl !== null) return tooMany(ttl);
      }
    } catch (error) {
      // Fail CLOSED on writes, in production. The old code failed open here,
      // which meant a Redis blip silently disabled every limit at once. A
      // rejected write is recoverable; a mass check-in bypass is not.
      //
      // `hit()` already absorbs an unreachable store outside production, so
      // reaching here on a dev machine means something else is genuinely wrong
      // and should still surface.
      console.error("[proxy] rate limiter unavailable, blocking write", error);
      return NextResponse.json(
        { success: false, error: "SERVICE_UNAVAILABLE", message: "Please try again in a moment." },
        { status: 503 },
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/api/:path*",
    "/admin/:path*",
    "/admissions/:path*",
    "/checkin",
    "/assessment/exam",
    "/assessment/exam/:path*",
    "/assessment/theory",
    "/assessment/result",
  ],
};
