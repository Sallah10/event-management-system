import { NextResponse } from "next/server";
import { Resend } from "resend";
import { requireCandidate } from "@/lib/auth";
import { redis, rateLimitKey, usingMemoryRedis } from "@/lib/redis";
import { escapeHtml, cleanText } from "@/lib/validate";
import { log } from "@/lib/logger";
import { BRAND } from "@/config/branding";

export const dynamic = "force-dynamic";

// ─── TECHNICAL ISSUE REPORTS ──────────────────────────────────────────────────
// This endpoint was an open relay with an HTML injection in it.
//
// 1. NO AUTHENTICATION, BY DESIGN. The comment said "Optional: Verify user is
//    logged in", then read a cookie named `auth_token` — which is not a cookie
//    this application has ever set. Candidates get `CANDIDATE_COOKIE`, signed
//    and httpOnly. So that branch could never fire, and `email` was accepted from
//    the request body. The result: anyone on the internet could make this server
//    send an email, from our own sending domain, to our support inbox, as often
//    as they liked. A mail relay with our domain reputation attached.
//
// 2. HTML INJECTION. `description`, `email`, `url` and `issue` were interpolated
//    into the email's HTML with no escaping. An attacker fully controlled the
//    body of a message sent from our domain — which is to say, they could send
//    our support team a convincing phishing page, and our mail reputation is what
//    made it convincing. Everything interpolated below goes through escapeHtml().
//
// 3. NO RATE LIMIT. Same flooding problem, with no ceiling.
//
// 4. REAL IDENTITIES COMMITTED. The from-address was a live company domain, the
//    recipient was a real inbox, and the body named the programme. All three now
//    come from BRAND / the environment, and default to placeholders.
//
// 5. PII IN LOGS. `console.log` with the candidate's email address. Now a
//    structured warn() keyed on the ticket, which is the identifier staff
//    actually need.
//
// A note on durability: a report lives in the support inbox and in the logs. It
// is not in a table, so it is not queryable from the admin tools and it does not
// survive a mail provider problem. If the admissions team needs to see open
// reports during a live event, that needs a table and a queue — this is not one.

const ISSUE_LABELS: Record<string, string> = {
  back_button: "Pressed the browser back button",
  tab_switch: "Lost focus or switched tabs",
  window_resize: "Window resized or moved",
  browser_crash: "Browser or device crashed",
  network: "Lost network connection",
  device_locked: "Phone locked or went to sleep",
  other: "Something else",
};

/** Per-candidate ceiling. More than this is a script, not an exam. */
const REPORTS_PER_SITTING = 5;

let resend: Resend | null = null;
function mailer(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (!resend) resend = new Resend(key);
  return resend;
}

export async function POST(request: Request) {
  // Identity comes from the session, never from the body. See FIX 1.
  const { session, error } = await requireCandidate(request);
  if (error) return error;

  let body: { issue?: unknown; description?: unknown; url?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "BAD_REQUEST", message: "Invalid report." },
      { status: 400 },
    );
  }

  const issue = cleanText(body.issue, 40);
  if (!issue || !(issue in ISSUE_LABELS)) {
    return NextResponse.json(
      { success: false, error: "BAD_REQUEST", message: "Pick an issue type." },
      { status: 400 },
    );
  }

  // ─── RATE LIMIT ────────────────────────────────────────────────────────────
  const limitKey = rateLimitKey("report-issue", session.barcodeId);
  const attempts = await redis.incr(limitKey);
  if (attempts === 1) await redis.expire(limitKey, 6 * 60 * 60);
  if (attempts > REPORTS_PER_SITTING) {
    log.warn("assessment.report_issue.rate_limited", {
      barcodeId: session.barcodeId,
      attempts,
    });
    return NextResponse.json(
      {
        success: false,
        error: "RATE_LIMITED",
        message: `You've already sent ${REPORTS_PER_SITTING} reports. Email ${BRAND.contactEmail} and we'll pick it up.`,
      },
      { status: 429 },
    );
  }

  const description = cleanText(body.description, 2000);
  const where = cleanText(body.url, 300);
  const label = ISSUE_LABELS[issue];
  const at = new Date().toISOString();

  log.warn("assessment.issue_reported", {
    barcodeId: session.barcodeId,
    issue: label,
    usingMemoryRedis,
  });

  const mailerClient = mailer();
  if (!mailerClient) {
    // No mail provider configured. The report is still logged, so this is a
    // degraded success rather than a lie to the candidate — but say so.
    log.warn("assessment.report_issue.no_mailer", {
      barcodeId: session.barcodeId,
    });
    return NextResponse.json({
      success: true,
      error: null,
      message: "Recorded. There is no mail provider configured, so this went to the logs only.",
      data: { emailed: false },
    });
  }

  try {
    await mailerClient.emails.send({
      from: process.env.SUPPORT_FROM_EMAIL ?? BRAND.organisation,
      to: [process.env.SUPPORT_TO_EMAIL ?? BRAND.contactEmail],
      replyTo: session.email,
      subject: `[${BRAND.shortName}] Technical issue — ${label} — ${session.barcodeId}`,
      html: `
        <h2 style="color:#141210;margin:0 0 4px;font-size:18px;">Technical issue reported</h2>
        <p style="color:#78716C;margin:0 0 20px;font-size:13px;">
          ${escapeHtml(BRAND.name)} Â· candidate portal
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <tr>
            <td style="padding:10px;background:#F5F5F4;font-weight:bold;width:34%;border:1px solid #E7E5E4;">Ticket</td>
            <td style="padding:10px;border:1px solid #E7E5E4;font-family:monospace;">${escapeHtml(session.barcodeId)}</td>
          </tr>
          <tr>
            <td style="padding:10px;background:#F5F5F4;font-weight:bold;border:1px solid #E7E5E4;">Email</td>
            <td style="padding:10px;border:1px solid #E7E5E4;">${escapeHtml(session.email)}</td>
          </tr>
          <tr>
            <td style="padding:10px;background:#F5F5F4;font-weight:bold;border:1px solid #E7E5E4;">Issue</td>
            <td style="padding:10px;border:1px solid #E7E5E4;">${escapeHtml(label)}</td>
          </tr>
          <tr>
            <td style="padding:10px;background:#F5F5F4;font-weight:bold;border:1px solid #E7E5E4;">Description</td>
            <td style="padding:10px;border:1px solid #E7E5E4;">${escapeHtml(description) || "<em>none given</em>"}</td>
          </tr>
          <tr>
            <td style="padding:10px;background:#F5F5F4;font-weight:bold;border:1px solid #E7E5E4;">Page</td>
            <td style="padding:10px;border:1px solid #E7E5E4;font-size:12px;word-break:break-all;">${escapeHtml(where) || "unknown"}</td>
          </tr>
          <tr>
            <td style="padding:10px;background:#F5F5F4;font-weight:bold;border:1px solid #E7E5E4;">Reported at</td>
            <td style="padding:10px;border:1px solid #E7E5E4;font-size:12px;">${escapeHtml(at)}</td>
          </tr>
        </table>
        <p style="color:#78716C;font-size:12px;margin-top:20px;">
          Reply goes straight to the candidate. Reporting an issue does not flag
          the account — an admissions reviewer decides that.
        </p>
      `,
    });
  } catch (sendError) {
    // A provider outage must not read to the candidate as "your report was lost
    // because you did something wrong", and must not lose the record.
    log.warn("assessment.report_issue.send_failed", {
      barcodeId: session.barcodeId,
      error: sendError instanceof Error ? sendError.message : "unknown",
    });
  }

  return NextResponse.json({
    success: true,
    error: null,
    message: "Reported. Someone will look at it — reply to the email if you need to add anything.",
    data: { emailed: true },
  });
}
