import Link from "next/link";

import { RegisterForm } from "@/components/RegisterForm";
import { Page, PageHeader, Stack } from "@/components/ui/shell";
import { BRAND } from "@/config/branding";
import { courseOptions } from "@/config/course-matrix";
import { turnstileSiteKey } from "@/lib/turnstile";

export const metadata = {
  title: `Register · ${BRAND.name}`,
  description: `Apply for ${BRAND.name}. No account needed — you get a ticket ID straight away.`,
};

// The course list is configuration, read from the same source the seat counters
// use, so a programme added to config/rules.ts appears here automatically and
// the form can never offer a course the ranking does not know about.
export default function RegisterPage() {
  return (
    <Page width="form">
      <Stack gap="lg" className="pb-10">
        <PageHeader
          eyebrow="Registration"
          title="Register for the programme"
          lede="Fill this in and you'll get a ticket ID immediately. You sign in on the day with that ID and your email address — there's no account to remember."
        />

        <RegisterForm courses={courseOptions()} siteKey={turnstileSiteKey()} />

        <div className="rule" role="separator" />

        <p className="text-small text-ink-soft">
          Already registered?{" "}
          <Link href="/assessment/login" className="font-medium text-ink underline underline-offset-2">
            Sign in with your ticket
          </Link>
          .
        </p>
      </Stack>
    </Page>
  );
}
