import { NextResponse } from "next/server";
import { Registrant } from "@/lib/models/Registrant";
import { redis, flagKey } from "@/lib/redis";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key-change-this";

function getTokenFromRequest(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

  // Match auth_token=xxx (not token=xxx)
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

    const key = flagKey(payload.barcodeId);
    const flagCount = (await redis.get(key)) || 0;

    const student = await Registrant.findOne({
      where: { barcodeId: payload.barcodeId },
      attributes: ["isFlagged", "status"],
    });

    return NextResponse.json({
      success: true,
      flagCount: Number(flagCount),
      isFlagged: student?.isFlagged || false,
      status: student?.status,
    });
  } catch (error) {
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
