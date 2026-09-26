import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cleanPhone, cleanText, countWords, escapeHtml, isValidEmail } from "@/lib/validate";

// ─── VALIDATION ───────────────────────────────────────────────────────────────
// lib/validate.ts replaced a blacklist — `sanitizeString` stripped `<>'";` from
// everything on the way in — with shape checks and length caps. Two properties
// are worth pinning down, because both were previously wrong in opposite
// directions:
//
//   1. It must NOT mangle legitimate input. Stripping the apostrophe out of
//      "O'Brien" produced "OBrien": a different name, in a scholarship shortlist,
//      printed on a certificate. Punctuation in a name is data.
//   2. It must NOT let control characters or unbounded length through, because
//      these strings are emailed, logged and written to CSV.

describe("cleanText", () => {
  it("keeps punctuation, including apostrophes and hyphens", () => {
    assert.equal(cleanText("O'Brien"), "O'Brien");
    assert.equal(cleanText("Anne-Marie"), "Anne-Marie");
    assert.equal(cleanText("  O'Brien-Smith  "), "O'Brien-Smith");
  });

  it("keeps non-Latin scripts intact", () => {
    for (const name of ["Amina Yusuf", "Chidinma Okafor", "José Álvarez", "李明", "Ольга"]) {
      assert.equal(cleanText(name), name);
    }
  });

  it("does not strip angle brackets, because React escapes on render", () => {
    // The old sanitiser turned "<script>" into "script" and gave a false sense of
    // safety while corrupting the field. Escaping happens in escapeHtml, at the
    // one place that builds markup.
    assert.equal(cleanText("<b>Name</b>"), "<b>Name</b>");
  });

  it("removes control characters, which break logs and CSV exports", () => {
    // A newline in a name is the payload in a CSV/log-injection attempt: it can
    // forge a row in an export or split a log line into two.
    assert.equal(cleanText("Ada\u0000Lovelace"), "Ada Lovelace");
    assert.equal(cleanText("Ada\r\nLovelace"), "Ada Lovelace");
    assert.equal(cleanText("Ada\u001B[31mRed"), "Ada [31mRed");
    assert.equal(cleanText("Ada\u007FLovelace"), "Ada Lovelace");
  });

  it("collapses runs of whitespace rather than preserving them", () => {
    assert.equal(cleanText("  too    many\t\tspaces  "), "too many spaces");
  });

  it("caps length", () => {
    const long = "a".repeat(5000);
    assert.equal(cleanText(long).length, 200);
    assert.equal(cleanText(long, 10).length, 10);
  });

  it("returns an empty string for non-strings instead of coercing", () => {
    for (const value of [null, undefined, 42, {}, [], true]) {
      assert.equal(cleanText(value), "");
    }
  });
});

describe("isValidEmail", () => {
  it("accepts ordinary addresses", () => {
    for (const value of ["a@b.co", "first.last@example.com", "a+tag@sub.example.org"]) {
      assert.equal(isValidEmail(value), true, `${value} should be accepted`);
    }
  });

  it("rejects addresses that would break a header or a query", () => {
    for (const value of [
      "no-at-sign",
      "@example.com",
      "user@",
      "user@localhost", // no dot: the TLD is required by the pattern
      "a@b.c, d@e.f", // comma
      "a@b.c; d@e.f", // semicolon
      "user name@example.com", // space
      "user@exam ple.com",
      "<user@example.com>",
      "a@b..c",
      "a@-b.com",
    ]) {
      assert.equal(isValidEmail(value), false, `${value} should be rejected`);
    }
  });

  it("rejects non-strings and over-long values", () => {
    for (const value of [null, undefined, 42, {}, [], `${"a".repeat(250)}@example.com`]) {
      assert.equal(isValidEmail(value), false);
    }
  });
});

describe("cleanPhone", () => {
  it("keeps digits and a leading plus", () => {
    assert.equal(cleanPhone("+2348012345678"), "+2348012345678");
    assert.equal(cleanPhone("080 1234 5678"), "08012345678");
  });

  it("rejects a number too short to be one", () => {
    // 6 digits is a pager. Accepting it puts a junk value in a contact field that
    // an invigilator may need to use.
    for (const value of ["12345", "1", "+234"]) {
      assert.equal(cleanPhone(value), null, `${value} should be rejected`);
    }
  });

  it("rejects non-strings", () => {
    for (const value of [null, undefined, 42, {}]) {
      assert.equal(cleanPhone(value), null);
    }
  });
});

describe("countWords", () => {
  it("counts the essay minimum the way a marker would", () => {
    // This number gates whether an essay reaches a grader at all.
    assert.equal(countWords("one two three"), 3);
    assert.equal(countWords("  padded   out  words  "), 3);
    assert.equal(countWords("line\nbreaks\tcount"), 3);
  });

  it("counts zero for empty, blank and non-string input", () => {
    for (const value of ["", "   ", "\n\t", null, undefined, 42, {}]) {
      assert.equal(countWords(value), 0);
    }
  });

  it("does not count punctuation as a word", () => {
    assert.equal(countWords("... --- ***"), 0);
  });
});

describe("escapeHtml", () => {
  it("escapes every character that can close a tag or an attribute", () => {
    // The hand-built email template is the one place user data becomes markup.
    assert.equal(escapeHtml("<script>alert(1)</script>"), "&lt;script&gt;alert(1)&lt;/script&gt;");
    assert.equal(escapeHtml('" onload="x'), "&quot; onload=&quot;x");
    assert.equal(escapeHtml("it's"), "it&#39;s");
  });

  it("escapes the ampersand first, so entities are not double-decoded", () => {
    // "&lt;" must become "&amp;lt;", not "&lt;". Getting this backwards turns a
    // literal "<" in a name into a tag in the email.
    assert.equal(escapeHtml("&lt;"), "&amp;lt;");
  });

  it("returns an empty string for non-strings", () => {
    for (const value of [null, undefined, 42, {}]) {
      assert.equal(escapeHtml(value), "");
    }
  });
});
