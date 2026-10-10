// ─── EXPLICIT END-TO-END SMOKE TEST ───────────────────────────────────────────
// Run against a LOCAL, RUNNING copy of the app and the seeded database:
//
//     npm run dev              # in another terminal
//     npm run test:e2e         # in this one
//
// The server is expected on http://localhost:3000 (override with
// E2E_BASE_URL). Credentials come from your .env: STAFF_PIN, ADMISSIONS_PIN
// and the ticket prefix TICKET_PREFIX. Nothing is printed except masked
// values, and the only database writes are the check-in test on Amara, which
// this script resets afterwards.
//
// Order matters: the "registered, not checked in" login case must run BEFORE
// the check-in tests, or Amara has just been checked in by the script itself.
// Each step prints PASS or FAIL with the actual HTTP status and response.
// Exits non-zero if anything fails, so it can gate a deploy.
import "dotenv/config";
import pg from "pg";
import { Redis } from "@upstash/redis";

const BASE = (process.env.E2E_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const PREFIX = (process.env.TICKET_PREFIX ?? "TS26").toUpperCase();

// Deterministic ticket bodies, exactly as scripts/seed.mjs mints them.
const ticket = (i) =>
  `${PREFIX}-${(((i * 2654435761) >>> 0) >>> 0)
    .toString(16)
    .toUpperCase()
    .padStart(8, "0")}`;

// The ten named candidates from the seed, in seed order (Amara = 1).
const CANDIDATES = {
  Amara: { i: 1, email: "amara.okafor@example.com" },
  Tomas: { i: 2, email: "tomas.berg@example.com" },
  Priya: { i: 3, email: "priya.raghunathan@example.com" },
  Kwame: { i: 4, email: "kwame.mensah@example.com" },
  Lucia: { i: 5, email: "lucia.marchetti@example.com" },
  Idris: { i: 6, email: "idris.haddad@example.com" },
  Sofia: { i: 7, email: "sofia.novak@example.com" },
  Rahul: { i: 8, email: "rahul.verma@example.com" },
  Chiara: { i: 9, email: "chiara.bellini@example.com" },
  Bilal: { i: 10, email: "bilal.chaudhry@example.com" },
  Nadia: { i: 11, email: "nadia.petrova@example.com" },
};
const amaraTicket = ticket(CANDIDATES.Amara.i);

let failures = 0;
const ok = (pass, detail = "") => {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${detail}`);
  if (!pass) failures++;
};

async function req(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, options);
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json, headers: res.headers };
}

const jsonHeaders = (extra = {}) => ({
  "content-type": "application/json",
  ...extra,
});

const login = (email, ticketId, cookie) =>
  req("/api/assessment/login", {
    method: "POST",
    headers: jsonHeaders(cookie ? { cookie } : {}),
    body: JSON.stringify({ email, ticketId }),
  });

// Returns Amara to her pristine seed state in both stores: the Postgres row
// AND the Redis fast-path key the check-in route reads first. The Redis key
// lives on for 24h, so without this a re-run gets "409 ALREADY CHECKED IN"
// even though the database row was already reset.
async function resetAmara(pool) {
  await pool.query(
    `UPDATE registrants SET checked_in = false, status = 'registered', updated_at = NOW()
      WHERE barcode_id = $1`,
    [amaraTicket],
  );
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    await Redis.fromEnv().del(`checkin:${amaraTicket}`);
  } else {
    console.log(
      "  NOTE: no Upstash credentials - the dev server uses an in-memory store. " +
        "Restart " + (process.env.E2E_BASE_URL ? "the server" : "\"npm run dev\"") +
        " to clear its check-in cache before re-running.",
    );
  }
}

async function main() {
  console.log(`\nTarget: ${BASE}`);
  console.log(`Ticket prefix: ${PREFIX}  (a real ticket looks like ${amaraTicket})`);

  try {
    await fetch(BASE, { method: "GET" });
  } catch {
    console.log(`\nERROR: no server on ${BASE}. Start it with "npm run dev" and re-run.`);
    process.exit(1);
  }

  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
  });

  // ── 1. Public surfaces ────────────────────────────────────────────────────
  console.log("\n[1/8] Public surfaces");
  let r = await req("/");
  ok(r.status === 200, `landing page GET / -> ${r.status} (expected 200)`);
  r = await req("/assessment/login");
  ok(r.status === 200, `candidate login page -> ${r.status} (expected 200)`);
  ok(r.json === null || !r.json?.error, `no route-level error on login page`);

  // ── 2. Staff session ──────────────────────────────────────────────────────
  console.log("\n[2/8] Staff sign-in");
  const staffPin = process.env.STAFF_PIN;
  if (!staffPin) {
    console.log("  SKIP: STAFF_PIN not set in .env");
  } else {
    r = await req("/api/admin/auth?role=staff", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ pin: staffPin }),
    });
    globalThis.__staffCookie = r.headers.get("set-cookie")?.split(";")[0] ?? "";
    ok(r.status === 200 && r.json?.success === true, `staff login -> ${r.status} (expected 200)`);
  }

  // ── 3. Stats + manual search ──────────────────────────────────────────────
  console.log("\n[3/8] Staff + manual desk");
  if (staffPin) {
    r = await req("/api/admin/stats", { headers: { cookie: globalThis.__staffCookie } });
    const total = r.json?.data?.summary?.total;
    ok(r.status === 200 && r.json?.success === true && typeof total === "number" && total >= 1,
      `stats -> ${r.status}, total=${total} (expected a count)`);

    r = await req("/api/admin/manual-search?q=" + encodeURIComponent("amara"), {
      headers: { cookie: globalThis.__staffCookie },
    });
    const hit = Array.isArray(r.json?.data?.results) && r.json.data.results.some((x) => x.name === "Amara Okafor");
    ok(r.status === 200 && hit, `manual-search "amara" -> ${r.status}, hit=${hit} (expected 1 hit)`);

    r = await req("/api/admin/manual-search?q=" + encodeURIComponent("a"), {
      headers: { cookie: globalThis.__staffCookie },
    });
    ok(r.status === 400 && r.json?.error === "QUERY_TOO_SHORT", `manual-search "a" -> ${r.status}/${r.json?.error} (expected 400 QUERY_TOO_SHORT)`);
  }

  // ── 4. Candidate logins ───────────────────────────────────────────────────
  // Runs BEFORE the check-in section so Amara is still "registered, not
  // checked in" - this is exactly the stage gate her seed status describes.
  // Reset her first in case an earlier aborted run left her checked in.
  console.log("\n[4/8] Candidate logins at their correct stages");
  await resetAmara(pool);
  const cases = [
    {
      label: `registered + not checked in (Amara ${amaraTicket})`,
      email: CANDIDATES.Amara.email, ticket: amaraTicket,
      expect: { status: 403, error: "NOT_CHECKED_IN" },
    },
    {
      label: `attended + checked in (Priya)`,
      email: CANDIDATES.Priya.email, ticket: ticket(CANDIDATES.Priya.i),
      // NO_DEVICE_KEY, not "malformed": credentials AND check-in passed; the
      // next step is the browser-held device cookie. A real browser sends it
      // automatically, which is why this is the deepest a plain API call goes.
      expect: { status: 400, error: "NO_DEVICE_KEY" },
    },
    {
      label: `qualified (Idris) -> theory`,
      email: CANDIDATES.Idris.email, ticket: ticket(CANDIDATES.Idris.i),
      expect: { status: 403, error: "THEORY_READY", redirect: "/assessment/theory" },
    },
    {
      label: `awarded (Nadia) -> done`,
      email: CANDIDATES.Nadia.email, ticket: ticket(CANDIDATES.Nadia.i),
      expect: { status: 403, error: "ALREADY_COMPLETED", redirect: "/assessment/thank-you" },
    },
    {
      label: `waitlisted (Bilal) -> not qualified`,
      email: CANDIDATES.Bilal.email, ticket: ticket(CANDIDATES.Bilal.i),
      expect: { status: 403, error: "NOT_QUALIFIED" },
    },
  ];
  for (const c of cases) {
    r = await login(c.email, c.ticket);
    const pass =
      r.status === c.expect.status &&
      r.json?.error === c.expect.error &&
      (!c.expect.redirect || r.json?.redirect === c.expect.redirect);
    ok(pass, `${c.label} -> ${r.status}/${r.json?.error}${r.json?.redirect ? " -> " + r.json.redirect : ""} (expected ${c.expect.status}/${c.expect.error}${c.expect.redirect ? " -> " + c.expect.redirect : ""})`);
  }

  // Wrong-email on a real ticket must give the SAME generic reply, not a hint.
  r = await login("totally.wrong@example.com", ticket(CANDIDATES.Priya.i));
  ok(r.status === 401 && r.json?.error === "INVALID_CREDENTIALS",
    `wrong email on Priya's ticket -> ${r.status}/${r.json?.error} (expected 401, no user enumeration)`);

  // ── 5. Check-in ───────────────────────────────────────────────────────────
  console.log("\n[5/8] Check-in");
  if (staffPin) {
    await resetAmara(pool);
    r = await req("/api/check-in", {
      method: "POST",
      headers: jsonHeaders({ cookie: globalThis.__staffCookie }),
      body: JSON.stringify({ barcodeId: amaraTicket }),
    });
    ok(r.status === 200 && r.json?.success === true && /Welcome, Amara/.test(r.json?.message ?? ""),
      `check-in Amara ${amaraTicket} -> ${r.status} ${r.json?.message ?? ""}`);

    r = await req("/api/check-in", {
      method: "POST",
      headers: jsonHeaders({ cookie: globalThis.__staffCookie }),
      body: JSON.stringify({ barcodeId: amaraTicket }),
    });
    ok(r.status === 409 && r.json?.error === "ALREADY_CHECKED_IN",
      `duplicate check-in -> ${r.status}/${r.json?.error} (expected 409)`);

    r = await req("/api/check-in", {
      method: "POST",
      headers: jsonHeaders({ cookie: globalThis.__staffCookie }),
      body: JSON.stringify({ barcodeId: `${PREFIX}-1234` }),
    });
    ok(r.status === 400 && r.json?.error === "BAD_REQUEST",
      `malformed ticket check-in -> ${r.status}/${r.json?.error} (expected 400)`);
  }

  // ── 6. Admissions session ─────────────────────────────────────────────────
  console.log("\n[6/8] Admissions sign-in");
  const admissionsPin = process.env.ADMISSIONS_PIN;
  let admissionsCookie = "";
  if (!admissionsPin) {
    console.log("  SKIP: ADMISSIONS_PIN not set in .env");
  } else {
    r = await req("/api/admin/auth?role=admissions", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ pin: admissionsPin }),
    });
    admissionsCookie = r.headers.get("set-cookie")?.split(";")[0] ?? "";
    ok(r.status === 200 && r.json?.success === true, `admissions login -> ${r.status} (expected 200)`);
  }

  // ── 7. Winners export ─────────────────────────────────────────────────────
  console.log("\n[7/8] Winners export");
  if (admissionsPin) {
    r = await req("/api/admin/winners-export", { headers: { cookie: admissionsCookie } });
    const count = r.json?.data?.count;
    ok(r.status === 200 && r.json?.success === true && typeof count === "number" && count >= 1,
      `winners export -> ${r.status}, count=${count} (expected >= 1: Nadia awarded / Chiara shortlisted)`);
  }

  // ── 8. Cleanup: put Amara back the way the seed made her ─────────────────
  console.log("\n[8/8] Cleanup");
  await resetAmara(pool);
  await pool.end();
  ok(true, `Amara reset to registered + not checked in (${amaraTicket})`);

  console.log(`\n━━━ ${failures === 0 ? "ALL PASS" : failures + " STEP(S) FAILED"} ━━━`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\nERROR running smoke test:", error);
  process.exit(1);
});