import { Sequelize } from "sequelize";
import pg from "pg";

// ─── DATABASE CONNECTION ──────────────────────────────────────────────────────
// Postgres only (Neon in prod). Kept deliberately single-dialect: a dev-mode
// SQLite fallback would mean maintaining two dialects for zero portfolio value.
//
// Fixes vs the original:
//   • `logging: console.log` was printing EVERY SQL statement on every request.
//     At 3,500 attendees on check-in day that is hundreds of MB of logs - and
//     the query text discloses the exact PII columns being selected. Now off
//     outside development, and bind values are never logged.
//   • The eager `authenticate()` at module scope fired on every cold start and
//     logged to console. Replaced with a single lazily-awaited warmup that
//     can't reject unhandled.
//   • Pool sized for a serverless runtime, with a loud acquire timeout so a
//     saturated pool surfaces as an error instead of hanging a request.

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in - " +
      "see docs/ENV_SETUP.md.",
  );
}

const isProd = process.env.NODE_ENV === "production";

const sequelize = new Sequelize(DATABASE_URL, {
  dialect: "postgres",
  dialectModule: pg,
  dialectOptions: {
    ssl: isProd ? { require: true, rejectUnauthorized: true } : undefined,
  },
  // FIX: was `console.log` unconditionally
  logging: isProd
    ? false
    : process.env.SQL_LOG === "true"
      ? console.log
      : false,
  // FIX: `max: 5` with 3,500 sequential scans at the door was the bottleneck.
  // Serverless functions are numerous but each holds few connections, so the
  // ceiling has to be per-instance and the acquire timeout has to be short
  // enough that a queue forms in Redis rather than in Postgres.
  pool: {
    max: Number(process.env.DB_POOL_MAX ?? 10),
    min: 0,
    acquire: 10_000,
    idle: 10_000,
  },
  retry: { max: 2 },
});

// FIX: was a bare .authenticate() that logged to console on import
let warmup: Promise<void> | null = null;
export function ensureDatabase(): Promise<void> {
  if (!warmup) {
    warmup = sequelize.authenticate().catch((err) => {
      warmup = null; // let the next request retry instead of caching the failure
      throw err;
    });
  }
  return warmup;
}

export default sequelize;
