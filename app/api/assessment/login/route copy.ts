import { NextResponse } from "next/server";
import { Registrant } from "@/lib/models/Registrant";
import { headers } from "next/headers";
import sequelize from "@/lib/db";

export async function POST(request: Request) {
  try {
    // 1. Ensure DB connection is alive
    await sequelize.authenticate();

    const { email, ticketId } = await request.json();

    //  use the User-Agent as a fingerprint for "Device"
    const headerList = await headers();
    const userAgent = headerList.get("user-agent") || "unknown-device";

    const student = await Registrant.findOne({
      where: {
        email: email.toLowerCase().trim(),
        barcodeId: ticketId.toUpperCase().trim(),
      },
    });

    const checkAnyMatch = await Registrant.findOne({
      where: { barcodeId: ticketId.toUpperCase().trim() },
    });
    if (checkAnyMatch) {
      console.log(
        `🔍 TICKET FOUND! But email mismatch. Typed: [${email.toLowerCase()}] | DB has: [${checkAnyMatch.email}]`,
      );
    } else {
      console.log(`🔍 TICKET NOT FOUND AT ALL in DB for ID: [${ticketId}]`);
    }

    if (!student) {
      return NextResponse.json(
        {
          success: false,
          message:
            "INVALID_CREDENTIALS: Email or Ticket ID does not match our records.",
        },
        { status: 401 },
      );
    }

    // 1. Physical Check-in Gate

    if (!student.checkedIn) {
      return NextResponse.json(
        {
          success: false,
          message:
            "ACCESS DENIED: You must be physically checked in at the venue to access the portal.",
        },
        { status: 403 },
      );
    }

    if (student.status === "awarded" || student.status === "shortlisted") {
      return NextResponse.json(
        {
          success: false,
          message:
            "ASSESSMENT COMPLETE: You have already submitted your final application.",
        },
        { status: 403 },
      );
    }

    // 2. DEVICE LOCK LOGIC
    const existingDevice = student.deviceId;

    if (existingDevice && existingDevice !== userAgent) {
      console.error(
        `🚨 ACCESS BLOCKED: Ticket ${ticketId} tried to login from a second device.`,
      );
      return NextResponse.json(
        {
          success: false,
          message:
            "DEVICE_LOCKED: This ticket is already active on another device. Multiple logins are prohibited, Please use the original devices.",
        },
        { status: 401 },
      );
    }

    // Lock it to this device if it's the first time
    if (!existingDevice) {
      await student.update({ deviceId: userAgent });
      console.log(`🔒 Device Locked for ${email}: ${userAgent}`);
    }

    return NextResponse.json({
      success: true,
      deviceId: student.deviceId,
      message: "Login successful",
    });
  } catch (error: any) {
    console.error("CRITICAL LOGIN ERROR:", error.message);

    return NextResponse.json(
      {
        success: false,
        message: "Internal Server Error",
        debug: error.message,
      },
      { status: 500 },
    );
  }
}
