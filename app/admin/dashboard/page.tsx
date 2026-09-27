"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Loader2,
  LogOut,
  RefreshCw,
  ScanLine,
  UserCheck,
  Users,
} from "lucide-react";
import { apiFetch, type ApiResult } from "@/lib/client/api";
import { BRAND } from "@/config/branding";
import { cn } from "@/lib/utils";

// ─── STAFF DASHBOARD ──────────────────────────────────────────────────────────
// Rebuilt. The two things worth reading about are the ones that were removed.
//
// 1. IT SENT A SECRET TO THE BROWSER.
//        headers: { "x-api-key": process.env.NEXT_PUBLIC_INTERNAL_API_KEY }
//        headers: { "x-api-key": process.env.NEXT_PUBLIC_ADMIN_SECRET! }
//    `NEXT_PUBLIC_*` is inlined into the client bundle at build time. Both values
//    were therefore published to anyone who loaded the page and read the JS —
//    and the routes behind them also accepted them, so this was not a cosmetic
//    header. Authentication here is the staff session cookie, which is httpOnly
//    and signed. Nothing secret goes in a browser bundle any more.
//
// 2. THE AI AUDIT BUTTON WAS ON THE WRONG SCREEN, UNDER THE WRONG ROLE.
//    It POSTed to /api/admin/ai-audit, which requires `admissions` — so for the
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
  // — so the real component is split out below and this wrapper provides one.
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
    <div className="flex min-h-dvh items-center justify-center bg-paper">
        <Loader2 className="h-6 w-6 animate-spin text-ink-soft" aria-label="Loading" />
    </div>
  );
}

function StaffDashboardInner() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastSync, setLastSync] = useState<Date | null>(null);
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
    <div className="min-h-dvh bg-paper text-ink">
      <header className="border-b border-ink/10 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-ink-soft">
              {BRAND.shortName} · staff
            </p>
            <h1 className="text-xl font-bold">Attendance desk</h1>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/checkin"
              className="flex items-center gap-2 rounded-full bg-amber px-4 py-2 text-sm font-bold"
            >
              <ScanLine className="h-4 w-4" aria-hidden /> Check-in desk
            </Link>
            <Link
              href="/admin/manual-checkin"
              className="rounded-full border border-ink/15 px-4 py-2 text-sm font-semibold"
            >
              Manual desk
            </Link>
            <button
              onClick={() => {
                // Set the spinner here, in the handler, rather than at the top of
                // `load()`. The click is the user asking for a refresh, so a state
                // change belongs to it; the mount call has nothing to show.
                setLoading(true);
                void load();
              }}
              aria-label="Refresh"
              className="grid h-9 w-9 place-items-center rounded-full border border-ink/15"
            >
              <RefreshCw
                className={cn("h-4 w-4", loading && "animate-spin")}
                aria-hidden
              />
            </button>
            <button
              onClick={signOut}
              className="flex items-center gap-1.5 rounded-full border border-ink/15 px-3 py-2 text-xs font-semibold"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden /> Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-8 px-5 py-8">
        {denied && (
          <p className="rounded-2xl border border-amber-deep/40 bg-amber/10 p-4 text-sm font-semibold">
            You are signed in as{" "}
            {denied === "admissions" ? "an admissions officer" : "event staff"}, so
            that area is not available to you. Admissions decisions live in{" "}
            <Link href="/admissions" className="underline underline-offset-4">
              the admissions portal
            </Link>
            .
          </p>
        )}

        {error && (
          <p
            role="alert"
            className="rounded-2xl border border-red-300 bg-red-50 p-4 text-sm font-semibold text-red-900"
          >
            {error} Figures below may be out of date.
          </p>
        )}

        {/* ─── HEADLINE ────────────────────────────────────────────────────── */}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label="Registered"
            value={stats?.summary.total ?? 0}
            icon={<Users className="h-4 w-4" aria-hidden />}
          />
          <Metric
            label="Checked in"
            value={stats ? `${stats.summary.checkedIn.toLocaleString()} / ${stats.summary.venueCapacity.toLocaleString()}` : "—"}
            sub={stats ? `${stats.summary.attendanceRate}% of registrations` : undefined}
            icon={<UserCheck className="h-4 w-4" aria-hidden />}
            alert={Boolean(stats && stats.summary.venueRemaining === 0)}
          />
          <Metric
            label="In the pool"
            value={stats?.pool.insidePool ?? 0}
            sub={stats ? `of ${stats.pool.size} places` : undefined}
          />
          <Metric
            label="Seats held"
            value={
              stats ? stats.scholarships.awarded + stats.scholarships.shortlisted : 0
            }
            sub={stats ? `of ${stats.scholarships.total} scholarships` : undefined}
          />
        </section>

        {/* ─── PIPELINE ────────────────────────────────────────────────────── */}
        <section className="rounded-3xl border border-ink/10 bg-white p-6">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-ink-soft">
            Where everyone is
          </h2>
          <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            {(stats?.pipeline ?? []).map((stage) => (
              <div key={stage.key} className="rounded-2xl bg-paper p-4">
                <p className="text-2xl font-bold tabular-nums">{stage.count}</p>
                <p className="mt-1 text-sm font-semibold">{stage.label}</p>
                <p className="mt-0.5 text-[11px] leading-snug text-ink-soft">
                  {stage.blurb}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ─── COURSES ─────────────────────────────────────────────────────── */}
        <section className="rounded-3xl border border-ink/10 bg-white p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-ink-soft">
              Seats by track
            </h2>
            <p className="text-xs text-ink-soft">
              Counts include essays awaiting grading
            </p>
          </div>
          <div className="mt-4 space-y-3">
            {(stats?.courses ?? []).map((course) => (
              <div key={course.slug} className="flex items-center gap-4">
                <span className="w-56 shrink-0 truncate text-sm font-semibold">
                  {course.displayName}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink/8">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      course.remaining === 0 ? "bg-ink/40" : "bg-amber",
                    )}
                    style={{ width: `${Math.min(100, course.fillRate)}%` }}
                  />
                </div>
                <span className="w-24 shrink-0 text-right text-xs tabular-nums text-ink-soft">
                  {course.taken}/{course.capacity}
                </span>
              </div>
            ))}
            {!stats && <p className="text-sm text-ink-soft">Loading tracks…</p>}
          </div>
        </section>

        {/* ─── RECENT ──────────────────────────────────────────────────────── */}
        <section className="rounded-3xl border border-ink/10 bg-white p-6">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-ink-soft">
            Last 25 checked in
          </h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[10px] uppercase tracking-widest text-ink-soft">
                <tr>
                  <th className="pb-3 pr-4 font-bold">Name</th>
                  <th className="pb-3 pr-4 font-bold">Ticket</th>
                  <th className="pb-3 pr-4 font-bold">Status</th>
                  <th className="pb-3 font-bold">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink/8">
                {(stats?.recent ?? []).map((row) => (
                  <tr key={row.id}>
                    <td className="py-3 pr-4">
                      <p className="font-semibold">{row.name}</p>
                      <p className="text-xs text-ink-soft">{row.email}</p>
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs">{row.barcodeId}</td>
                    <td className="py-3 pr-4">
                      <span className="rounded-full bg-paper px-2.5 py-1 text-[11px] font-semibold">
                        {row.status}
                      </span>
                    </td>
                    <td className="py-3 text-xs tabular-nums text-ink-soft">
                      {new Date(row.updatedAt).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
                {stats && stats.recent.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-ink-soft">
                      Nobody has checked in yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {lastSync && (
          <p className="text-right text-[11px] text-ink-soft">
            Updated {lastSync.toLocaleTimeString()} · refreshes every 30s
          </p>
        )}
      </main>
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  icon,
  alert,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon?: React.ReactNode;
  alert?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-3xl border p-5",
        alert ? "border-red-300 bg-red-50" : "border-ink/10 bg-white",
      )}
    >
      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-ink-soft">
        {icon}
        {label}
      </p>
      <p className="mt-2 text-3xl font-bold tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-[11px] text-ink-soft">{sub}</p>}
    </div>
  );
}
