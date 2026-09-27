import { NextResponse } from "next/server";
import { redis, rateLimitKey } from "@/lib/redis";
import { log, maskEmail } from "@/lib/logger";
import { cleanText } from "@/lib/validate";
import { WP_FORM_FIELDS } from "@/config/branding";
import { safeEqual } from "@/lib/session";
import { requireEnv } from "@/lib/env";
import { registerApplicant } from "@/lib/registration";

export const dynamic = "force-dynamic";

// ─── REGISTRATION (server-to-server from the CMS form) ────────────────────────
// This is not a public endpoint. The website's form posts here with a shared
// secret, and the response is consumed by the CMS, not by a person. That matters
// for every decision below.
//
// WHAT WAS WRONG
//
// 1. THE RATE LIMITER DIDN'T LIMIT.
//        const current = await redis.get(key);
//        if (current && current >= MAX) return 429;
//        await redis.incr(key);
//    A read, a branch, and a write, with awaits in between. Under concurrency
//    every request reads the same value, every one passes, and the limit is
//    whatever the traffic happened to be. It is now a single atomic INCR, and
//    the counter is keyed on the source IP *and* the shared secret, so a forged
//    x-forwarded-for doesn't buy a fresh budget and a legitimate CMS retry
//    doesn't punish the next applicant.
//
// 2. IT LOGGED THE ENTIRE PAYLOAD.
//        console.log("📥 Incoming WP Payload:", JSON.stringify(body, null, 2));
//    Name, email, phone, career status, every field, pretty-printed, on every
//    registration. That is a complete copy of the applicant list in the log
//    aggregator, created automatically. It now logs field NAMES and a masked
//    email, and nothing else.
//
// 3. selectedCourseSlug WAS NEVER VALIDATED.
//        selectedCourseSlug: cleanCourse
//    straight from the request body, where cleanCourse defaulted to the string
//    "General Admission". So the column that the course-slots endpoint GROUP BYs
//    — and that the per-course cap counts — accumulated values that were never
//    a course. A junk slug counts as a seat holder, or as a course nobody can
//    ever be admitted to, depending on the query. It is now validated against
//    the canonical list and stored as NULL when there isn't a real choice yet.
//
// 4. THE DUPLICATE-EMAIL ERROR ECHOED THE EMAIL BACK.
//        `The email "a@b.com" is already registered.`
//    plus a full dump of the Sequelize error. A duplicate is now idempotent: you
//    get the original ticket back with 200. The CMS can retry safely, the person
//    keeps the ticket they already have, and the endpoint stops being a
//    registration oracle.
//
// 5. FAILURE FELL THROUGH TO A 500 WITH NO ROLLBACK LOG.
//    Now a structured error, and the log says which field collided without
//    saying whose.

const RATE_LIMIT_WINDOW = 60;
const RATE_LIMIT_MAX = 5;

function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function POST(request: Request) {
  const route = "register";

  try {
    // ─── SHARED SECRET ───────────────────────────────────────────────────────
    // requireEnv throws when unset. The old `apiKey !== process.env.WP_TO_APP_SECRET`
    // happened to fail closed with the variable missing, but the failure mode was
    // a 401 that looks exactly like a wrong secret, and nobody could tell the
    // difference between "not configured" and "not allowed".
    const expectedSecret = requireEnv("WP_TO_APP_SECRET");
    const presented = request.headers.get("x-api-key") ?? "";
    if (!safeEqual(presented, expectedSecret)) {
      log.warn("register.unauthorized", { ip: clientIp(request) });
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    // ─── RATE LIMIT (atomic) ─────────────────────────────────────────────────
    const ip = clientIp(request);
    const limitKey = rateLimitKey("register", `${ip}:${presented.slice(0, 8)}`);

    const attempts = Number((await redis.incr(limitKey)) ?? 0);
    if (attempts === 1) await redis.expire(limitKey, RATE_LIMIT_WINDOW);

    if (attempts > RATE_LIMIT_MAX) {
      const ttl = await redis.ttl(limitKey);
      log.warn("register.rate_limited", { ip, attempts });
      return NextResponse.json(
        { success: false, message: "Too many requests. Try again shortly." },
        { status: 429, headers: { "Retry-After": String(Math.max(1, ttl)) } },
      );
    }

    // ─── PARSE ───────────────────────────────────────────────────────────────
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ message: "Invalid JSON body." }, { status: 400 });
    }

    // Field names are configuration, not code. A form's field name is an
    // implementation detail of the CMS, and hardcoding it here is how a copy of
    // someone else's brand ends up living in your repository forever.
    const pick = (...keys: string[]): string => {
      for (const key of keys) {
        const value = body[key];
        if (typeof value === "string" && value.trim().length > 0) return value;
      }
      return "";
    };

    let name = pick(...WP_FORM_FIELDS.name);
    let email = pick(...WP_FORM_FIELDS.email);
    let phone = pick(...WP_FORM_FIELDS.phone);
    const career = pick(...WP_FORM_FIELDS.career);
    const courseInterest = pick(...WP_FORM_FIELDS.course);

    // Some CMS themes submit one textarea instead of discrete fields. Dig the
    // two things we cannot do without out of it.
    const blob = body[WP_FORM_FIELDS.blob];
    if (!email && typeof blob === "string") {
      const emailMatch = blob.match(/[^\s@]+@[^\s@]+\.[^\s@]{2,}/);
      const phoneMatch = blob.match(/\+?\d[\d\s-]{7,}\d/);
      if (emailMatch) email = emailMatch[0];
      if (phoneMatch) {
        phone = phoneMatch[0];
        if (!name) name = blob.slice(0, blob.indexOf(phoneMatch[0])).trim();
      }
    }

    // ─── VALIDATE ────────────────────────────────────────────────────────────
    // The CMS occasionally forwards its own unrendered template tags, e.g.
    // "{{email}}". That is a CMS misconfiguration, not a user error, and it used
    // to be reported as "Registration failed" with the template printed in the
    // logs. Name the cause and say who has to fix it.
    const looksLikePlaceholder = (value: string) => value.includes("{{") || value.includes("}}");
    if (looksLikePlaceholder(email) || looksLikePlaceholder(name)) {
      log.error("register.cms_placeholder", { fields: Object.keys(body) });
      return NextResponse.json(
        {
          success: false,
          message: "The form sent unrendered template tags. This is a CMS configuration error.",
        },
      { status: 400 },
      );
    }

    // ─── REGISTER ─────────────────────────────────────────────────────────────
    // Validation, dedupe, row creation and the ticket email all live in
    // lib/registration.ts, shared with the public /api/apply route. This file
    // keeps only what is specific to the CMS: the shared secret, the rate-limit
    // budget, and the field names WordPress happens to use.
    const result = await registerApplicant({
      name,
      email,
      phone,
      course: courseInterest,
      career,
    });

    if (!result.ok) {
      return NextResponse.json({ message: result.message, error: result.code }, { status: result.status });
    }

    return NextResponse.json(
      { success: true, ticketId: result.ticketId, ...(result.duplicate ? { duplicate: true } : {}) },
      { status: result.duplicate ? 200 : 201 },
    );
  } catch (error) {
    const err = error as Error & { name?: string };

    if (err.name === "SequelizeUniqueConstraintError") {
      // Two requests raced past the existence check. The unique index caught it,
      // which is exactly what it is for. Return the winner's ticket.
      const conflictEmail = maskEmail(cleanText((error as { params?: { value?: unknown } })?.params?.value, 254));
      log.info("register.race_resolved", { conflictEmail });
      return NextResponse.json(
        { success: true, duplicate: true, message: "Already registered." },
        { status: 200 },
      );
    }

    log.error("register.failed", { route, name: err.name, message: err.message });
    return NextResponse.json({ message: "Registration failed. Try again shortly." }, { status: 500 });
  }
}
