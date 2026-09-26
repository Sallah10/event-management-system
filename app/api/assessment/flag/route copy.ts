import { NextResponse } from "next/server";
import { Registrant } from "@/lib/models/Registrant";
import sequelize from "@/lib/db";

export async function POST(request: Request) {
  try {
    const { email, barcodeId, reason } = await request.json();
    await sequelize.authenticate();

    const student = await Registrant.findOne({
      where: {
        email: email.toLowerCase().trim(),
        barcodeId: barcodeId.toUpperCase().trim(),
      },
    });

    if (student) {
      // Update the database record immediately
      await student.update({
        isFlagged: true,
        // Optional: append reason to deviceId or a notes field if you have one
      });
      console.log(`🚩 SILENT FLAG: ${email} flagged for ${reason}`);
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
