import { Suspense } from "react";
import type { Metadata } from "next";
import LoginForm from "@/components/LoginForm";
import { Spinner } from "@/components/ui/display";
import { TICKET_PREFIX } from "@/lib/tickets";

// The wrapper painted the whole page `#E6E6FF` and the spinner `#0000FF` - a
// blue that exists nowhere else in the product, so the login screen was the one
// place a candidate saw a different brand. Both are gone.
//
// The fallback also had no accessible name: it was a bare `div` spinner, so a
// screen reader heard nothing while the form loaded. `Spinner` announces it.
export const metadata: Metadata = {
  title: "Candidate sign-in",
};

export default function LoginPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-paper px-5 py-12">
      <Suspense
        fallback={
          <div className="flex flex-col items-center gap-3">
            <Spinner className="text-ink-soft" label="Loading sign-in" />
            <p className="text-small text-ink-faint">Loading sign-in…</p>
          </div>
        }
      >
        <LoginForm ticketPrefix={TICKET_PREFIX} />
      </Suspense>
    </div>
  );
}
