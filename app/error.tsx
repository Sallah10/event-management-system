"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

/**
 * The error boundary for the root layout.
 *
 * There was no `error.tsx` anywhere in the product, so any render failure showed
 * Next's default error page: unstyled, off-palette, no link home, and no way for
 * a candidate mid-exam to tell a crashed server from a paper that was lost. A
 * candidate in that position is the exact person this file is for.
 *
 * `reset()` retries the render rather than reloading, which matters here: a
 * re-render keeps the URL and any form state, and a full reload during an exam
 * would cost the candidate their place.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Left in deliberately: Vercel captures server console output, and without
    // this a boundary error is a blank page and a support ticket with no detail.
    console.error("Unhandled route error:", error);
  }, [error]);

  return (
    <main
      id="main"
      className="flex min-h-dvh flex-col justify-center bg-paper px-5 py-20 sm:px-8"
    >
      <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
        <p className="rule eyebrow">Something broke</p>

        <h1 className="font-display text-h1 text-balance text-ink">
          This page failed to load.
        </h1>

        <p className="measure text-lead text-pretty text-ink-soft">
          It is a fault on our side, not yours. If you were part-way through an
          assessment, your answers were saved as you typed - retrying will bring
          you back to where you were.
        </p>

        {/* The digest is what an operator needs to find this in the logs, so
            it is shown rather than swallowed. */}
        {error.digest ? (
          <p className="text-small text-ink-faint">
            Reference:{" "}
            <code data-numeric className="font-mono text-ink-soft">
              {error.digest}
            </code>
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button onClick={reset} size="lg">
            Try again
          </Button>
          <Button asChild variant="ghost" size="lg">
            <Link href="/">Go to the front page</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
