"use client";

import { useState } from "react";
import { LifeBuoy, Loader2, X } from "lucide-react";
import { apiFetch } from "@/lib/client/api";
import { BRAND } from "@/config/branding";

// ─── TECHNICAL SUPPORT ────────────────────────────────────────────────────────
// A genuinely good idea, and worth keeping: the most common thing that goes
// wrong in a live exam is the candidate's own setup, and an invigilator queue of
// people who cannot finish is a bad afternoon for everyone.
//
// What it was doing wrong:
//   • It posted `email` and `ticketId` from props that the pages filled in from
//     `localStorage`, so the identity attached to a support report was whatever
//     the browser claimed. The route now reads the signed session instead, and
//     this component sends no identity at all.
//   • The failure toast told the candidate to email `support@1techacdemy.com` —
//     a real address, hardcoded in the UI, wrong domain from the route's real
//     address, and unreachable in any deployment that isn't theirs. Now BRAND.
//   • Raw `fetch` with no credentials, and the response read as `data.success`
//     even on a 500.
//   • #0000FF on white, again.
//
// The note in the panel is the important part and it is kept verbatim in spirit:
// reporting a problem does not flag the account. See the old IntegrityObserver
// comment for how that used to be false.

const ISSUES = [
  { value: "back_button", label: "I pressed the browser back button" },
  { value: "tab_switch", label: "I lost focus or switched tabs by accident" },
  { value: "window_resize", label: "The window resized or moved" },
  { value: "browser_crash", label: "The browser or device crashed" },
  { value: "network", label: "I lost my network connection" },
  { value: "device_locked", label: "My phone locked or went to sleep" },
  { value: "other", label: "Something else" },
];

export default function TechnicalSupport() {
  const [open, setOpen] = useState(false);
  const [issue, setIssue] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!issue || submitting) return;
    setSubmitting(true);
    setError(null);
    setMessage(null);

    const result = await apiFetch<{ emailed: boolean }>(
      "/api/assessment/report-issue",
      {
        method: "POST",
        body: JSON.stringify({
          issue,
          description,
          url: window.location.pathname,
        }),
      },
    );

    if (result.ok) {
      setMessage(result.data.emailed ? "Reported — we'll be in touch." : "Recorded.");
      setIssue("");
      setDescription("");
      // Leave the panel open on success so the confirmation is actually read.
      window.setTimeout(() => setOpen(false), 2500);
    } else {
      setError(result.message);
    }
    setSubmitting(false);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Report a technical problem"
        className="fixed bottom-4 right-4 z-40 grid h-12 w-12 place-items-center rounded-full border border-ink/15 bg-white text-ink shadow-lg transition-colors hover:border-ink/40"
      >
        <LifeBuoy className="h-5 w-5" aria-hidden />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-ink/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="support-title"
        >
          <div className="w-full max-w-md rounded-3xl bg-white p-7 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <h2 id="support-title" className="text-lg font-bold">
                Something gone wrong?
              </h2>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded-full p-1 text-ink-soft hover:bg-ink/5"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>

            <p className="mt-3 rounded-2xl bg-paper p-4 text-sm leading-relaxed text-ink-soft">
              Telling us about a problem{" "}
              <strong className="text-ink">will not flag your account</strong>. An
              admissions reviewer looks at these, and your paper keeps its place on
              the clock.
            </p>

            <div className="mt-5 space-y-4">
              <div>
                <label
                  htmlFor="support-issue"
                  className="text-[11px] font-bold uppercase tracking-[0.18em] text-ink-soft"
                >
                  What happened
                </label>
                <select
                  id="support-issue"
                  value={issue}
                  onChange={(event) => setIssue(event.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-ink/15 bg-white p-3 text-sm outline-none focus:border-ink/40"
                >
                  <option value="">Choose one…</option>
                  {ISSUES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="support-detail"
                  className="text-[11px] font-bold uppercase tracking-[0.18em] text-ink-soft"
                >
                  Anything else <span className="font-normal">(optional)</span>
                </label>
                <textarea
                  id="support-detail"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={3}
                  maxLength={2000}
                  placeholder="What you were doing when it happened."
                  className="mt-1.5 w-full resize-none rounded-xl border border-ink/15 bg-white p-3 text-sm outline-none focus:border-ink/40"
                />
              </div>
            </div>

            {message && (
              <p className="mt-4 rounded-xl bg-amber/15 p-3 text-sm font-semibold">
                {message}
              </p>
            )}
            {error && (
              <p
                role="alert"
                className="mt-4 rounded-xl border border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-900"
              >
                {error}
              </p>
            )}

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setOpen(false)}
                className="flex-1 rounded-full border border-ink/20 px-4 py-2.5 text-sm font-semibold"
              >
                Close
              </button>
              <button
                onClick={submit}
                disabled={!issue || submitting}
                className="flex-1 rounded-full bg-ink px-4 py-2.5 text-sm font-bold text-paper disabled:opacity-50"
              >
                {submitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Sending
                  </span>
                ) : (
                  "Send report"
                )}
              </button>
            </div>

            <p className="mt-4 text-center text-xs text-ink-soft">
              Or email{" "}
              <a
                href={`mailto:${BRAND.contactEmail}`}
                className="font-semibold underline underline-offset-2"
              >
                {BRAND.contactEmail}
              </a>
            </p>
          </div>
        </div>
      )}
    </>
  );
}
