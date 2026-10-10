import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Toaster } from "sonner";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { BRAND } from "@/config/branding";

// FIX: self-hosted instead of next/font/google. The Google CDN fetch made
// `next build` depend on network access to fonts.gstatic.com - it failed
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

// Display face. Serif for headlines, grotesk for everything functional - the
// oldest combination in editorial design and the reason the product stopped
// reading as a generated template.
//
// Self-hosted for the same reason as the Geist files above: `next/font/google`
// fetches from fonts.gstatic.com at build time and the build failed roughly
// half the time on a machine without outbound access. The woff2 files are
// committed to app/fonts, so the build is hermetic and works offline. Latin
// subset only, which is all this content needs.
const instrumentSerif = localFont({
  variable: "--font-instrument-serif",
  display: "swap",
  src: [
    { path: "./fonts/InstrumentSerif-Regular.woff2", style: "normal", weight: "400" },
    { path: "./fonts/InstrumentSerif-Italic.woff2", style: "italic", weight: "400" },
  ],
});

// The title and description used to be hardcoded strings naming a previous
// cohort, which is what every tab in the browser, every shared link preview and
// every search result for this application said - including on the admissions
// side, where a reviewer opening five tabs had no way to tell which was which.
// They are configuration now, and default to something honest about what the
// thing is.
//
// The rest of this object is the social and crawler contract.
// `metadataBase` turns every relative URL below (the `/og-image.jpg` card and
// the canonical links) into an absolute one, which is what a link preview needs -
// an OG image at a relative path is silently dropped by most scrapers. It reads
// `NEXT_PUBLIC_APP_URL`, the same value the QR payloads and the email links use,
// so a deployment sets its public URL once.
export const metadata: Metadata = {
  metadataBase: new URL(BRAND.portalUrl),
  applicationName: BRAND.name,
  title: {
    default: BRAND.name,
    // The staff tools are a different application to a person holding five tabs,
    // so they say so. `/assessment/login` overrides this with its own title.
    template: `%s · ${BRAND.shortName}`,
  },
  description: BRAND.tagline,
  keywords: [
    "scholarship",
    "tech scholarship",
    "coding scholarship",
    "scholarship programme",
    "career development",
    "assessment day",
    BRAND.name,
  ],
  authors: [{ name: BRAND.organisation }],
  creator: BRAND.organisation,
  publisher: BRAND.organisation,
  category: "education",
  // A page on this site should not be auto-linked into a phone number or a
  // postal address; the ticket IDs and the phone numbers candidates type are the
  // only strings here that look like either, and neither should become a tappable
  // guess.
  formatDetection: { email: false, address: false, telephone: false },
  openGraph: {
    type: "website",
    siteName: BRAND.name,
    title: BRAND.name,
    description: BRAND.tagline,
    url: BRAND.portalUrl,
    locale: "en_GB",
    // The banner is a designed asset in `public/`, referenced here rather than
    // generated, so the card is art-directed. Dimensions are the real pixel size
    // of the file; scrapers use them to lay out the preview before it loads.
    images: [
      {
        url: "/og-image.jpg",
        width: 1424,
        height: 752,
        alt: `${BRAND.name} - ${BRAND.tagline}`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: BRAND.name,
    description: BRAND.tagline,
    images: ["/og-image.jpg"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FBFAF7" },
    { media: "(prefers-color-scheme: dark)", color: "#22242B" },
  ],
  colorScheme: "light dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning={true}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} antialiased`}
      >
        {/* The skip link is the first focusable thing on the page. Every staff
            desk in this product is a keyboard-and-tablet workflow, and the
            check-in page has a focus-sink input ahead of its real content. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-ink focus:px-4 focus:py-2.5 focus:text-small focus:font-medium focus:text-paper"
        >
          Skip to content
        </a>
        {children}
        <Toaster
          position="top-right"
          toastOptions={{
            classNames: {
              toast:
                "rounded-md! border-line! bg-surface! text-ink! font-sans! shadow-float!",
              title: "text-small! font-semibold!",
              description: "text-small! text-ink-soft!",
            },
          }}
        />
      </body>
      <Analytics />
      <SpeedInsights />
    </html>
  );
}
