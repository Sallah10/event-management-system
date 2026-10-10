/**
 * One-off repair for mojibake in comments.
 *
 * Some earlier writes emitted comment headers whose box-drawing characters were
 * double-encoded: the UTF-8 bytes of "─" (E2 94 80) were decoded as CP1252,
 * giving three characters - "â" + "”" + "€" - which are what the files contain
 * today. Purely cosmetic, but it makes every file header unreadable in a diff.
 *
 * The fix is the inverse: re-encode the run as CP1252 bytes and decode as UTF-8.
 *
 * SAFETY
 * Only runs whose decoded result consists ENTIRELY of characters this codebase
 * actually uses in prose are touched. If a run does not round-trip to a known
 * character, or the bytes are not valid UTF-8, it is left alone. That matters
 * because a blanket round-trip would mangle legitimately accented text.
 *
 * Run: node scripts/fix-mojibake.mjs [--check]
 */

import fs from "node:fs";
import path from "node:path";

/** Unicode -> CP1252 byte, for the range CP1252 puts above 0x7F. */
const CP1252_HIGH = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};

/** Characters we are willing to introduce. Everything else is left as found. */
const ALLOWED = new Set([
  "─", // ─  box drawing
  "→", // →  arrow
  "-", // -  em dash
  "–", // –  en dash
  "’", // ’  right single quote
  "‘", // ‘
  "“", // “
  "”", // ”
  "…", // …
  "•", // •
  "£", // £  (prices in prose)
  "é", // é
  "…",
]);

function toCp1252Byte(cp) {
  if (cp <= 0xff) return cp;
  return CP1252_HIGH[cp] ?? null;
}

/** Decode one maximal non-ASCII run, if it is recoverable mojibake. */
function repairRun(run) {
  const bytes = [];
  for (const ch of run) {
    const byte = toCp1252Byte(ch.codePointAt(0));
    if (byte === null) return null;
    bytes.push(byte);
  }

  const decoded = Buffer.from(bytes).toString("utf8");
  // A replacement character means the bytes were not valid UTF-8 - so this run
  // was not mojibake of the kind we are fixing. Leave it.
  if (decoded.includes("�")) return null;
  for (const ch of decoded) {
    if (!ALLOWED.has(ch)) return null;
  }
  return decoded;
}

function repairText(text) {
  let out = "";
  let i = 0;
  let changed = 0;

  while (i < text.length) {
    if (text.codePointAt(i) < 0x80) {
      out += text[i];
      i += 1;
      continue;
    }
    // Take the whole run of non-ASCII characters.
    let j = i;
    while (j < text.length && text.codePointAt(j) >= 0x80) j += 1;
    const run = text.slice(i, j);
    const fixed = repairRun(run);
    if (fixed === null) {
      out += run;
    } else {
      out += fixed;
      changed += 1;
    }
    i = j;
  }
  return { out, changed };
}

const check = process.argv.includes("--check");
const roots = ["app", "components", "lib", "config", "scripts", "docs"];
const files = [];

const walk = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    // FIX: this list was ts/tsx/json/md only, so the two script formats the repo
    // actually runs - .mjs, and the .js that predates them - were never repaired.
    // That is how scripts/migrate.mjs kept a mangled em dash in the middle of the
    // one migration comment anybody would read when the sitting timers were
    // broken. A repair tool with a narrower file filter than the project's file
    // list is worse than none, because it reports "clean".
    else if (/\.(ts|tsx|js|mjs|cjs|json|md|css)$/.test(entry.name))
      files.push(full);
  }
};
roots.forEach(walk);

let repaired = 0;
for (const file of files) {
  const original = fs.readFileSync(file, "utf8");
  const { out, changed } = repairText(original);
  if (changed === 0 || out === original) continue;
  repaired += 1;
  console.log(
    `${check ? "would fix" : "fixed"}: ${file} (${changed} run${changed === 1 ? "" : "s"})`,
  );
  if (!check) fs.writeFileSync(file, out, "utf8");
}

console.log(
  check
    ? `\n${repaired} file(s) would change.`
    : `\nRepaired ${repaired} file(s).`,
);
