"use client";

import {
  CheckCircle2,
  Clock,
  Facebook,
  Instagram,
  Linkedin,
  Twitter,
  type LucideIcon,
} from "lucide-react";
import { motion } from "framer-motion";
import { BRAND } from "@/config/branding";
import { COURSES } from "@/config/course-matrix";

/**
 * Icon per configured platform.
 *
 * A lookup rather than a component stored in configuration, because
 * `config/branding.ts` is imported by server code and by the email template, and
 * a JSX element cannot live in a module that a server bundle also reads. An
 * unrecognised platform renders nothing rather than a broken link.
 */
const ICONS: Record<string, LucideIcon> = {
  instagram: Instagram,
  facebook: Facebook,
  linkedin: Linkedin,
  x: Twitter,
};

interface Props {
  /** From the database, not the URL. See the page for why. */
  submittedLate: boolean;
  track: string | null;
}

export default function ThankYouView({ submittedLate, track }: Props) {
  // Only links a deployment actually configured. With nothing set, the row is not
  // rendered at all — an icon that goes nowhere is worse than no icon.
  const socials = BRAND.socials.filter(
    (entry) => entry.url !== "" && ICONS[entry.platform] !== undefined,
  );

  const trackName = COURSES.find((course) => course.slug === track)?.displayName;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-paper p-6 text-ink">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-xl overflow-hidden rounded-[2.5rem] border border-ink/10 bg-white shadow-[0_40px_80px_rgba(20,18,16,0.12)]"
      >
        <div className="relative -mt-10 bg-ink p-14 text-center text-paper">
          <div
            className="pointer-events-none absolute inset-0 opacity-10"
            aria-hidden
          >
            <div className="absolute left-10 top-10 h-20 w-20 rounded-full border-8 border-paper" />
            <div className="absolute bottom-10 right-10 h-20 w-20 rotate-45 border-8 border-amber" />
          </div>
          <div className="relative mb-6 flex justify-center">
            <div className="animate-pulse rounded-full bg-amber p-6 shadow-[0_0_50px_rgba(180,83,9,0.45)]">
              <CheckCircle2 className="h-16 w-16 text-ink" strokeWidth={3} />
            </div>
          </div>
          <h1 className="text-4xl font-black uppercase leading-none tracking-tighter">
            Application complete
          </h1>
          <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.3em] text-paper/60">
            {BRAND.name}
            {BRAND.date ? ` · ${BRAND.date}` : ""}
          </p>
        </div>

        <div className="space-y-8 bg-white p-10 text-center">
          {submittedLate && (
            // Said plainly rather than left for the candidate to assume. The paper
            // was accepted and is marked; the only consequence is that the finish
            // time is on the record, and hiding that would be the dishonest option.
            <p className="flex items-start gap-3 rounded-2xl border border-amber-deep/40 bg-amber/10 p-4 text-left text-sm">
              <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                Your answers were received after the time limit closed. They have
                been submitted and will be read — the recorded finishing time is
                later than the deadline, and that is all that has changed.
              </span>
            </p>
          )}

          <div className="space-y-3">
            <h2 className="text-xl font-black uppercase">What happens next</h2>
            <p className="text-lg leading-relaxed text-ink-soft">
              {trackName
                ? `You applied for ${trackName}. `
                : ""}
              Decisions are made by the panel and any outcome is sent to the email
              address on your application. There is nothing else for you to do.
            </p>
          </div>

          {socials.length > 0 && (
            <div className="border-t border-ink/10 pt-6">
              <p className="mb-4 text-[10px] font-black uppercase tracking-widest text-ink-soft">
                Follow the programme
              </p>
              <div className="flex justify-center gap-4">
                {socials.map((social) => {
                  const Icon = ICONS[social.platform];
                  return (
                    <a
                      key={social.platform}
                      href={social.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={social.label}
                      className="rounded-2xl bg-paper p-4 text-ink transition-all hover:-translate-y-0.5 hover:bg-ink hover:text-paper"
                    >
                      <Icon aria-hidden />
                    </a>
                  );
                })}
              </div>
            </div>
          )}

          <a
            href={BRAND.portalUrl}
            className="block w-full rounded-2xl border-2 border-ink py-4 text-sm font-black uppercase transition-colors hover:bg-ink hover:text-paper"
          >
            Return to {BRAND.shortName}
          </a>

          <p className="text-[11px] text-ink-soft">
            Something wrong?{" "}
            <a href={`mailto:${BRAND.contactEmail}`} className="underline underline-offset-4">
              {BRAND.contactEmail}
            </a>
          </p>
        </div>
      </motion.div>
    </div>
  );
}
