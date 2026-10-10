"use client";

// ─── CLIENT DEVICE KEY ────────────────────────────────────────────────────────
// A random value this browser generates once and sends as `x-device-key`. The
// server stores sha256(key + DEVICE_PEPPER) against the candidate, so the exam
// session is bound to one browser instance.
//
// WHAT THIS IS NOT, STATED PLAINLY
// It is not a fingerprint, and it is not a substitute for one. It does not
// survive a cache clear, it is trivially copyable, and anyone determined can
// read it out of their own browser and replay it. What it does buy is real:
//
//   • A candidate who opens the exam in a second tab, a second browser or a
//     phone is refused, instead of two parallel sessions writing two answers.
//   • A stolen session cookie is not enough on its own; the attacker also needs
//     this value, which they do not have if the cookie was lifted from a header
//     dump on a different machine.
//
// The server hashes it with a pepper, so a database leak does not hand over
// usable device keys. See lib/session.ts for the server half.
//
// The previous implementation hashed `userAgent + language` and called it a
// fingerprint. User-agent is attacker-supplied and identical across a whole
// office's worth of Windows laptops, so it detected almost nothing while giving
// the reassuring appearance of a real control. Random and forgettable is
// strictly better than derived and guessable.

const STORAGE_KEY = "ts_device_key";

function randomKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The device key for this browser, created on first use.
 *
 * localStorage rather than a cookie: a cookie would be sent on every request to
 * every origin by default unless scoped, and the value has no business leaving
 * this one. It is also readable by any script on the page, which is the same
 * trust level as the exam itself - see the note above.
 */
export function getDeviceKey(): string {
  if (typeof window === "undefined") return "";

  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing && existing.length === 64) return existing;

    const created = randomKey();
    window.localStorage.setItem(STORAGE_KEY, created);
    return created;
  } catch {
    // Private mode, storage disabled, or quota exceeded. The exam cannot bind to
    // a device without it, so say so rather than silently sending nothing and
    // letting the server guess.
    return "";
  }
}

/** Forget this device. Used by the "sign out on this device" control. */
export function clearDeviceKey(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing useful to do; the key dies with the tab either way.
  }
}
