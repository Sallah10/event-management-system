import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "pg-native", "sequelize"],
  allowedDevOrigins: ["*.tunnel.example.com", "local-origin.dev"],
  // experimental: {
  //   ...({
  //     allowedDevOrigins: ["http://192.168.2.22:3000/", "localhost:3000"],
  //     // eslint-disable-next-line @typescript-eslint/no-explicit-any
  //   } as any),
  // },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Prevent clickjacking - stops your site being loaded in an iframe
          { key: "X-Frame-Options", value: "DENY" },

          // Prevent MIME type sniffing
          { key: "X-Content-Type-Options", value: "nosniff" },

          // Control referrer info sent to other sites
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

          // Restrict browser features - camera only needed on /checkin
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
        // API routes - prevent caching of sensitive responses
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
