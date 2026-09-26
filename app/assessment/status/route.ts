import { NextResponse } from "next/server";
import { Registrant } from "@/lib/models/Registrant";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key-change-this";

function getTokenFromRequest(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)auth_token=([^;]+)/);
  return match ? match[1] : null;
}

export async function GET(request: Request) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ success: false }, { status: 401 });
    }

    let payload: any;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch {
      return NextResponse.json({ success: false }, { status: 401 });
    }

    const student = await Registrant.findOne({
      where: { barcodeId: payload.barcodeId },
      attributes: ["status", "isFlagged"],
    });

    if (!student) {
      return NextResponse.json({ success: false }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      status: student.status,
      isFlagged: student.isFlagged,
    });
  } catch (error) {
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
