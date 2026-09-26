import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "jwt_secret_key";

function getTokenFromRequest(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)auth_token=([^;]+)/);
  return match ? match[1] : null;
}

export async function POST(request: Request) {
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

    const key = `start:${payload.barcodeId}`;
    await redis.set(key, Date.now().toString(), { ex: 7200 });

    console.log(
      `⏱️ Exam started for ${payload.email} at ${new Date().toLocaleTimeString()}`,
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Start exam error:", error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
