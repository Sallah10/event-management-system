import { NextResponse } from "next/server";
import { Registrant } from "@/lib/models/Registrant";
import { sendEntranceTicket } from "@/lib/email-service";
import sequelize from "@/lib/db";
import { redis } from "@/lib/redis";
import { randomBytes } from "crypto";

export async function POST(request: Request) {
  try {
    const apiKey = request.headers.get("x-api-key");
    if (apiKey !== process.env.WP_TO_APP_SECRET) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    console.log("📥 Incoming WP Payload:", JSON.stringify(body, null, 2));

    // 1. Try to get data from standard keys or Forminator specific keys
    let name = body.name || body["text-1"] || body["name-1"];
    let email = body.email || body["email-1"];
    let phone = body.phone || body["phone-1"] || body["text-2"];
    let career = body.careerStatus || body.career_status || body["select-1"];

    // 2. BACKUP: If WP sends that "mashed" string block
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

    // 3. THE PLACEHOLDER GUARD
    // Check if the data is just a WordPress "Smart Tag" like {{email-1}}
    const isPlaceholder = (val: string) =>
      typeof val === "string" && val.includes("{{") && val.includes("}}");

    if (isPlaceholder(email) || isPlaceholder(name)) {
      console.error(
        "❌ WP CONFIG ERROR: Sent placeholders instead of real data",
        { name, email },
      );
      return NextResponse.json(
        {
          success: false,
          message:
            "Registration failed: WordPress sent unparsed tags. Please check Webhook Mapping.",
          received: { name, email },
        },
        { status: 400 },
      );
    }

    // 4. Basic Validation
    if (!email || !name || email.length < 5) {
      return NextResponse.json(
        {
          success: false,
          message: "Missing or invalid name/email data.",
        },
        { status: 400 },
      );
    }

    await sequelize.authenticate();

    const barcodeId = `TS26-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

    // 5. Database Operation
    const newRegistrant = await Registrant.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      phone: phone ? phone.trim() : null,
      selectedCourseSlug: body.courseInterest || "General Admission",
      careerStatus: career || "Not Specified",
      barcodeId,
      checkedIn: false,
      status: "registered",
      objectiveScore: 0,
      theoryScore: 0,
      cohortYear: 2026,
      isFlagged: false,
      deviceId: null,
    });

    // 6. Send Email (Only if valid)

    try {
      console.log(`📤 Attempting to send email to: ${newRegistrant.email}`);

      // We MUST await this so Vercel doesn't kill the function early
      const mailResult = await sendEntranceTicket({
        name: newRegistrant.name,
        email: newRegistrant.email,
        barcodeId: newRegistrant.barcodeId,
      });

      console.log("Resend Response:", JSON.stringify(mailResult));
    } catch (mailError: any) {
      // This will now catch errors like "Domain not verified" or "API Key invalid"
      console.error("Resend API Error:", mailError.message);
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

      console.error("Duplicate Entry:", message);

      return NextResponse.json(
        {
          success: false,
          message: message,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { message: "Internal Server Error", error: error.message },
      { status: 500 },
    );
  }
}
