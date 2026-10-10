import type { MetadataRoute } from "next";
import { BRAND } from "@/config/branding";

// ─── WEB APP MANIFEST ─────────────────────────────────────────────────────────
// Enough for "Add to Home Screen" on the candidate portal: a name, a theme, and
// the icons. `start_url` is the landing page; the portal is not an installable
// app, so this is presentational rather than an offline story.
//
// The two colours are the light-theme tokens from app/globals.css, repeated here
// because a manifest is static JSON and cannot read CSS custom properties.

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND.name,
    short_name: BRAND.shortName,
    description: BRAND.tagline,
    start_url: "/",
    display: "standalone",
    background_color: "#FBFAF7",
    theme_color: "#171A22",
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
