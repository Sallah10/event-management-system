import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function POST(request: Request) {
  const { pin } = await request.json();

  if (String(pin) === String(process.env.STAFF_PIN)) {
    const cookieStore = await cookies();

    cookieStore.set("staff_access", "authorized", {
      httpOnly: true,
      // Only use secure in production (HTTPS)
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24,
      path: "/", // Ensure cookie is available on all paths
    });

    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ success: false }, { status: 401 });
}
