// ─── STRUCTURED LOGGER ────────────────────────────────────────────────────────
// Replaces the ~25 raw console.log calls that were dumping full names, emails,
// phones and device fingerprints into logs. Everything now goes through here so
// there is exactly ONE place where redaction happens.
//
// Rules:
//   • Never log a secret. redact() strips anything that looks like one.
//   • Never log a full email / barcode. We keep a short prefix so support can
//     correlate a log line with a ticket without the log becoming a PII dump.
//   • Never interpolate a client-controlled string raw (log injection). We JSON
//     encode the payload, so a newline in `reason` can't forge a log line.

type Level = "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = { info: 0, warn: 1, error: 2 };

// Validated rather than cast. `LOG_LEVEL=verbose` used to produce a level that
// compares false against every entry, which silences the logger completely - the
// worst possible failure mode for the thing you'd switch on during an incident.
const LOG_LEVELS: Level[] = ["info", "warn", "error"];
const MIN_LEVEL: Level = LOG_LEVELS.includes(process.env.LOG_LEVEL as Level)
  ? (process.env.LOG_LEVEL as Level)
  : "info";

// ─── REDACTION ────────────────────────────────────────────────────────────────

/** a@b.com → a***@b.com  (keeps it correlatable, not identifiable) */
export function maskEmail(value?: string | null): string {
  if (!value) return "none";
  const [user = "", domain = ""] = value.split("@");
  if (!domain) return "***";
  return `${user.slice(0, 1)}***@${domain}`;
}

/** TS26-A1B2C3D4 → TS26-A1B2… (enough to find the row, not enough to impersonate) */
export function maskTicket(value?: string | null): string {
  if (!value) return "none";
  if (value.length <= 10) return `${value.slice(0, 4)}***`;
  return `${value.slice(0, 9)}…`;
}

/** Long opaque ids (device keys, JWTs) → first 8 chars only. */
export function maskId(value?: string | null): string {
  if (!value) return "none";
  return value.length <= 8 ? "***" : `${value.slice(0, 8)}…`;
}

const SECRET_KEYS = [
  "token",
  "secret",
  "password",
  "pin",
  "apikey",
  "api_key",
  "authorization",
  "cookie",
  "jwt",
  "fingerprint",
  "devicekey",
  "device_id",
  "deviceid",
];

/**
 * Deep-redact an arbitrary payload. Walks up to 3 levels so a nested object
 * can't smuggle a secret past us.
 *
 * Key matching is by SUBSTRING on a stripped key, not exact match - "apikey",
 * "x-api-key" and "api_key" all have to hit, and a new field name nobody
 * enumerated is the most likely way a secret escapes.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 3) return "[deep]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string")
    return value.length > 512 ? `${value.slice(0, 512)}…` : value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value))
    return value.slice(0, 20).map((v) => redact(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    const flat = key.toLowerCase().replace(/[^a-z]/g, "");

    if (SECRET_KEYS.some((s) => flat.includes(s.replace(/[^a-z]/g, "")))) {
      out[key] = "[redacted]";
    } else if (flat.includes("email")) {
      out[key] = maskEmail(val as string);
    } else if (flat.includes("barcode") || flat.includes("ticket")) {
      out[key] = maskTicket(val as string);
    } else if (flat.includes("fingerprint") || flat.includes("device")) {
      out[key] = maskId(val as string);
    } else {
      out[key] = redact(val, depth + 1);
    }
  }
  return out;
}

// ─── EMIT ─────────────────────────────────────────────────────────────────────

function emit(level: Level, event: string, data?: Record<string, unknown>) {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[MIN_LEVEL]) return;

  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...(data ? (redact(data) as Record<string, unknown>) : {}),
  };

  // Single line, JSON - survives log aggregators that mangle multi-line output
  const line = JSON.stringify(entry);

  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, data?: Record<string, unknown>) =>
    emit("info", event, data),
  warn: (event: string, data?: Record<string, unknown>) =>
    emit("warn", event, data),
  error: (event: string, data?: Record<string, unknown>) =>
    emit("error", event, data),
};

/** Domain helpers - these are the ones that replaced the old raw console.logs. */
export const logMetrics = {
  /** Check-in attempt. Never logs the raw scan, only the matched row. */
  checkin: (
    barcodeId: string,
    outcome: string,
    extra?: Record<string, unknown>,
  ) => log.info("checkin", { barcodeId, outcome, ...extra }),

  /** Integrity violation. `reason` is client-supplied so redact() JSON-encodes it. */
  flag: (barcodeId: string, reason: string, count: number) =>
    log.warn("integrity.flag", { barcodeId, reason, count }),

  /** Venue capacity pressure - the thing that actually pages someone on event day. */
  capacity: (current: number, limit: number) =>
    current >= limit - 50
      ? log.warn("checkin.capacity", { current, limit })
      : log.info("checkin.capacity", { current, limit }),

  /** Any route handler that throws. */
  routeError: (route: string, error: unknown) =>
    log.error("route.error", {
      route,
      name: (error as Error)?.name,
      message: (error as Error)?.message,
    }),
};
