"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  LogOut,
  RefreshCw,
  ScanLine,
  ShieldAlert,
  UserCheck,
} from "lucide-react";
import { apiFetch, type ApiResult } from "@/lib/client/api";
import { BRAND } from "@/config/branding";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Alert,
  EmptyState,
  Spinner,
  Stat,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from "@/components/ui/display";
import { Page, PageHeader, Stack } from "@/components/ui/shell";

// ─── STAFF DASHBOARD ──────────────────────────────────────────────────────────
// Rebuilt. The two things worth reading about are the ones that were removed.
//
// 1. IT SENT A SECRET TO THE BROWSER.
//        headers: { "x-api-key": process.env.NEXT_PUBLIC_INTERNAL_API_KEY }
//        headers: { "x-api-key": process.env.NEXT_PUBLIC_ADMIN_SECRET! }
//    `NEXT_PUBLIC_*` is inlined into the client bundle at build time. Both values
//    were therefore published to anyone who loaded the page and read the JS -
//    and the routes behind them also accepted them, so this was not a cosmetic
//    header. Authentication here is the staff session cookie, which is httpOnly
//    and signed. Nothing secret goes in a browser bundle any more.
//
// 2. THE AI AUDIT BUTTON WAS ON THE WRONG SCREEN, UNDER THE WRONG ROLE.
//    It POSTed to /api/admin/ai-audit, which requires `admissions` - so for the
//    `staff` role that signed in here it could only ever return 403. It also
//    wrote the OpenAI batch id to localStorage, which on a shared event laptop
//    means the next person at that desk inherits a half-finished batch job and
//    no idea what it cost. Grading and AI review are admissions actions; the
//    button now lives with them.
//
// The hardcoded `3500` and `(910)` are gone too. Both were literals in this
// file while the server read VENUE_CAPACITY and QUALIFIED_POOL_SIZE, so
// retuning either one left the staff dashboard quoting last year's numbers to
// the person running the door.
//
// PRESENTATION ONLY. This was the most machine-styled screen in the product: a
// sticky white header with four rounded-full controls, five rounded-3xl panels,
// a hand-rolled `Metric` card with a `font-black` 30px number, uppercase
// `tracking-[0.2em]` section kickers, a hand-rolled table, and
// `aria-label="Loading"` on a bare `<svg>` - which is not a labellable role, so
// the Suspense fallback announced nothing at all. It is now `Page` +
// `PageHeader` for the frame, `Stat` for the figures, `Table` for the queue,
// `Alert` for the two banners and `Spinner` for every loading state, and the
// amber is rationed to the one door that matters: the fill meter and the link to
// the check-in desk.

interface Stats {
  summary: {
    total: number;
    checkedIn: number;
    attendanceRate: number;
    venueCapacity: number;
    venueRemaining: number;
  };
  pool: { size: number; finished: number; insidePool: number; remaining: number };
  scholarships: {
    total: number;
    perCourse: number;
    awarded: number;
    shortlisted: number;
  };
  queue: { finishedObjective: number; awaitingGrading: number; flagged: number };
  pipeline: { key: string; label: string; blurb: string; count: number }[];
  courses: {
    slug: string;
    displayName: string;
    taken: number;
    capacity: number;
    remaining: number;
    fillRate: number;
  }[];
  recent: {
    id: string;
    name: string;
    email: string;
    barcodeId: string;
    status: string;
    updatedAt: string;
  }[];
}

export default function StaffDashboard() {
  // The `denied` param is only ever a redirect reason in the query string, and
  // useSearchParams during prerender is a build error without a Suspense boundary
  // - so the real component is split out below and this wrapper provides one.
  // The previous version read window.location in an effect and held the result in
  // state, which was a render pass whose only job was to copy a value that was
  // already in the URL.
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <StaffDashboardInner />
    </Suspense>
  );
}

function DashboardSkeleton() {
  return (
    <Page width="wide" className="flex min-h-dvh items-center justify-center">
      <Spinner className="text-ink-soft" label="Loading the attendance desk" />
    </Page>
  );
}

function StaffDashboardInner() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const denied = useSearchParams().get("denied");
  const router = useRouter();

  // Fetch, with no state changes of its own.
  //
  // Splitting "get the numbers" from "put them on screen" is what lets the mount
  // effect below set state inside a promise callback, which is both what the React
  // lint rule wants (setState belongs in a subscription callback, not in the body
  // of an effect) and what makes the response cancellable. The previous version
  // called this same function straight from the effect, which meant a response
  // arriving after the operator had navigated away still called setState on a
  // component that no longer existed.
  const fetchStats = useCallback(() => apiFetch<Stats>("/api/admin/stats"), []);

  /** Apply a fetch result to state. Shared by the effect and the refresh button. */
  const applyStats = useCallback(
    (result: ApiResult<Stats>) => {
      if (result.ok) {
        setStats(result.data);
        setError(null);
        setLastSync(new Date());
        return;
      }
      // A 401 here means the session expired mid-shift, which happens: the cookie
      // has a maxAge. Sending them to sign in again is right; a silent empty
      // dashboard at a busy door is not.
      if (result.status === 401) {
        router.replace("/admin/login");
        return;
      }
      setError(result.message);
    },
    [router],
  );

  const load = useCallback(async () => {
    // No `setLoading(true)` here. The mount call already starts with `loading`
    // true, and setting it on the way into an effect is the extra render pass the
    // lint rule is right to object to. The refresh button sets it in its own
    // handler, where a state change is what the user just asked for.
    applyStats(await fetchStats());
    setLoading(false);
  }, [applyStats, fetchStats]);

  useEffect(() => {
    let cancelled = false;

    const run = () => {
      void fetchStats().then((result) => {
        if (cancelled) return;
        applyStats(result);
        setLoading(false);
      });
    };

    run();
    // Auto-refresh while the desk is in use. 30s is a compromise: the stats
    // query is two aggregates, and a door operator refreshing by hand every
    // thirty seconds is the behaviour we are replacing.
    const timer = setInterval(run, 30_000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [applyStats, fetchStats]);

  const signOut = async () => {
    await apiFetch("/api/admin/auth", { method: "DELETE" });
    router.replace("/admin/login");
  };

  return (
    <Page width="wide" className="flex flex-col gap-8">
      <PageHeader
        eyebrow={`${BRAND.shortName} · Staff`}
        title="Attendance desk"
        actions={
          <>
            <Button asChild variant="accent">
              <Link href="/checkin">
                <ScanLine aria-hidden />
                Check-in desk
              </Link>
            </Button>

            <Button asChild variant="outline">
              <Link href="/admin/manual-checkin">Manual desk</Link>
            </Button>

            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Refresh"
              onClick={() => {
                // Set the spinner here, in the handler, rather than at the top of
                // `load()`. The click is the user asking for a refresh, so a state
                // change belongs to it; the mount call has nothing to show.
                setLoading(true);
                void load();
              }}
            >
              <RefreshCw
                aria-hidden
                className={cn(
                  "size-4",
                  loading && "animate-spin motion-reduce:animate-none",
                )}
              />
            </Button>

            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmSignOut(true)}
            >
              <LogOut aria-hidden />
              Sign out
            </Button>
          </>
        }
      />

      {denied && (
        <Alert tone="caution" icon={ShieldAlert}>
          You are signed in as{" "}
          {denied === "admissions" ? "an admissions officer" : "event staff"}, so that
          area is not available to you. Admissions decisions live in{" "}
          <Link
            href="/admissions"
            className="font-medium text-ink underline decoration-line-strong underline-offset-4 transition-colors hover:decoration-ink"
          >
            the admissions portal
          </Link>
          .
        </Alert>
      )}

      {error && (
        <Alert tone="critical" icon={AlertTriangle} role="alert">
          {error} Figures below may be out of date.
        </Alert>
      )}

      <Stack gap="lg">
        {/* ─── HEADLINE ──────────────────────────────────────────────────────
            Four figures on a hairline rather than four shadowed cards. The
            totals update every 30 seconds, so `Stat` sets them in the display
            serif with tabular figures - at 30px, proportional digits make the
            whole row twitch every time a single person walks in. */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-7 border-y border-line py-7 lg:grid-cols-4">
          <Stat label="Registered" value={stats?.summary.total ?? 0} />

          <Stat
            label="Checked in"
            value={
              stats
                ? `${stats.summary.checkedIn.toLocaleString()} / ${stats.summary.venueCapacity.toLocaleString()}`
                : "-"
            }
            hint={
              stats ? `${stats.summary.attendanceRate}% of registrations` : undefined
            }
            tone={
              stats && stats.summary.venueRemaining === 0 ? "critical" : undefined
            }
          />

          <Stat
            label="In the pool"
            value={stats?.pool.insidePool ?? 0}
            hint={stats ? `of ${stats.pool.size} places` : undefined}
          />

          <Stat
            label="Seats held"
            value={
              stats ? stats.scholarships.awarded + stats.scholarships.shortlisted : 0
            }
            hint={stats ? `of ${stats.scholarships.total} scholarships` : undefined}
          />
        </div>

        {/* ─── PIPELINE ────────────────────────────────────────────────────── */}
        <Card>
          <section
            aria-labelledby="desk-pipeline"
            className="flex flex-col gap-5 p-5 sm:p-6"
          >
            <h2 id="desk-pipeline" className="eyebrow">
              Where everyone is
            </h2>

            {stats ? (
              <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
                {(stats.pipeline ?? []).map((stage) => (
                  <div
                    key={stage.key}
                    className="flex flex-col gap-1 border-l border-line pl-4"
                  >
                    <p
                      data-numeric
                      className="font-display text-h4 leading-none tabular-nums text-ink"
                    >
                      {stage.count}
                    </p>
                    <p className="text-small font-medium text-ink">{stage.label}</p>
                    <p className="text-small leading-relaxed text-ink-soft">
                      {stage.blurb}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <Spinner className="text-ink-soft" label="Loading the pipeline" />
            )}
          </section>
        </Card>

        {/* ─── COURSES ─────────────────────────────────────────────────────── */}
        <Card>
          <section
            aria-labelledby="desk-courses"
            className="flex flex-col gap-5 p-5 sm:p-6"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="desk-courses" className="eyebrow">
                Seats by track
              </h2>
              <p className="text-small text-ink-soft">
                Counts include essays awaiting grading
              </p>
            </div>

            {stats ? (
              <div className="flex flex-col gap-3.5">
                {(stats.courses ?? []).map((course) => (
                  <div key={course.slug} className="flex items-center gap-4">
                    <span
                      id={`course-${course.slug}`}
                      className="w-56 shrink-0 truncate text-small font-medium text-ink"
                    >
                      {course.displayName}
                    </span>
                    {/* The meter is the amber on this screen: one hairline per
                        track, full-amber while seats remain and drained to ink
                        once a track is closed. Labelled from the visible track
                        name, so the bar is not colour-only. */}
                    <div
                      role="progressbar"
                      aria-labelledby={`course-${course.slug}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={course.fillRate}
                      className="h-1.5 flex-1 overflow-hidden rounded-pill bg-paper-sunk"
                    >
                      <div
                        className={cn(
                          "h-full rounded-pill",
                          course.remaining === 0 ? "bg-ink/30" : "bg-amber",
                        )}
                        style={{ width: `${Math.min(100, course.fillRate)}%` }}
                      />
                    </div>
                    <span
                      data-numeric
                      className="w-24 shrink-0 text-right text-small tabular-nums text-ink-soft"
                    >
                      {course.taken}/{course.capacity}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <Spinner className="text-ink-soft" label="Loading tracks" />
            )}
          </section>
        </Card>

        {/* ─── RECENT ──────────────────────────────────────────────────────── */}
        <Card>
          <section
            aria-labelledby="desk-recent"
            className="flex flex-col gap-5 p-5 sm:p-6"
          >
            <h2 id="desk-recent" className="eyebrow">
              Last 25 checked in
            </h2>

            {stats && stats.recent.length === 0 ? (
              <EmptyState icon={UserCheck} title="Nobody has checked in yet">
                Entries appear here the moment a ticket is accepted at the door.
              </EmptyState>
            ) : (
              <Table>
                <THead>
                  <tr>
                    <TH>Name</TH>
                    <TH>Ticket</TH>
                    <TH>Status</TH>
                    <TH className="text-right">Time</TH>
                  </tr>
                </THead>
                <TBody>
                  {!stats ? (
                    <TR>
                      <TD colSpan={4} className="py-8 text-center">
                        <Spinner
                          className="justify-center text-ink-soft"
                          label="Loading check-ins"
                        />
                      </TD>
                    </TR>
                  ) : (
                    (stats.recent ?? []).map((row) => (
                      <TR key={row.id}>
                        <TD>
                          <p className="font-medium text-ink">{row.name}</p>
                          <p className="truncate text-small text-ink-soft">
                            {row.email}
                          </p>
                        </TD>
                        {/* The ticket is the one column an operator retypes, so
                            it is the one column in the display mono. */}
                        <TD className="font-mono text-small text-ink-soft">
                          {row.barcodeId}
                        </TD>
                        <TD>
                          <Badge variant="secondary">{row.status}</Badge>
                        </TD>
                        <TD
                          data-numeric
                          className="whitespace-nowrap text-right text-small tabular-nums text-ink-soft"
                        >
                          {new Date(row.updatedAt).toLocaleTimeString()}
                        </TD>
                      </TR>
                    ))
                  )}
                </TBody>
              </Table>
            )}
          </section>
        </Card>
      </Stack>

      {lastSync && (
        <p className="border-t border-line pt-4 text-micro text-ink-faint">
          <span data-numeric className="tabular-nums">
            Updated {lastSync.toLocaleTimeString()}
          </span>{" "}
          · refreshes every 30s
        </p>
      )}

      <Dialog
        open={confirmSignOut}
        onOpenChange={(open) => setConfirmSignOut(open)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign out of the desk?</DialogTitle>
            <DialogDescription>
              You&apos;ll need the {BRAND.shortName} PIN to come back in.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmSignOut(false)}
            >
              Cancel
            </Button>
            <Button type="button" variant="critical" onClick={signOut}>
              Sign out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
