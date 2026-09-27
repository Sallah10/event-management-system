"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock } from "lucide-react";
import { apiFetch } from "@/lib/client/api";
import { BRAND } from "@/config/branding";
import { cn } from "@/lib/utils";

// ─── STAFF SIGN-IN ────────────────────────────────────────────────────────────
// Two roles, two PINs, two doors. The page used to have no role control at all:
// it POSTed to /api/admin/auth, which defaulted to the `staff` tier, so an
// admissions officer with the right PIN signed in and landed on the check-in
// dashboard — and then found every admissions route refusing them for having the
// wrong role. The role is now chosen here, sent explicitly, and the server sends
// the officer back to the right place.
//
// The two roles are kept apart on purpose. `staff` opens a door. `admissions`
// reads essays, flags candidates and awards scholarships. A single shared PIN
// meant one leaked number gave somebody both, and the audit trail recorded them
// as the same person.

type Role = "staff" | "admissions";

const ROLES: { id: Role; label: string; blurb: string }[] = [
  { id: "staff", label: "Event staff", blurb: "Door and attendance" },
  { id: "admissions", label: "Admissions", blurb: "Grading and awards" },
];

export default function AdminLoginPage() {
  const [pin, setPin] = useState("");
  const [role, setRole] = useState<Role>("staff");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const signIn = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!pin || loading) return;
    setLoading(true);
    setError(null);

    const result = await apiFetch<{ role: Role; next: string }>(
      `/api/admin/auth?role=${role}`,
      { method: "POST", body: JSON.stringify({ pin }) },
    );

    if (result.ok) {
      // The server decides where this role lands; following it means the two
      // never drift into a redirect loop.
      router.replace(result.data.next || "/admin/dashboard");
      return;
    }

    setError(
      result.code === "UNAVAILABLE"
        ? "Staff sign-in is not configured on this deployment."
        : result.message,
    );
    setPin("");
    setLoading(false);
  };

  return (
    <div className="grid min-h-dvh place-items-center bg-ink p-4">
      <div className="w-full max-w-sm overflow-hidden rounded-3xl bg-white shadow-2xl">
        <header className="bg-paper px-7 py-8 text-center">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-ink">
            <Lock className="h-5 w-5 text-amber" aria-hidden />
          </div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-ink-soft">
            {BRAND.shortName}
          </p>
          <h1 className="mt-1 text-xl font-bold">Staff access</h1>
        </header>

        <form onSubmit={signIn} className="space-y-5 p-7">
          <fieldset>
            <legend className="text-[11px] font-bold uppercase tracking-[0.18em] text-ink-soft">
              Signing in as
            </legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {ROLES.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setRole(option.id)}
                  aria-pressed={role === option.id}
                  className={cn(
                    "rounded-2xl border p-3 text-left transition-colors",
                    role === option.id
                      ? "border-ink bg-ink text-paper"
                      : "border-ink/15 bg-white hover:border-ink/40",
                  )}
                >
                  <span className="block text-sm font-bold">{option.label}</span>
                  <span
                    className={cn(
                      "mt-0.5 block text-[11px]",
                      role === option.id ? "text-paper/60" : "text-ink-soft",
                    )}
                  >
                    {option.blurb}
                  </span>
                </button>
              ))}
            </div>
          </fieldset>

          <div>
            <label
              htmlFor="pin"
              className="text-[11px] font-bold uppercase tracking-[0.18em] text-ink-soft"
            >
              PIN
            </label>
            <input
              id="pin"
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-ink/15 bg-paper p-4 text-center font-mono text-lg tracking-[0.4em] outline-none focus:border-ink/50"
            />
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-900"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={!pin || loading}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-ink py-4 text-sm font-bold text-paper disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Checking
              </>
            ) : (
              "Authorise session"
            )}
          </button>

          <p className="text-center text-xs text-ink-soft">
            Sessions are role-scoped and end on sign out. Shared event laptops
            should be signed out at the end of a shift.
          </p>
        </form>
      </div>
    </div>
  );
}
