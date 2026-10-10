// Types imported as types: see the note in lib/models/Registrant.ts. The bundler
// erases them either way, but a runtime import of a type-only name fails in every
// other loader, including the test runner.
import { DataTypes, Model } from "sequelize";
import type {
  CreationOptional,
  InferAttributes,
  InferCreationAttributes,
} from "sequelize";
import sequelize from "../db";

/**
 * Append-only log of every status change a human makes in the admissions portal.
 *
 * This exists because a scholarship is a decision with consequences. When a
 * candidate asks "why did I not get a seat", the honest answer must be
 * reconstructable months later - which of the three criteria were scored, who
 * made the call, when, and what they wrote at the time.
 *
 * Without it, status is a bare enum column: a row can move from "registered" to
 * "awarded" and there is no record of who did it or why. "Probably the importer"
 * is not an audit trail.
 *
 * Nothing in the app updates or deletes these rows. `lib/admissions.ts` only
 * ever creates them.
 */
export class AdmissionDecision extends Model<
  InferAttributes<AdmissionDecision>,
  InferCreationAttributes<AdmissionDecision>
> {
  declare id: CreationOptional<string>;
  declare registrantId: string;
  declare fromStatus: string | null;
  declare toStatus: string;
  /** Which console made the change: "staff" or "admissions". */
  declare actorRole: string;
  /** Human-readable actor label, e.g. "Admissions officer". */
  declare actor: string;
  declare note: string | null;
  /** Snapshot of the scores at decision time, so the log stands alone. */
  declare context: Record<string, unknown> | null;

  declare readonly createdAt: CreationOptional<Date>;
}

if (!sequelize.models.AdmissionDecision) {
  AdmissionDecision.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      registrantId: { type: DataTypes.UUID, allowNull: false },
      fromStatus: { type: DataTypes.STRING },
      toStatus: { type: DataTypes.STRING, allowNull: false },
      actorRole: { type: DataTypes.STRING, allowNull: false },
      actor: { type: DataTypes.STRING, allowNull: false },
      note: { type: DataTypes.TEXT },
      context: { type: DataTypes.JSONB },
      createdAt: { type: DataTypes.DATE },
    },
    {
      sequelize,
      modelName: "AdmissionDecision",
      tableName: "admission_decisions",
      underscored: true,
      timestamps: true,
      // There is no updatedAt on purpose: this table is immutable.
      updatedAt: false,
      indexes: [{ fields: ["registrant_id"] }],
    },
  );
}

export default AdmissionDecision;
