import type { Metadata } from "next";

// Admissions is an internal review tool. It is reachable only with the admissions
// PIN, but a direct URL would otherwise be crawlable, so the whole segment opts
// out of indexing.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AdmissionsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
