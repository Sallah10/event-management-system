import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
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
  declare checkedIn: boolean; // Maps to checked_in
  declare status:
    | "registered"
    | "attended"
    | "qualified"
    | "completed"
    | "shortlisted"
    | "awarded";
  declare objectiveScore: number; // Maps to objective_score
  declare objectiveFinishedAt: Date | null; // Maps to objective_finished_at
  declare theoryAnswer: string | null; // Maps to theory_answer'
  declare theoryAnswer1: string | null; // NEW
  declare theoryAnswer2: string | null; // NEW
  declare theoryAnswer3: string | null; // NEW
  declare theoryScore: number;
  declare selectedCourseSlug: string | null; // Maps to selected_course_slug
  declare cohortYear: number; // Maps to cohort_year
  declare isFlagged: boolean; // Maps to is_flagged
  declare deviceId: string | null; // Maps to device_id
  declare careerStatus: string | null;

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
          "completed",
          "shortlisted",
          "awarded",
        ),
        defaultValue: "registered",
      },
      objectiveScore: { type: DataTypes.INTEGER, defaultValue: 0 },
      objectiveFinishedAt: { type: DataTypes.DATE },
      theoryAnswer: { type: DataTypes.TEXT },
      theoryAnswer1: { type: DataTypes.TEXT },
      theoryAnswer2: { type: DataTypes.TEXT },
      theoryAnswer3: { type: DataTypes.TEXT },
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
