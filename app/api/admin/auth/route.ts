import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { redis } from "@/lib/redis";

export async function POST(request: Request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";

  // Lock out after 5 failed attempts for 15 minutes
  const failKey = `login_fails:${ip}`;
  const fails = (await redis.get<number>(failKey)) || 0;

  if (fails >= 5) {
    const ttl = await redis.ttl(failKey);
    return NextResponse.json(
      { success: false, message: `Too many attempts. Try again in ${ttl}s.` },
      { status: 429 },
    );
  }

  const { pin } = await request.json();

  if (String(pin) === String(process.env.STAFF_PIN)) {
    // Clear fail counter on success
    await redis.del(failKey);

    const cookieStore = await cookies();
    cookieStore.set("staff_access", process.env.STAFF_ACCESS_TOKEN!, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24,
      path: "/",
    });

    return NextResponse.json({ success: true });
  }

  // Increment fail counter, expire after 15 minutes
  await redis.incr(failKey);
  if (fails === 0) await redis.expire(failKey, 60 * 10);

  return NextResponse.json(
    { success: false, message: "Invalid PIN" },
    { status: 401 },
  );
}
