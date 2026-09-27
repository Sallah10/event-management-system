"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Loader2,
  LogOut,
  Search,
  ShieldAlert,
  Sparkles,
  UserCheck,
} from "lucide-react";
import { apiFetch, type ApiResult } from "@/lib/client/api";
import { BRAND } from "@/config/branding";
import { cn } from "@/lib/utils";
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
    <div className="flex min-h-dvh items-center justify-center bg-paper text-ink">
      <Loader2 className="h-6 w-6 animate-spin text-ink-soft" aria-label="Loading" />
    </div>
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
    <div className="min-h-dvh bg-paper text-ink">
      <header className="border-b border-ink/10 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-ink-soft">
              {BRAND.shortName} · admissions
            </p>
            <h1 className="text-xl font-bold">Decisions</h1>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/api/admin/winners-export"
              className="rounded-full border border-ink/15 px-4 py-2 text-sm font-semibold"
            >
              Winners export
            </a>
            <button
              onClick={signOut}
              className="flex items-center gap-1.5 rounded-full border border-ink/15 px-3 py-2 text-xs font-semibold"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden /> Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-5 py-8">
        {denied && (
          <p className="rounded-2xl border border-amber-deep/40 bg-amber/10 p-4 text-sm font-semibold">
            You are signed in as event staff, so scholarship decisions are not
            available to you. The attendance desk is{" "}
            <a href="/admin/dashboard" className="underline underline-offset-4">
              here
            </a>
            .
          </p>
        )}

        {banner && (
          <p
            role="status"
            className="flex items-center gap-2 rounded-2xl border border-green-300 bg-green-50 p-4 text-sm font-semibold text-green-900"
          >
            <UserCheck className="h-4 w-4" aria-hidden />
            {banner}
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-2xl border border-red-300 bg-red-50 p-4 text-sm font-semibold text-red-900"
          >
            {error}
          </p>
        )}

        <nav className="flex flex-wrap gap-2">
          {TABS.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setTab(item.id);
                setSelected(null);
              }}
              aria-current={tab === item.id ? "page" : undefined}
              className={cn(
                "rounded-2xl border px-4 py-2.5 text-left text-sm transition-colors",
                tab === item.id
                  ? "border-ink bg-ink text-paper"
                  : "border-ink/15 bg-white hover:border-ink/40",
              )}
            >
              <span className="block font-bold">{item.label}</span>
              <span
                className={cn(
                  "mt-0.5 block text-[11px]",
                  tab === item.id ? "text-paper/60" : "text-ink-soft",
                )}
              >
                {item.hint}
              </span>
            </button>
          ))}
        </nav>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-64">
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft"
              aria-hidden
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name or ticket"
              aria-label="Search candidates"
              className="w-full rounded-full border border-ink/15 bg-white py-2.5 pl-10 pr-4 text-sm outline-none focus:border-ink/40"
            />
          </div>
          <p className="text-xs tabular-nums text-ink-soft">
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

        <div className="overflow-hidden rounded-3xl border border-ink/10 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-ink/10 text-[10px] uppercase tracking-widest text-ink-soft">
              <tr>
                <th className="px-4 py-3 font-bold">Candidate</th>
                <th className="px-4 py-3 font-bold">Objective</th>
                <th className="px-4 py-3 font-bold">Theory</th>
                <th className="px-4 py-3 font-bold">Track</th>
                <th className="px-4 py-3 font-bold">Review</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/8">
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer transition-colors hover:bg-paper"
                  onClick={() => setSelected(row)}
                >
                  <td className="px-4 py-3">
                    <p className="font-semibold">{row.name}</p>
                    <p className="font-mono text-[11px] text-ink-soft">
                      {row.barcodeId}
                    </p>
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    <p className="font-bold">
                      {row.objectiveScore ?? "—"}
                      <span className="text-[11px] font-normal text-ink-soft">%</span>
                    </p>
                    <p className="text-[11px] text-ink-soft">
                      {row.objectiveRank ? `rank #${row.objectiveRank}` : "unranked"}
                    </p>
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {row.theoryGradedAt ? (
                      <>
                        <p className="font-bold">{row.theoryScore}</p>
                        <p className="text-[11px] text-ink-soft">graded</p>
                      </>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber/25 px-2.5 py-1 text-[11px] font-bold">
                        <Loader2 className="h-3 w-3" aria-hidden /> awaiting
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[13px] text-ink-soft">
                    {row.course ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {row.isFlagged && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-800">
                          <ShieldAlert className="h-3 w-3" aria-hidden /> Flagged
                        </span>
                      )}
                      {row.aiSuspected && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full bg-amber/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                          title={row.aiGradeReason ?? undefined}
                        >
                          <Sparkles className="h-3 w-3" aria-hidden /> AI:{" "}
                          {row.aiConfidence ?? "flagged"}
                        </span>
                      )}
                      {Number(row.tabSwitches) > 0 && (
                        <span
                          className="rounded-full bg-ink/8 px-2 py-0.5 text-[10px] font-bold tabular-nums text-ink-soft"
                          title={`${row.tabSwitches} recorded focus losses`}
                        >
                          {row.tabSwitches} focus
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-ink-soft">
                    Nothing in this queue.
                    {tab === "grading" && " No essays are awaiting grading."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="text-[11px] leading-relaxed text-ink-soft">
          Flags and AI observations are shown separately and never the same thing: a
          flag suspends a candidate pending review, an AI note is a suggestion for
          whoever reviews. Deciding a candidate is disqualified is a person&apos;s
          call, it requires a written reason, and both actions are recorded with
          your name against the time.
        </p>
      </main>
    </div>
  );
}
