import type { MetadataRoute } from "next";
import { BRAND } from "@/config/branding";

// ─── ROBOTS ───────────────────────────────────────────────────────────────────
// Crawl the public doors, stay out of everything behind a sign-in. `/admin`,
// `/api` and the candidate exam pages are private-but-reachable URLs; a crawler
// following them either bounces off a redirect or, worse, indexes a fragment of
// somebody's sitting. `/assessment/login` is deliberately allowed - it is the
// public "sign in with your ticket" door.

export default function robots(): MetadataRoute.Robots {
  const base = BRAND.portalUrl.replace(/\/+$/, "");

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin/",
          "/api/",
          "/admissions",
          "/checkin",
          "/assessment/exam",
          "/assessment/result",
          "/assessment/theory",
          "/assessment/thank-you",
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
