import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { gradeComponents, grades, periods, subjects } from "../db/schema";
import { badRequest, protectedProcedure } from "../lib/orpc";
import {
  requireGrade,
  requirePeriod,
  requireSubject,
  requireYear,
} from "../lib/ownership";

const componentInput = z.object({
  name: z.string().trim().min(1).max(64),
  value: z.number().min(0).max(100_000),
  outOf: z.number().positive().max(100_000),
  coefficient: z.number().min(0).max(1000).default(1),
});

const gradeInput = z.object({
  name: z.string().trim().min(1).max(96),
  value: z.number().min(0).max(100_000),
  outOf: z.number().positive().max(100_000),
  coefficient: z.number().min(0).max(1000).default(1),
  note: z.string().trim().max(500).nullable().default(null),
  passedAt: z.coerce.date(),
  subjectId: z.string(),
  periodId: z.string().nullable().default(null),
  /**
   * When present, the headline value is derived from the parts rather than
   * typed. Keeping the derived value on the row means every reader — chart,
   * table, export — sees the same number without recomputing.
   */
  components: z.array(componentInput).max(20).default([]),
});

/** Weighted roll-up of a composite grade, expressed on `outOf` points. */
function rollUp(
  components: Array<z.infer<typeof componentInput>>,
  outOf: number,
): number {
  let weighted = 0;
  let total = 0;
  for (const component of components) {
    if (component.outOf <= 0) continue;
    const coefficient = component.coefficient > 0 ? component.coefficient : 0;
    if (coefficient === 0) continue;
    weighted += (component.value / component.outOf) * coefficient;
    total += coefficient;
  }
  if (total === 0) return 0;
  return (weighted / total) * outOf;
}

/** The period a date belongs to, when the user did not pick one. */
async function inferPeriod(
  yearId: string,
  passedAt: Date,
): Promise<string | null> {
  const rows = await db
    .select()
    .from(periods)
    .where(eq(periods.yearId, yearId));

  const time = passedAt.getTime();
  const matches = rows.filter(
    (period) =>
      time >= period.startAt.getTime() && time <= period.endAt.getTime(),
  );
  if (matches.length === 0) return null;
  const specific = matches.filter((period) => !period.isCumulative);
  return (specific[0] ?? matches[0])?.id ?? null;
}

export const gradesRouter = {
  get: protectedProcedure
    .input(z.object({ gradeId: z.string() }))
    .handler(async ({ context, input }) => {
      const grade = await requireGrade(context.session.user.id, input.gradeId);
      const components = await db
        .select()
        .from(gradeComponents)
        .where(eq(gradeComponents.gradeId, grade.id))
        .orderBy(gradeComponents.sortOrder);
      return { ...grade, components };
    }),

  recent: protectedProcedure
    .input(z.object({ yearId: z.string(), limit: z.number().int().min(1).max(50).default(5) }))
    .handler(async ({ context, input }) => {
      await requireYear(context.session.user.id, input.yearId);
      return db
        .select({
          id: grades.id,
          name: grades.name,
          value: grades.value,
          outOf: grades.outOf,
          coefficient: grades.coefficient,
          passedAt: grades.passedAt,
          subjectId: grades.subjectId,
          subjectName: subjects.name,
        })
        .from(grades)
        .innerJoin(subjects, eq(grades.subjectId, subjects.id))
        .where(eq(grades.yearId, input.yearId))
        .orderBy(desc(grades.passedAt), desc(grades.createdAt))
        .limit(input.limit);
    }),

  create: protectedProcedure
    .input(gradeInput)
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const subject = await requireSubject(userId, input.subjectId);
      if (input.periodId) await requirePeriod(userId, input.periodId);

      const isComposite = input.components.length > 0;
      const value = isComposite
        ? rollUp(input.components, input.outOf)
        : input.value;
      if (value > input.outOf) {
        badRequest("A grade cannot be worth more than its maximum");
      }

      const periodId =
        input.periodId ?? (await inferPeriod(subject.yearId, input.passedAt));

      const [created] = await db
        .insert(grades)
        .values({
          name: input.name,
          value,
          outOf: input.outOf,
          coefficient: input.coefficient,
          note: input.note,
          isComposite,
          passedAt: input.passedAt,
          subjectId: subject.id,
          periodId,
          yearId: subject.yearId,
          userId,
        })
        .returning();
      if (!created) badRequest("The grade could not be saved");

      if (isComposite) {
        await db.insert(gradeComponents).values(
          input.components.map((component, index) => ({
            gradeId: created.id,
            name: component.name,
            value: component.value,
            outOf: component.outOf,
            coefficient: component.coefficient,
            sortOrder: index,
            userId,
          })),
        );
      }

      return created;
    }),

  update: protectedProcedure
    .input(gradeInput.partial().extend({ gradeId: z.string() }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const { gradeId, components, ...patch } = input;
      const existing = await requireGrade(userId, gradeId);

      let yearId = existing.yearId;
      if (patch.subjectId) {
        const subject = await requireSubject(userId, patch.subjectId);
        yearId = subject.yearId;
      }
      if (patch.periodId) await requirePeriod(userId, patch.periodId);

      const outOf = patch.outOf ?? existing.outOf;
      let value = patch.value ?? existing.value;
      let isComposite = existing.isComposite;

      if (components !== undefined) {
        isComposite = components.length > 0;
        await db
          .delete(gradeComponents)
          .where(eq(gradeComponents.gradeId, gradeId));
        if (isComposite) {
          value = rollUp(components, outOf);
          await db.insert(gradeComponents).values(
            components.map((component, index) => ({
              gradeId,
              name: component.name,
              value: component.value,
              outOf: component.outOf,
              coefficient: component.coefficient,
              sortOrder: index,
              userId,
            })),
          );
        }
      }

      if (value > outOf) {
        badRequest("A grade cannot be worth more than its maximum");
      }

      const [updated] = await db
        .update(grades)
        .set({
          ...patch,
          value,
          outOf,
          isComposite,
          yearId,
          updatedAt: new Date(),
        })
        .where(eq(grades.id, gradeId))
        .returning();
      return updated;
    }),

  /** Bulk reassignment used by the grades table's multi-select. */
  reassign: protectedProcedure
    .input(
      z.object({
        gradeIds: z.array(z.string()).min(1).max(200),
        subjectId: z.string().optional(),
        periodId: z.string().nullable().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const target = input.subjectId
        ? await requireSubject(userId, input.subjectId)
        : null;
      if (input.periodId) await requirePeriod(userId, input.periodId);

      await Promise.all(
        input.gradeIds.map(async (gradeId) => {
          await requireGrade(userId, gradeId);
          await db
            .update(grades)
            .set({
              ...(target
                ? { subjectId: target.id, yearId: target.yearId }
                : {}),
              ...(input.periodId !== undefined
                ? { periodId: input.periodId }
                : {}),
              updatedAt: new Date(),
            })
            .where(and(eq(grades.id, gradeId), eq(grades.userId, userId)));
        }),
      );

      return { ok: true, count: input.gradeIds.length };
    }),

  delete: protectedProcedure
    .input(z.object({ gradeId: z.string() }))
    .handler(async ({ context, input }) => {
      await requireGrade(context.session.user.id, input.gradeId);
      await db.delete(grades).where(eq(grades.id, input.gradeId));
      return { ok: true };
    }),
};
