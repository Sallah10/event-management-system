import { randomBytes } from "node:crypto";
import { Registrant } from "@/lib/models/Registrant";
import { sendEntranceTicket } from "@/lib/email-service";
import { ensureDatabase } from "@/lib/db";
import { log } from "@/lib/logger";
import { cleanText, cleanPhone, isValidEmail } from "@/lib/validate";
import { isValidCourseSlug } from "@/config/rules";
import { CURRENT_COHORT } from "@/config/branding";

// ─── REGISTRATION CORE ────────────────────────────────────────────────────────
//
// Two front doors, one implementation.
//
//   app/api/register  <- the WordPress form, gated on a shared secret
//   app/api/apply     <- the in-app form, gated on Turnstile
//
// Both call `registerApplicant` below. That is the entire point of this file.
// When all of this lived inside the WordPress route, adding a second way in
// meant either duplicating 200 lines of validation, rate limiting and PII-safe
// logging - and the two copies would drift, and the bug fixed in one would stay
// live in the other - or reworking the CMS route and breaking a site that is
// already in production.
//
// So the split is deliberately at the boundary where the two genuinely differ.
// What stays in the routes: how you prove who you are (shared secret vs
// captcha), your field names (WP_FORM_FIELDS vs ours), and your rate-limit
// budget. What lives here: everything to do with what happens to a person.

export interface RegistrationInput {
  name: unknown;
  email: unknown;
  phone: unknown;
  course: unknown;
  career: unknown;
}

export type RegistrationFailure = {
  ok: false;
  status: number;
  code: string;
  message: string;
  /** Set when one field is at fault, so the form can highlight it. */
  field?: "name" | "email" | "course";
};

export type RegistrationSuccess = {
  ok: true;
  ticketId: string;
  /** True when this email already had a ticket and we returned it unchanged. */
  duplicate: boolean;
  /** True when a row was written now. Lets the caller phrase the confirmation. */
  created: boolean;
  /**
   * Whether the confirmation email actually went out. False when the provider is
   * unconfigured or down, which the in-app form uses to stop telling someone to
   * check an inbox that will never receive anything.
   */
  emailed: boolean;
};

export type RegistrationResult = RegistrationSuccess | RegistrationFailure;

/** 4 random bytes = 2^32 codes, with a unique index behind them. */
function mintTicket(): string {
  return `TS26-${randomBytes(4).toString("hex").toUpperCase()}`;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Register one applicant, idempotently.
 *
 * Never throws for an input problem - a bad email is a `RegistrationFailure`,
 * not an exception, so neither route has to guess which errors are the
 * caller's fault and which are ours.
 */
export async function registerApplicant(input: RegistrationInput): Promise<RegistrationResult> {
  const name = cleanText(asString(input.name), 100);
  const email = cleanText(asString(input.email), 254).toLowerCase();

  if (!name) {
    return { ok: false, status: 400, code: "MISSING_NAME", message: "Please enter your name.", field: "name" };
  }
  if (!email) {
    return { ok: false, status: 400, code: "MISSING_EMAIL", message: "Please enter your email address.", field: "email" };
  }
  if (!isValidEmail(email)) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_EMAIL",
      message: "That email address doesn't look right. Check it and try again.",
      field: "email",
    };
  }

  // Validated, or null. "General Admission" is not a course and must never
  // reach a column that counts seats.
  const courseSlug = isValidCourseSlug(input.course) ? input.course : null;

  if (input.course && !courseSlug) {
    return {
      ok: false,
      status: 400,
      code: "UNKNOWN_COURSE",
      message: "Pick a programme from the list.",
      field: "course",
    };
  }

  const ticketId = mintTicket();

  try {
    await ensureDatabase();
  } catch (error) {
    log.error("register.db_unavailable", { message: (error as Error)?.message });
    return {
      ok: false,
      status: 503,
      code: "UNAVAILABLE",
      message: "We couldn't reach the register just now. Please try again in a moment.",
    };
  }

  // Idempotent, and the duplicate is resolved BEFORE the ticket is minted, so
  // a retry can never burn a code. The person keeps the ticket they already
  // have, and this stops the endpoint being a registration oracle.
  const existing = await Registrant.findOne({ where: { email } });
  if (existing) {
    log.info("register.duplicate", { email, barcodeId: existing.barcodeId });
    return {
      ok: true,
      ticketId: existing.barcodeId,
      duplicate: true,
      created: false,
      emailed: false,
    };
  }

  const registrant = await Registrant.create({
    name,
    email,
    phone: cleanPhone(asString(input.phone)),
    selectedCourseSlug: courseSlug,
    careerStatus: input.career ? cleanText(asString(input.career), 50) : null,
    barcodeId: ticketId,
    checkedIn: false,
    status: "registered",
    cohortYear: CURRENT_COHORT,
  });

  // ─── TICKET EMAIL ────────────────────────────────────────────────────────────
  // Best-effort, and that is a real trade-off worth naming: if Resend is down
  // the person is registered and has no ticket, and the fix is a resend from the
  // admin console. Failing the whole request instead would lose the
  // registration too, which is worse - and for the CMS it would fail the form,
  // which would then retry, creating a second applicant.
  //
  // This is also why the in-app form shows the ticket on screen. The core
  // journey must not depend on a third-party mail provider being reachable, so
  // the caller is told the truth either way and can warn the person to save it.
  let emailed = false;
  try {
    const result = await sendEntranceTicket({
      name: registrant.name,
      email: registrant.email,
      barcodeId: registrant.barcodeId,
    });
    emailed = true;
    log.info("register.ticket_sent", { email, id: result?.id });
  } catch (mailError) {
    log.error("register.ticket_failed", {
      email,
      barcodeId: registrant.barcodeId,
      message: (mailError as Error)?.message,
      remedy: "Registration is saved. Resend the ticket from the admin console.",
    });
  }

  log.info("register.created", { email, barcodeId: registrant.barcodeId, course: courseSlug });

  return { ok: true, ticketId: registrant.barcodeId, duplicate: false, created: true, emailed };
}
