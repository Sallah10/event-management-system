import { Resend } from "resend";
import QRCode from "qrcode";
import { BRAND, PALETTE } from "@/config/branding";
import { escapeHtml } from "@/lib/validate";
import { log } from "@/lib/logger";
import {
  TOTAL_SLOTS,
  QUALIFIED_POOL_SIZE,
  VENUE_CAPACITY,
  LIMIT_PER_COURSE,
} from "@/config/rules";
import { COURSES } from "@/config/course-matrix";

export interface TicketRecipient {
  name: string;
  email: string;
  /** Must be the canonical ticket. There is no fallback - see FIX 2. */
  barcodeId: string;
}

let resend: Resend | null = null;
function mailer(): Resend {
  if (!resend) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY is not set");
    resend = new Resend(key);
  }
  return resend;
}

type MailProvider = "resend" | "brevo";

function resolveProvider(): MailProvider {
  const explicit = process.env.MAIL_PROVIDER?.trim().toLowerCase();
  if (explicit === "resend" || explicit === "brevo") return explicit;
  if (process.env.BREVO_API_KEY) return "brevo";
  return "resend";
}

interface RenderedMail {
  subject: string;
  html: string;
  qr: Buffer;
  ticket: string;
  to: string;
}

async function sendViaBrevo(m: RenderedMail) {
  const key = process.env.BREVO_API_KEY;
  if (!key) throw new Error("BREVO_API_KEY is not set");
  const fromEmail =
    process.env.BREVO_FROM_EMAIL ??
    process.env.EVENT_CONTACT_EMAIL ??
    BRAND.contactEmail;
  const fromName = process.env.BREVO_FROM_NAME ?? BRAND.name;
  const qrBase64 = m.qr.toString("base64");

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": key,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender: { name: fromName, email: fromEmail },
      to: [{ email: m.to }],
      subject: m.subject,
      htmlContent: m.html,
      inlineAttachments: [{ name: "ticket-qr", content: qrBase64 }],
      attachment: [
        { name: "ticket-qr.png", content: qrBase64 },
        { name: `entrance-pass-${m.ticket}.png`, content: qrBase64 },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Brevo rejected the message (${response.status}): ${detail.slice(0, 300)}`,
    );
  }
  return { id: response.headers.get("x-message-id") ?? undefined };
}

async function sendViaResend(m: RenderedMail) {
  const from = process.env.MAIL_FROM ?? `${BRAND.name} <${BRAND.contactEmail}>`;
  const { data, error } = await mailer().emails.send({
    from,
    to: m.to,
    subject: m.subject,
    html: m.html,
    attachments: [
      { filename: "ticket-qr.png", content: m.qr, contentId: "ticket-qr" },
      { filename: `entrance-pass-${m.ticket}.png`, content: m.qr },
    ],
  });
  if (error) throw new Error(error.message);
  return data;
}

// ─── ENTRANCE TICKET EMAIL ────────────────────────────────────────────────────
// Sent once, at registration. It is the only thing standing between a person and
// a QR code they need at the door, so it is worth being careful with in three
// specific ways.
//
// WHAT WAS ACTUALLY BROKEN HERE
//
// 1. THE SUBJECT LINE WAS MOJIBAKE.
//        subject: "Hi " + first + ", You're In! dYZYï¿½,?"
//    A mis-decoded em-dash and a stray comma. This is the first thing every
//    applicant saw, in their inbox, next to their name. The body had the same
//    corruption twice more: "Youï¿½?Tre In!" and "ï¿½,ï¿½505 Million". The file had
//    been saved with the wrong encoding and nobody re-opened it. Nothing detects
//    this: a mojibake subject still sends, still delivers, still passes every
//    test that only checks for a 2xx.
//
// 2. THE FALLBACK TICKET WAS COMPUTED AND THEN IGNORED.
//        const barcodeId = registrant.barcodeId || `TS26-${Math.floor(Math.random() * 100000)}`;
//        ...
//        <div>${registrant.barcodeId}</div>          // â† prints the ORIGINAL
//        QRCode.toBuffer(barcodeId)                  // â† encodes the FALLBACK
//    A registrant with no stored code got an email showing an EMPTY box and a QR
//    containing a random number that appears nowhere in the email. They cannot
//    check in with it and they cannot read it. The QR and the printed code have
//    to be the same value, so the value is resolved once, up front.
//
// 3. Math.random() FOR TICKET CODES.
//    100,000 values from a PRNG that is not designed to be unguessable, on a
//    code that gates a physical venue. `randomBytes(4)` gives 2^32 and is
//    designed for this. The real code is minted in the register route, which
//    already does it correctly - so this fallback no longer needs to exist at
//    all, and a function that invents its own identifiers is a bug waiting.
//
// Also: `registrant: any` (the values are interpolated straight into an HTML
// email, so they are escaped now), a Resend client constructed at module scope
// with a possibly-undefined key, and the entire organisation's name, venue and
// scholarship figure hardcoded into the markup.

function firstName(fullName: string): string {
  const trimmed = fullName.trim();
  const space = trimmed.indexOf(" ");
  return escapeHtml(space === -1 ? trimmed : trimmed.slice(0, space));
}

export async function sendEntranceTicket(registrant: TicketRecipient) {
  const ticket = registrant.barcodeId.trim();
  if (!ticket) {
    // Better a loud failure the caller logs than a QR code encoding "undefined".
    throw new Error("sendEntranceTicket called without a barcodeId");
  }

  const qrBuffer = await QRCode.toBuffer(ticket, {
    color: { dark: PALETTE.ink, light: PALETTE.paper },
    width: 400,
    margin: 2,
    errorCorrectionLevel: "M",
  });

  const subject = `You're in - your ${BRAND.shortName} ticket`;

  const rendered: RenderedMail = {
    subject,
    to: registrant.email,
    qr: qrBuffer,
    ticket,
    html: renderTicketHtml({
      name: firstName(registrant.name),
      ticket,
      totalSeats: TOTAL_SLOTS,
      poolSize: QUALIFIED_POOL_SIZE,
      venueCapacity: VENUE_CAPACITY,
      perTrack: LIMIT_PER_COURSE,
      trackCount: COURSES.length,
    }),
  };

  const provider = resolveProvider();
  const result =
    provider === "brevo"
      ? await sendViaBrevo(rendered)
      : await sendViaResend(rendered);

  log.info("email.ticket_sent", {
    provider,
    subject,
    to: registrant.email,
    id: result?.id,
  });
  return result;
}

// ─── TEMPLATE ─────────────────────────────────────────────────────────────────
// Inline styles and a table-free layout, because this renders in Outlook and
// every CSS feature worth using is unsupported there. Not pretty, and that is the
// correct trade for a message that has to arrive.

interface TicketTemplate {
  name: string;
  ticket: string;
  totalSeats: number;
  poolSize: number;
  venueCapacity: number;
  perTrack: number;
  trackCount: number;
}

function renderTicketHtml(t: TicketTemplate): string {
  const when = BRAND.date
    ? `<strong>${escapeHtml(BRAND.date)}</strong>`
    : "the event day";
  const where = BRAND.venue
    ? `${escapeHtml(BRAND.venue)}${BRAND.address ? `, ${escapeHtml(BRAND.address)}` : ""}`
    : "the venue";

  return `<!doctype html>
<html lang="en">
<body style="margin:0;padding:0;background:#f5f5f4;">
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;background:${PALETTE.paper};color:${PALETTE.ink};line-height:1.6;">

    <div style="background:${PALETTE.ink};color:${PALETTE.paper};padding:32px 24px;">
      <p style="margin:0 0 6px;font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:.7;">Entrance ticket</p>
      <h1 style="margin:0;font-size:24px;letter-spacing:-.02em;">${escapeHtml(BRAND.name)}</h1>
    </div>

    <div style="padding:32px 24px;">
      <h2 style="margin:0 0 12px;font-size:20px;letter-spacing:-.01em;">You're in, ${t.name}.</h2>

      <p style="margin:0 0 20px;">
        Your place is reserved. Bring this ticket with you to ${where} on ${when}.
      </p>

      <div style="background:${PALETTE.accentSoft};border:1px dashed ${PALETTE.accent};border-radius:12px;padding:28px 20px;text-align:center;margin:0 0 24px;">
        <p style="margin:0 0 16px;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:${PALETTE.muted};">Your entrance code</p>
        <img src="cid:ticket-qr" width="180" height="180" alt="Your entrance QR code" style="display:block;margin:0 auto 16px;border:0;" />
        <p style="margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:20px;font-weight:700;letter-spacing:.04em;color:${PALETTE.ink};">${escapeHtml(t.ticket)}</p>
        <p style="margin:14px 0 0;font-size:12px;color:${PALETTE.muted};">Show this code at the door. One scan per person.</p>
      </div>

      <h3 style="margin:0 0 8px;font-size:15px;">What happens next</h3>
      <ol style="margin:0 0 24px;padding-left:20px;">
        <li style="margin-bottom:6px;">Check in at the venue with the code above.</li>
        <li style="margin-bottom:6px;">Sit the assessment on the day.</li>
        <li>${escapeHtml(String(t.totalSeats))} scholarships are available across ${escapeHtml(String(t.trackCount))} tracks, capped at ${escapeHtml(String(t.perTrack))} per track.</li>
      </ol>

      <div style="background:#fafaf9;border-left:3px solid ${PALETTE.accent};padding:14px 16px;margin:0 0 24px;font-size:14px;">
        Attendance is required to sit the assessment. Seats are confirmed in the order candidates finish, and the top ${escapeHtml(String(t.poolSize))} of the objective section proceed to the written part.
      </div>

      <p style="margin:0 0 24px;font-size:14px;color:${PALETTE.muted};">
        Need to change something? Reply to this email or write to
        <a href="mailto:${escapeHtml(BRAND.contactEmail)}" style="color:${PALETTE.accent};">${escapeHtml(BRAND.contactEmail)}</a>.
      </p>

      <hr style="border:0;border-top:1px solid ${PALETTE.line};margin:0 0 20px;" />
      <p style="margin:0;font-size:12px;color:${PALETTE.muted};text-align:center;">
        ${escapeHtml(BRAND.organisation)}<br />
        <span style="opacity:.8;">${escapeHtml(BRAND.tagline)}</span>
      </p>
    </div>
  </div>
</body>
</html>`;
}
