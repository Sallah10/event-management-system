"use client";

import { useState } from "react";
import { LifeBuoy, Loader2, ShieldCheck } from "lucide-react";
import { apiFetch } from "@/lib/client/api";
import { BRAND } from "@/config/branding";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/display";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
//   • The failure toast told the candidate to email an address that belonged to
//     whoever ran the previous cohort - wrong domain from the route's real
//     address, and unreachable in any deployment that isn't theirs. Now BRAND.
//   • Raw `fetch` with no credentials, and the response read as `data.success`
//     even on a 500.
//   • #0000FF on white, again.
//
// The note in the panel is the important part and it is kept verbatim in spirit:
// reporting a problem does not flag the account. See the old IntegrityObserver
// comment for how that used to be false.
//
// Presentation: this is a reassurance dialog, so the reassurance is the largest
// element in it and the form is secondary. The reassurance also leads with an
// icon rather than being a grey box, because a candidate deciding whether to
// trust this dialog is reading its shape before its words.

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
      setMessage(result.data.emailed ? "Reported - we'll be in touch." : "Recorded.");
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
      {/* Sits above the exam footer rather than over it, and carries a visible
          label - a 48px circle with a lone lifebuoy is a control nobody can
          name. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 inline-flex h-11 items-center gap-2 rounded-pill border border-line-strong bg-surface px-4 text-small font-medium text-ink shadow-float transition-colors duration-[var(--duration-quick)] hover:border-ink"
      >
        <LifeBuoy aria-hidden className="size-4" />
        <span className="hidden sm:inline">Report a problem</span>
        <span className="sr-only sm:hidden">Report a technical problem</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="font-display text-h4 text-ink">
              Something gone wrong?
            </DialogTitle>
            <DialogDescription asChild>
              {/* The reassurance is the point of this dialog, so it is set as
                  the description and given the icon, not buried in the body. */}
              <span className="flex items-start gap-2.5 rounded-md border border-positive/30 bg-positive/8 p-3.5 text-small leading-relaxed text-ink">
                <ShieldCheck aria-hidden className="mt-px size-4 shrink-0 text-positive" />
                <span>
                  Telling us about a problem{" "}
                  <strong className="font-semibold">will not flag your account</strong>.
                  An admissions reviewer looks at these, and your paper keeps its
                  place on the clock.
                </span>
              </span>
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <Field label="What happened">
              {({ id }) => (
                <Select
                  id={id}
                  value={issue}
                  onChange={(value) => setIssue(value)}
                  placeholder="Choose one…"
                  options={ISSUES.map((item) => ({
                    value: item.value,
                    label: item.label,
                  }))}
                />
              )}
            </Field>

            <Field
              label="Anything else"
              hint="Optional. What you were doing when it happened."
            >
              {({ id, describedBy }) => (
                <Textarea
                  id={id}
                  aria-describedby={describedBy}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={3}
                  maxLength={2000}
                  className="resize-none"
                />
              )}
            </Field>
          </div>

          {message ? <Alert tone="positive">{message}</Alert> : null}
          {error ? <Alert tone="critical">{error}</Alert> : null}

          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <p className="order-last text-small text-ink-soft sm:order-first sm:self-center">
              Or email{" "}
              <a
                href={`mailto:${BRAND.contactEmail}`}
                className="font-medium text-ink underline decoration-line-strong underline-offset-4 transition-colors hover:decoration-ink"
              >
                {BRAND.contactEmail}
              </a>
            </p>
            <div className="flex gap-2">
              <DialogClose asChild>
                <Button variant="ghost">Close</Button>
              </DialogClose>
              <Button onClick={submit} disabled={!issue || submitting}>
                {submitting ? (
                  <>
                    <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" />
                    Sending
                  </>
                ) : (
                  "Send report"
                )}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
