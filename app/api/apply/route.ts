import { NextResponse } from "next/server";
import { redis, rateLimitKey } from "@/lib/redis";
import { log, maskEmail } from "@/lib/logger";
import { registerApplicant } from "@/lib/registration";
import { verifyTurnstile } from "@/lib/turnstile";

export const dynamic = "force-dynamic";

// ─── PUBLIC APPLICATION (in-app) ───────────────────────────────────────────────
//
// The second front door. WordPress keeps working through /api/register; this is
// the one a person can reach from a phone with no CMS involved. Both end up in
// the same place - lib/registration.ts - because two front doors sharing one
// implementation is the only version of this that stays correct.
//
// The gate here is Turnstile rather than a shared secret, and that is the whole
// difference between this route and the other one. See lib/turnstile.ts for why
// a public write endpoint needs one.

const RATE_LIMIT_WINDOW = 60;
const RATE_LIMIT_MAX = 8;

function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

let warnedLimiter = false;

/**
 * Per-IP fixed-window budget.
 *
 * Returns true when the caller is over budget. An unreachable store is fatal in
 * production and a warning outside it, for the same reason as proxy.ts: a
 * third-party outage must not take the registration form offline, and outside
 * production this is not the security boundary - Turnstile is.
 */
async function overBudget(ip: string): Promise<boolean> {
  try {
    const key = rateLimitKey("apply", ip);
    const attempts = Number((await redis.incr(key)) ?? 0);
    if (attempts === 1) await redis.expire(key, RATE_LIMIT_WINDOW);
    return attempts > RATE_LIMIT_MAX;
  } catch (error) {
    if (process.env.NODE_ENV === "production") throw error;
    if (!warnedLimiter) {
      warnedLimiter = true;
      console.warn(
        "[apply] Rate-limit store unreachable; skipping the local budget. " +
          `(${(error as Error)?.message})`,
      );
    }
    return false;
  }
}

export async function POST(request: Request) {
  const ip = clientIp(request);

  try {
    // ─── RATE LIMIT ───────────────────────────────────────────────────────────
    // Deliberately much tighter than the CMS route (8/min vs 600/min). A shared
    // secret means the only caller is a server we control on a known schedule;
    // here the caller is the internet, so the budget is sized for a person
    // filling in a form and mistyping an email.
    if (await overBudget(ip)) {
      log.warn("apply.rate_limited", { ip });
      return NextResponse.json(
        { success: false, error: "RATE_LIMITED", message: "Too many attempts. Please wait a moment." },
        { status: 429, headers: { "Retry-After": String(RATE_LIMIT_WINDOW) } },
      );
    }

    // ─── PARSE ────────────────────────────────────────────────────────────────
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ success: false, error: "BAD_JSON", message: "Invalid request." }, { status: 400 });
    }

    // ─── CAPTCHA ──────────────────────────────────────────────────────────────
    const captcha = await verifyTurnstile(body.turnstileToken, ip);

    if (!captcha.ok) {
      const status = captcha.reason === "unconfigured" ? 503 : 400;
      log.warn("apply.captcha_failed", { ip, reason: captcha.reason });
      return NextResponse.json(
        {
          success: false,
          error: captcha.reason === "unconfigured" ? "UNAVAILABLE" : "CAPTCHA_FAILED",
          message:
            captcha.reason === "unconfigured"
              ? "Registration is temporarily unavailable. Please try again shortly."
              : "Please confirm you're human and try again.",
        },
        { status },
      );
    }

    // ─── REGISTER ─────────────────────────────────────────────────────────────
    const result = await registerApplicant({
      name: body.name,
      email: body.email,
      phone: body.phone,
      course: body.course,
      career: body.career,
    });

    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.code, message: result.message, field: result.field },
        { status: result.status },
      );
    }

    log.info("apply.created", {
      email: maskEmail(String(body.email ?? "")),
      barcodeId: result.ticketId,
      duplicate: result.duplicate,
    });

    return NextResponse.json(
      {
        success: true,
        ticketId: result.ticketId,
        duplicate: result.duplicate,
        emailed: result.emailed,
      },
      { status: result.duplicate ? 200 : 201 },
    );
  } catch (error) {
    log.error("apply.failed", { message: (error as Error)?.message, ip });
    return NextResponse.json(
      { success: false, error: "UNAVAILABLE", message: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}

/** A GET here means someone bookmarked the API. Say what it is. */
export async function GET() {
  return NextResponse.json(
    {
      endpoint: "apply",
      method: "POST",
      description: "Public application endpoint. Requires a Turnstile token.",
    },
    { status: 405, headers: { allow: "POST" } },
  );
}
