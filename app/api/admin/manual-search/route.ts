import { NextResponse } from "next/server";
import { Registrant } from "@/lib/models/Registrant";
import { Op } from "sequelize";

export async function GET(request: Request) {
  // Staff access check — inline since middleware doesn't cover this path
  const cookieHeader = request.headers.get("cookie") || "";
  const staffToken = cookieHeader.match(/(?:^|;\s*)staff_access=([^;]+)/)?.[1];

  if (!staffToken || staffToken !== process.env.STAFF_ACCESS_TOKEN) {
    return NextResponse.json(
      { success: false, message: "Unauthorized" },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();

  if (!q || q.length < 2) {
    return NextResponse.json(
      { success: false, message: "Query too short" },
      { status: 400 },
    );
  }

  try {
    const results = await Registrant.findAll({
      where: {
        [Op.or]: [
          { name: { [Op.iLike]: `%${q}%` } },
          { email: { [Op.iLike]: `%${q}%` } },
          { barcodeId: { [Op.iLike]: `%${q}%` } },
        ],
      },
      attributes: ["id", "name", "email", "barcodeId", "checkedIn", "status"],
      limit: 10,
    });

    return NextResponse.json({
      success: true,
      results: results.map((r) => ({
        name: r.name,
        email: r.email,
        barcodeId: r.barcodeId,
        checkedIn: r.checkedIn,
        status: r.status,
      })),
    });
  } catch (error) {
    console.error("Manual search error:", error);
    return NextResponse.json(
      { success: false, message: "Server error" },
      { status: 500 },
    );
  }
}
