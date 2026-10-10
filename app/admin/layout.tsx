import type { Metadata } from "next";

// The staff tools are behind a PIN and have no business in a search index. Set on
// the segment so it covers the dashboard and the sign-in page alike.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
