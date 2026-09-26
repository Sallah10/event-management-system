import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { verifyToken, getAuthToken } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const token = getAuthToken(request as any);
    if (!token) {
      return NextResponse.json({ success: false }, { status: 401 });
    }

    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json({ success: false }, { status: 401 });
    }

    // Store exam start time in Redis (expires after 2 hours)
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
