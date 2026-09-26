"use client";

import { motion } from "framer-motion";
import { ArrowRight, FileSearch, GraduationCap, ShieldCheck, Zap } from "lucide-react";
import Link from "next/link";
import { BRAND } from "@/config/branding";

// ─── ENTRY POINT ──────────────────────────────────────────────────────────────
// Two cards, and the palette was hardcoded: `bg-[#0000FF]`, `bg-[#FFBB00]`,
// `text-[#0000FF]`, `bg-[#E6E6FF]`. Those five values are not the product's
// colours — app/globals.css defines ink/paper/amber for everything else — so the
// first screen a visitor saw was the one screen that did not look like the rest
// of it, and none of it could be themed per deployment.
//
// It also had two doors where the system has three. `/admissions` has its own
// login and its own PII permissions, and the only way in was to type the URL —
// which is not discoverable, and reads as a hidden back door into the system that
// can see every essay. Three doors, all labelled, is both more honest and easier
// to review.

const DOORS = [
  {
    href: "/assessment/login",
    kicker: "Candidates",
    title: "Assessment",
    blurb: "Sit the assessment and track your result.",
    cta: "Enter portal",
    Icon: Zap,
  },
  {
    href: "/admin/login",
    kicker: "Event staff",
    title: "Check-in",
    blurb: "Scan tickets and record attendance.",
    cta: "Staff login",
    Icon: ShieldCheck,
  },
  {
    href: "/admissions/login",
    kicker: "Admissions panel",
    title: "Admissions",
    blurb: "Read essays, grade papers, allocate seats.",
    cta: "Panel login",
    Icon: FileSearch,
  },
] as const;

export default function EntryPortal() {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-ink p-4">
      <div
        className="absolute -left-[10%] -top-[10%] h-[40%] w-[40%] animate-pulse rounded-full bg-amber opacity-20 blur-[150px]"
        aria-hidden
      />

      <div className="z-10 grid w-full max-w-5xl grid-cols-1 gap-8 md:grid-cols-3">
        {DOORS.map(({ href, kicker, title, blurb, cta, Icon }) => (
          <motion.div
            key={href}
            whileHover={{ y: -8 }}
            className="group relative flex flex-col justify-between overflow-hidden rounded-[2.5rem] border border-paper/15 bg-paper/5 p-8 backdrop-blur-xl"
          >
            <div
              className="pointer-events-none absolute right-0 top-0 p-5 text-paper opacity-5 transition-opacity group-hover:opacity-10"
              aria-hidden
            >
              <GraduationCap size={150} />
            </div>

            <div>
              <div className="mb-7 flex h-16 w-16 items-center justify-center rounded-2xl bg-paper/10">
                <Icon className="text-amber" size={30} aria-hidden />
              </div>
              <p className="mb-2 text-[10px] font-black uppercase tracking-[0.25em] text-paper/50">
                {kicker}
              </p>
              <h2 className="mb-3 text-3xl font-black uppercase leading-none tracking-tight text-paper">
                {title}
              </h2>
              <p className="text-sm font-medium leading-relaxed text-paper/60">
                {blurb}
              </p>
            </div>

            <Link
              href={href}
              className="mt-10 flex items-center justify-center gap-3 rounded-2xl bg-amber py-4 text-sm font-black uppercase text-ink transition-transform hover:scale-[1.02]"
            >
              {cta} <ArrowRight strokeWidth={3} aria-hidden />
            </Link>
          </motion.div>
        ))}
      </div>

      <p className="absolute bottom-4 text-center text-[10px] uppercase tracking-[0.2em] text-paper/40">
        {BRAND.organisation}
      </p>
    </main>
  );
}
