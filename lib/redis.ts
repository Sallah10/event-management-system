import { Redis } from "@upstash/redis";

// ─── REDIS CLIENT ─────────────────────────────────────────────────────────────
// Two modes:
//   1. Upstash  - used whenever UPSTASH_REDIS_REST_URL + _TOKEN are present
//                 (production, and your own machine if you paste them in).
//   2. Memory   - a tiny in-process stand-in so `npm run dev` works with zero
//                 credentials. Refuses to engage in production, because a
//                 silently-degraded rate limiter is worse than no rate limiter.
//
// Both expose the same surface we actually use: get / set / incr / del /
// expire / ttl / keys. The memory mode deliberately implements the same TTL
// semantics so behaviour matches.

export interface RedisLike {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, opts?: { ex?: number }): Promise<unknown>;
  incr(key: string): Promise<number>;
  decr(key: string): Promise<number>;
  del(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  ttl(key: string): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  /** Cursor iteration. Preferred over keys() - never blocks the server. */
  scan(
    cursor: string,
    matchToken: "MATCH",
    pattern: string,
    countToken: "COUNT",
    count: number,
  ): Promise<{ cursor: string; keys: string[] }>;
}

const hasCredentials = Boolean(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
);

// ─── IN-MEMORY FALLBACK ───────────────────────────────────────────────────────

function createMemoryRedis(): RedisLike {
  const store = new Map<string, { value: unknown; expiresAt: number | null }>();

  const alive = (key: string) => {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      store.delete(key);
      return null;
    }
    return entry;
  };

  // Every dev request would otherwise queue a timer and keep the process alive
  if (typeof setInterval === "function" && process.env.NODE_ENV !== "test") {
    const sweeper = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of store) {
        if (entry.expiresAt !== null && now > entry.expiresAt)
          store.delete(key);
      }
    }, 30_000);
    sweeper.unref?.();
  }

  return {
    async get<T>(key: string) {
      const entry = alive(key);
      return entry ? (entry.value as T) : null;
    },
    async set(key, value, opts) {
      store.set(key, {
        value,
        expiresAt: opts?.ex ? Date.now() + opts.ex * 1000 : null,
      });
      return "OK";
    },
    async incr(key) {
      const entry = alive(key);
      const next = (typeof entry?.value === "number" ? entry.value : 0) + 1;
      store.set(key, {
        value: next,
        expiresAt: entry?.expiresAt ?? null,
      });
      return next;
    },
    async decr(key) {
      const entry = alive(key);
      const next = (typeof entry?.value === "number" ? entry.value : 0) - 1;
      store.set(key, { value: next, expiresAt: entry?.expiresAt ?? null });
      return next;
    },
    async del(key) {
      return store.delete(key) ? 1 : 0;
    },
    async expire(key, seconds) {
      const entry = alive(key);
      if (!entry) return 0;
      entry.expiresAt = Date.now() + seconds * 1000;
      return 1;
    },
    async ttl(key) {
      const entry = alive(key);
      if (!entry) return -2;
      if (entry.expiresAt === null) return -1;
      return Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000));
    },
    async keys(pattern) {
      const prefix = pattern.replace(/\*$/, "");
      const out: string[] = [];
      for (const key of store.keys()) {
        const entry = alive(key);
        if (entry && key.startsWith(prefix)) out.push(key);
      }
      return out;
    },
    async scan(cursor, _matchToken, pattern, _countToken, count) {
      const prefix = pattern.replace(/\*$/, "");
      const out: string[] = [];
      let seen = 0;
      for (const key of store.keys()) {
        if (seen++ >= Number(cursor)) break;
        const entry = alive(key);
        if (entry && key.startsWith(prefix)) out.push(key);
      }
      void count;
      return { cursor: "0", keys: out };
    },
  };
}

// ─── RESOLUTION ───────────────────────────────────────────────────────────────

function createRedis(): RedisLike {
  if (hasCredentials) return Redis.fromEnv() as unknown as RedisLike;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are missing. " +
        "Refusing to start in production with an in-memory rate limiter.",
    );
  }

  console.warn(
    "[redis] No Upstash credentials - using in-memory store. " +
      "Rate limits and capacity counters reset on restart and are not shared " +
      "across instances. Fine for local dev, never for a real event.",
  );
  return createMemoryRedis();
}

export const redis: RedisLike = createRedis();
export const usingMemoryRedis = !hasCredentials;

// ─── KEY BUILDERS ─────────────────────────────────────────────────────────────
// Centralised so a typo can't silently create a second namespace (which is how
// you end up with a rate limiter that "works" but counts nothing).

export const flagKey = (barcodeId: string) => `flag:${barcodeId}`;
export const checkinKey = (barcodeId: string) => `checkin:${barcodeId}`;
export const capacityKey = () => "event:capacity";
// `start:<barcode>` is deliberately absent. It used to be the exam clock, kept in
// Redis while the paper counted down from a Postgres column - two clocks for one
// sitting, which agreed right up until the key expired or was evicted and the
// candidate was handed a fresh full-length timer. The clock now lives only in
// `registrants.objective_started_at`, read through lib/exam-sitting.ts. Nothing
// writes a start time to Redis.
export const backButtonKey = (barcodeId: string) => `backnav:${barcodeId}`;
export const rateLimitKey = (scope: string, id: string) =>
  `rate_limit:${scope}:${id}`;
