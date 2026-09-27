import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { BRAND } from "@/config/branding";
import { Button } from "@/components/ui/button";

// The 404 used to be a blue-and-white page with the words "Back to TechShift" on
// the button, in hex values (`#0000FF`, `#0000CC`, `#E6E6FF`) that exist nowhere
// else in the product. So a candidate who mistyped an assessment URL left the
// site's palette and met a page for a different brand, and the link text was
// wrong for any deployment that wasn't that event.
//
// The 40-point compass in a circle has gone too. A big centred illustration
// above three lines of centred text is the other half of the template look;
// the page now sets the fact, the explanation and the way out as a left-aligned
// column, which is what an editorial 404 actually looks like.
export default function NotFound() {
  return (
    <main
      id="main"
      className="flex min-h-dvh flex-col justify-center bg-paper px-5 py-20 sm:px-8"
    >
      <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
        <p className="rule eyebrow">Error 404</p>

        <h1 className="font-display text-h1 text-balance text-ink">
          This page doesn&rsquo;t exist.
        </h1>

        <div className="flex flex-col gap-3">
          <p className="text-lead text-ink-soft">
            The link is broken, or the page has moved.
          </p>
          <p className="measure text-small leading-relaxed text-ink-soft">
            If you were part-way through an assessment, your answers were saved as
            you typed. Nothing is lost — go back to the front page and pick up
            from the portal.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button asChild>
            <Link href="/">
              <ArrowLeft aria-hidden />
              Back to {BRAND.shortName}
            </Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/assessment/login">Candidate portal</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
