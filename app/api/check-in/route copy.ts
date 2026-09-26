import { NextResponse } from "next/server";
import { Registrant } from "@/lib/models/Registrant";
import sequelize from "@/lib/db";
import { redis, checkinKey, capacityKey } from "@/lib/redis";
import { logSecurityEvent } from "@/lib/logger";

const CAPACITY_LIMIT = 3500;

export async function POST(request: Request) {
  const t = await sequelize.transaction();

  try {
    const body = await request.json();
    const { barcodeId } = body;
    const cleanId = barcodeId?.trim().toUpperCase();

    if (!cleanId) {
      await t.rollback();
      return NextResponse.json(
        { success: false, message: "No Barcode Provided" },
        { status: 400 },
      );
    }

    // REDIS: Check if already checked in (distributed cache)
    const cachedCheckin = await redis.get(checkinKey(cleanId));
    if (cachedCheckin) {
      await t.rollback();
      return NextResponse.json(
        { success: false, message: "Already checked in (verified)" },
        { status: 400 },
      );
    }

    // REDIS: Check capacity (atomic counter)
    const currentCount = (await redis.get(capacityKey())) || 0;
    if (Number(currentCount) >= CAPACITY_LIMIT) {
      await t.rollback();
      return NextResponse.json(
        { success: false, message: "VENUE FULL: Capacity of 3500 reached" },
        { status: 400 },
      );
    }

    // Find student in DB
    const student = await Registrant.findOne({
      where: { barcodeId: cleanId },
      attributes: ["id", "name", "checkedIn", "selectedCourseSlug"],
      transaction: t,
    });

    if (!student) {
      await t.rollback();

      // Log the failed attempt
      console.log(`❌ QR scan failed: Ticket ${cleanId} not found in database`);

      return NextResponse.json(
        {
          success: false,
          message: "❌ TICKET NOT FOUND",
          details:
            "This QR code is not registered. Please check-in manually at the registration desk.",
          code: "TICKET_NOT_FOUND",
          timestamp: new Date().toISOString(),
        },
        { status: 404 },
      );
    }

    if (student.checkedIn) {
      // Update cache
      await redis.set(checkinKey(cleanId), true, { ex: 3600 });
      await t.rollback();

      return NextResponse.json(
        {
          success: false,
          message: `🔄 ALREADY CHECKED IN`,
          details: `${student.name} was checked in earlier.`,
          name: student.name,
          code: "ALREADY_CHECKED_IN",
        },
        { status: 400 },
      );
    }

    // Update DB
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

    // REDIS: Increment capacity counter and cache this check-in
    await redis.incr(capacityKey());
    await redis.set(checkinKey(cleanId), true, { ex: 3600 });

    await t.commit();

    Promise.all([
      redis.get(capacityKey()).then((count) => {
        const current = Number(count || 0);
        if (current >= CAPACITY_LIMIT - 50) {
          console.log(
            `⚠️ Capacity warning: ${current}/${CAPACITY_LIMIT} checked in`,
          );
        }
      }),
    ]);
    return NextResponse.json({
      success: true,
      message: ` Welcome, ${student.name}!`,
      name: student.name,
      course: student.selectedCourseSlug || "Tech Scholarship",
      timestamp: new Date().toISOString(),
      code: "CHECKIN_SUCCESS",
    });
  } catch (error: any) {
    await t.rollback();
    console.error("Check-in error:", error);
    return NextResponse.json(
      { success: false, message: "Server Error. Please try again." },
      { status: 500 },
    );
  }
}
