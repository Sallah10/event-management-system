import Link from "next/link";
import { MoveLeft, Compass } from "lucide-react";
import { BRAND } from "@/config/branding";

// The 404 used to be a blue-and-white page with the words "Back to TechShift" on
// the button, in hex values (`#0000FF`, `#0000CC`, `#E6E6FF`) that exist nowhere
// else in the product. So a candidate who mistyped an assessment URL left the
// site's palette and met a page for a different brand, and the link text was
// wrong for any deployment that wasn't that event.
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-paper p-6 text-ink">
      <div className="rounded-full bg-amber/20 p-6">
        <Compass className="h-20 w-20 text-amber-deep" aria-hidden />
      </div>

      <div className="space-y-2 text-center">
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-ink-soft">
          {BRAND.name}
        </p>
        {/* The 404 as a heading, not a decorative number: a screen reader should
            hear "page not found" as the page's purpose. */}
        <h1 className="text-4xl font-black uppercase tracking-tight">
          Page not found
        </h1>
        <p className="max-w-sm text-ink-soft">
          That link is broken, or the page has moved. If you were part-way through
          an assessment, your answers are saved as you type — go back and start
          from the front page.
        </p>
      </div>

      <Link
        href="/"
        className="inline-flex items-center gap-2 rounded-full bg-ink px-8 py-3 font-bold text-paper transition-opacity hover:opacity-90"
      >
        <MoveLeft className="h-5 w-5" aria-hidden />
        Back to {BRAND.shortName}
      </Link>
    </main>
  );
}
