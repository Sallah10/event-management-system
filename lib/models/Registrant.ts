// `InferAttributes`, `InferCreationAttributes` and `CreationOptional` are types,
// not values. Saying so with `import type` is not a style preference: without it
// the import survives to runtime, where `sequelize` has no such export, and
// anything loading this module outside the bundler - the test runner, a script -
// fails on a name that only ever existed in a type position.
import { DataTypes, Model } from "sequelize";
import type {
  CreationOptional,
  InferAttributes,
  InferCreationAttributes,
} from "sequelize";
import sequelize from "../db";

export class Registrant extends Model<
  InferAttributes<Registrant>,
  InferCreationAttributes<Registrant>
> {
  declare id: CreationOptional<string>;
  declare name: string;
  declare email: string;
  declare phone: string | null;
  declare barcodeId: string; // Maps to barcode_id
  /**
   * The pipeline. "waitlisted" and "eliminated" did not exist, and the enum had
   * no way to say "sat the paper and didn't make the cut" - so the objective
   * submit route reused "completed" for both outcomes:
   *
   *     status: rank.hasSeat ? "qualified" : "completed"
   *
   * which silently overloaded it with a second meaning, "theory submitted,
   * awaiting grading". The AI grader selects `status: "completed"`, so every
   * waitlisted candidate who had never written an essay would have been sent to
   * OpenAI as if they had, with `theoryScore: 0` as the only evidence, and
   * nothing in the query result would have looked wrong. One overloaded enum
   * value, two subsystems, no error.
   *
   * A status now means exactly one thing. Waitlisted candidates keep their score
   * and finish time, so a later appeal or a re-run is still possible.
   *
   * Creation-optional: the database supplies the default (see the migration), so
   * a caller that only knows a name, an email and a ticket shouldn't have to
   * restate "0" and "false" - and shouldn't be able to get them wrong. Declaring
   * them required here made every create() site invent those values, which is how
   * `objectiveScore: 0` ended up copy-pasted into a dozen files.
   */
  declare checkedIn: CreationOptional<boolean>; // Maps to checked_in
  declare status: CreationOptional<
    | "registered"
    | "attended"
    | "qualified"
    | "waitlisted"
    | "eliminated"
    | "completed"
    | "shortlisted"
    | "awarded"
  >;
  declare objectiveScore: CreationOptional<number>; // Maps to objective_score
  /**
   * When this candidate's clock started. Set once, on first view of the paper.
   *
   * This column is the only reason the time limit is real. Both the exam and the
   * theory pages used to hold the countdown in React state initialised to 1800 /
   * 3600 - so a refresh, a crash, a closed tab or a second device handed the
   * candidate a full new sitting. The deadline is now issued by the server from
   * this timestamp and never travels in client state.
   */
  declare objectiveStartedAt: Date | null; // Maps to objective_started_at
  declare theoryStartedAt: Date | null; // Maps to theory_started_at
  declare objectiveFinishedAt: Date | null; // Maps to objective_finished_at
  // When the theory paper was handed in. Added with theoryStartedAt: without a
  // finish time there is no way to record that an essay arrived late, and no way
  // to rank two papers of equal quality by who finished first. theory_graded_at
  // is not a substitute - that is when a marker looked at it, which can be days
  // later and tells you nothing about the candidate.
  declare theoryFinishedAt: Date | null; // Maps to theory_finished_at
  /** Legacy single-answer column, kept so old rows still read. See migration 001. */
  declare theoryAnswer: string | null; // Maps to theory_answer
  declare theoryAnswer1: string | null;
  declare theoryAnswer2: string | null;
  declare theoryAnswer3: string | null;
  declare theoryScore: CreationOptional<number>;
  declare selectedCourseSlug: string | null; // Maps to selected_course_slug
  declare cohortYear: CreationOptional<number>; // Maps to cohort_year
  declare isFlagged: CreationOptional<boolean>; // Maps to is_flagged
  declare deviceId: string | null; // Maps to device_id
  declare careerStatus: string | null;

  // ─── AI GRADING (observation only - never a verdict) ──────────────────────
  // These columns did not exist, which is why the old AI audit route had to
  // squeeze its output into isFlagged. It wrote
  //     isFlagged: aiData.is_ai_suspected || false
  // on every graded row, unconditionally - so a candidate the invigilation team
  // had already flagged had that flag erased the moment a model reported
  // "not AI-generated". The model's opinion now lands in its own column where
  // it can be weighed, argued with, and ignored, and only a human moves
  // isFlagged.
  declare aiSuspected: CreationOptional<boolean>; // Maps to ai_suspected
  declare aiGradeReason: string | null; // Maps to ai_grade_reason
  declare aiConfidence: "high" | "medium" | "low" | null; // Maps to ai_confidence
  declare theoryGradedAt: Date | null; // Maps to theory_graded_at
  declare theoryGradedBy: string | null; // Maps to theory_graded_by

  // ─── POOL RANK AND DECISIONING ─────────────────────────────────────────────
  // objectiveRank is persisted rather than recomputed on read so the "910 Wall"
  // is auditable: we can always answer "why was this candidate in, and who put
  // them there", including after the fact.
  declare objectiveRank: number | null; // Maps to objective_rank
  declare decisionNote: string | null; // Maps to decision_note
  declare decidedAt: Date | null; // Maps to decided_at
  declare decidedBy: string | null; // Maps to decided_by

  /**
   * Client-reported focus losses during the objective section. Stored so the
   * integrity queue can triage on it - never used to disqualify anyone, because
   * the client is the one sending this number and could send zero.
   */
  declare tabSwitches: CreationOptional<number | null>; // Maps to tab_switches

  declare readonly createdAt: CreationOptional<Date>;
  declare readonly updatedAt: CreationOptional<Date>;
}

if (!sequelize.models.Registrant) {
  Registrant.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: { type: DataTypes.STRING },
      email: { type: DataTypes.STRING, unique: true },
      phone: { type: DataTypes.STRING },
      barcodeId: { type: DataTypes.STRING, unique: true },
      checkedIn: { type: DataTypes.BOOLEAN, defaultValue: false },
      status: {
        type: DataTypes.ENUM(
          "registered",
          "attended",
          "qualified",
          "waitlisted",
          "eliminated",
          "completed",
          "shortlisted",
          "awarded",
        ),
        defaultValue: "registered",
      },
      objectiveScore: { type: DataTypes.INTEGER, defaultValue: 0 },
      objectiveStartedAt: { type: DataTypes.DATE, allowNull: true },
      theoryStartedAt: { type: DataTypes.DATE, allowNull: true },
      objectiveFinishedAt: { type: DataTypes.DATE },
      theoryFinishedAt: { type: DataTypes.DATE, allowNull: true },
      theoryAnswer: { type: DataTypes.TEXT },
      // `underscored: true` converts camelCase to snake_case but does not insert a
      // separator before a digit, so it turned `theoryAnswer1` into
      // `theory_answer1`. The migration builds `theory_answer_1`. Sequelize
      // generated SELECTs naming a column that does not exist, so every query on
      // this model failed - which surfaced as "sign-in failed" on a login route
      // that never mentions theory answers. Spelled out rather than inferred.
      theoryAnswer1: { type: DataTypes.TEXT, field: "theory_answer_1" },
      theoryAnswer2: { type: DataTypes.TEXT, field: "theory_answer_2" },
      theoryAnswer3: { type: DataTypes.TEXT, field: "theory_answer_3" },
      theoryScore: { type: DataTypes.INTEGER, defaultValue: 0 },
      selectedCourseSlug: { type: DataTypes.STRING },
      cohortYear: { type: DataTypes.INTEGER, defaultValue: 2026 },
      isFlagged: { type: DataTypes.BOOLEAN, defaultValue: false },
      deviceId: { type: DataTypes.STRING },
      careerStatus: {
        type: DataTypes.STRING,
        allowNull: true,
        field: "career_status",
      },
      aiSuspected: { type: DataTypes.BOOLEAN, defaultValue: false },
      aiGradeReason: { type: DataTypes.STRING(400) },
      aiConfidence: { type: DataTypes.ENUM("high", "medium", "low") },
      theoryGradedAt: { type: DataTypes.DATE },
      theoryGradedBy: { type: DataTypes.STRING },
      objectiveRank: { type: DataTypes.INTEGER },
      decisionNote: { type: DataTypes.TEXT },
      decidedAt: { type: DataTypes.DATE },
      decidedBy: { type: DataTypes.STRING },
      tabSwitches: { type: DataTypes.INTEGER, defaultValue: 0 },
      createdAt: { type: DataTypes.DATE },
      updatedAt: { type: DataTypes.DATE },
    },
    {
      sequelize,
      modelName: "Registrant",
      tableName: "registrants",
      underscored: true, // IMPORTANT: Matches your barcode_id, checked_in, etc.
      timestamps: true,
    },
  );
}

export default Registrant;
