"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Download,
  Inbox,
  LogOut,
  Search,
  ShieldAlert,
  Sparkles,
  UserCheck,
} from "lucide-react";
import { apiFetch, type ApiResult } from "@/lib/client/api";
import { BRAND } from "@/config/branding";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import {
  Alert,
  EmptyState,
  Spinner,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  Tabs,
} from "@/components/ui/display";
import { Page, PageHeader, Stack } from "@/components/ui/shell";
import CandidatePanel, { type QueueRow } from "@/components/admissions/CandidatePanel";

// ─── ADMISSIONS PORTAL ────────────────────────────────────────────────────────
// The decision surface. Replaces a process that did not exist: previously an
// officer could trigger the AI grader and read essays, but there was nowhere to
// shortlist anybody, nowhere to award a seat, and no list of who was waiting. The
// status column had four legal values written by four routes, and the "award a
// scholarship" button was a student pressing Submit.
//
// Three tabs, in the order a reviewer works them:
//   • Grading     — essays in, scores out. Ordered by objective rank, so the pool
//                   is worked from the strongest candidate downwards.
//   • Integrity   — every candidate a human has flagged or the AI has marked.
//                   Note that the AI's opinion is a SEPARATE field from the human
//                   flag, and this list shows both, labelled. Conflating them is
//                   how a model gets to disqualify somebody by itself.
//   • Awards      — who holds a seat, and the one button that creates one.
//
// Every status change goes to /api/admissions/decision, which is a transaction
// plus an audit row, and the seat cap is enforced inside it. The buttons here
// cannot bypass that, because there is no other path to a status.
//
// PRESENTATION ONLY. The frame was a white masthead on a rounded-3xl card, the
// three queues were `rounded-2xl` buttons with `font-bold` labels and a second
// line of 11px text, the table was hand-rolled with `tracking-widest` headers,
// and the empty queue rendered a bare "Nothing in this queue" row. It is now the
// shared frame — one h1 from `PageHeader`, `Tabs` for the three queues,
// `Field` for the search (it had a placeholder and an aria-label but no visible
// label), `Table` for the queue and `Badge` for the three integrity markers.

type Tab = "grading" | "integrity" | "awards";

const TABS: { id: Tab; label: string; hint: string; status: string }[] = [
  {
    id: "grading",
    label: "Grading",
    hint: "Essays submitted, awaiting a decision",
    status: "completed",
  },
  {
    id: "integrity",
    label: "Integrity",
    hint: "Flagged for a human to look at",
    status: "qualified,completed,attended,registered,waitlisted",
  },
  {
    id: "awards",
    label: "Seats",
    hint: "Shortlisted and awarded",
    status: "shortlisted,awarded",
  },
];

export default function AdmissionsPage() {
  // useSearchParams during prerender needs a Suspense boundary, so the component
  // that reads the query string is split out below. The previous version copied
  // window.location.search into state from an effect, which is a render pass whose
  // only purpose was to read a value the router already had.
  return (
    <Suspense fallback={<QueueSkeleton />}>
      <AdmissionsQueue />
    </Suspense>
  );
}

function QueueSkeleton() {
  return (
    <Page width="wide" className="flex min-h-dvh items-center justify-center">
      <Spinner className="text-ink-soft" label="Loading the queue" />
    </Page>
  );
}

function AdmissionsQueue() {
  const [tab, setTab] = useState<Tab>("grading");
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const denied = useSearchParams().get("denied") === "staff";
  const [selected, setSelected] = useState<QueueRow | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const router = useRouter();

  // The queue the reviewer is looking at, for the one line of context under the
  // tabs. `Tabs` takes a plain string, so the change is routed back through the
  // list rather than cast — the same two state updates the old inline handler
  // made, and no others.
  const activeTab = TABS.find((item) => item.id === tab)!;

  // Debounced search, so typing a name is one query rather than eleven.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  // Build the query for the current tab, then fetch it. Fetching and applying are
  // separate so the effect below can set state inside a promise callback — which
  // is cancellable, and means a response that lands after the reviewer has
  // switched tabs or signed out does not overwrite what they are now looking at.
  const fetchQueue = useCallback(() => {
    const active = TABS.find((t) => t.id === tab)!;
    const params = new URLSearchParams({ status: active.status, pageSize: "50" });
    if (tab === "integrity") params.set("flagged", "true");
    if (tab === "grading") params.set("graded", "false");
    if (search) params.set("q", search);
    return apiFetch<{ rows: QueueRow[]; total: number }>(`/api/admissions/queue?${params}`);
  }, [tab, search]);

  const applyQueue = useCallback(
    (result: ApiResult<{ rows: QueueRow[]; total: number }>) => {
      if (result.status === 401) {
        router.replace("/admin/login");
        return;
      }
      if (result.ok) {
        setRows(result.data.rows);
        setTotal(result.data.total);
        setError(null);
      } else {
        setError(result.message);
      }
    },
    [router],
  );

  const load = useCallback(async () => {
    // No setLoading(true) at the top: the mount call already starts with `loading`
    // true, and a state change on the way into an effect is a second render pass
    // for nothing. The refresh after a decision sets it in its own handler.
    applyQueue(await fetchQueue());
    setLoading(false);
  }, [applyQueue, fetchQueue]);

  useEffect(() => {
    let cancelled = false;
    void fetchQueue().then((result) => {
      if (cancelled) return;
      applyQueue(result);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [applyQueue, fetchQueue]);

  const signOut = async () => {
    await apiFetch("/api/admin/auth", { method: "DELETE" });
    router.replace("/admin/login");
  };

  // After a decision, refresh the list and drop the panel. The reviewer almost
  // always wants the next candidate, and leaving a stale panel open over a row
  // that has changed status is how a second decision gets applied to the wrong
  // person.
  const onDecided = (message: string) => {
    setSelected(null);
    setBanner(message);
    void load();
  };

  return (
    <Page width="wide" className="flex flex-col gap-6">
      <PageHeader
        eyebrow={`${BRAND.shortName} · Admissions`}
        title="Decisions"
        actions={
          <>
            {/* A real file download, so it stays an <a>: `download` tells the
                browser to save the response instead of navigating to it, and the
                server builds the payload on request. The accessible name says so
                rather than leaving a reviewer to guess whether it is a page. */}
            <Button asChild variant="outline">
              <a
                href="/api/admin/winners-export"
                download="winners-export.json"
              >
                <Download aria-hidden />
                Winners export
                <span className="sr-only">
                  {" "}— built on the server and downloaded as a file
                </span>
              </a>
            </Button>

            <Button type="button" variant="ghost" onClick={signOut}>
              <LogOut aria-hidden />
              Sign out
            </Button>
          </>
        }
      />

      {denied && (
        <Alert tone="caution" icon={ShieldAlert}>
          You are signed in as event staff, so scholarship decisions are not
          available to you. The{" "}
          <Link
            href="/admin/dashboard"
            className="font-medium text-ink underline decoration-line-strong underline-offset-4 transition-colors hover:decoration-ink"
          >
            attendance desk
          </Link>{" "}
          is open to you.
        </Alert>
      )}

      {banner && (
        <Alert tone="positive" icon={UserCheck} role="status">
          {banner}
        </Alert>
      )}

      {error && (
        <Alert tone="critical" icon={AlertTriangle} role="alert">
          {error}
        </Alert>
      )}

      {/* Three queues, one selection. `Tabs` replaces three rounded-2xl buttons
          carrying their own hint line: the underline indicator is quieter, and
          the hint is now one line of context under the row rather than three
          stacked two-line buttons. `aria-selected` in a tablist replaces the
          `aria-current="page"` these buttons used — they are not links to pages,
          they are a filter over the queue on this page, and claiming otherwise
          told a screen reader they navigated somewhere. */}
      <Stack gap="sm">
        <Tabs
          value={tab}
          onValueChange={(value) => {
            const next = TABS.find((item) => item.id === value);
            if (!next) return;
            setTab(next.id);
            setSelected(null);
          }}
          aria-label="Candidate queues"
          items={TABS.map((item) => ({ value: item.id, label: item.label }))}
        />
        <p className="text-small text-ink-soft">{activeTab.hint}</p>
      </Stack>

      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <Field label="Search candidates" className="w-full max-w-sm">
          {({ id }) => (
            <div className="relative">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-faint"
              />
              <Input
                id={id}
                aria-label="Search candidates"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Name or ticket"
                autoComplete="off"
                className="pl-10"
              />
            </div>
          )}
        </Field>

        <p data-numeric className="text-small tabular-nums text-ink-soft">
          {loading ? "Loading…" : `${rows.length} of ${total}`}
        </p>
      </div>

      {selected && (
        <CandidatePanel
          candidate={selected}
          onClose={() => setSelected(null)}
          onDecided={onDecided}
        />
      )}

      {!loading && rows.length === 0 ? (
        <EmptyState icon={Inbox} title="Nothing in this queue">
          {tab === "grading" ? "No essays are awaiting grading." : null}
        </EmptyState>
      ) : (
        <Card>
          <Table>
            {/* A data table that says what it holds. The old one had column
                headers and nothing else, so a screen-reader user tabbing into it
                heard "Candidate, Objective, Theory" with no idea which queue or
                what activating a row does. */}
            <caption className="sr-only">
              {activeTab.label} queue — {activeTab.hint}. Activate a candidate&apos;s
              name to open the review panel.
            </caption>
            <THead>
              <tr>
                <TH>Candidate</TH>
                <TH className="text-right">Objective</TH>
                <TH className="text-right">Theory</TH>
                <TH>Track</TH>
                <TH>Review</TH>
              </tr>
            </THead>
            <TBody>
              {loading ? (
                <TR>
                  <TD colSpan={5} className="py-10 text-center">
                    <Spinner
                      className="justify-center text-ink-soft"
                      label="Loading the queue"
                    />
                  </TD>
                </TR>
              ) : (
                rows.map((row) => (
                  <TR
                    key={row.id}
                    onClick={() => setSelected(row)}
                    className={cn(
                      "cursor-pointer",
                      selected?.id === row.id && "bg-paper-sunk",
                    )}
                  >
                    <TD>
                      {/* The row click is a mouse affordance on a <tr>, which is
                          not focusable, so the candidate's name is also a real
                          button that calls the same state update. That is the only
                          keyboard route into a review that existed. */}
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        onClick={() => setSelected(row)}
                        aria-label={`Open review for ${row.name}`}
                        className="h-auto px-0 py-0.5 text-left text-small font-medium"
                      >
                        {row.name}
                      </Button>
                      <p className="font-mono text-micro text-ink-faint">
                        {row.barcodeId}
                      </p>
                    </TD>
                    <TD data-numeric className="text-right tabular-nums">
                      <p className="font-medium text-ink">
                        {row.objectiveScore ?? "—"}
                        <span className="text-small font-normal text-ink-faint">%</span>
                      </p>
                      <p className="text-micro text-ink-faint">
                        {row.objectiveRank ? `rank #${row.objectiveRank}` : "unranked"}
                      </p>
                    </TD>
                    <TD className="text-right" data-numeric>
                      {row.theoryGradedAt ? (
                        <>
                          <p className="font-medium text-ink">{row.theoryScore}</p>
                          <p className="text-micro text-ink-faint">graded</p>
                        </>
                      ) : (
                        /* Not a spinner: this queue is every ungraded essay, so
                           fifty rows would have been fifty rotating icons. The
                           amber dot and the word carry it. */
                        <Badge variant="accent">
                          <span
                            aria-hidden
                            className="size-1.5 rounded-pill bg-amber-deep"
                          />
                          awaiting
                        </Badge>
                      )}
                    </TD>
                    <TD className="text-small text-ink-soft">
                      {row.course ?? "—"}
                    </TD>
                    <TD>
                      {/* Three separate badges, never merged. A human flag, a
                          model opinion and a focus-loss count are different
                          facts with different consequences. */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        {row.isFlagged && (
                          <Badge variant="destructive">
                            <ShieldAlert aria-hidden />
                            Flagged
                          </Badge>
                        )}
                        {row.aiSuspected && (
                          <Badge
                            variant="accent"
                            title={row.aiGradeReason ?? undefined}
                          >
                            <Sparkles aria-hidden />
                            AI: {row.aiConfidence ?? "flagged"}
                          </Badge>
                        )}
                        {Number(row.tabSwitches) > 0 && (
                          <Badge
                            variant="secondary"
                            data-numeric
                            title={`${row.tabSwitches} recorded focus losses`}
                          >
                            {row.tabSwitches} focus
                          </Badge>
                        )}
                      </div>
                    </TD>
                  </TR>
                ))
              )}
            </TBody>
          </Table>
        </Card>
      )}

      <p className="measure border-t border-line pt-4 text-small leading-relaxed text-ink-soft">
        Flags and AI observations are shown separately and never the same thing: a
        flag suspends a candidate pending review, an AI note is a suggestion for
        whoever reviews. Deciding a candidate is disqualified is a person&apos;s
        call, it requires a written reason, and both actions are recorded with
        your name against the time.
      </p>
    </Page>
  );
}
