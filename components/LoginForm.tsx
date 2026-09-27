"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { LogIn, Ticket, Mail, Loader2, ShieldAlert } from "lucide-react";
import { apiFetch } from "@/lib/client/api";
import { BRAND } from "@/config/branding";
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
  // ?reason=disqualified — a string the redirect could produce for several very
  // different reasons, so a candidate whose session merely expired was told they
  // had been disqualified. A disqualification is a serious thing to tell
  // someone on the strength of a query parameter. Each reason now says what
  // actually happened.
  //
  // Derived during render rather than pushed into state by an effect. `reason`
  // is already available here, so an effect that copies it into `error` was a
  // second render pass for a value we already had — and it meant the message
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
    <div className="grid w-full max-w-5xl grid-cols-1 gap-6 md:grid-cols-2">
      {/* ─── Rules ────────────────────────────────────────────────────────── */}
      <Card className="border-stone-300 bg-white">
        <CardHeader>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">
            Before you begin
          </p>
          <CardTitle className="font-serif text-2xl tracking-tight text-stone-900">
            Rules of the assessment
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm leading-relaxed text-stone-700">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              {TOTAL_QUESTIONS} objective questions in{" "}
              <strong>{OBJECTIVE_TTL_MINUTES} minutes</strong>.
            </li>
            <li>
              The top <strong>{QUALIFIED_POOL_SIZE}</strong> by score — ties
              broken by who finished first — go through to{" "}
              <strong>{THEORY_TTL_MINUTES} minutes</strong> of written questions.
            </li>
            <li>
              A score of <strong>{PASS_MARK_PERCENT}%</strong> is needed to be
              eligible for a place in the pool.
            </li>
            <li>
              Your exam is tied to this browser. Opening it on a second device
              signs you out here.
            </li>
            <li>Switching tabs and leaving the page are recorded for review.</li>
            <li>
              Writing is your own. Essays are screened for machine-generated
              text, and a human reviews anything flagged.
            </li>
          </ul>

          <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <input
              type="checkbox"
              id="rules"
              checked={acceptedRules}
              onChange={(e) => setAcceptedRules(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-amber-700"
            />
            <label htmlFor="rules" className="cursor-pointer font-medium text-stone-900">
              I have read these and I am ready to begin.
            </label>
          </div>
        </CardContent>
      </Card>

      {/* ─── Sign in ─────────────────────────────────────────────────────── */}
      <Card className="w-full border-stone-300 bg-white">
        <CardHeader className="text-center">
          <div className="mb-1 flex justify-center">
            <div className="rounded-full bg-amber-100 p-3">
              <LogIn className="h-6 w-6 text-amber-800" />
            </div>
          </div>
          <CardTitle className="font-serif text-2xl tracking-tight text-stone-900">
            Candidate sign-in
          </CardTitle>
          <CardDescription>
            Use the email you registered with and the code on your ticket.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="email" className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                Email address
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-stone-400" />
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="name@example.com"
                  className="w-full rounded-lg border border-stone-300 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-amber-600 focus:ring-2 focus:ring-amber-100"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="ticketId" className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                Ticket code
              </label>
              <div className="relative">
                <Ticket className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-stone-400" />
                <input
                  id="ticketId"
                  name="ticketId"
                  type="text"
                  required
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="TS26-XXXXXXXX"
                  className="w-full rounded-lg border border-stone-300 bg-white py-2.5 pl-9 pr-3 font-mono text-sm uppercase outline-none transition focus:border-amber-600 focus:ring-2 focus:ring-amber-100"
                />
              </div>
            </div>

            {message && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
              >
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{message}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !acceptedRules}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-stone-900 px-4 py-3 text-sm font-semibold text-stone-50 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Start the assessment"}
            </button>

            <p className="text-center text-xs text-stone-500">
              Lost your code? Email{" "}
              <a
                href={`mailto:${BRAND.contactEmail}`}
                className="underline underline-offset-2 hover:text-stone-800"
              >
                {BRAND.contactEmail}
              </a>
              . {COURSES.length} tracks are open this year.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
