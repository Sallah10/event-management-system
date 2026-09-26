import { NextResponse } from "next/server";
import { Registrant } from "@/lib/models/Registrant";
import { generateToken, setAuthCookie, getDeviceFingerprint } from "@/lib/auth";
import sequelize from "@/lib/db";

export async function POST(request: Request) {
  try {
    console.log("🔐 Login attempt started");

    // Test database connection first
    try {
      await sequelize.authenticate();
      console.log("✅ Database connected");
    } catch (dbError) {
      console.error("❌ Database connection failed:", dbError);
      return NextResponse.json(
        {
          success: false,
          message: "Service temporarily unavailable",
        },
        { status: 503 },
      );
    }

    const { email, ticketId } = await request.json();
    console.log(`📧 Email: ${email}, 🎫 Ticket: ${ticketId}`);

    const deviceFingerprint = getDeviceFingerprint(request as any);
    console.log(
      `🖥️ Device fingerprint: ${deviceFingerprint.substring(0, 50)}...`,
    );

    // First check if ticket exists with any email
    const ticketOnly = await Registrant.findOne({
      where: { barcodeId: ticketId.toUpperCase().trim() },
    });

    if (!ticketOnly) {
      console.log(`❌ No ticket found with ID: ${ticketId}`);
      return NextResponse.json(
        {
          success: false,
          message: "INVALID_CREDENTIALS: Ticket ID not found.",
        },
        { status: 401 },
      );
    }

    console.log(
      `🔍 Ticket found with email: ${ticketOnly.email}, your input: ${email}`,
    );

    // Check if email matches
    if (ticketOnly.email !== email.toLowerCase().trim()) {
      return NextResponse.json(
        {
          success: false,
          message: "INVALID_CREDENTIALS: Email does not match this Ticket ID.",
        },
        { status: 401 },
      );
    }

    // Now find the full student record
    const student = await Registrant.findOne({
      where: {
        email: email.toLowerCase().trim(),
        barcodeId: ticketId.toUpperCase().trim(),
      },
    });

    if (!student) {
      // This shouldn't happen since we already found ticketOnly, but just in case
      return NextResponse.json(
        {
          success: false,
          message:
            "INVALID_CREDENTIALS: Email or Ticket ID does not match our records.",
        },
        { status: 401 },
      );
    }

    // Check if already completed
    if (["completed", "awarded", "shortlisted"].includes(student.status)) {
      return NextResponse.json(
        {
          success: false,
          message:
            "You have already completed the assessment and cannot log in again.",
        },
        { status: 403 },
      );
    }

    // Physical Check-in Gate
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

    // Check if flagged
    if (student.isFlagged) {
      return NextResponse.json(
        {
          success: false,
          message: "ACCOUNT SUSPENDED: Multiple violations detected.",
        },
        { status: 403 },
      );
    }

    // Device Lock Logic
    const existingDevice = student.deviceId;

    if (existingDevice && existingDevice !== deviceFingerprint) {
      console.error(
        `🚨 ACCESS BLOCKED: Ticket ${ticketId} tried to login from a second device.`,
      );
      return NextResponse.json(
        {
          success: false,
          message:
            "DEVICE_LOCKED: This ticket is already active on another device. Multiple logins are prohibited. Please use the original device.",
        },
        { status: 401 },
      );
    }

    // Lock to this device if first time
    if (!existingDevice) {
      await student.update({ deviceId: deviceFingerprint });
      console.log(`🔒 Device Locked for ${email}: ${deviceFingerprint}`);
    }

    // Generate JWT token
    const token = generateToken({
      email: student.email,
      barcodeId: student.barcodeId,
      deviceFingerprint,
      status: student.status,
    });

    // Set HTTP-only cookie
    await setAuthCookie(token);

    console.log(`✅ Login successful for ${email}`);

    return NextResponse.json({
      success: true,
      message: "Login successful",
      status: student.status,
      deviceId: deviceFingerprint,
    });
  } catch (error: any) {
    console.error("CRITICAL LOGIN ERROR:", {
      message: error.message,
      stack: error.stack,
      name: error.name,
    });

    return NextResponse.json(
      {
        success: false,
        message: "Internal Server Error. Please try again later.",
      },
      { status: 500 },
    );
  }
}
