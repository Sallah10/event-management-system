import { test } from "node:test";
import assert from "node:assert/strict";

import { COURSES, courseOptions } from "@/config/course-matrix";
import { isValidCourseSlug } from "@/config/rules";
import { verifyTurnstile } from "@/lib/turnstile";

// ─── THE REGISTRATION FORM ────────────────────────────────────────────────────

test("the form offers exactly the programmes the ranking knows about", () => {
  // This is the invariant that matters. The form is rendered from a list, the
  // per-course seat counters GROUP BY the same slugs, and "General Admission" -
  // which is what a CMS theme posts when a person has not chosen - is not a
  // course. If these two lists can drift, the form offers a programme that
  // quietly counts seats nobody can ever be admitted into.
  const options = courseOptions();

  assert.equal(options.length, COURSES.length);
  assert.deepEqual(
    options.map((option) => option.slug),
    COURSES.map((course) => course.slug),
  );

  for (const option of options) {
    assert.ok(
      isValidCourseSlug(option.slug),
      `"${option.slug}" is offered by the form but is not a valid course slug`,
    );
    assert.ok(option.label.trim().length > 0, `${option.slug} has no display name`);
  }
});

test("the form never offers a course that is only a placeholder", () => {
  for (const option of courseOptions()) {
    assert.notEqual(option.slug, "General Admission");
    assert.ok(option.slug.trim().length > 0, "every option needs a slug to submit");
  }
});

// ─── TURNSTILE ─────────────────────────────────────────────────────────────────
//
// The fail-open/fail-closed split is the entire point of this endpoint, and it
// is invisible at runtime: both unconfigured branches return before any network
// call, so the only way to keep them honest is to assert on them.

/** Next types NODE_ENV as read-only, which is right for app code and wrong here. */
function setEnv(values: { nodeEnv?: string; secret?: string | null }): () => void {
  const env = process.env as Record<string, string | undefined>;
  const previousNode = env.NODE_ENV;
  const previousSecret = env.TURNSTILE_SECRET_KEY;

  if (values.nodeEnv !== undefined) env.NODE_ENV = values.nodeEnv;
  if (values.secret === null) delete env.TURNSTILE_SECRET_KEY;
  else if (values.secret !== undefined) env.TURNSTILE_SECRET_KEY = values.secret;

  return () => {
    if (previousNode === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = previousNode;
    if (previousSecret === undefined) delete env.TURNSTILE_SECRET_KEY;
    else env.TURNSTILE_SECRET_KEY = previousSecret;
  };
}

test("a missing captcha token is refused", async () => {
  // Checked before configuration, so this holds either way: an absent token is
  // a caller error, not a deployment problem.
  for (const token of [undefined, null, "", "   ", 42, {}]) {
    const result = await verifyTurnstile(token, "203.0.113.1");
    assert.equal(result.ok, false, `token ${JSON.stringify(token)} should be refused`);
    if (!result.ok) assert.equal(result.reason, "missing");
  }
});

test("an unconfigured captcha fails CLOSED in production", async () => {
  const restore = setEnv({ nodeEnv: "production", secret: null });

  try {
    const result = await verifyTurnstile("a-token", "203.0.113.1");
    // Failing open here would ship a public, unauthenticated write endpoint with
    // the protection silently absent. The refusal is the safe outcome; the cost
    // is that registration is down until a key is configured, which is visible
    // and fixable rather than invisible.
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "unconfigured");
  } finally {
    restore();
  }
});

test("an unconfigured captcha still allows local development", async () => {
  const restore = setEnv({ nodeEnv: "development", secret: null });

  try {
    const result = await verifyTurnstile("a-token", "203.0.113.1");
    // Deliberate asymmetry with the test above. A developer should be able to
    // build the form without an account at Cloudflare, and a rate limit plus
    // the proxy ceiling still stand behind it. It warns on every call, so this
    // cannot be mistaken for being protected.
    assert.equal(result.ok, true);
  } finally {
    restore();
  }
});
