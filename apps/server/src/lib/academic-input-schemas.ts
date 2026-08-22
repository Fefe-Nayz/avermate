import { z } from "zod";

export const gradeComponentInputSchema = z.object({
  name: z.string().trim().min(1).max(64),
  value: z.number().min(0).max(100_000),
  outOf: z.number().positive().max(100_000),
  coefficient: z.number().min(0).max(1000).default(1),
});

const gradePatchShape = {
  name: z.string().trim().min(1).max(96),
  value: z.number().min(0).max(100_000),
  outOf: z.number().positive().max(100_000),
  coefficient: z.number().min(0).max(1000),
  excludedFromAverage: z.boolean(),
  /**
   * Extra points on this result's own scale.
   *
   * Signed, because the same mechanism is a malus where a school deducts, and refusing
   * the sign would only push people to write it into the mark itself — where it stops
   * being visible as an adjustment at all.
   */
  bonus: z.number().min(-100_000).max(100_000),
  note: z.string().trim().max(500).nullable(),
  passedAt: z.coerce.date(),
  subjectId: z.string(),
  periodId: z.string().nullable(),
  typeId: z.string().nullable(),
  components: z.array(gradeComponentInputSchema).max(20),
};

/** Creation applies ergonomic defaults; patches never manufacture omitted fields. */
export const gradeCreateInputSchema = z.object({
  ...gradePatchShape,
  coefficient: gradePatchShape.coefficient.default(1),
  excludedFromAverage: gradePatchShape.excludedFromAverage.default(false),
  bonus: gradePatchShape.bonus.default(0),
  note: gradePatchShape.note.default(null),
  periodId: gradePatchShape.periodId.default(null),
  typeId: gradePatchShape.typeId.default(null),
  components: gradePatchShape.components.default([]),
});

export const gradePatchInputSchema = z.object(gradePatchShape).partial();

const gradeTypePatchShape = {
  name: z.string().trim().min(1).max(48),
  /** Kept untrimmed because a trailing separator is meaningful in a title prefix. */
  titlePrefix: z.string().max(48),
  coefficient: z.number().min(0).max(1000),
  outOf: z.number().positive().max(100_000),
  accent: z.string().trim().max(32).nullable(),
};

export const gradeTypeCreateInputSchema = z.object({
  ...gradeTypePatchShape,
  titlePrefix: gradeTypePatchShape.titlePrefix.default(""),
  coefficient: gradeTypePatchShape.coefficient.default(1),
  outOf: gradeTypePatchShape.outOf.default(20),
  accent: gradeTypePatchShape.accent.default(null),
});

export const gradeTypePatchInputSchema = z
  .object(gradeTypePatchShape)
  .partial();
