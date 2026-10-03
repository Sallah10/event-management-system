import { Sequelize, DataTypes } from "sequelize";
import "dotenv/config";

const force = process.argv.includes("--force");
const isTs = new Date("2026-04-18T09:00:00Z");
const at = (minutesFromStart) => new Date(isTs.getTime() + minutesFromStart * 60_000);

const COHORT_YEAR = 2026;
const PREFIX = "EVT";
const ticket = (n) =>
  `${PREFIX}-${(((n + 1) * 2654435761) >>> 0).toString(16).padStart(8, "0").toUpperCase()}`;

const ANSWER = {
  "artificial-intelligence-and-machine-learning-fundamentals-74": {
    1: "Supervised learning uses labelled data to learn a mapping from inputs to outputs, and generalises to unseen examples once trained.",
    2: "A validation set tunes hyper-parameters during development, whereas a held-out test set is only touched once to estimate generalisation error.",
    3: "Overfitting is when a model memorises training data instead of learning the underlying pattern, which shows up as a train/test accuracy gap.",
  },
  "frontend-development-with-react-js-64": {
    1: "State belongs as close to where it is used as possible, so a component re-renders only when its own inputs change.",
    2: "A keyed list gives React a stable identity per item, so reordering does not remount nodes and lose their internal state.",
    3: "Lifting state up is right when two siblings need the same value, and wrong when it would re-render a large subtree for no benefit.",
  },
  "microsoft-power-bi-certification-training-course-52": {
    1: "A star schema keeps facts separate from dimensions so each dimension can be reused across many fact tables.",
    2: "Row-level security restricts what a report viewer sees without duplicating the report for different audiences.",
    3: "Incremental refresh limits how much data is reprocessed per run, which keeps large models inside the refresh time limit.",
  },
  "comptia-security-certification-43": {
    1: "Least privilege means a user or process holds only the permissions required for its task, reducing blast radius.",
    2: "Defence in depth layers independent controls so a single failure does not expose the whole system.",
    3: "Network segmentation limits lateral movement, so compromising one host does not reach the rest of the estate.",
  },
};

const CANDIDATES = [
  {
    stage: "registered, never started",
    name: "Amara Okafor",
    email: "amara.okafor@example.com",
    phone: "+44 7700 900101",
    course: "frontend-development-with-react-js-64",
    createdMinutes: -60 * 24 * 9,
    status: "registered",
  },
  {
    stage: "registered + checked in at venue",
    name: "Tomas Berg",
    email: "tomas.berg@example.com",
    phone: "+44 7700 900102",
    course: "microsoft-power-bi-certification-training-course-52",
    createdMinutes: -60 * 24 * 8,
    status: "registered",
    checkedIn: true,
  },
  {
    stage: "objective in progress",
    name: "Priya Raghunathan",
    email: "priya.raghunathan@example.com",
    phone: "+44 7700 900103",
    course: "artificial-intelligence-and-machine-learning-fundamentals-74",
    createdMinutes: -60 * 24 * 8,
    status: "attended",
    checkedIn: true,
    objectiveStartedAt: at(-18),
    tabSwitches: 0,
  },
  {
    stage: "objective in progress + tab switches",
    name: "Kwame Mensah",
    email: "kwame.mensah@example.com",
    phone: "+44 7700 900104",
    course: "frontend-development-with-react-js-64",
    createdMinutes: -60 * 24 * 8,
    status: "attended",
    checkedIn: true,
    objectiveStartedAt: at(-22),
    tabSwitches: 6,
  },
  {
    stage: "objective finished, waiting for pass mark",
    name: "Lucia Marchetti",
    email: "lucia.marchetti@example.com",
    phone: "+44 7700 900105",
    course: "comptia-security-certification-43",
    createdMinutes: -60 * 24 * 7,
    status: "attended",
    checkedIn: true,
    objectiveStartedAt: at(-300),
    objectiveFinishedAt: at(-265),
    objectiveScore: 34,
    tabSwitches: 1,
  },
  {
    stage: "qualified, theory not started",
    name: "Idris Haddad",
    email: "idris.haddad@example.com",
    phone: "+44 7700 900106",
    course: "artificial-intelligence-and-machine-learning-fundamentals-74",
    createdMinutes: -60 * 24 * 7,
    status: "qualified",
    checkedIn: true,
    objectiveStartedAt: at(-290),
    objectiveFinishedAt: at(-255),
    objectiveScore: 58,
    objectiveRank: 2,
    tabSwitches: 0,
  },
  {
    stage: "qualified, flagged by tab monitoring",
    name: "Sofia Novak",
    email: "sofia.novak@example.com",
    phone: "+44 7700 900107",
    course: "frontend-development-with-react-js-64",
    createdMinutes: -60 * 24 * 7,
    status: "qualified",
    checkedIn: true,
    objectiveStartedAt: at(-280),
    objectiveFinishedAt: at(-240),
    objectiveScore: 51,
    objectiveRank: 4,
    isFlagged: true,
    tabSwitches: 14,
  },
  {
    stage: "theory submitted, not yet graded",
    name: "Rahul Verma",
    email: "rahul.verma@example.com",
    phone: "+44 7700 900108",
    course: "microsoft-power-bi-certification-training-course-52",
    createdMinutes: -60 * 24 * 6,
    status: "qualified",
    checkedIn: true,
    objectiveStartedAt: at(-270),
    objectiveFinishedAt: at(-235),
    objectiveScore: 62,
    objectiveRank: 1,
    theoryStartedAt: at(-40),
    theoryFinishedAt: at(-4),
    theoryAnswer: ANSWER["microsoft-power-bi-certification-training-course-52"][1],
    theoryAnswer1: ANSWER["microsoft-power-bi-certification-training-course-52"][1],
    theoryAnswer2: ANSWER["microsoft-power-bi-certification-training-course-52"][2],
    theoryAnswer3: ANSWER["microsoft-power-bi-certification-training-course-52"][3],
    tabSwitches: 2,
  },
  {
    stage: "graded + shortlisted",
    name: "Chiara Bellini",
    email: "chiara.bellini@example.com",
    phone: "+44 7700 900109",
    course: "artificial-intelligence-and-machine-learning-fundamentals-74",
    createdMinutes: -60 * 24 * 6,
    status: "shortlisted",
    checkedIn: true,
    objectiveStartedAt: at(-260),
    objectiveFinishedAt: at(-225),
    objectiveScore: 66,
    objectiveRank: 1,
    theoryStartedAt: at(-180),
    theoryFinishedAt: at(-150),
    theoryAnswer: ANSWER["artificial-intelligence-and-machine-learning-fundamentals-74"][1],
    theoryAnswer1: ANSWER["artificial-intelligence-and-machine-learning-fundamentals-74"][1],
    theoryAnswer2: ANSWER["artificial-intelligence-and-machine-learning-fundamentals-74"][2],
    theoryAnswer3: ANSWER["artificial-intelligence-and-machine-learning-fundamentals-74"][3],
    theoryScore: 84,
    theoryGradedAt: at(-120),
    theoryGradedBy: "seed@script",
    careerStatus: "graduate",
    aiConfidence: "0.91",
    tabSwitches: 0,
  },
  {
    stage: "graded + waitlisted",
    name: "Bilal Chaudhry",
    email: "bilal.chaudhry@example.com",
    phone: "+44 7700 900110",
    course: "frontend-development-with-react-js-64",
    createdMinutes: -60 * 24 * 6,
    status: "waitlisted",
    checkedIn: true,
    objectiveStartedAt: at(-255),
    objectiveFinishedAt: at(-220),
    objectiveScore: 49,
    objectiveRank: 6,
    theoryStartedAt: at(-170),
    theoryFinishedAt: at(-140),
    theoryAnswer: ANSWER["frontend-development-with-react-js-64"][1],
    theoryAnswer1: ANSWER["frontend-development-with-react-js-64"][1],
    theoryAnswer2: ANSWER["frontend-development-with-react-js-64"][2],
    theoryAnswer3: ANSWER["frontend-development-with-react-js-64"][3],
    theoryScore: 61,
    theoryGradedAt: at(-115),
    theoryGradedBy: "seed@script",
    careerStatus: "final_year",
    aiConfidence: "0.63",
    decisionNote: "Strong practical answers, held for the next available seat.",
    tabSwitches: 3,
  },
  {
    stage: "awarded a funded place",
    name: "Nadia Petrova",
    email: "nadia.petrova@example.com",
    phone: "+44 7700 900111",
    course: "comptia-security-certification-43",
    createdMinutes: -60 * 24 * 8,
    status: "awarded",
    checkedIn: true,
    objectiveStartedAt: at(-250),
    objectiveFinishedAt: at(-215),
    objectiveScore: 71,
    objectiveRank: 1,
    theoryStartedAt: at(-160),
    theoryFinishedAt: at(-130),
    theoryAnswer: ANSWER["comptia-security-certification-43"][1],
    theoryAnswer1: ANSWER["comptia-security-certification-43"][1],
    theoryAnswer2: ANSWER["comptia-security-certification-43"][2],
    theoryAnswer3: ANSWER["comptia-security-certification-43"][3],
    theoryScore: 93,
    theoryGradedAt: at(-100),
    theoryGradedBy: "seed@script",
    careerStatus: "final_year",
    aiConfidence: "0.88",
    decisionNote: "Highest aggregate on the day, scholarship offered and accepted.",
    decidedAt: at(-90),
    decidedBy: "seed@script",
    tabSwitches: 0,
  },
];

const DECISIONS = [
  ["chiara.bellini@example.com", "qualified", "shortlisted", "Theory scored well above the cohort median."],
  ["bilal.chaudhry@example.com", "qualified", "waitlisted", "Cohort seats were filled by higher aggregates."],
  ["nadia.petrova@example.com", "qualified", "awarded", "Top aggregate, funded place awarded."],
  ["sofia.novak@example.com", "qualified", "qualified", "Flagged for review before grading."],
];

const sequelize = new Sequelize(process.env.DATABASE_URL, { logging: false });

const Registrant = sequelize.define(
  "registrant",
  {
    name: DataTypes.STRING,
    email: { type: DataTypes.STRING, unique: true },
    phone: DataTypes.STRING,
    barcodeId: DataTypes.STRING,
    deviceId: DataTypes.STRING,
    checkedIn: { type: DataTypes.BOOLEAN, defaultValue: false },
    status: { type: DataTypes.STRING, defaultValue: "registered" },
    objectiveScore: DataTypes.INTEGER,
    objectiveStartedAt: DataTypes.DATE,
    objectiveFinishedAt: DataTypes.DATE,
    objectiveRank: DataTypes.INTEGER,
    theoryStartedAt: DataTypes.DATE,
    theoryFinishedAt: DataTypes.DATE,
    theoryAnswer: DataTypes.TEXT,
    theoryAnswer1: { type: DataTypes.TEXT, field: "theory_answer_1" },
    theoryAnswer2: { type: DataTypes.TEXT, field: "theory_answer_2" },
    theoryAnswer3: { type: DataTypes.TEXT, field: "theory_answer_3" },
    theoryScore: DataTypes.INTEGER,
    theoryGradedAt: DataTypes.DATE,
    theoryGradedBy: DataTypes.STRING,
    aiSuspected: DataTypes.BOOLEAN,
    aiGradeReason: DataTypes.TEXT,
    aiConfidence: DataTypes.STRING,
    careerStatus: DataTypes.STRING,
    isFlagged: { type: DataTypes.BOOLEAN, defaultValue: false },
    selectedCourseSlug: DataTypes.STRING,
    cohortYear: { type: DataTypes.INTEGER, defaultValue: COHORT_YEAR },
    tabSwitches: { type: DataTypes.INTEGER, defaultValue: 0 },
    decisionNote: DataTypes.TEXT,
    decidedAt: DataTypes.DATE,
    decidedBy: DataTypes.STRING,
  },
  { tableName: "registrants", underscored: true, timestamps: true }
);

const AdmissionDecision = sequelize.define(
  "admissionDecision",
  {
    registrantId: { type: DataTypes.UUID, primaryKey: true },
    fromStatus: DataTypes.STRING,
    toStatus: DataTypes.STRING,
    actorRole: DataTypes.STRING,
    actor: DataTypes.STRING,
    note: DataTypes.TEXT,
    context: DataTypes.JSONB,
  },
  { tableName: "admission_decisions", underscored: true, timestamps: true, updatedAt: false }
);

const [[existing]] = await sequelize.query("select count(*)::int as n from registrants");

if (existing.n > 0 && !force) {
  console.log(`registrants already present (${existing.n}). Re-run with --force to replace them.`);
  await sequelize.close();
  process.exit(0);
}

if (force && existing.n > 0) {
  await sequelize.query("delete from admission_decisions");
  await sequelize.query("delete from registrants");
  console.log(`cleared ${existing.n} existing registrant(s)`);
}

const rows = CANDIDATES.map((c, i) => {
  const row = { ...c };
  delete row.stage;
  delete row.course;
  delete row.createdMinutes;
  const rest = row;
  return {
    ...rest,
    barcodeId: ticket(i),
    selectedCourseSlug: c.course,
    cohortYear: COHORT_YEAR,
    checkedIn: rest.checkedIn ?? false,
    isFlagged: rest.isFlagged ?? false,
    aiSuspected: false,
    tabSwitches: rest.tabSwitches ?? 0,
    objectiveScore: rest.objectiveScore ?? 0,
    theoryScore: rest.theoryScore ?? 0,
    deviceId: `seed-device-${String(i + 1).padStart(3, "0")}`,
    createdAt: at(c.createdMinutes),
    updatedAt: at(c.createdMinutes),
  };
});

const created = await Registrant.bulkCreate(rows, { returning: true });
console.log(`inserted ${created.length} registrants\n`);

for (const [email, fromStatus, toStatus, note] of DECISIONS) {
  const person = created.find((r) => r.email === email);
  if (!person) continue;
  await AdmissionDecision.create({
    registrantId: person.id,
    fromStatus,
    toStatus,
    actorRole: "staff",
    actor: "seed@script",
    note,
    context: { seeded: true },
  });
}
console.log(`inserted ${DECISIONS.length} admission decisions\n`);

for (const [i, c] of CANDIDATES.entries()) {
  console.log(`  ${String(i + 1).padStart(2)}. ${c.stage.padEnd(38)} ${c.name}  ${ticket(i)}`);
}

console.log(`\ncohort year ${COHORT_YEAR}, event ${isTs.toISOString()}`);
console.log("synthetic data only - no real candidates, email addresses use example.com");
await sequelize.close();