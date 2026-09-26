import { NextResponse } from "next/server";
import { Registrant } from "@/lib/models/Registrant";
import { sendEntranceTicket } from "@/lib/email-service";
import sequelize from "@/lib/db";
import { redis } from "@/lib/redis";
import { randomBytes } from "crypto";

// ─── RATE LIMITING CONFIG ─────────────────────────────────────────────────────
const RATE_LIMIT_WINDOW = 60; // seconds
const RATE_LIMIT_MAX = 5; // max registrations per IP per minute

// ─── INPUT SANITIZER ──────────────────────────────────────────────────────────
const sanitizeString = (val: string, maxLength = 100): string =>
  val
    .trim()
    .replace(/[<>'"`;]/g, "")
    .substring(0, maxLength);

const sanitizePhone = (val: string): string =>
  val.replace(/[^0-9+\-\s]/g, "").substring(0, 20);

const isValidEmail = (email: string): boolean =>
  /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email) &&
  email.length <= 254;

export async function POST(request: Request) {
  try {
    // ─── API KEY CHECK ──────────────────────────────────────────────────────
    const apiKey = request.headers.get("x-api-key");
    if (apiKey !== process.env.WP_TO_APP_SECRET) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    // ─── RATE LIMITING ──────────────────────────────────────────────────────
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";

    const rateLimitKey = `rate_limit:register:${ip}`;
    const current = await redis.get<number>(rateLimitKey);

    if (current && current >= RATE_LIMIT_MAX) {
      const ttl = await redis.ttl(rateLimitKey);
      return NextResponse.json(
        { success: false, message: `Too many requests. Try again in ${ttl}s.` },
        { status: 429, headers: { "Retry-After": String(ttl) } },
      );
    }

    await redis.incr(rateLimitKey);
    if (!current) await redis.expire(rateLimitKey, RATE_LIMIT_WINDOW);

    // ─── PARSE BODY ─────────────────────────────────────────────────────────
    const body = await request.json();
    console.log("📥 Incoming WP Payload:", JSON.stringify(body, null, 2));

    let name = body.name || body["text-1"] || body["name-1"];
    let email = body.email || body["email-1"];
    let phone = body.phone || body["phone-1"] || body["text-2"];
    let career = body.careerStatus || body.career_status || body["select-1"];

    // Backup: parse mashed string block from WP
    if (body["techshift-event-registration"] && !email) {
      const rawData = body["techshift-event-registration"];
      const emailMatch = rawData.match(
        /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
      );
      const phoneMatch = rawData.match(/\d{11}/);
      if (emailMatch) email = emailMatch[0];
      if (phoneMatch) phone = phoneMatch[0];
      if (phoneMatch) name = rawData.split(phoneMatch[0])[0];
    }

    // ─── PLACEHOLDER GUARD ──────────────────────────────────────────────────
    const isPlaceholder = (val: string) =>
      typeof val === "string" && val.includes("{{") && val.includes("}}");

    if (isPlaceholder(email) || isPlaceholder(name)) {
      console.error("❌ WP CONFIG ERROR: Sent placeholders", { name, email });
      return NextResponse.json(
        {
          success: false,
          message: "Registration failed: WordPress sent unparsed tags.",
        },
        { status: 400 },
      );
    }

    // ─── VALIDATION ─────────────────────────────────────────────────────────
    if (!name || !email) {
      return NextResponse.json(
        { success: false, message: "Missing name or email." },
        { status: 400 },
      );
    }

    if (!isValidEmail(email)) {
      return NextResponse.json(
        { success: false, message: "Invalid email address." },
        { status: 400 },
      );
    }

    // ─── SANITIZE ───────────────────────────────────────────────────────────
    const cleanName = sanitizeString(name, 100);
    const cleanEmail = email.toLowerCase().trim();
    const cleanPhone = phone ? sanitizePhone(phone) : null;
    const cleanCareer = career ? sanitizeString(career, 50) : "Not Specified";
    const cleanCourse = body.courseInterest
      ? sanitizeString(body.courseInterest, 100)
      : "General Admission";

    // ─── BARCODE — crypto instead of Math.random ─────────────────────────────
    // Math.random() is not cryptographically secure
    // randomBytes(4) = 4 bytes = 8 hex chars = 4.2 billion combinations
    const barcodeId = `TS26-${randomBytes(4).toString("hex").toUpperCase()}`;

    // ─── DB OPERATION ───────────────────────────────────────────────────────
    // Removed sequelize.authenticate() — wasted TCP roundtrip per request
    const newRegistrant = await Registrant.create({
      name: cleanName,
      email: cleanEmail,
      phone: cleanPhone,
      selectedCourseSlug: cleanCourse,
      careerStatus: cleanCareer,
      barcodeId,
      checkedIn: false,
      status: "registered",
      objectiveScore: 0,
      theoryScore: 0,
      cohortYear: 2026,
      isFlagged: false,
      deviceId: null,
    });

    // ─── SEND EMAIL ─────────────────────────────────────────────────────────
    try {
      console.log(`📤 Attempting to send email to: ${newRegistrant.email}`);
      const mailResult = await sendEntranceTicket({
        name: newRegistrant.name,
        email: newRegistrant.email,
        barcodeId: newRegistrant.barcodeId,
      });
      console.log("Resend Response:", JSON.stringify(mailResult));
    } catch (mailError: any) {
      console.error("Resend API Error:", mailError.message);
      // Don't fail the registration if email fails — just log it
    }

    return NextResponse.json(
      {
        success: true,
        ticketId: newRegistrant.barcodeId,
        message: "Registration successful.",
      },
      { status: 201 },
    );
  } catch (error: any) {
    console.error("❌ REGISTRATION FAILURE:", error.name, error.message);

    if (error.name === "SequelizeUniqueConstraintError") {
      const field = Object.keys(error.fields)[0];
      const message = `The ${field} "${error.fields[field]}" is already registered.`;
      return NextResponse.json({ success: false, message }, { status: 400 });
    }

    // FIX: Never expose error.message to client in production
    return NextResponse.json(
      { message: "Internal Server Error" },
      { status: 500 },
    );
  }
}
