import type { MetadataRoute } from "next";
import { BRAND } from "@/config/branding";

// ─── SITEMAP ──────────────────────────────────────────────────────────────────
// Only the pages a search engine should ever land a stranger on. The staff and
// assessment areas are excluded here and in robots.ts, and each of those segments
// also sets `noindex`, so a crawler that arrives by a shared link still will not
// index it.

export default function sitemap(): MetadataRoute.Sitemap {
  const base = BRAND.portalUrl.replace(/\/+$/, "");
  const lastModified = new Date();

  return [
    {
      url: `${base}/`,
      lastModified,
      changeFrequency: "monthly",
      priority: 1,
    },
    {
      url: `${base}/register`,
      lastModified,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${base}/assessment/login`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.5,
    },
  ];
}
