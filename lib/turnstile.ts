import { log } from "@/lib/logger";

// ─── CLOUDFLARE TURNSTILE ─────────────────────────────────────────────────────
//
// What this is, and why the public form needs it.
//
// /api/register is gated on a shared secret, so only our WordPress server can
// call it. /api/apply is public - that is the entire point of it - which means
// anything on the internet can call it. Without a check, a script can create a
// few thousand applicants in an afternoon, and every one of them is a real row
// in the table that decides the ranking, the per-course seat counts and the
// scholarship allocation. A bot flood here does not just cost database rows, it
// quietly corrupts the one number the programme exists to produce.
//
// The rate limiter alone is not enough. It is keyed per IP, and it caps speed,
// not volume. Ten thousand requests spread over a day is well inside the limit
// and still ruins the data.
//
// Turnstile is Cloudflare's free widget. It is a checkbox that usually resolves
// itself with no interaction, ~10 lines to wire up, and the free tier is orders
// of magnitude more than one registration form will use.

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TIMEOUT_MS = 5000;

export type TurnstileResult =
  | { ok: true }
  | { ok: false; reason: "missing" | "invalid" | "unconfigured" | "unreachable" };

/**
 * Server-side verification. The token is single-use and short-lived, so this
 * must run on the server; a client-only check would be trivially bypassed by
 * posting straight to the endpoint with the field simply omitted.
 */
export async function verifyTurnstile(token: unknown, ip: string): Promise<TurnstileResult> {
  if (typeof token !== "string" || token.trim().length === 0) {
    return { ok: false, reason: "missing" };
  }

  const secret = process.env.TURNSTILE_SECRET_KEY;

  if (!secret) {
    // Unconfigured is not the same as failed, and it must not read as either.
    // Failing open in production would mean shipping a public write endpoint
    // with the protection silently absent, which is the exact failure this was
    // added to prevent. Failing closed in dev would mean nobody can test the
    // form they just built.
    if (process.env.NODE_ENV === "production") {
      log.error("turnstile.unconfigured", {
        remedy: "Set TURNSTILE_SECRET_KEY and NEXT_PUBLIC_TURNSTILE_SITE_KEY.",
      });
      return { ok: false, reason: "unconfigured" };
    }

    log.warn(
      "[turnstile] TURNSTILE_SECRET_KEY is not set - skipping verification. " +
        "The public form is unprotected on this machine. Never do this in production.",
    );
    return { ok: true };
  }

  try {
    const response = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      log.error("turnstile.verify_http_error", { status: response.status });
      return { ok: false, reason: "unreachable" };
    }

    const data = (await response.json()) as { success?: boolean; "error-codes"?: string[] };

    if (!data.success) {
      log.warn("turnstile.rejected", { codes: data["error-codes"] ?? [], ip });
      return { ok: false, reason: "invalid" };
    }

    return { ok: true };
  } catch (error) {
    // Cloudflare is unreachable. Do not fail open on the strength of a
    // third-party outage in production: that turns their downtime into an
    // open registration window.
    log.error("turnstile.verify_failed", { message: (error as Error)?.message, ip });
    return { ok: false, reason: "unreachable" };
  }
}

/** Site key for the client widget, or empty when not configured. */
export function turnstileSiteKey(): string {
  return process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
}
