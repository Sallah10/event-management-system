import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Toaster } from "sonner";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { BRAND } from "@/config/branding";

// FIX: self-hosted instead of next/font/google. The Google CDN fetch made
// `next build` depend on network access to fonts.gstatic.com — it failed
// ~50% of builds here. Now the build is hermetic and works offline.
const geistSans = localFont({
  variable: "--font-geist-sans",
  display: "swap",
  src: [{ path: "./fonts/Geist-Variable.woff2", style: "normal" }],
  weight: "100 900",
});

const geistMono = localFont({
  variable: "--font-geist-mono",
  display: "swap",
  src: [{ path: "./fonts/GeistMono-Variable.woff2", style: "normal" }],
  weight: "100 900",
});

// The title and description used to be the literal strings "Techshift Event
// Portal" and "Event Portal For Techshift", which is what every tab in the
// browser, every shared link preview and every search result for this
// application said — including on the admissions side, where a reviewer opening
// five tabs had no way to tell which was which. They are configuration now, and
// default to something honest about what the thing is.
export const metadata: Metadata = {
  title: {
    default: BRAND.name,
    // The staff tools are a different application to a person holding five tabs,
    // so they say so. `/assessment/login` overrides this with its own title.
    template: `%s · ${BRAND.shortName}`,
  },
  description: BRAND.tagline,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning={true}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <Toaster position="top-right" />
      </body>
      <Analytics />
      <SpeedInsights />
    </html>
  );
}
