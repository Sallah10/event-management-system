import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";

  try {
    // ─── AUTH CHECK (runs on all protected paths) ───────────────────────────
    const isProtectedPath =
      path.startsWith("/admin") || path.startsWith("/checkin");
    const isPublicPath =
      path === "/admin/login" || path === "/assessment/login";

    if (isProtectedPath && !isPublicPath) {
      const token = request.cookies.get("staff_access")?.value;

      // FIX: Check token VALUE not just existence
      // Anyone could set document.cookie = "staff_access=anything" before
      if (!token || token !== process.env.STAFF_ACCESS_TOKEN) {
        return NextResponse.redirect(new URL("/admin/login", request.url));
      }
    }

    // ─── RATE LIMITING (assessment routes) ─────────────────────────────────
    // if (path.startsWith("/api/assessment/")) {
    //   let userId = "anonymous";
    //   const authToken = request.cookies.get("auth_token")?.value;

    //   if (authToken) {
    //     try {
    //       const base64Payload = authToken.split(".")[1];
    //       const payload = JSON.parse(atob(base64Payload));
    //       userId = payload.email || payload.barcodeId || userId;
    //     } catch {}
    //   }

    //   const windowMs = 60;
    //   const maxRequests = 60;
    //   const key = `rate_limit:${userId}:${path}`;

    //   // ATOMIC: INCR first, then check — fixes race condition where
    //   // concurrent requests all GET null and all bypass the limit
    //   const current = await redis.incr(key);

    //   if (current === 1) {
    //     await redis.expire(key, windowMs);
    //   }

    //   if (current > maxRequests) {
    //     const ttl = await redis.ttl(key);
    //     return NextResponse.json(
    //       {
    //         error: "Too many requests",
    //         message: `Slow down. Try again in ${ttl} seconds.`,
    //       },
    //       {
    //         status: 429,
    //         headers: { "Retry-After": String(ttl) },
    //       },
    //     );
    //   }

    //   return NextResponse.next();
    // }

    if (path.startsWith("/api/assessment/")) {
      let userId = "anonymous";
      const authToken = request.cookies.get("auth_token")?.value;

      if (authToken) {
        try {
          const base64Payload = authToken.split(".")[1];
          const payload = JSON.parse(atob(base64Payload));
          userId = payload.email || payload.barcodeId || userId;
        } catch {}
      }

      // Submission routes get higher limit — don't block actual work
      const isSubmitRoute =
        path.includes("/submit") ||
        path.includes("/objective") ||
        path.includes("/theory") ||
        path.includes("/answer");

      const windowMs = 60;
      const maxRequests = isSubmitRoute ? 300 : 60;
      const key = `rate_limit:${userId}:${path}`;

      const current = await redis.incr(key);
      if (current === 1) {
        await redis.expire(key, windowMs);
      }

      if (current > maxRequests) {
        const ttl = await redis.ttl(key);
        return NextResponse.json(
          {
            error: "Too many requests",
            message: `Please slow down. Try again in ${ttl} seconds.`,
          },
          {
            status: 429,
            headers: { "Retry-After": String(ttl) },
          },
        );
      }

      return NextResponse.next();
    }

    // ─── RATE LIMITING (check-in route) ────────────────────────────────────
    // Prevent barcode brute-forcing at the edge
    if (path === "/api/check-in") {
      const maxRequests = 60; // 60 scans per minute per IP is generous for real use
      const key = `rate_limit:${ip}:checkin`;
      const current = await redis.get<number>(key);

      if (current && current >= maxRequests) {
        const ttl = await redis.ttl(key);
        return NextResponse.json(
          { success: false, message: "Too many requests." },
          { status: 429, headers: { "Retry-After": String(ttl) } },
        );
      }

      await redis.incr(key);
      if (!current) await redis.expire(key, 60);
    }

    return NextResponse.next();
  } catch (error) {
    // If Redis fails, fail open (allow requests) but still enforce auth
    console.error("Proxy error:", error);

    const isProtectedPath =
      path.startsWith("/admin") || path.startsWith("/checkin");
    const isPublicPath =
      path === "/admin/login" || path === "/assessment/login";

    if (isProtectedPath && !isPublicPath) {
      const token = request.cookies.get("staff_access")?.value;
      if (!token || token !== process.env.STAFF_ACCESS_TOKEN) {
        return NextResponse.redirect(new URL("/admin/login", request.url));
      }
    }

    return NextResponse.next();
  }
}

export const config = {
  matcher: ["/api/:path*", "/admin/:path*", "/checkin"],
};
