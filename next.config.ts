import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "pg-native", "sequelize"],

  // FIX: this was inside `experimental`, spread through `as any` to stop the
  // type checker complaining. Two separate problems, and the cast was hiding
  // both of them:
  //
  //  1. `allowedDevOrigins` is a TOP-LEVEL key, not an experimental one. Nested
  //     under `experimental` Next did not read it at all — so the thing it was
  //     added to fix (loading the app from a phone on the same wifi to test the
  //     barcode scanner) never worked, and the config printed an unrecognised-key
  //     warning that the cast made impossible to trace back here.
  //  2. `as any` is what stopped anyone finding out. NextConfig is a closed
  //     object type; the honest compile error was the only signal that the key was
  //     in the wrong place.
  //
  // Host strings are origins, not URLs with a trailing slash. `192.168.2.22` is
  // this machine's old LAN address — replace it with your own, or delete the
  // entry when you are not testing on a phone.
  allowedDevOrigins: ["localhost:3000", "192.168.2.22:3000"],

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Prevent clickjacking — stops your site being loaded in an iframe
          { key: "X-Frame-Options", value: "DENY" },

          // Prevent MIME type sniffing
          { key: "X-Content-Type-Options", value: "nosniff" },

          // Control referrer info sent to other sites
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

          // Restrict browser features — camera only needed on /checkin
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(), geolocation=()",
          },

          // Basic XSS protection for older browsers
          { key: "X-XSS-Protection", value: "1; mode=block" },

          // Force HTTPS for 1 year
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
      {
        // API routes — prevent caching of sensitive responses
        source: "/api/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, no-cache, must-revalidate",
          },
          { key: "Pragma", value: "no-cache" },
        ],
      },
    ];
  },
};

export default nextConfig;
