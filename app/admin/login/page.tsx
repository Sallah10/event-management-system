"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock, ShieldAlert } from "lucide-react";
import { apiFetch } from "@/lib/client/api";
import { BRAND } from "@/config/branding";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Alert } from "@/components/ui/display";
import { Page, PageHeader } from "@/components/ui/shell";

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
//
// PRESENTATION ONLY. The sign-in was a white rounded-3xl card floating on an
// ink field, with a rounded-2xl lock tile, two rounded-2xl role cards, a
// rounded-full submit and a `rounded-xl` red error box. It is now the shared page
// frame: a hairline, one h1, and the form set on the paper. The role control
// keeps its `aria-pressed` semantics — two buttons, not a segmented pill, because
// a pill made it look like a tab row and it is not one.

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
    <Page
      width="form"
      className="flex min-h-dvh flex-col justify-center py-14 sm:py-20"
    >
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-2">
            <Lock aria-hidden className="size-3.5 text-amber" />
            {BRAND.shortName}
          </span>
        }
        title="Staff access"
      />

      <form onSubmit={signIn} className="mt-8 flex flex-col gap-6">
        <fieldset className="flex flex-col gap-2">
          <legend className="text-small font-medium text-ink">Signing in as</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {ROLES.map((option) => (
              <Button
                key={option.id}
                type="button"
                onClick={() => setRole(option.id)}
                aria-pressed={role === option.id}
                variant={role === option.id ? "default" : "outline"}
                className="h-auto w-full flex-col items-start gap-1 whitespace-normal px-4 py-3.5 text-left"
              >
                <span className="text-small font-medium">{option.label}</span>
                <span
                  className={cn(
                    "text-micro",
                    role === option.id ? "text-paper/70" : "text-ink-soft",
                  )}
                >
                  {option.blurb}
                </span>
              </Button>
            ))}
          </div>
        </fieldset>

        <Field label="PIN">
          {({ id }) => (
            <Input
              id={id}
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              data-numeric
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              className="text-center font-mono text-lead"
            />
          )}
        </Field>

        {error && (
          <Alert tone="critical" icon={ShieldAlert} role="alert">
            {error}
          </Alert>
        )}

        <Button
          type="submit"
          size="lg"
          variant="accent"
          className="w-full"
          disabled={!pin || loading}
        >
          {loading ? (
            <>
              <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" />
              Checking
            </>
          ) : (
            "Authorise session"
          )}
        </Button>
      </form>

      <p className="mt-8 border-t border-line pt-5 text-small text-ink-faint">
        Sessions are role-scoped and end on sign out. Shared event laptops should
        be signed out at the end of a shift.
      </p>
    </Page>
  );
}
