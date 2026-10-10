import type { Metadata } from "next";

// The check-in desk is an operational screen, not a public page: a candidate
// arriving from a search result to a barcode field is nobody's intent. The page
// itself is a client component and cannot export metadata, so the segment does.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function CheckinLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
