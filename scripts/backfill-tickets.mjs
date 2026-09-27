import fs from "node:fs";
import process from "node:process";

/**
 * One-off migration: import a WordPress registrant export into this app.
 *
 * WHY THIS SCRIPT WAS REWRITTEN
 * The version in the tree could never have worked, and worse, could have worked
 * by accident:
 *
 *  1. IT REQUIRED A PACKAGE THAT IS NOT INSTALLED. `csv-parser` was imported with
 *     a "// npm install csv-parser" comment and no such dependency exists in
 *     package.json, so the script threw on line one of its first run. Nobody
 *     noticed because it is not part of the build.
 *  2. THE SECRET NAME WAS WRONG. It sent `x-api-key: process.env.WP_API_KEY`.
 *     app/api/register/route.ts compares that header against WP_TO_APP_SECRET.
 *     WP_API_KEY is a WordPress-side variable, not this app's. Every single
 *     request would have been rejected with 401 — silently, one line per person,
 *     in a console nobody reads. A migration that reports 900 failures and 900
 *     successes-because-it-looks-like-it-worked is worse than one that refuses to
 *     start.
 *  3. IT EMAILED EVERYONE, EVERY TIME. No dry run, no confirmation, no
 *     idempotency check. Run it twice and 900 people get two confirmation
 *     emails, which for an events team is a reputational problem, not a bug.
 *
 * SO: dry run by default, `--execute` to actually send, a hard refusal if the
 * secret is missing, and per-row reporting that says which row failed and why.
 *
 * USAGE
 *   node scripts/backfill-tickets.mjs registrants.csv            # dry run
 *   node scripts/backfill-tickets.mjs registrants.csv --execute  # for real
 *
 * Required: WP_TO_APP_SECRET   (the same value the app verifies)
 * Optional: EVENT_PORTAL_URL   (defaults to http://localhost:3000)
 */

const args = process.argv.slice(2);
const execute = args.includes("--execute");
const csvPath = args.find((a) => !a.startsWith("--")) ?? "registrants.csv";

const SECRET = process.env.WP_TO_APP_SECRET;
const BASE_URL = (
  process.env.EVENT_PORTAL_URL ?? "http://localhost:3000"
).replace(/\/+$/, "");
const ENDPOINT = `${BASE_URL}/api/register`;

/** Pause between posts so a 900-row import is not a burst against the app. */
const DELAY_MS = 250;

/**
 * Minimal RFC 4180 CSV row parser.
 *
 * Hand-rolled rather than pulled in as a dependency because this script is the
 * only thing in the project that needs one, and a one-shot migration tool is a
 * poor reason to add a package to the tree. Handles quoted fields, escaped
 * double quotes and embedded newlines — WordPress exports contain all three once
 * somebody has put a line break in a "job title" field.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      // Skip the trailing empty row every file ends with.
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** First non-empty value among several possible column names. */
function pick(record, ...names) {
  for (const name of names) {
    const value = record[name];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return "";
}

const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  if (!fs.existsSync(csvPath)) {
    console.error(`No such file: ${csvPath}`);
    process.exitCode = 1;
    return;
  }

  if (execute && !SECRET) {
    // Refuse rather than send 900 unauthenticated requests that will all 401.
    console.error(
      "WP_TO_APP_SECRET is not set.\n" +
        "The register route checks that header against it; without it every\n" +
        "request is rejected. Set it, or drop --execute to see the plan.",
    );
    process.exitCode = 1;
    return;
  }

  const rows = parseCsv(fs.readFileSync(csvPath, "utf8"));
  if (rows.length < 2) {
    console.error(`${csvPath} has no data rows.`);
    process.exitCode = 1;
    return;
  }

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const records = rows.slice(1).map((cells) =>
    Object.fromEntries(header.map((key, i) => [key, cells[i] ?? ""])),
  );

  // Validate everything BEFORE sending anything, so a bad column name is caught
  // on a dry run rather than after 400 emails have gone out.
  const usable = [];
  const rejected = [];

  for (const [index, record] of records.entries()) {
    const line = index + 2; // +2: one-based, and the header is line 1.
    const name = pick(record, "full_name", "name");
    const email = pick(record, "user_email", "email").toLowerCase();
    const phone = pick(record, "user_phone", "phone");
    const courseInterest = pick(record, "selected_course", "courseinterest", "course");

    if (!name) {
      rejected.push({ line, why: "no name" });
    } else if (!isEmail(email)) {
      rejected.push({ line, why: `bad or missing email (${email || "empty"})` });
    } else if (courseInterest) {
      rejected.push({
        line,
        why: `"${courseInterest}" is not a course slug — map it to one of the slugs in config/course-matrix.ts first`,
      });
    } else {
      usable.push({ line, name, email, phone });
    }
  }

  console.log(`${csvPath}: ${records.length} row(s)`);
  console.log(`  usable:   ${usable.length}`);
  console.log(`  rejected: ${rejected.length}`);
  for (const { line, why } of rejected) {
    console.log(`    line ${line}: ${why}`);
  }
  console.log(`\nTarget: ${ENDPOINT}`);

  if (!execute) {
    console.log(
      "\nDry run. Nothing was sent.\n" +
        "Re-run with --execute to import, which emails every registrant a ticket.",
    );
    return;
  }

  let sent = 0;
  const failed = [];

  for (const person of usable) {
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": SECRET,
        },
        body: JSON.stringify({
          name: person.name,
          email: person.email,
          phone: person.phone || undefined,
        }),
      });

      const payload = await response.json().catch(() => ({}));

      if (response.ok && payload.success) {
        sent += 1;
        console.log(`  ok    line ${person.line}  ${person.email}`);
      } else {
        const why = payload.message ?? `HTTP ${response.status}`;
        failed.push({ ...person, why });
        console.log(`  FAIL  line ${person.line}  ${person.email}  — ${why}`);
      }
    } catch (error) {
      const why = error instanceof Error ? error.message : "unknown error";
      failed.push({ ...person, why });
      console.log(`  FAIL  line ${person.line}  ${person.email}  — ${why}`);
    }

    await sleep(DELAY_MS);
  }

  console.log(`\nSent ${sent}/${usable.length}.`);
  if (failed.length > 0) {
    console.log(`${failed.length} failed:`);
    for (const { line, email, why } of failed) {
      console.log(`  line ${line}  ${email}  — ${why}`);
    }
    // Non-zero exit so a CI step or a shell `&&` chain notices.
    process.exitCode = 1;
  }
}

await main();
