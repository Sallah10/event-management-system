import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";

const JWT_SECRET = process.env.JWT_SECRET!;

export interface TokenPayload {
  email: string;
  barcodeId: string;
  deviceFingerprint: string;
  status: string;
}

export function generateToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "2h" });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch {
    return null;
  }
}

// Fixed: Make this function async and await cookies()
export async function setAuthCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set("auth_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 7200, // 2 hours
    path: "/",
  });
}

export function getAuthToken(request: NextRequest) {
  // Check cookie first (for browser requests)
  const cookieToken = request.cookies.get("auth_token")?.value;
  if (cookieToken) return cookieToken;

  // Check Authorization header (for API requests)
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.substring(7);
  }

  return null;
}

export function getDeviceFingerprint(request: NextRequest): string {
  const userAgent = request.headers.get("user-agent") || "";
  const accept = request.headers.get("accept") || "";
  const acceptLanguage = request.headers.get("accept-language") || "";
  const ip = request.headers.get("x-forwarded-for") || "";

  // Create a stronger fingerprint
  const rawFingerprint = `${userAgent}|${accept}|${acceptLanguage}|${ip}`;

  // Hash it
  const crypto = require("crypto");
  return crypto.createHash("sha256").update(rawFingerprint).digest("hex");
}
