export interface CourseMapping {
  slug: string;
  lmsId: number;
  displayName: string;
}

export const TECHSHIFT_COURSES: CourseMapping[] = [
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

// DYNAMIC MATH: Calculate limit per course based on the 13 courses above
export const TOTAL_SLOTS = Number(process.env.TOTAL_SLOTS) || 546;
export const LIMIT_PER_COURSE = Math.floor(
  TOTAL_SLOTS / TECHSHIFT_COURSES.length,
);
// Math: 546 / 13 = 42 slots per course.
