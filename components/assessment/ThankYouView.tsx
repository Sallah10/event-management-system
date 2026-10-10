"use client";

import {
  Clock,
  Facebook,
  Instagram,
  Linkedin,
  Twitter,
  type LucideIcon,
} from "lucide-react";
import { BRAND } from "@/config/branding";
import { COURSES } from "@/config/course-matrix";
import { Alert } from "@/components/ui/display";

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

/**
 * The confirmation screen, and the second-most machine-made surface in the
 * product. It was a 2.5rem-radius card with an 80px stacked shadow, a dark
 * header full of decorative CSS circles, a pulsing amber disc with a 50px
 * glow, an uppercase `font-black` heading, everything centred, and a
 * `scale: 0.96 → 1` entrance.
 *
 * What replaced it is a receipt. A confirmation is a document: it has a
 * reference, a list of facts, and a way out. It is set as one, left-aligned,
 * on paper, with the one piece of news that needs emphasis given a rule rather
 * than a glow. Nothing here animates in, because a candidate who has just
 * finished a paper does not need to be shown off to.
 */
export default function ThankYouView({ submittedLate, track }: Props) {
  // Only links a deployment actually configured. With nothing set, the row is not
  // rendered at all - an icon that goes nowhere is worse than no icon.
  const socials = BRAND.socials.filter(
    (entry) => entry.url !== "" && ICONS[entry.platform] !== undefined,
  );

  const trackName = COURSES.find((course) => course.slug === track)?.displayName;

  return (
    <main
      id="main"
      className="flex min-h-dvh items-center justify-center bg-paper px-5 py-16 sm:px-8"
    >
      <div className="w-full max-w-lg">
        {/* Masthead */}
        <div className="flex flex-col gap-3">
          <p className="rule eyebrow">Submitted</p>
          <h1 className="font-display text-h1 text-balance text-ink">
            Your paper is in.
          </h1>
          <p className="text-small text-ink-soft">
            {BRAND.name}
            {BRAND.date ? ` · ${BRAND.date}` : ""}
          </p>
        </div>

        <div className="mt-8 flex flex-col gap-7 border-t border-line pt-7">
          {submittedLate ? (
            // Said plainly rather than left for the candidate to assume. The paper
            // was accepted and is marked; the only consequence is that the finish
            // time is on the record, and hiding that would be the dishonest option.
            <Alert tone="caution" icon={Clock} title="Submitted after the deadline">
              Your answers were received after the time limit closed. They have been
              submitted and will be read - the recorded finishing time is later than
              the deadline, and that is all that has changed.
            </Alert>
          ) : null}

          <section className="flex flex-col gap-2">
            <h2 className="eyebrow">What happens next</h2>
            <p className="measure text-lead text-pretty text-ink-soft">
              {trackName ? `You applied for ${trackName}. ` : ""}
              Decisions are made by the panel, and any outcome is sent to the email
              address on your application. There is nothing else for you to do.
            </p>
          </section>

          {socials.length > 0 ? (
            <section className="flex flex-col gap-3 border-t border-line pt-6">
              <h2 className="eyebrow">Follow the programme</h2>
              <ul className="flex flex-wrap gap-x-5 gap-y-2">
                {socials.map((social) => {
                  const Icon = ICONS[social.platform];
                  return (
                    <li key={social.platform}>
                      <a
                        href={social.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-small font-medium text-ink transition-colors hover:text-amber-deep"
                      >
                        <Icon aria-hidden className="size-4" />
                        {social.label}
                        <span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </div>

        <div className="mt-8 flex flex-col gap-3 border-t border-line pt-6">
          <a
            href={BRAND.portalUrl}
            className="inline-flex h-11 items-center justify-center rounded-md border border-ink px-5 text-small font-medium text-ink transition-colors duration-[var(--duration-quick)] hover:bg-ink hover:text-paper"
          >
            Return to {BRAND.shortName}
          </a>
          <p className="text-small text-ink-soft">
            Something wrong?{" "}
            <a
              href={`mailto:${BRAND.contactEmail}`}
              className="font-medium text-ink underline decoration-line-strong underline-offset-4 transition-colors hover:decoration-ink"
            >
              {BRAND.contactEmail}
            </a>
          </p>
        </div>
      </div>
    </main>
  );
}
