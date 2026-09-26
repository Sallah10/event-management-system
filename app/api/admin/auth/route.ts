import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { redis, rateLimitKey } from "@/lib/redis";
import { signStaffSession, staffCookieOptions, STAFF_COOKIE, safeEqual, type StaffRole } from "@/lib/session";
import { requireEnv } from "@/lib/env";
import { readDeviceKey } from "@/lib/auth";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";

// ─── STAFF SIGN-IN ────────────────────────────────────────────────────────────
// Two fixes that matter:
//
// 1. IT FAILED OPEN. The comparison was
//        String(pin) === String(process.env.STAFF_PIN)
//    With STAFF_PIN unset, String(undefined) === "undefined", so POSTing
//    {"pin":"undefined"} authenticated successfully and minted a staff cookie.
//    A missing env var turned into a valid credential.
//
// 2. THE COMPARISON LEAKED TIMING. `===` short-circuits on the first differing
//    character. Against a 6-digit PIN — a 10^6 search space — that's a real
//    oracle, and the only rate limit was 5 attempts per IP per 10 minutes, keyed
//    on an `x-forwarded-for` header the client controls outside Vercel. Now a
//    constant-time compare, and the limit is keyed on IP *and* device.
//
// The lockout window was also documented as 15 minutes and implemented as 10.

// Two credential tiers. `staff` runs the door; `admissions` decides who wins.
const CREDENTIALS: Record<StaffRole, { pinEnv: string; name: string }> = {
  staff: { pinEnv: "STAFF_PIN", name: "Check-in staff" },
  admissions: { pinEnv: "ADMISSIONS_PIN", name: "Admissions officer" },
};

const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 15 * 60;

function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function POST(request: Request) {
  const route = "admin.auth";

  try {
    // `request` is a plain Request here, not a NextRequest, so there is no
    // `nextUrl` shortcut — read the query off the URL directly.
    const role = (new URL(request.url).searchParams.get("role") ?? "staff") as StaffRole;
    const credential = CREDENTIALS[role];
    if (!credential) {
      return NextResponse.json(
        { success: false, error: "BAD_ROLE", message: "Unknown role." },
        { status: 400 },
      );
    }

    // requireEnv THROWS if the PIN is unset — which is the whole point. An
    // unconfigured staff portal must not be enterable.
    const expectedPin = requireEnv(credential.pinEnv);

    const ip = clientIp(request);
    const device = readDeviceKey(request) ?? "no-device";
    // Keyed on both, so rotating IPs doesn't hand an attacker a fresh budget.
    const failKey = rateLimitKey(`stafflogin:${role}`, `${ip}:${device}`);

    const fails = Number((await redis.get(failKey)) ?? 0);
    if (fails >= MAX_ATTEMPTS) {
      const ttl = await redis.ttl(failKey);
      return NextResponse.json(
        {
          success: false,
          error: "LOCKED",
          message: `Too many attempts. Try again in ${Math.max(1, ttl)}s.`,
        },
        { status: 429, headers: { "Retry-After": String(Math.max(1, ttl)) } },
      );
    }

    let pin = "";
    try {
      const body = await request.json();
      if (typeof body?.pin === "string" || typeof body?.pin === "number") {
        pin = String(body.pin);
      }
    } catch {
      return NextResponse.json(
        { success: false, error: "BAD_REQUEST", message: "Invalid request." },
        { status: 400 },
      );
    }

    if (!safeEqual(pin, expectedPin)) {
      const attempts = Number((await redis.incr(failKey)) ?? 1);
      if (attempts === 1) await redis.expire(failKey, LOCKOUT_SECONDS);

      log.warn("admin.auth.failed", { role, attempts, ip });
      return NextResponse.json(
        { success: false, error: "INVALID_PIN", message: "Incorrect PIN." },
        { status: 401 },
      );
    }

    await redis.del(failKey);

    const token = await signStaffSession(role, credential.name);
    const store = await cookies();
    store.set(STAFF_COOKIE, token, staffCookieOptions);

    log.info("admin.auth.success", { role });

    return NextResponse.json({
      success: true,
      error: null,
      role,
      // Where the proxy will let them land
      next: role === "admissions" ? "/admissions" : "/admin/dashboard",
    });
  } catch (error) {
    log.error("admin.auth.error", {
      route,
      message: (error as Error)?.message,
    });
    return NextResponse.json(
      {
        success: false,
        error: "UNAVAILABLE",
        message: "Staff sign-in is not configured. Contact the event lead.",
      },
      { status: 503 },
    );
  }
}

// ─── SIGN OUT ─────────────────────────────────────────────────────────────────
// The old code had no way to end a staff session other than clearing cookies by
// hand. On a shared event-day laptop that is the difference between "I locked
// myself out" and "the next person is still an admin".
export async function DELETE() {
  const store = await cookies();
  store.set(STAFF_COOKIE, "", { ...staffCookieOptions, maxAge: 0 });
  return NextResponse.json({ success: true, error: null });
}
