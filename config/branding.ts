/**
 * Event identity and third-party form wiring.
 *
 * WHY THIS FILE EXISTS
 *
 * The event's name, the venue, the sender identity, the scholarship figure and
 * the CMS form's field names were all hardcoded — in the layout, in the landing
 * page, in the email template, in a "copy" file nobody imported, and in an
 * `EVENT_CONFIG` object that nothing read. That is five places to change per
 * event and no way to see them all at once, and it is why real venue addresses
 * and a real deployment URL ended up committed to a public repository.
 *
 * Everything here is configuration, defaults are generic, and a deployment sets
 * the real values in the environment. That is the whole point: the repository
 * stays publishable and a new cohort is a `.env` change, not a code change.
 *
 * Nothing here is a secret. Secrets live in lib/env.ts and nowhere else.
 */

/** Cohort year. Drives `registrants.cohort_year` and every "2026" in the copy. */
export const CURRENT_COHORT = Number(process.env.CURRENT_COHORT ?? 2026);

export const BRAND = {
  /** Programme name as the candidate should see it. */
  name: process.env.EVENT_NAME ?? "Tech Scholarship Programme",
  /** Short form for tight spaces: nav, QR label, email signature. */
  shortName: process.env.EVENT_SHORT_NAME ?? "Scholarship Programme",
  /** The organisation running it. */
  organisation: process.env.EVENT_ORGANISATION ?? "Programme Office",
  /** One line for meta descriptions and the footer. */
  tagline:
    process.env.EVENT_TAGLINE ??
    "A day of assessments, scholarships and careers.",
  /** Formatted date, or empty when the date isn't fixed yet. */
  date: process.env.EVENT_DATE ?? "",
  venue: process.env.EVENT_VENUE ?? "",
  address: process.env.EVENT_ADDRESS ?? "",
  /** Support address shown to candidates. */
  contactEmail: process.env.EVENT_CONTACT_EMAIL ?? "support@example.com",
  /** Where the candidate portal is deployed, used in links and QR payloads. */
  portalUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",

  /**
   * Social accounts, shown on the confirmation page.
   *
   * Empty by default, and the page renders no icons when every entry is empty.
   * They used to be four hardcoded links to one organisation's Instagram,
   * Facebook, LinkedIn and X accounts, sitting in a repository whose stated goal
   * is to be reusable for the next cohort — so a deployment that was not that
   * organisation sent candidates to a stranger's feed. Config, with nothing to
   * inherit by accident.
   */
  socials: [
    { platform: "instagram", label: "Instagram", url: process.env.SOCIAL_INSTAGRAM ?? "" },
    { platform: "facebook", label: "Facebook", url: process.env.SOCIAL_FACEBOOK ?? "" },
    { platform: "linkedin", label: "LinkedIn", url: process.env.SOCIAL_LINKEDIN ?? "" },
    { platform: "x", label: "X", url: process.env.SOCIAL_X ?? "" },
  ],
} as const;

/**
 * Palette for the HTML email and the QR code.
 *
 * The email used to hardcode `#0000FF` as the primary and a blue/amber mix in
 * the body, which is not the colour the product uses anywhere else. One palette,
 * used by every surface, configurable per deployment.
 */
export const PALETTE = {
  ink: process.env.BRAND_INK ?? "#141210",
  accent: process.env.BRAND_ACCENT ?? "#B45309",
  accentSoft: process.env.BRAND_ACCENT_SOFT ?? "#FEF3C7",
  paper: process.env.BRAND_PAPER ?? "#FFFFFF",
  muted: process.env.BRAND_MUTED ?? "#78716C",
  line: process.env.BRAND_LINE ?? "#E7E5E4",
} as const;

/**
 * Field names posted by the CMS registration form.
 *
 * These are the CMS's field names, not ours, which is exactly why they belong in
 * configuration: renaming a form field in the CMS should not require a code
 * change, and a form field name is a small piece of someone else's brand that
 * has no business living in this repository.
 *
 * The first entry of each list is the modern name; the rest are the older
 * Gravity Forms keys this endpoint has accepted, so an in-flight site keeps
 * working while it is updated.
 */
export const WP_FORM_FIELDS = {
  name: ["name", "text-1", "name-1"],
  email: ["email", "email-1"],
  phone: ["phone", "phone-1", "text-2"],
  career: ["careerStatus", "career_status", "select-1"],
  course: ["courseInterest", "course_interest"],
  /** Some themes submit one textarea instead of discrete inputs. */
  blob: process.env.WP_FORM_BLOB_FIELD ?? "event-registration",
} as const;

/** Scholarship headline figures shown to candidates. Read from rules.ts values. */
export function scholarshipHeadline(slots: number, courses: number) {
  return {
    seats: slots,
    tracks: courses,
    perTrack: Math.floor(slots / Math.max(1, courses)),
  };
}
