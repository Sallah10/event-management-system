import { NextResponse } from "next/server";
import { Registrant } from "@/lib/models/Registrant";
import { ensureDatabase } from "@/lib/db";
import { setCandidateCookie, hashDeviceKey, readDeviceKey, routeError } from "@/lib/auth";
import { isValidEmail } from "@/lib/validate";
import { log } from "@/lib/logger";
import { normaliseTicket } from "@/lib/tickets";

export const dynamic = "force-dynamic";

// ─── CANDIDATE LOGIN ──────────────────────────────────────────────────────────
// Unchanged in shape: ticket + email must both match, the candidate must be
// physically checked in, and the session is bound to a device key.
//
// Two things are genuinely different now:
//
// 1. DEVICE BINDING USED TO BE A HEADER HASH CALLED "FINGERPRINTING".
//    It hashed (User-Agent | Accept | Accept-Language | x-forwarded-for). Every
//    one of those is attacker-controlled, and because the IP was in the hash, a
//    candidate switching from venue Wi-Fi to mobile data was rejected as "a
//    second device" and locked out of their own exam. Now the browser holds a
//    random key and we store sha256(key + server pepper). See lib/session.ts for
//    an honest description of what this does and does not buy you.
//
// 2. LOGS NO LONGER CONTAIN PII.
//    This route used to console.log the submitted email, the ticket, 50 of the 64
//    fingerprint characters, AND — on a near-miss — the *stored* email for the
//    ticket that was submitted, which is a registration-enumeration oracle sitting
//    in your log aggregator. All of it now goes through the redacting logger.
//
// The old code also called `sequelize.authenticate()` at the top of every login
// to "test the connection" — a wasted TCP round-trip per candidate, on the one
// route that 3,500 people hit at once. `ensureDatabase()` caches the warmup.

export async function POST(request: Request) {
  const route = "assessment.login";

  try {
    await ensureDatabase();

    let body: { email?: unknown; ticketId?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "BAD_REQUEST", message: "Invalid request." },
        { status: 400 },
      );
    }

    const email = typeof body.email === "string" ? body.email.toLowerCase().trim() : "";
    const ticket = normaliseTicket(body.ticketId);

    // One generic failure for every credential problem. The original returned
    // "Ticket ID not found" vs "Email does not match this Ticket ID", which
    // confirms whether a given ticket exists — enough to enumerate who is
    // registered.
    const INVALID = NextResponse.json(
      {
        success: false,
        error: "INVALID_CREDENTIALS",
        message: "That email and ticket ID don't match our records. Check both and try again.",
      },
      { status: 401 },
    );

    if (!isValidEmail(email) || !ticket.ok) {
      log.info("assessment.login.rejected", { reason: "malformed" });
      return INVALID;
    }

    const student = await Registrant.findOne({
      where: { barcodeId: ticket.value },
    });

    if (!student || student.email !== email) {
      log.info("assessment.login.rejected", { reason: "no_match" });
      return INVALID;
    }

    // ─── STAGE GATES ─────────────────────────────────────────────────────────
    // "qualified" is checked FIRST because it is the one status in this set that
    // still has work attached to it — they have earned a place on the theory
    // paper. Getting the order wrong here is how a qualified candidate is told
    // they've already finished.
    //
    // The first version of this gate was:
    //     if (["completed","awarded","shortlisted"].includes(status)) {
    //       message: status === "qualified" ? "already through" : "already done"
    //     }
    // "qualified" is not in that array, so the ternary could only ever take its
    // false branch. Dead code that read as if it handled the important case.
    if (student.status === "qualified") {
      return NextResponse.json(
        {
          success: false,
          error: "THEORY_READY",
          message: "You're through to the theory section. Pick it up where you left off.",
          redirect: "/assessment/theory",
        },
        { status: 403 },
      );
    }

    if (["completed", "shortlisted", "awarded"].includes(student.status)) {
      return NextResponse.json(
        {
          success: false,
          error: "ALREADY_COMPLETED",
          message:
            student.status === "completed"
              ? "Your theory section is already submitted and is with our admissions team."
              : "You've already been through the assessment.",
          redirect: "/assessment/thank-you",
        },
        { status: 403 },
      );
    }

    // Waitlisted and eliminated are terminal for this cohort, but the candidate
    // is not a winner and has no more pages to sit. Say which, plainly.
    if (student.status === "waitlisted" || student.status === "eliminated") {
      log.info("assessment.login.rejected", {
        barcodeId: student.barcodeId,
        reason: "finished_not_qualified",
      });
      return NextResponse.json(
        {
          success: false,
          error: "NOT_QUALIFIED",
          message:
            student.status === "waitlisted"
              ? "You met the pass mark, but the qualified pool filled before your submission came in. Your score is recorded and we'd like you to apply again next cohort."
              : "You didn't reach the pass mark for this cohort. Your score is recorded if you'd like feedback.",
          redirect: "/assessment/thank-you",
        },
        { status: 403 },
      );
    }

    if (!student.checkedIn) {
      log.info("assessment.login.rejected", { barcodeId: student.barcodeId, reason: "not_checked_in" });
      return NextResponse.json(
        {
          success: false,
          error: "NOT_CHECKED_IN",
          message: "You need to be checked in at the venue before you can sit the assessment.",
        },
        { status: 403 },
      );
    }

    if (student.isFlagged) {
      return NextResponse.json(
        {
          success: false,
          error: "SUSPENDED",
          message: "This account is suspended. Please speak to an invigilator.",
        },
        { status: 403 },
      );
    }

    // ─── DEVICE BINDING ──────────────────────────────────────────────────────
    const rawDeviceKey = readDeviceKey(request);
    if (!rawDeviceKey) {
      return NextResponse.json(
        {
          success: false,
          error: "NO_DEVICE_KEY",
          message: "Your browser blocked a required request. Enable cookies and reload.",
        },
        { status: 400 },
      );
    }

    const deviceKey = await hashDeviceKey(rawDeviceKey);

    if (student.deviceId && student.deviceId !== deviceKey) {
      log.warn("assessment.login.device_conflict", { barcodeId: student.barcodeId });
      return NextResponse.json(
        {
          success: false,
          error: "DEVICE_IN_USE",
          message:
            "This ticket is already active in another browser. Close it there, or ask an invigilator to reset your session.",
        },
        { status: 409 },
      );
    }

    if (!student.deviceId) {
      await student.update({ deviceId: deviceKey });
    }

    await setCandidateCookie({
      email: student.email,
      barcodeId: student.barcodeId,
      deviceKey,
      status: student.status,
    });

    log.info("assessment.login.success", { barcodeId: student.barcodeId, status: student.status });

    return NextResponse.json({
      success: true,
      error: null,
      message: "Signed in.",
      data: {
        status: student.status,
        name: student.name,
        // Where to send them. Server decides, client obeys.
        // Unconditional, and that is now provable rather than hopeful: the
        // "qualified" case returned 30 lines above, so TypeScript narrows the
        // type and would reject a redundant check here. It rejected one once
        // already — a leftover ternary that could only ever be false.
        next: "/assessment/exam",
      },
    });
  } catch (error) {
    return routeError(route, error, 500, "Sign-in failed. Please try again.");
  }
}
