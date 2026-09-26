// app/api/assessment/flag/route.ts - Add better logging
import { NextResponse } from "next/server";
import { Registrant } from "@/lib/models/Registrant";
import { redis, flagKey } from "@/lib/redis";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "jwt_secret_key";
const GRACE_PERIOD = 30 * 1000; // 30 seconds grace period for tab switching
// const GRACE_PERIOD = 1 * 60 * 1000; // 1 minute grace period for tab switching ( former logic)

// Direct cookie parser - no dependencies on other files
function getTokenFromRequest(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

  // Match auth_token=xxx (not token=xxx)
  const match = cookieHeader.match(/(?:^|;\s*)auth_token=([^;]+)/);
  return match ? match[1] : null;
}

export async function POST(request: Request) {
  try {
    // Get token directly - NO DEPENDENCIES
    const token = getTokenFromRequest(request);

    if (!token) {
      console.log("🚫 No token in request");
      return NextResponse.json(
        { success: false, error: "No token" },
        { status: 401 },
      );
    }

    // Verify token directly - NO DEPENDENCIES
    let payload: any;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      console.log("🚫 Invalid token");
      return NextResponse.json(
        { success: false, error: "Invalid token" },
        { status: 401 },
      );
    }

    const { reason } = await request.json();
    const barcodeId = payload.barcodeId;
    const email = payload.email;

    console.log(`🚩 Flag from ${email}: ${reason}`);

    // Check grace period
    const examStartKey = `start:${barcodeId}`;
    const examStartTime = await redis.get(examStartKey);

    if (
      examStartTime &&
      Date.now() - parseInt(examStartTime as string) < GRACE_PERIOD
    ) {
      return NextResponse.json({
        success: true,
        grace: true,
        warning: true,
        message: "⚠️ WARNING: Tab switching detected!",
      });
    }

    // Increment flag count
    const key = flagKey(barcodeId);
    const flagCount = await redis.incr(key);

    if (flagCount === 1) {
      await redis.expire(key, 3600); // 1 hour expiry
    }

    console.log(`🚩 Flag ${flagCount}/3 for ${email}`);

    // Handle responses based on flag count
    if (flagCount === 1) {
      return NextResponse.json({
        success: true,
        flagCount: 1,
        warning: true,
        message: "⚠️ First warning: Tab switching detected!",
        remainingChances: 2,
      });
    }

    if (flagCount === 2) {
      return NextResponse.json({
        success: true,
        flagCount: 2,
        warning: true,
        message: "🚨 FINAL WARNING: Last chance!",
        remainingChances: 1,
      });
    }

    if (flagCount >= 3) {
      // Flag in database
      await Registrant.update({ isFlagged: true }, { where: { barcodeId } });

      // Clear redis
      await redis.del(key);

      return NextResponse.json({
        success: true,
        flagCount: 3,
        forceLogout: true,
        message: "❌ DISQUALIFIED: Multiple violations",
      });
    }

    return NextResponse.json({ success: true, flagCount });
  } catch (error) {
    console.error("Flag error:", error);
    return NextResponse.json(
      { success: false, error: "Server error" },
      { status: 500 },
    );
  }
}
