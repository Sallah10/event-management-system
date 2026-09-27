export interface CourseMapping {
  slug: string;
  /** Identifier in the downstream LMS. Carried in exports, never trusted inbound. */
  lmsId: number;
  displayName: string;
}

export const COURSES: CourseMapping[] = [
  {
    slug: "aws-certified-cloud-practitioner-13",
    lmsId: 13,
    displayName: "AWS Cloud Practitioner",
  },
  {
    slug: "comptia-security-certification-43",
    lmsId: 43,
    displayName: "Cybersecurity (CompTIA Security+)",
  },
  {
    slug: "microsoft-power-bi-certification-training-course-52",
    lmsId: 52,
    displayName: "Data Analysis (Power BI)",
  },
  {
    slug: "frontend-development-with-react-js-64",
    lmsId: 64,
    displayName: "Frontend Dev (React.js)",
  },
  {
    slug: "aws-solution-architect-associate-certification-training-71",
    lmsId: 71,
    displayName: "AWS Solution Architect",
  },
  {
    slug: "microsoft-azure-fundamental-az-900-certification-training-72",
    lmsId: 72,
    displayName: "Microsoft Azure (AZ-900)",
  },
  {
    slug: "artificial-intelligence-and-machine-learning-fundamentals-74",
    lmsId: 74,
    displayName: "AI & Machine Learning Fundamentals",
  },
  {
    slug: "blockchain-technology-75",
    lmsId: 75,
    displayName: "Blockchain Technology",
  },
  {
    slug: "certnexus-certified-data-science-practitioner-certification-training-76",
    lmsId: 76,
    displayName: "Certified Data Science Practitioner",
  },
  {
    slug: "comptia-cybersecurity-analyst-cysa-77",
    lmsId: 77,
    displayName: "Cybersecurity Analyst (CySA+)",
  },
  {
    slug: "back-end-development-express-in-node-js-78",
    lmsId: 78,
    displayName: "Backend Dev (Node.js/Express)",
  },
  {
    slug: "certified-artificial-intelligence-practitioner-79",
    lmsId: 79,
    displayName: "Certified AI Practitioner",
  },
  {
    slug: "microsoft-azure-ai-900-fundamentals-80",
    lmsId: 80,
    displayName: "Microsoft Azure AI Fundamentals",
  },
];

// NOTE: TOTAL_SLOTS and LIMIT_PER_COURSE now live in config/rules.ts, which is
// the single source of truth for every business number. They used to be
// declared here AND in config/event-settings.ts, the two were never compared,
// and the event-settings copy was read by nothing at all.

// ─── DISPLAY ───────────────────────────────────────────────────────────────────

/**
 * Programmes for the in-app registration form.
 *
 * Lives here rather than in lib/registration.ts so the form can render its
 * course list without importing anything that needs a database. Reading config
 * from a module that throws on a missing DATABASE_URL means the page 500s
 * instead of showing a person a form.
 *
 * Derived from COURSES, so a programme added above appears in the form
 * automatically and the form can never offer something the ranking does not
 * know about.
 */
export function courseOptions(): { slug: string; label: string }[] {
  return COURSES.map((course) => ({ slug: course.slug, label: course.displayName }));
}
