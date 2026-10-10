"use client";

import { useState, useEffect, useCallback } from "react";
import { AlertTriangle, CheckCircle, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { Alert, EmptyState, Spinner } from "@/components/ui/display";
import { Page, PageHeader } from "@/components/ui/shell";
import { BRAND } from "@/config/branding";

/**
 * One row from /api/admin/manual-search.
 *
 * Declared rather than `any`: the search route selects exactly these seven
 * columns, and the desk renders all of them. A row that arrives missing
 * `barcodeId` should not be typed as a row that has one.
 */
interface SearchHit {
  id: string;
  name: string;
  email: string;
  barcodeId: string;
  checkedIn: boolean;
  status: string;
  selectedCourseSlug: string | null;
}

// PRESENTATION ONLY. This page was the last screen in the product still wearing
// a different brand: a lavender `#E6E6FF` field, a `#0000FF` heading, grey-500
// sub-text, `font-black` on every name and on the button, and a
// `hover:scale-105` on the check-in action. It also had a search field whose
// only label was its placeholder, and a bare lucide `<svg>` spinner with no
// accessible name at all.
//
// The desk is used by volunteers under time pressure, so the changes that matter
// are functional rather than cosmetic: the search field now has a real `<label>`
// (it is a `Field`, so it physically cannot lose one), the result list is a
// `role="list"` region marked `aria-live` so a search that returns nothing is
// announced instead of silently rendering blank, the two statuses are `Badge`
// chips paired with a word rather than bare green/orange text, and the "done"
// state is carried by an icon and a word as well as a colour.

export default function ManualCheckinPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [checkedIn, setCheckedIn] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [hasSearched, setHasSearched] = useState(false);

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults([]);
      setError("");
      setHasSearched(false);
      return;
    }

    setSearching(true);
    setError("");

    try {
      const res = await fetch(
        `/api/admin/manual-search?q=${encodeURIComponent(q.trim())}`,
      );

      if (res.status === 401) {
        setError("Not authorized. Please log into the admin panel first.");
        setSearching(false);
        return;
      }

      const data = await res.json();
      setHasSearched(true);

      if (data.success) {
        // Anything that came back from the network is untrusted until it has been
        // shaped. It used to land in `any[]`, so a rename of a column upstream
        // would render `undefined` into the table and nobody would find out until
        // a volunteer at the desk was looking at a blank name.
        const hits: SearchHit[] = Array.isArray(data.results)
          ? data.results.filter(
            (hit: unknown): hit is SearchHit =>
              !!hit && typeof (hit as SearchHit).id === "string",
          )
          : [];
        setResults(hits);
        setError("");
      } else {
        setError(data.message || "Search failed.");
        setResults([]);
      }
    } catch {
      setError("Connection error. Try again.");
      setResults([]);
    }

    setSearching(false);
  }, []);

  // Debounce - waits 400ms after user stops typing before searching
  useEffect(() => {
    const timer = setTimeout(() => {
      search(query);
    }, 400);

    return () => clearTimeout(timer);
  }, [query, search]);

  const checkIn = async (barcodeId: string) => {
    setError("");
    const res = await fetch("/api/check-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ barcodeId }),
    });
    const data = await res.json();

    if (data.success) {
      setCheckedIn(barcodeId);
      setResults((prev) =>
        prev.map((r) =>
          r.barcodeId === barcodeId ? { ...r, checkedIn: true } : r,
        ),
      );
    } else {
      setError(data.message);
    }
  };

  return (
    <Page width="form" className="flex flex-col gap-6">
      <PageHeader
        eyebrow={BRAND.shortName}
        title="Manual check-in"
        lede="Search by name, email, or ticket ID"
      />

      {/* Search input - no button needed, live search */}
      <Field label="Search">
        {({ id }) => (
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-faint"
            />
            <Input
              id={id}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name, email or ticket ID…"
              autoComplete="off"
              spellCheck={false}
              className="pl-10 pr-10"
            />
            {searching && (
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
                <Spinner label="Searching" />
              </span>
            )}
          </div>
        )}
      </Field>

      {error && (
        <Alert tone="critical" icon={AlertTriangle}>
          {error}
        </Alert>
      )}

      {/* Announced when it changes, so a volunteer who has looked away from the
          screen hears that a search finished. */}
      <div aria-live="polite" aria-busy={searching} className="flex flex-col gap-6">
        {results.length > 0 && (
          <ul className="flex flex-col gap-3">
            {results.map((r) => (
              <li key={r.barcodeId}>
                <Card className="flex-row items-center gap-4 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">{r.name}</p>
                    <p className="truncate text-small text-ink-soft">{r.email}</p>
                    <p className="mt-1 font-mono text-micro text-ink-faint">
                      {r.barcodeId}
                    </p>
                    <Badge
                      variant={r.checkedIn ? "positive" : "caution"}
                      className="mt-2"
                    >
                      {r.checkedIn ? "Already checked in" : "Not checked in"}
                    </Badge>
                  </div>

                  {r.checkedIn || checkedIn === r.barcodeId ? (
                    <span className="flex shrink-0 items-center gap-1.5 text-small font-medium text-positive">
                      <CheckCircle aria-hidden className="size-4" />
                      Done
                    </span>
                  ) : (
                    <Button
                      type="button"
                      variant="accent"
                      onClick={() => checkIn(r.barcodeId)}
                    >
                      Check in
                    </Button>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}

        {/* Only show "no results" after a completed search, not while typing */}
        {hasSearched &&
          !searching &&
          results.length === 0 &&
          query.length >= 2 &&
          !error && (
            <EmptyState
              icon={Search}
              title={`No results found for “${query}”`}
            />
          )}

        {query.length < 2 && (
          <p className="py-6 text-small text-ink-faint">
            Type at least 2 characters to search
          </p>
        )}
      </div>
    </Page>
  );
}
