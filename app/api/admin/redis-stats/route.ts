import { NextResponse } from "next/server";
import { redis, capacityKey } from "@/lib/redis";

export async function GET(request: Request) {
  const apiKey = request.headers.get("x-api-key");
  if (apiKey !== process.env.INTERNAL_API_KEY) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    const currentCapacity = (await redis.get(capacityKey())) || 0;

    // Get all flag counts (for monitoring)
    const flagKeys = await redis.keys("flag:*");
    const flaggedUsers = await Promise.all(
      flagKeys.map(async (key) => ({
        barcodeId: key.replace("flag:", ""),
        count: await redis.get(key),
      })),
    );

    return NextResponse.json({
      success: true,
      data: {
        currentCheckins: Number(currentCapacity),
        remaining: 3500 - Number(currentCapacity),
        flaggedUsers: flaggedUsers.filter((f) => Number(f.count) >= 1),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: "Error fetching Redis stats" },
      { status: 500 },
    );
  }
}
