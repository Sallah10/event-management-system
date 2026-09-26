import { NextResponse } from "next/server";
import { Registrant } from "@/lib/models/Registrant";
import sequelize from "@/lib/db";
import { redis, checkinKey, capacityKey } from "@/lib/redis";
import { Op } from "sequelize";

const CAPACITY_LIMIT = 3500;

export async function POST(request: Request) {
  const t = await sequelize.transaction();

  try {
    const body = await request.json();
    const { barcodeId } = body;
    const cleanId = barcodeId?.trim().toUpperCase();

    console.log(
      `RAW SCAN: "${barcodeId}" → CLEANED: "${cleanId}" (length: ${cleanId.length})`,
    );

    if (!cleanId) {
      await t.rollback();
      return NextResponse.json(
        { success: false, message: "No Barcode Provided" },
        { status: 400 },
      );
    }

    // Only validate minimum length - be flexible with format
    if (!cleanId || cleanId.length < 8) {
      await t.rollback();
      return NextResponse.json(
        { success: false, message: "Invalid barcode format" },
        { status: 400 },
      );
    }

    // REDIS: Check if already checked in
    const cachedCheckin = await redis.get(checkinKey(cleanId));
    if (cachedCheckin) {
      await t.rollback();
      return NextResponse.json(
        { success: false, message: "Already checked in (verified)" },
        { status: 400 },
      );
    }

    // REDIS: Check capacity
    const currentCount = (await redis.get(capacityKey())) || 0;
    if (Number(currentCount) >= CAPACITY_LIMIT) {
      await t.rollback();
      return NextResponse.json(
        { success: false, message: "VENUE FULL: Capacity of 3500 reached" },
        { status: 400 },
      );
    }

    // Find student
    let student = null;

    // Strategy 1: Exact match (original)
    student = await Registrant.findOne({
      where: { barcodeId: cleanId },
      attributes: ["id", "name", "checkedIn", "selectedCourseSlug"],
      transaction: t,
    });

    // Strategy 2: Try without hyphen (if QR has hyphen but DB doesn't)
    if (!student && cleanId.includes("-")) {
      const noHyphen = cleanId.replace(/-/g, "");
      console.log(`🔍 Trying without hyphen: ${noHyphen}`);
      student = await Registrant.findOne({
        where: {
          barcodeId: {
            [Op.iLike]: `%${noHyphen}%`, // Case-insensitive partial match
          },
        },
        attributes: ["id", "name", "checkedIn", "selectedCourseSlug"],
        transaction: t,
      });

      if (student) {
        console.log(
          `✅ Fuzzy match 1: QR="${cleanId}" → DB="${student.barcodeId}"`,
        );
      }
    }

    // Strategy 3: Try with hyphen (if QR has no hyphen but DB does)
    if (!student && !cleanId.includes("-") && cleanId.startsWith("TS26")) {
      const withHyphen = `TS26-${cleanId.substring(4)}`;
      console.log(`🔍 Trying with hyphen: ${withHyphen}`);
      student = await Registrant.findOne({
        where: { barcodeId: withHyphen },
        attributes: ["id", "name", "checkedIn", "selectedCourseSlug"],
        transaction: t,
      });

      if (student) {
        console.log(
          `✅ Fuzzy match 2: QR="${cleanId}" → DB="${student.barcodeId}"`,
        );
      }
    }

    // Strategy 4: Remove all non-alphanumeric and try
    if (!student) {
      const alphanumeric = cleanId.replace(/[^A-Z0-9]/gi, "");
      console.log(`🔍 Trying alphanumeric only: ${alphanumeric}`);
      student = await Registrant.findOne({
        where: {
          barcodeId: {
            [Op.iLike]: `%${alphanumeric}%`,
          },
        },
        attributes: ["id", "name", "checkedIn", "selectedCourseSlug"],
        transaction: t,
      });

      if (student) {
        console.log(
          `✅ Fuzzy match 3: QR="${cleanId}" → DB="${student.barcodeId}"`,
        );
      }
    }

    // Strategy 5: Partial match on the suffix (handles missing characters)
    if (!student && cleanId.startsWith("TS26")) {
      const suffix = cleanId.substring(5); // Everything after "TS26-" or "TS26"
      const cleanSuffix = suffix.replace("-", "");

      if (cleanSuffix.length >= 6) {
        // Only try if suffix is long enough to be unique
        console.log(`🔍 Trying partial suffix match: ${cleanSuffix}`);
        student = await Registrant.findOne({
          where: {
            barcodeId: {
              [Op.iLike]: `%${cleanSuffix}%`,
            },
          },
          attributes: ["id", "name", "checkedIn", "selectedCourseSlug"],
          transaction: t,
        });

        if (student) {
          console.log(
            `✅ Partial match: QR="${cleanId}" → DB="${student.barcodeId}"`,
          );
        }
      }
    }

    // If still no student found after all strategies
    if (!student) {
      await t.rollback();
      console.log(
        `❌ QR scan failed: Ticket ${cleanId} not found after all strategies`,
      );
      return NextResponse.json(
        {
          success: false,
          // message: "TICKET NOT FOUND",
          message: "TICKET_NOT_FOUND",
          details:
            "This QR code is not registered. Please check in manually at the registration desk.",
          code: "TICKET_NOT_FOUND",
          timestamp: new Date().toISOString(),
        },
        { status: 404 },
      );
    }

    if (student.checkedIn) {
      await redis.set(checkinKey(cleanId), true, { ex: 3600 });
      await t.rollback();
      return NextResponse.json(
        {
          success: false,
          message: "ALREADY CHECKED IN",
          details: `${student.name} was checked in earlier.`,
          name: student.name,
          code: "ALREADY_CHECKED_IN",
        },
        { status: 400 },
      );
    }

    // Atomic update
    const [updatedCount] = await Registrant.update(
      { checkedIn: true, status: "attended" },
      {
        where: { id: student.id, checkedIn: false },
        transaction: t,
      },
    );

    if (updatedCount === 0) {
      await t.rollback();
      return NextResponse.json(
        { success: false, message: `Already checked in: ${student.name}` },
        { status: 400 },
      );
    }

    await redis.incr(capacityKey());
    await redis.set(checkinKey(cleanId), true, { ex: 3600 });
    await t.commit();

    // Fire-and-forget capacity warning
    redis.get(capacityKey()).then((count) => {
      const current = Number(count || 0);
      if (current >= CAPACITY_LIMIT - 50) {
        console.warn(`⚠️ Capacity warning: ${current}/${CAPACITY_LIMIT}`);
      }
    });

    return NextResponse.json({
      success: true,
      message: `Welcome, ${student.name}!`,
      name: student.name,
      course: student.selectedCourseSlug || "Tech Scholarship",
      timestamp: new Date().toISOString(),
      code: "CHECKIN_SUCCESS",
    });
  } catch (error: any) {
    await t.rollback();
    // FIX: Log full error server-side, never send error.message to client
    console.error("Check-in error:", error.name, error.message);
    return NextResponse.json(
      { success: false, message: "Server Error. Please try again." },
      { status: 500 },
    );
  }
}
