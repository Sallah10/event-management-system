# Scholarship Assessment and Admissions Platform

An assessment portal for a high-traffic scholarship round: registration,
venue check-in, a timed objective paper, a ranked cut into a theory paper, human
essay grading, and seat allocation — plus the staff and admissions tools to run
it.

Built for an event of a few thousand applicants on serverless infrastructure.
Every event-specific value is configuration, so running a different round is a
`.env` change rather than a code change.

---

## What it does

**For a candidate**

- Registers through a WordPress form and receives a ticket code by email.
- Scans the ticket at the venue to check in.
- Sits a timed objective paper; the clock is enforced server-side.
- Sees their result, and the actual reason for it.
- If they are inside the ranked pool, sits a timed theory paper of three essays.
- Reads their outcome afterwards.

**For event staff**

- Check-in desk: camera scanner, hardware scanner, and manual search by name or
  ticket.
- Attendance counts, venue capacity enforcement, check-in list export.

**For the admissions panel**

- A queue of papers to grade, ordered by who is waiting.
- Essays, AI observations, integrity flags, and the decision history in one view.
- Human grading with an audit trail; flagging and unflagging with a reason.
- Course allocation against a seat cap, shortlisting, awarding, standing down.
- Winners export.

---

## The parts worth reading

This is a codebase where the interesting decisions are the ones that were got
wrong first. Each of these is commented at the site of the fix.

| Area | What it does |
| --- | --- |
| `lib/tickets.ts` | Ticket matching. The check-in endpoint used to interpolate scanned text into `ILIKE` patterns, so a scan of `TS26-%%%` checked in the first registrant in the table. It is a regex and an exact match now. |
| `lib/exam-sitting.ts` | The clocks. Both papers opened with a hardcoded `useState(1800)`, so a refresh, a crash or a second device handed back a full sitting — and the server accepted a paper at any hour of any day. Deadlines come from database columns now. |
| `lib/answer-key.ts` | Scoring. The answer key shipped in the browser bundle inside `questions.json`, so the correct answer to all 60 questions was readable in DevTools. The key is behind `import "server-only"` now. |
| `lib/session.ts` | Sessions. Four different hardcoded fallback JWT secrets meant a missing env var left some routes signing tokens with a published string. It fails closed now, and pins the algorithm and the token type. |
| `lib/admissions.ts` | Every status change, transactional with its audit row. The only place a seat is created. |
| `proxy.ts` | Route gating for candidate, staff and admissions sessions. |

---

## Honest limitations

Stated here rather than discovered in production:

- **Device binding is friction, not DRM.** One sitting is bound to one browser
  profile. Clearing site data mints a new key. The real boundary is the
  checked-in gate plus the invigilator process.
- **The AI essay check is advisory.** It reports a suspicion with a reason and a
  confidence. It never disqualifies anyone. `ai_suspected` and the human
  `is_flagged` are separate columns, and only a person sets the second.
- **Lateness is recorded, not punished.** A paper that arrives after the deadline
  is accepted, marked, and its real finish time kept, so ranking can account for
  it. Rejecting a finished paper over an open tab costs a real applicant and
  protects nothing a recorded timestamp does not.
- **Rate limiting and locks need Redis in production.** Without it they fall back
  to per-process state, which is correct on one instance and not on several.
- **The CSP allows `'unsafe-inline'` for scripts.** Next.js inlines its
  bootstrap; a nonce-based policy requires per-request headers. See
  `docs/ENV_SETUP.md`.
- **No end-to-end tests.** The unit suite covers pure logic — ticket matching,
  validation, scoring, clocks, sessions, the rules of the round. Nothing has run
  against a real database in this repository, because there are no credentials
  for one. The migrations have not been executed.

---

## Stack

- **Framework:** Next.js 16, App Router, React 19
- **Database:** PostgreSQL (Neon serverless in development), Sequelize 6
- **Sessions:** `jose`, HS256, `httpOnly` cookies
- **Cache and locks:** Upstash Redis, optional
- **Email:** Brevo, Resend as a fallback
- **AI:** Gemini, essay observation only
- **Tests:** `node --test`, no test-framework dependency

---

## Setup

Requires Node 20+. Full guide, including the cost of each setting, in
[docs/ENV_SETUP.md](docs/ENV_SETUP.md).

```bash
npm install
cp .env.example .env.local
npm run db:migrate
npm run db:seed            # optional: synthetic candidates covering every state
npm run dev
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Unit tests. No database, no network |
| `npm run db:migrate` | Apply migrations. Safe to re-run |
| `npm run db:seed` | Insert synthetic candidates spanning the whole pipeline. Destructive; `--force` to overwrite |
| `npm run tickets:backfill` | Issue tickets for registrants who predate the system. Dry run unless `--execute` |
| `npm run fix:mojibake` | Report text encoding damage without changing anything |
| `node scripts/fix-mojibake.mjs` | Repair it |

---

## Configuration

Three kinds, and the difference matters when you are setting up a new round.

**Environment** — the numbers and the identity. Seats, pool size, venue capacity,
section lengths, pass mark, event name, contact address, palette. See
`.env.example`.

**Content** — the questions, the answers, the essays, the courses. Deliberately
per-event, like the course list, and not genericised on purpose: a question that
said "this event" instead of naming it would be a worse question. See
[config/README.md](config/README.md) for how the three coupled files move together.

**Code** — the pipeline. Statuses, transitions, and who may make them.

Two variables need setting in two places. The candidate's rules page has to state
the pass mark the server enforces, and a client bundle cannot read a server
variable, so `OBJECTIVE_PASS_MARK` and `NEXT_PUBLIC_OBJECTIVE_PASS_MARK` must
agree. The server re-checks everything regardless; this only affects what the
candidate is told in advance.

---

## The pipeline

```
registered ──▶ attended ──▶ qualified ──▶ completed ──▶ shortlisted ──▶ awarded
                  │             │             │
                  └──▶ waitlisted / eliminated ◀┘  (release)
```

A status is a promise about what happens next, and `lib/admissions.ts` is the
only place one is made. Promotions have to come from a legal state; corrections
(`release`, `allocate`) may land anywhere a person can defend in the audit log.

| Rule | Where |
| --- | --- |
| Only checked-in candidates may sit the paper | `/assessment/login` |
| Venue capacity is a hard stop | check-in |
| The pool is ranked, not a per-person threshold | `submit` |
| Seats are capped per course | `lib/admissions.ts` |
| Only a person can flag or unflag | decision endpoint |
| Every decision is written with its actor and reason | `admission_decisions` |

---

## Layout

```
app/
  assessment/      candidate-facing: login, exam, result, theory, thank-you
  admin/           check-in staff: dashboard, manual check-in
  admissions/      admissions panel: queue and review
  api/             route handlers
components/
  exam/            objective and theory clients
  admissions/      the review panel
config/            rules, branding, courses, questions, answer key
lib/               sessions, validation, clocks, admissions, models
scripts/           migrations, backfill, encoding repair, test loader
tests/             unit tests
```

---

## Security notes

- Sessions are `httpOnly`, `SameSite`, `Secure` in production, and pinned to one
  algorithm and one token type. A candidate token cannot be replayed as a staff
  token.
- Secrets are read through `lib/env.ts`, which throws when one is missing. There
  are no fallback secrets in this repository.
- The answer key is server-only. The question count is verified against the answer
  key at startup, so nobody is marked against a different paper than the one they
  were shown.
- Essays and PII are served per candidate from an admissions-only endpoint, and
  every read is logged.
- Ticket matching is exact. Search input is escaped for `LIKE` and bound.
- The client is told the deadline; it never invents one.
