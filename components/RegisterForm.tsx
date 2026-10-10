"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Alert, Spinner } from "@/components/ui/display";
import { BRAND } from "@/config/branding";

// ─── TURNSTILE WIDGET ──────────────────────────────────────────────────────────
// Loaded lazily and only here. The script is third-party, so it should not be on
// any of the twenty other pages, and `render: "explicit"` keeps it from injecting
// a widget we did not ask for.

const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string | undefined;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<void> | null = null;

function loadTurnstile(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();

  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Turnstile failed to load")));
      return;
    }
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", () => resolve());
    script.addEventListener("error", () => reject(new Error("Turnstile failed to load")));
    document.head.appendChild(script);
  });

  return scriptPromise;
}

function Turnstile({
  siteKey,
  onToken,
  resetSignal,
}: {
  siteKey: string;
  onToken: (token: string | null) => void;
  /** Bump to force a fresh widget. Tokens are single-use, so a retry needs one. */
  resetSignal: number;
}) {
  const container = React.useRef<HTMLDivElement>(null);
  const widgetId = React.useRef<string | undefined>(undefined);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    if (!siteKey) return;
    let cancelled = false;

    loadTurnstile()
      .then(() => {
        if (cancelled || !container.current || !window.turnstile) return;
        widgetId.current = window.turnstile.render(container.current, {
          sitekey: siteKey,
          theme: "light",
          // Unobtrusive by default. A visible challenge only appears to a
          // browser Cloudflare is unsure about, which is the behaviour we want
          // for an honest applicant on a phone on a slow connection.
          size: "flexible",
          callback: (token: string) => onToken(token),
          "expired-callback": () => onToken(null),
          "error-callback": () => {
            setFailed(true);
            onToken(null);
          },
        });
      })
      .catch(() => setFailed(true));

    return () => {
      cancelled = true;
    };
    // Deliberately not depending on `onToken`: callers pass an inline closure,
    // and including it would tear the widget down and re-render it on every
    // keystroke. `resetSignal` is the only intended re-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey, resetSignal]);

  React.useEffect(() => {
    if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
  }, [resetSignal]);

  if (!siteKey) {
    return (
      <p className="text-small text-ink-soft">
        Bot protection is not configured on this deployment, so submissions are only rate-limited.
      </p>
    );
  }

  if (failed) {
    return (
      <Alert tone="caution">
        The verification widget could not load. Check your connection, or reload the page.
      </Alert>
    );
  }

  return <div ref={container} />;
}

// ─── THE FORM ──────────────────────────────────────────────────────────────────

type Course = { slug: string; label: string };

const CAREER_OPTIONS = [
  "Student",
  "Recent graduate",
  "Working",
  "Between roles",
  "Prefer not to say",
];

type ApiResponse = {
  success: boolean;
  error?: string;
  message?: string;
  field?: "name" | "email" | "course";
  ticketId?: string;
  duplicate?: boolean;
  emailed?: boolean;
};

function RegisterForm({ courses, siteKey }: { courses: Course[]; siteKey: string }) {
  const [busy, setBusy] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [fieldError, setFieldError] = React.useState<{ field: string; message: string } | null>(null);
  const [token, setToken] = React.useState<string | null>(null);
  const [resetSignal, setResetSignal] = React.useState(0);
  const [done, setDone] = React.useState<{ ticketId: string; duplicate: boolean; emailed: boolean } | null>(null);
  const [copied, setCopied] = React.useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setFormError(null);
    setFieldError(null);

    const data = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          email: data.get("email"),
          phone: data.get("phone"),
          course: data.get("course"),
          career: data.get("career"),
          turnstileToken: token,
        }),
      });

      const payload = (await response.json()) as ApiResponse;

      if (!response.ok || !payload.success) {
        setFormError(payload.message ?? "Something went wrong. Please try again.");
        if (payload.field && payload.message) {
          setFieldError({ field: payload.field, message: payload.message });
        }
        // The token is single-use, so a retry needs a new one.
        setToken(null);
        setResetSignal((n) => n + 1);
        return;
      }

      setDone({
        ticketId: payload.ticketId ?? "",
        duplicate: Boolean(payload.duplicate),
        emailed: Boolean(payload.emailed),
      });
    } catch {
      setFormError("We couldn't reach the server. Check your connection and try again.");
      setToken(null);
      setResetSignal((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  async function copyTicket() {
    if (!done) return;
    try {
      await navigator.clipboard.writeText(done.ticketId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  if (done) {
    return (
      <div className="flex flex-col gap-6">
        <Alert tone={done.duplicate ? "caution" : "positive"}>
          <strong className="font-semibold">
            {done.duplicate ? "You were already registered." : "You're registered."}
          </strong>{" "}
          {done.duplicate
            ? "This email already had a ticket, so here it is again. Nothing was duplicated."
            : "Keep this ticket ID safe - you need it, together with your email, to sign in on the day."}
        </Alert>

        <div className="flex flex-col gap-3 rounded-md border border-line-strong bg-paper-sunk p-5 sm:p-6">
          <p className="eyebrow">Your ticket ID</p>
          <div className="flex flex-wrap items-center gap-3">
            <p className="font-mono text-h3 text-ink tabular-nums select-all">{done.ticketId}</p>
            <Button type="button" variant="outline" size="sm" onClick={copyTicket}>
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <p className="text-body text-ink-soft">
            {done.emailed ? (
              <>
                We&apos;ve also emailed this to you. If it hasn&apos;t arrived in a few minutes, check
                your spam folder before contacting us.
              </>
            ) : (
              <>
                <strong className="font-semibold text-ink">
                  Our email provider is unavailable, so this ticket was not emailed.
                </strong>{" "}
                Screenshot it or copy it now, and bring it on the day. We&apos;ll also send it separately
                - if you lose it, email{" "}
                <a className="underline underline-offset-2 hover:text-ink" href={`mailto:${BRAND.contactEmail}`}>
                  {BRAND.contactEmail}
                </a>{" "}
                and we&apos;ll resend it.
              </>
            )}
          </p>

          <div className="rule" role="separator" />

          <Button asChild className="self-start">
            <a href="/assessment/login">Continue to sign in</a>
          </Button>
        </div>
      </div>
    );
  }

  const errorFor = (field: string) => (fieldError?.field === field ? fieldError.message : undefined);

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      {formError ? (
        <Alert tone="critical" role="alert">
          {formError}
        </Alert>
      ) : null}

      <Field label="Full name" error={errorFor("name")}>
        {({ id, describedBy }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            name="name"
            autoComplete="name"
            required
            maxLength={100}
            placeholder="As it appears on your ID"
          />
        )}
      </Field>

      <Field
        label="Email address"
        error={errorFor("email")}
        hint="You sign in with this, so it has to be the one you can reach on the day."
      >
        {({ id, describedBy }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            maxLength={254}
            placeholder="you@example.com"
          />
        )}
      </Field>

      <Field label="Phone number" hint="Optional. Only used if we need to reach you on the day.">
        {({ id, describedBy }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={30}
            placeholder="+254 7XX XXX XXX"
          />
        )}
      </Field>

      <Field
        label="Programme of interest"
        error={errorFor("course")}
        hint="You can change this later. It decides which assessment you sit."
      >
        {({ id, describedBy }) => (
          <Select id={id} aria-describedby={describedBy} name="course" defaultValue="">
            <option value="">Not sure yet</option>
            {courses.map((course) => (
              <option key={course.slug} value={course.slug}>
                {course.label}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field label="Current status" hint="Optional.">
        {({ id, describedBy }) => (
          <Select id={id} aria-describedby={describedBy} name="career" defaultValue="">
            <option value="">Prefer not to say</option>
            {CAREER_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <div className="flex flex-col gap-4 border-t border-line pt-6">
        <Turnstile siteKey={siteKey} onToken={setToken} resetSignal={resetSignal} />

        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" size="lg" disabled={busy || (Boolean(siteKey) && !token)}>
            {busy ? (
              <>
                <Spinner aria-hidden /> Registering…
              </>
            ) : (
              "Register"
            )}
          </Button>
          <p className="text-small text-ink-soft">
            By registering you agree to sit the assessment on the published date.
          </p>
        </div>
      </div>
    </form>
  );
}

export { RegisterForm };
export default RegisterForm;
