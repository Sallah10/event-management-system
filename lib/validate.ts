// ─── INPUT VALIDATION ─────────────────────────────────────────────────────────
// Pure, dependency-free, unit-tested. Exists so the "sanitise everything with a
// regex on the way in" pattern can be replaced by actual validation.
//
// The original had `sanitizeString = (v) => v.trim().replace(/[<>'"\`;]/g, "")`.
// That's a blacklist, blacklists are always incomplete, and it bought nothing:
// these values are rendered by React, which escapes by default, and they go into
// a JSON column read back as data. Stripping `<` and `>` from a name just
// produces "OBrien" with the apostrophe removed, which is worse than useless.
//
// What actually matters:
//   • shape checks that reject garbage early (email, ticket, course slug)
//   • length caps, so nobody can write a 4MB "name"
//   • control-character stripping, because these strings get emailed and logged
//     and a newline in a name breaks CSV exports downstream
//   • HTML-escaping at the point of interpolation into an email template, which
//     is the one place we build markup by hand

/**
 * Practical email check. Deliberately not a full RFC 5322 parser.
 *
 * The domain part is stricter than "any run of non-delimiter characters", because
 * that version accepted `a@-b.com`. A label may not begin or end with a hyphen:
 * it is not a legal hostname, and an address that reads like a real domain while
 * being unroutable is exactly the shape worth refusing. Nothing legitimate is
 * lost - no provider issues addresses at a hyphen-leading domain.
 */
const EMAIL =
  /^[^\s@,;:<>()[\]\\]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

export function isValidEmail(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > 254) return false;
  if (/\s/.test(value)) return false;
  return EMAIL.test(value);
}

/**
 * Clean a human-entered string. Trims, collapses whitespace, strips control
 * characters, and caps length. Does NOT mangle punctuation - a name is allowed
 * to contain an apostrophe, a hyphen or a non-Latin script.
 */
export function cleanText(value: unknown, maxLength = 200): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

/** Nigerian mobile, tolerant of spacing and the +234 prefix. */
export function cleanPhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/[^\d+]/g, "");
  if (digits.replace(/\D/g, "").length < 7) return null;
  return digits.slice(0, 20);
}

/**
 * Words in a free-text answer - the gate on whether an essay reaches a marker.
 *
 * A token counts only if it contains at least one letter or digit, in any script.
 *
 * The previous version counted whitespace-separated tokens, so "--- ... ***" was
 * three words. Padded to the minimum, that is a page of punctuation and dots
 * passing a check described to candidates as "a one-line answer can't be assessed
 * fairly" - the gate existed to stop exactly that, and it did not. `config/rules`
 * counts words the same way, so the client-side counter and this agreed with each
 * other and both agreed on the wrong number.
 */
export function countWords(value: unknown): number {
  if (typeof value !== "string") return 0;
  return value.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token))
    .length;
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Escape for interpolation into the hand-built HTML email template.
 * This is the ONE place in the codebase that concatenates user data into markup,
 * so it's the one place that genuinely must escape.
 */
export function escapeHtml(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}
