/**
 * Idempotent schema migration.
 *
 *   npm run db:migrate
 *
 * WHY A HAND-ROLLED SCRIPT AND NOT sequelize.sync()
 * `sync({ alter: true })` is the fastest way to lose data in production: it
 * issues ALTER statements based on what it thinks the model looks like, it
 * drops columns it no longer knows about, and it has no record of what it did.
 * It also runs implicitly on serverless cold starts if any code path calls it.
 * This script only ever ADDs, and running it twice is a no-op.
 *
 * Written against `pg` directly so it doesn't have to import the models - the
 * models import `lib/db`, which would open a connection before we're ready.
 *
 * It reads DATABASE_URL from the environment. It never writes to .env.
 */

import { resolve } from "node:path";

// ─── LOAD .env WITHOUT TOUCHING IT ────────────────────────────────────────────
// Next reads .env for `next dev`/`next build`; a bare `node` process does not,
// so without this the script fails with "DATABASE_URL is not set" on a machine
// where the app itself works fine. dotenv only ever reads.
try {
  const { config } = await import("dotenv");
  config({ path: resolve(process.cwd(), ".env"), quiet: true });
} catch {
  // dotenv is a dependency, but a missing module must not be fatal - the
  // variable may already be exported in the shell.
}

const { default: pg } = await import("pg");
const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error(
    "DATABASE_URL is not set. Add it to .env (or export it) and re-run.",
  );
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_SSL === "false"
      ? false
      : { rejectUnauthorized: false },
  max: 1,
});

/** Additive migrations, in order. Never edit a shipped one - append a new entry. */
const MIGRATIONS = [
  {
    id: "001-create-registrants",
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS registrants (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name VARCHAR(255) NOT NULL,
          email VARCHAR(255) NOT NULL,
          phone VARCHAR(64),
          barcode_id VARCHAR(64) NOT NULL,
          checked_in BOOLEAN NOT NULL DEFAULT FALSE,
          status VARCHAR(32) NOT NULL DEFAULT 'registered',
          objective_score INTEGER NOT NULL DEFAULT 0,
          objective_finished_at TIMESTAMPTZ,
          theory_answer TEXT,
          theory_answer_1 TEXT,
          theory_answer_2 TEXT,
          theory_answer_3 TEXT,
          theory_score INTEGER NOT NULL DEFAULT 0,
          selected_course_slug VARCHAR(64),
          cohort_year INTEGER NOT NULL DEFAULT 2026,
          is_flagged BOOLEAN NOT NULL DEFAULT FALSE,
          device_id VARCHAR(255),
          career_status VARCHAR(64),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      // Uniqueness is enforced in the DB, not just the model. The registration
      // route's duplicate check is a UX affordance; this is the constraint.
      await client.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS registrants_email_key ON registrants (email)`,
      );
      await client.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS registrants_barcode_id_key ON registrants (barcode_id)`,
      );
      // The check-in desk queries by barcode constantly, and the admin queue
      // filters by status - both were unindexed full scans.
      await client.query(
        `CREATE INDEX IF NOT EXISTS registrants_status_idx ON registrants (status)`,
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS registrants_checked_in_idx ON registrants (checked_in)`,
      );
    },
  },
  {
    id: "002-ai-grading-and-decisioning",
    up: async (client) => {
      const columns = [
        // The AI's opinion, kept away from isFlagged on purpose.
        ["ai_suspected", "BOOLEAN NOT NULL DEFAULT FALSE"],
        ["ai_grade_reason", "VARCHAR(400)"],
        ["ai_confidence", "VARCHAR(16)"],
        ["theory_graded_at", "TIMESTAMPTZ"],
        ["theory_graded_by", "VARCHAR(255)"],
        // Pool position and decision provenance.
        ["objective_rank", "INTEGER"],
        ["decision_note", "TEXT"],
        ["decided_at", "TIMESTAMPTZ"],
        ["decided_by", "VARCHAR(255)"],
        // Client-reported focus losses - recorded, never decisive.
        ["tab_switches", "INTEGER NOT NULL DEFAULT 0"],
      ];
      for (const [name, definition] of columns) {
        await client.query(
          `ALTER TABLE registrants ADD COLUMN IF NOT EXISTS ${name} ${definition}`,
        );
      }
      await client.query(
        `CREATE INDEX IF NOT EXISTS registrants_objective_rank_idx ON registrants (objective_rank)`,
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS registrants_ai_suspected_idx ON registrants (ai_suspected)`,
      );
    },
    // ─── WHY THIS NEEDS TO RUN OUTSIDE A TRANSACTION ───────────────────────
    // "completed" meant two different things: "didn't make the top 910" (set by
    // the objective submit route) and "theory submitted, awaiting grading" (set
    // by the theory route). The AI grader selects on it, so one class of
    // candidates who never wrote an essay would have been sent for grading. The
    // enum needs two more values, and `ALTER TYPE ... ADD VALUE` cannot run
    // inside a transaction block on older Postgres - and on newer versions the
    // new value is not usable until the transaction commits. So it runs alone,
    // committed, before the transactional migrations.
    pre: async (client) => {
      const { rows } = await client.query(`
        SELECT udt_name, udt_schema
        FROM information_schema.columns
        WHERE table_name = 'registrants' AND column_name = 'status'
      `);
      const typeName = rows[0]?.udt_name;
      const typeSchema = rows[0]?.udt_schema;

      // A fresh install has VARCHAR(32) - there is no enum to extend. Postgres
      // names enum types after the column, so Sequelize's `status` column gives
      // you `enum_registrants_status`, NOT any of the labels inside it.
      //
      // The check here used to be `["registered", "attended"].includes(typeName)`
      // - comparing enum LABELS against the enum TYPE NAME. Those two sets have
      // no members in common, so this always bailed out early, and any database
      // created by sequelize.sync() silently kept its 4-value enum forever: the
      // app would happily write status="waitlisted" and Postgres would reject it
      // with a bare `invalid input value for enum`. Look the type up properly.
      if (!typeName || !typeName.startsWith("enum_")) return;

      const { rows: existing } = await client.query(
        `SELECT enumlabel FROM pg_enum WHERE enumtypid = $1::regtype`,
        [`"${typeSchema}"."${typeName}"`],
      );
      const have = new Set(existing.map((r) => r.enumlabel));

      for (const value of ["waitlisted", "eliminated"]) {
        if (have.has(value)) continue;
        // Each in its own implicit transaction: safe on every supported version.
        await client.query(
          `ALTER TYPE "${typeSchema}"."${typeName}" ADD VALUE IF NOT EXISTS '${value}'`,
        );
        console.log(`  enum  ${typeName} += ${value}`);
      }
    },
  },
  {
    id: "003-admission-decision-log",
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS admission_decisions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          registrant_id UUID NOT NULL REFERENCES registrants (id) ON DELETE CASCADE,
          from_status VARCHAR(32),
          to_status VARCHAR(32) NOT NULL,
          actor_role VARCHAR(32) NOT NULL,
          actor VARCHAR(255) NOT NULL,
          note TEXT,
          context JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(
        `CREATE INDEX IF NOT EXISTS admission_decisions_registrant_idx ON admission_decisions (registrant_id, created_at DESC)`,
      );
    },
  },
  {
    id: "004-sitting-timings",
    up: async (client) => {
      // The countdown used to live in React state, initialised to a hardcoded
      // 1800/3600. Reload the page and the timer reset to full - so the "30
      // minute" limit was a suggestion, not a limit, and the honest description
      // of this system was "a timer that resets on refresh".
      //
      // These two columns make the sitting real. The page is issued a deadline
      // derived from objective_started_at; the first view stamps it, every
      // later view recomputes from it, and it is never rewritten.
      for (const [name, definition] of [
        ["objective_started_at", "TIMESTAMPTZ"],
        ["theory_started_at", "TIMESTAMPTZ"],
        // The finish times. The objective side already had one; the theory side
        // did not, which meant a late essay was indistinguishable from an on-time
        // one and two candidates of equal quality could not be separated by who
        // actually finished first. theory_graded_at cannot stand in for it: that
        // is when a marker opened the paper, which may be the following week.
        ["theory_finished_at", "TIMESTAMPTZ"],
      ]) {
        await client.query(
          `ALTER TABLE registrants ADD COLUMN IF NOT EXISTS ${name} ${definition}`,
        );
      }
      // Backfill for anyone mid-sitting when this ships, so their first reload
      // doesn't look like a brand-new sitting. Coalesce to objective_finished_at
      // for past candidates so an already-finished sitter can't "re-open" a
      // deadline that never existed.
      await client.query(`
        UPDATE registrants
        SET objective_started_at = COALESCE(objective_finished_at, created_at)
        WHERE objective_started_at IS NULL
          AND objective_finished_at IS NOT NULL
      `);
    },
  },
];

async function main() {
  const client = await pool.connect();
  const applied = [];
  try {
    // A ledger, so re-running is a no-op and so there is a record of what ran.
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id VARCHAR(128) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const { rows } = await client.query("SELECT id FROM schema_migrations");
    const done = new Set(rows.map((r) => r.id));

    for (const migration of MIGRATIONS) {
      if (done.has(migration.id)) {
        console.log(`  skip  ${migration.id} (already applied)`);
        continue;
      }
      process.stdout.write(`  apply ${migration.id} ... `);
      if (migration.pre) {
        // `pre` exists because some DDL genuinely cannot run inside a
        // transaction (ALTER TYPE ... ADD VALUE, on older Postgres). Close the
        // open one, run it in autocommit, then open a fresh transaction so the
        // ledger insert and the rest of `up` stay atomic.
        //
        // There is exactly ONE BEGIN after `pre`. This used to open a second
        // one, which is a no-op on the server but emits a
        // "WARNING: there is already a transaction in progress" on every run.
        await client.query("COMMIT");
        await migration.pre(client);
        await client.query("BEGIN");
      } else {
        await client.query("BEGIN");
      }
      try {
        await migration.up(client);
        await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [
          migration.id,
        ]);
        await client.query("COMMIT");
        applied.push(migration.id);
        console.log("done");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    client.release();
    await pool.end();
  }

  console.log(
    applied.length === 0
      ? "\nSchema already up to date. Nothing to do."
      : `\nApplied ${applied.length} migration(s): ${applied.join(", ")}`,
  );
}

// Surface the real error, not a stack trace from a failed assert.
main().catch((error) => {
  console.error(`\nMigration failed: ${error.message}`);
  if (process.env.DEBUG) console.error(error);
  process.exit(1);
});
