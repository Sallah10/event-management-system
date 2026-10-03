# ENVIRONMENT SETUP

How to get this running, and what each decision costs you. Read the second half
before deploying; the first half is mechanical.

- [1. Local setup](#1-local-setup)
- [2. The three secrets](#2-the-three-secrets)
- [3. The database](#3-the-database)
- [4. Migrations](#4-migrations)
- [5. Redis, and when you actually need it](#5-redis-and-when-you-actually-need-it)
- [6. Email](#6-email)
- [7. Configuring a round](#7-configuring-a-round)
- [8. Deploying](#8-deploying)
- [9. What is not enforced anywhere](#9-what-is-not-enforced-anywhere)

---

## 1. Local setup

Requires Node 20 or newer. Developed against Node 24.

```bash
npm install
cp .env.example .env.local     # then fill in the three REQUIRED values
npm run db:migrate
npm run dev
```

`.env*` is gitignored. `.env.example` is the only environment file in the
repository and contains no real values.

Then:

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # unit tests, no database needed
npm run build       # production build
```

`npm test` needs no database and no network. It covers the ticket matcher, input
validation, objective scoring, the sitting clocks, session signing, and the
consistency of the rules of the round.

---

## 2. The secrets and pins

Generate the three secrets:

```bash
openssl rand -base64 32   # JWT_SECRET
openssl rand -base64 32   # DEVICE_PEPPER - must differ from JWT_SECRET
openssl rand -base64 32   # WP_TO_APP_SECRET
```

Pick the two staff PINs yourself — six digits each, different from each other:

```bash
echo $((100000 + RANDOM % 900000))   # STAFF_PIN
echo $((100000 + RANDOM % 900000))   # ADMISSIONS_PIN
```

| Variable | Needed for | If missing |
| --- | --- | --- |
| `JWT_SECRET` | every session cookie | app throws at startup |
| `DEVICE_PEPPER` | device binding | app throws at startup |
| `DATABASE_URL` | everything | app throws at startup |
| `WP_TO_APP_SECRET` | WordPress only | `/api/register` fails closed — fine if retired |
| `STAFF_PIN` | check-in staff login | that role cannot sign in |
| `ADMISSIONS_PIN` | admissions panel | that role cannot sign in |
| `UPSTASH_REDIS_*` | multi-instance correctness | **throws in production** |
| `TURNSTILE_SECRET_KEY` | the public form | `/api/apply` refuses every request in production |
| `RESEND_API_KEY` | ticket + report emails | tickets are not emailed, only shown on screen |

That behaviour — throwing rather than defaulting — is deliberate. This codebase
once had four different hardcoded fallback JWT secrets across six files. When the
variable was missing, some routes broke loudly and others silently accepted tokens
signed with a string published in the repository. That is fail-open on a security
boundary, so `lib/env.ts` fails closed.

Rotating `JWT_SECRET` logs everyone out, including staff mid-event. Rotate
`DEVICE_PEPPER` and every sitting in progress fails its device check.

### The two PINs are not one PIN

`STAFF_PIN` opens the check-in desk. `ADMISSIONS_PIN` opens the grading panel.
They are separate because the old design used one shared `STAFF_ACCESS_TOKEN` for
both, which meant a check-in operator could award scholarships and an admissions
officer could read attendance. That variable is now unused — if you find it in an
old `.env`, delete it.

---

## 3. The database

Any PostgreSQL. Neon serverless is what this was built against, but nothing in
the code is Neon-specific.

```
postgresql://user:password@host/dbname?sslmode=verify-full
```

Write `sslmode=verify-full` explicitly rather than `require`. The driver
currently treats `require` and `prefer` as aliases of `verify-full` and warns
that this changes in the next major version. Stating it now means the day the
driver changes meaning, your connection string already says what you meant.

### Pool sizing

`DB_POOL_MAX` (default 10) is **per serverless instance**, not per deployment.
Ten instances at the default is a hundred connections, which is more than a small
Neon plan allows. If you scale out, lower this. A connection that times out
because the pool is exhausted shows up as a slow page, not as an error, so it is
worth setting deliberately rather than leaving alone.

---

## 4. Migrations

```bash
npm run db:migrate
```

The runner keeps a `schema_migrations` table and is safe to re-run; applied
migrations are skipped. Migrations are forward-only — there is no `down`.

Read what it is about to do before running it against anything you care about.

---

## 5. Redis, and when you actually need it

Optional. Without `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` the
application runs, with two consequences worth stating plainly:

- **Rate limiting is per instance.** The limiter falls back to in-process state,
  so N instances allow N times the intended rate. Fine for development, wrong
  behind a load balancer.
- **Locks are per instance.** The check-in and submit routes take a Redis lock to
  serialise a contended write. In-process, two instances can both pass the check.

So: one instance, or Redis. Not "Redis eventually".

---

## 6. Email

Set `MAIL_PROVIDER` to `brevo` or `resend`, then set that provider's key.
Both are supported because both fail on a bad day, and it is useful not to be
locked into whichever one you tried first.

| Provider | Key | Notes |
| --- | --- | --- |
| Brevo | `BREVO_API_KEY` | Default when the key is present. Needs a **verified sender** |
| Resend | `RESEND_API_KEY` | Works from more hosts, but needs a verified domain |

Neither key is optional in the sense that registration does not fail without it —
the ticket is written to the structured log instead. That is a deliberate trade,
and it is a bad one to leave in place on the day.

A candidate who never receives their ticket becomes a support queue, a phone
number at the venue desk, and a manual check-in. Set the key, and set
`BREVO_FROM_EMAIL` to an address Brevo has verified.

On Brevo that means confirming the address in the Brevo dashboard first. Sending
from an unverified address does not error helpfully — it fails at delivery, so
the candidate's ticket is already in the void. `BREVO_FROM_NAME` is cosmetic.
Both fall back to `EVENT_CONTACT_EMAIL`, which only helps if that address is
verified too.

The in-app form at `/register` does not depend on any of this — it prints the
ticket on screen, and tells the person whether the email actually went out. That
is what makes the app usable on a bad mail day, and usable in a venue with no
reliable connectivity. Email is the backup channel, not the only one.

---

## 6c. Essay grading (Gemini)

`GEMINI_API_KEY` is optional in the strongest sense: with it unset, `/api/admin/ai-audit`
returns `503` and nothing else in the application notices. Admissions still works
entirely by hand, which is the point.

| Variable | Default | What it does |
| --- | --- | --- |
| `GEMINI_API_KEY` | — | Without it, grading refuses every request |
| `GEMINI_MODEL` | `gemini-3.8-flash` | `gemini-2.5-flash` is closed to new accounts |
| `GRADING_CHUNK_SIZE` | `40` | Candidates graded per request |
| `GRADING_CONCURRENCY` | `6` | Simultaneous calls, capped at 12 |

Three things are worth knowing before you rely on this, all of them learned by
running it rather than by reading about it.

**The free tier is unreliable, and the design assumes that.** While testing, calls
returned `503 high demand` somewhere between one in five and one in two. Each
candidate is therefore retried up to three times with a pause, and anything still
failing is recorded as a failure against that candidate and left `theoryScore: 0`.
Nothing is written wrong. It just means **a grading run usually needs more than
one pass** — press it again until the queue is empty. If that is unacceptable for
your deadline, a paid tier removes the problem rather than hiding it.

**Grading is resumable by construction.** A run grades a capped number of
candidates and stops. There is no batch job and no queue table, because a
serverless function has nowhere to keep one. Whatever a pass does not reach is
still pending on the next one, so an interrupted run resumes rather than restarts
and never double-charges.

**Never let it disqualify anyone.** `ai_suspected` is an observation with a
reason attached. `isFlagged` is a human decision reached in the admissions panel.
No code path sets one from the other. Verify that claim by reading
`lib/admissions.ts` rather than taking it from here.

Sending candidate essays to a model provider is a data-processing decision, not a
technical one. Confirm the terms cover it, and tell candidates, before you run it
on real submissions.

`npm run check:gemini` sends one throwaway essay and reports what came back. Run
it after setting the key; it costs one call.

---

## 6b. Public registration (Turnstile)

There are two ways to register, and both end up in the same place
(`lib/registration.ts`):

| Path | Gate | Who calls it |
| --- | --- | --- |
| `POST /api/register` | `x-api-key` shared secret | The WordPress form |
| `POST /api/apply` | Cloudflare Turnstile | Anyone, via `/register` |

The second endpoint is **public**. That is the point of it, but it means anything
on the internet can call it, and every row it creates is a real registrant that
later counts toward the ranking, the per-course seat totals and the scholarship
allocation. A bot flood does not just cost database rows — it quietly corrupts the
one number this programme exists to produce. The rate limit is per-IP, so it caps
speed, not volume.

Set both keys from Cloudflare → Turnstile → Add widget:

```
NEXT_PUBLIC_TURNSTILE_SITE_KEY=0x4AAAA...   # public, goes in the browser
TURNSTILE_SECRET_KEY=0x4AAAA...             # server only, never ship it
```

Behaviour when they are missing, which is deliberate:

- **Development** — the form works, the server logs a loud warning on every page
  that says so in the UI. You can build and test without signing up for anything.
- **Production** — `/api/apply` returns `503` and refuses every request. Failing
  open here would mean shipping a public write endpoint with the protection
  silently absent, which is the exact failure the check was added to prevent.

If Cloudflare is unreachable, registration is refused rather than waved through,
for the same reason: their downtime should not become an open sign-up window.

A honeypot field would also work and needs no account with anyone. It stops naive
bots only, so if you would rather not manage keys, that is a reasonable choice —
just do not ship the endpoint with no protection at all.

---

## 7. Configuring a round

Everything event-specific is configuration, so a new cohort is a `.env` change
rather than a code change.

**The numbers** are in `config/rules.ts` and read from the environment: seats,
pool size, venue capacity, section lengths, minimum essay length, pass mark.

Two of them need setting in two places. The candidate's rules page has to state
the pass mark the server enforces, and a client bundle cannot read a server
variable — so `OBJECTIVE_PASS_MARK` and `NEXT_PUBLIC_OBJECTIVE_PASS_MARK` must
agree. Set only the first and the rules page will quote a number that is not the
one being applied. The server re-checks everything regardless; this only affects
what the candidate is told in advance.

**The identity** is in `config/branding.ts`: name, organisation, date, venue,
contact address, social links, and the palette used by the confirmation page, the
email and the QR code. Unset social links are omitted from the page rather than
pointing somewhere unconfigured.

**The content** is not configuration, and is meant to differ per event, exactly as
the course list does:

| File | What to change |
| --- | --- |
| `config/course-matrix.ts` | Which courses are on offer, and their LMS ids |
| `config/questions.json` | The objective paper. Public — must never contain a `correct` field |
| `config/answer-key.json` | The answers. Server-only, never import from a client component |
| `config/theory-questions.ts` | The essay prompts |

The paper is three coupled files: `questions.json`, `answer-key.json`, and
`TOTAL_QUESTIONS` in `config/rules.ts`. If the counts disagree the process throws
at startup, rather than marking candidates against a different number of
questions than the ones they were shown.

---

## 8. Deploying

Vercel is configured (`vercel.json` sets security headers and function limits).
Any Node host works.

Set every variable from sections 2 and 3 in the host's environment panel. Do not
commit a `.env.local`.

The security headers include a Content-Security-Policy. It allows
`'unsafe-inline'` for scripts, which is weaker than a nonce-based policy: Next.js
inlines its bootstrap scripts, and a nonce requires a per-request header that
makes every page dynamic. Tightening it means generating a nonce in `proxy.ts` and
setting the policy there, and verifying that the pages you still want static
remain static. That is worth doing before this faces the public internet, and it
should be tested in a preview deployment rather than reasoned about.

---

## 9. What is not enforced anywhere

Places where the protection is real but partial, so nobody has to discover them
in production:

- **Device binding is friction, not DRM.** The browser holds a random key and the
  server stores `sha256(pepper + key)`. Clearing site data or opening a private
  window mints a new key and orphans the old one. The real boundary is the
  checked-in gate plus the invigilator process.
- **The AI essay check is advisory.** It reads an essay and reports a suspicion
  with a reason and a confidence. It never disqualifies anybody. `ai_suspected`
  and the human `is_flagged` are separate columns on purpose, and only a person
  can set the second one.
- **Support reports are email plus logs.** A candidate who cannot use the form
  emails an address; there is no queue in the database to reconcile against.
- **`proxy.ts` is a convenience, not the boundary.** Every route that touches
  candidate or staff data checks the session again in the handler. A page that
  renders a form to someone not entitled to one should not depend on a
  middleware check being configured correctly.
