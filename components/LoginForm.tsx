"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Mail, Ticket, ShieldAlert, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Alert } from "@/components/ui/display";
import { BRAND } from "@/config/branding";
import { apiFetch } from "@/lib/client/api";
import {
  OBJECTIVE_TTL_MINUTES,
  THEORY_TTL_MINUTES,
  QUALIFIED_POOL_SIZE,
  PASS_MARK_PERCENT,
  TOTAL_QUESTIONS,
} from "@/config/rules";
import { COURSES } from "@/config/course-matrix";

interface LoginResponse {
  status: string;
  name: string;
  next: string;
}

/**
 * What each `?reason=` actually means, in the candidate's own terms.
 *
 * A whitelist, not a fallback string. An unrecognised reason shows nothing rather
 * than something reassuring, because the failure mode of guessing here is telling
 * somebody their session expired when what actually happened is that they were
 * locked out of the venue.
 */
const REASON_COPY: Record<string, string> = {
  session: "Your session ended. Sign in again to carry on.",
  timeout: "The assessment closed. Sign in to see where you got to.",
};

const RULES = [
  <>
    <strong>{TOTAL_QUESTIONS}</strong> objective questions in{" "}
    <strong>{OBJECTIVE_TTL_MINUTES} minutes</strong>.
  </>,
  <>
    The top <strong>{QUALIFIED_POOL_SIZE}</strong> by score - ties broken by who
    finished first - go through to <strong>{THEORY_TTL_MINUTES} minutes</strong>{" "}
    of written questions.
  </>,
  <>
    A score of <strong>{PASS_MARK_PERCENT}%</strong> is needed to be eligible for
    a place in the pool.
  </>,
  <>
    Your paper is tied to this browser. Opening it on a second device signs you
    out here.
  </>,
  <>Switching tabs and leaving the page are recorded for review.</>,
  <>
    Writing is your own. Essays are screened for machine-generated text, and a
    human reviews anything flagged.
  </>,
];

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reason = searchParams.get("reason");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [acceptedRules, setAcceptedRules] = useState(false);

  // ─── WHY YOU WERE SENT BACK HERE ────────────────────────────────────────────
  // The old version fired one hardcoded red toast reading "You have been
  // disqualified due to multiple violations" whenever the URL had
  // ?reason=disqualified - a string the redirect could produce for several very
  // different reasons, so a candidate whose session merely expired was told they
  // had been disqualified. A disqualification is a serious thing to tell
  // someone on the strength of a query parameter. Each reason now says what
  // actually happened.
  //
  // Derived during render rather than pushed into state by an effect. `reason`
  // is already available here, so an effect that copies it into `error` was a
  // second render pass for a value we already had - and it meant the message
  // flashed in after the form appeared.
  const reasonMessage = REASON_COPY[reason ?? ""] ?? "";
  const message = error || reasonMessage;

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!acceptedRules) {
      setError("Please read and accept the rules before you start.");
      return;
    }

    setLoading(true);
    setError("");

    const formData = new FormData(e.currentTarget);
    const email = String(formData.get("email") ?? "");
    const ticketId = String(formData.get("ticketId") ?? "");

    const result = await apiFetch<LoginResponse>("/api/assessment/login", {
      method: "POST",
      body: JSON.stringify({ email, ticketId }),
    });

    if (result.ok) {
      // The server decides where the candidate goes next. Following its answer
      // rather than hardcoding "/assessment/exam" is what stops a qualified
      // candidate being bounced to a page they have already passed.
      router.push(result.data.next);
      router.refresh();
      return;
    }

    // The server may know something more specific than "no": a candidate who has
    // already submitted, or who never checked in, needs to be told that.
    if (result.redirect) {
      setError(result.message);
      return;
    }

    setError(result.message);
  };

  return (
    <div className="grid w-full max-w-4xl grid-cols-1 gap-5 md:grid-cols-[1.15fr_1fr] md:items-start">
      {/* ─── Rules ──────────────────────────────────────────────────────────
          Left column on a wide screen, above the form on a narrow one. The
          order matters: a candidate should meet the conditions before the field
          that starts the clock, not after. */}
      <section className="rounded-lg border border-line bg-surface p-6">
        <p className="rule eyebrow mb-4">Before you begin</p>
        <h1 className="font-display text-h3 text-balance text-ink">
          Rules of the assessment
        </h1>

        <ul className="mt-5 flex flex-col gap-2.5">
          {RULES.map((rule, index) => (
            <li key={index} className="flex gap-3 text-small leading-relaxed text-ink-soft">
              <span
                aria-hidden
                data-numeric
                className="mt-px shrink-0 font-mono text-micro text-amber-deep tabular-nums"
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <span>{rule}</span>
            </li>
          ))}
        </ul>

        {/* The consent control is a native checkbox with a real label, at 20px.
            It gates the submit button, and the button also stays disabled so
            the requirement is visible before anything is clicked. */}
        <div className="mt-6 flex items-start gap-3 border-t border-line pt-5">
          <input
            type="checkbox"
            id="rules"
            checked={acceptedRules}
            onChange={(e) => setAcceptedRules(e.target.checked)}
            className="mt-0.5 size-5 shrink-0 cursor-pointer accent-ink"
          />
          <label htmlFor="rules" className="cursor-pointer text-small font-medium text-ink">
            I have read these and I am ready to begin.
          </label>
        </div>
      </section>

      {/* ─── Sign in ─────────────────────────────────────────────────────── */}
      <section className="rounded-lg border border-line bg-surface p-6">
        <h2 className="font-display text-h3 text-ink">Candidate sign-in</h2>
        <p className="mt-1.5 text-small leading-relaxed text-ink-soft">
          Use the email you registered with and the code printed on your ticket.
        </p>

        <form onSubmit={handleLogin} className="mt-6 flex flex-col gap-4">
          <Field label="Email address">
            {({ id }) => (
              <div className="relative">
                <Mail
                  aria-hidden
                  className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-faint"
                />
                <Input
                  id={id}
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="name@example.com"
                  className="pl-10"
                />
              </div>
            )}
          </Field>

          <Field
            label="Ticket code"
            hint={`Printed on your ticket. ${COURSES.length} tracks are open this year.`}
          >
            {({ id, describedBy }) => (
              <div className="relative">
                <Ticket
                  aria-hidden
                  className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-faint"
                />
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  name="ticketId"
                  type="text"
                  required
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="TS26-XXXXXXXX"
                  className="pl-10 font-mono uppercase tracking-wider"
                />
              </div>
            )}
          </Field>

          {message ? (
            <Alert tone="critical" icon={ShieldAlert}>
              {message}
            </Alert>
          ) : null}

          <Button type="submit" size="lg" disabled={loading || !acceptedRules}>
            {loading ? (
              <>
                <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" />
                Signing in…
              </>
            ) : (
              <>
                Start the assessment
                <ArrowRight aria-hidden />
              </>
            )}
          </Button>

          <p className="text-small text-ink-soft">
            Lost your code?{" "}
            <a
              href={`mailto:${BRAND.contactEmail}`}
              className="font-medium text-ink underline decoration-line-strong underline-offset-4 transition-colors hover:decoration-ink"
            >
              Email {BRAND.contactEmail}
            </a>
            .
          </p>
        </form>
      </section>
    </div>
  );
}
