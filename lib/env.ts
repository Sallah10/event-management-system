// ─── REQUIRED ENV ─────────────────────────────────────────────────────────────
// Fail-closed, and fail LOUDLY. The original code had four different hardcoded
// fallback JWT secrets across six files ("jwt_secret_key",
// "your-secret-key-change-this", …). If the env var was ever missing, some
// routes broke while others silently accepted tokens signed with a string that
// is published in this repo. That's fail-open on a security boundary.

const cache = new Map<string, string>();

export function requireEnv(name: string): string {
  const cached = cache.get(name);
  if (cached) return cached;

  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `[env] ${name} is required but not set. Copy .env.example → .env.local. ` +
        `See docs/ENV_SETUP.md. Refusing to continue with an insecure default.`,
    );
  }

  cache.set(name, value);
  return value;
}

export function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : fallback;
}
