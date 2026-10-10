import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { BRAND, CURRENT_COHORT } from "@/config/branding";

/* ─── ENTRY POINT ────────────────────────────────────────────────────────────
   The previous version was the single most machine-made screen in the product:
   three rounded-[2.5rem] cards on a dark field, a pulsing amber orb blurred
   150px behind them, a 150px GraduationCap at 5% opacity in each corner, a
   y: -8 lift on hover and a scale on the button. Every one of those is a tell.

   It is now an index, which is what an entry page with three doors actually
   is. A masthead, a rule, and three numbered rows. Depth comes from a grain
   overlay and hairline separators rather than from glow, and the whole thing is
   a server component - framer-motion was imported to animate a hover that
   should not have been animated, which cost a client bundle for nothing.
   ─────────────────────────────────────────────────────────────────────────── */

const DOORS = [
  {
    href: "/register",
    kicker: "New applicants",
    title: "Register",
    blurb: "Apply in a minute and get your ticket ID on the spot. No account, no waiting.",
  },
  {
    href: "/assessment/login",
    kicker: "Candidates",
    title: "Assessment",
    blurb: "Sit the objective paper and the theory essay, then track your result.",
  },
  {
    href: "/admin/login",
    kicker: "Event staff",
    title: "Check-in",
    blurb: "Scan a ticket, record attendance, and resolve a problem at the door.",
  },
  {
    href: "/admissions",
    kicker: "Admissions panel",
    title: "Admissions",
    blurb: "Read essays, grade papers, shortlist candidates and award seats.",
  },
] as const;

const META = [
  { label: "Cohort", value: CURRENT_COHORT ? String(CURRENT_COHORT) : "" },
  { label: "Date", value: BRAND.date },
  { label: "Venue", value: BRAND.venue },
].filter((entry) => entry.value);

export default function EntryPortal() {
  return (
    <main id="main" className="relative flex min-h-dvh flex-col bg-ink text-paper">
      {/* Film grain. A 180×180 tiled SVG noise at 3.5% over a flat dark field is
          what stops a large area of one colour reading as a dead gradient. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.035] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />

      <div className="relative mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center gap-14 px-6 py-20 sm:px-8">
        {/* Masthead */}
        <div className="flex flex-col gap-5">
          <p className="eyebrow text-amber!">{BRAND.organisation}</p>
          <h1 className="font-display text-display text-balance">
            {BRAND.name}
          </h1>
          <p className="measure text-lead text-pretty text-paper/60">
            {BRAND.tagline}
          </p>
        </div>

        {/* The index */}
        <nav aria-label="Portals" className="border-t border-paper/15">
          {DOORS.map((door, index) => (
            <Link
              key={door.href}
              href={door.href}
              className="group flex items-center gap-5 border-b border-paper/15 py-6 transition-colors duration-[var(--duration-quick)] hover:bg-paper/[0.04] sm:gap-8 sm:py-7"
            >
              <span
                aria-hidden
                data-numeric
                className="w-6 shrink-0 font-mono text-micro text-paper/30 tabular-nums"
              >
                {String(index + 1).padStart(2, "0")}
              </span>

              <span className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-6">
                <span className="flex min-w-0 flex-col gap-1 sm:w-64 sm:shrink-0">
                  <span className="eyebrow text-paper/40!">{door.kicker}</span>
                  <span className="font-display text-h3 text-paper">
                    {door.title}
                  </span>
                </span>
                <span className="measure flex-1 text-small leading-relaxed text-paper/55 sm:text-body">
                  {door.blurb}
                </span>
              </span>

              <ArrowRight
                aria-hidden
                className="size-4 shrink-0 text-paper/25 transition-all duration-[var(--duration-quick)] group-hover:translate-x-1 group-hover:text-amber"
              />
            </Link>
          ))}
        </nav>

        {/* Event facts, only when they are actually set. A configured date
            renders; an unset one leaves no gap and no "TBC". */}
        {META.length > 0 ? (
          <dl className="flex flex-wrap gap-x-10 gap-y-4">
            {META.map((entry) => (
              <div key={entry.label} className="flex flex-col gap-1">
                <dt className="eyebrow text-paper/35!">{entry.label}</dt>
                <dd className="text-small text-paper/75">{entry.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>

      <footer className="relative mx-auto flex w-full max-w-4xl flex-col gap-3 border-t border-paper/15 px-6 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <p className="text-micro text-paper/40">
          Need help?{" "}
          <a
            href={`mailto:${BRAND.contactEmail}`}
            className="text-paper/70 underline decoration-paper/25 underline-offset-4 transition-colors hover:text-amber hover:decoration-amber"
          >
            {BRAND.contactEmail}
          </a>
        </p>
        <p className="text-micro text-paper/30">
          {BRAND.organisation} · {BRAND.shortName}
        </p>
      </footer>
    </main>
  );
}
