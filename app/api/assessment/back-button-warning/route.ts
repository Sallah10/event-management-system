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

    const { action } = await request.json();

    // Track back button warnings in Redis
    const backKey = `back:${payload.barcodeId}`;

    if (action === "warning") {
      const warningCount = await redis.incr(backKey);
      await redis.expire(backKey, 3600); // Expire after 1 hour

      console.log(
        `🔙 Back button warning ${warningCount}/2 for ${payload.email}`,
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Back button warning error:", error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
