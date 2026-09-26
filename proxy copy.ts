import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Redis } from "@upstash/redis";

// Initialize Redis (uses UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN from env)
const redis = Redis.fromEnv();

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const ip =
    request.headers.get("x-forwarded-for") ||
    request.headers.get("x-real-ip") ||
    "unknown";

  try {
    // ==================== RATE LIMITING ====================
    if (path.startsWith("/api/assessment/")) {
      const windowMs = 60 * 1000; // 1 minute
      const maxRequests = 30;

      // Create a unique key for this IP + path
      const key = `rate_limit:${ip}:${path}`;

      // Get current count from Redis
      const current = await redis.get<number>(key);

      if (current && current >= maxRequests) {
        // Get TTL to tell user when they can try again
        const ttl = await redis.ttl(key);

        return NextResponse.json(
          {
            error: "Too many requests",
            message: `Rate limit exceeded. Try again in ${ttl} seconds.`,
            retryAfter: ttl,
          },
          {
            status: 429,
            headers: {
              "Retry-After": String(ttl),
              "X-RateLimit-Limit": String(maxRequests),
              "X-RateLimit-Remaining": "0",
            },
          },
        );
      }

      // Increment count (if key doesn't exist, it starts at 0 then increments to 1)
      await redis.incr(key);

      // Set expiry on first request
      if (!current) {
        await redis.expire(key, 60); // 60 seconds
      }

      // Add rate limit headers to successful requests
      const remaining = maxRequests - (current || 0) - 1;
      const response = NextResponse.next();
      response.headers.set("X-RateLimit-Limit", String(maxRequests));
      response.headers.set(
        "X-RateLimit-Remaining",
        String(Math.max(0, remaining)),
      );

      // ==================== AUTH PROTECTION ====================
      const isProtectedPath =
        path.startsWith("/admin") || path.startsWith("/checkin");
      const isPublicPath =
        path === "/admin/login" || path === "/assessment/login";
      const token = request.cookies.get("staff_access")?.value;

      if (isProtectedPath && !isPublicPath && !token) {
        return NextResponse.redirect(new URL("/admin/login", request.url));
      }

      return response;
    }

    // ==================== NON-API ROUTES ====================
    // For non-API routes, just handle auth
    const isProtectedPath =
      path.startsWith("/admin") || path.startsWith("/checkin");
    const isPublicPath =
      path === "/admin/login" || path === "/assessment/login";
    const token = request.cookies.get("staff_access")?.value;

    if (isProtectedPath && !isPublicPath && !token) {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }

    return NextResponse.next();
  } catch (error) {
    // If Redis fails, fail open (allow requests) but log error
    console.error("Proxy error:", error);

    // Still enforce auth even if rate limiting fails
    const isProtectedPath =
      path.startsWith("/admin") || path.startsWith("/checkin");
    const isPublicPath =
      path === "/admin/login" || path === "/assessment/login";
    const token = request.cookies.get("staff_access")?.value;

    if (isProtectedPath && !isPublicPath && !token) {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }

    return NextResponse.next();
  }
}

// Configure which paths this runs on
export const config = {
  matcher: ["/api/:path*", "/admin/:path*", "/checkin"],
};
