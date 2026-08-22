import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { gradeTypes, grades } from "../db/schema";
import { badRequest, protectedProcedure } from "../lib/orpc";
import { newId } from "../lib/id";
import { requireYear } from "../lib/ownership";
import {
  gradeTypeCreateInputSchema,
  gradeTypePatchInputSchema,
} from "../lib/academic-input-schemas";

/**
 * The kinds of assessment a year holds.
 *
 * A template rather than a taxonomy: "DS", "Colle", "TP noté" are what a particular year
 * is made of, and no fixed list of written/oral/practical survives two school systems.
 * What a type carries is the tedious part of writing a result down — the start of the
 * name, the coefficient, the denominator — and every one of those stays editable on the
 * result itself.
 *
 * Per year, like subjects and custom averages, and for the same reason: a year is a
 * contract. Last year's kinds are not automatically this year's, and a preset or a class
 * can propose a set the way it proposes subjects.
 */

export const gradeTypesRouter = {
  list: protectedProcedure
    .input(z.object({ yearId: z.string() }))
    .handler(async ({ context, input }) => {
      const year = await requireYear(context.session.user.id, input.yearId);
      const rows = await db
        .select({
          id: gradeTypes.id,
          name: gradeTypes.name,
          titlePrefix: gradeTypes.titlePrefix,
          coefficient: gradeTypes.coefficient,
          outOf: gradeTypes.outOf,
          accent: gradeTypes.accent,
          sortOrder: gradeTypes.sortOrder,
          presetNodeKey: gradeTypes.presetNodeKey,
        })
        .from(gradeTypes)
        .where(eq(gradeTypes.yearId, year.id))
        .orderBy(asc(gradeTypes.sortOrder), asc(gradeTypes.name));

      // How many results each one has, because that is the number that matters when
      // deleting: "used by 14 results" is the question, not "are you sure".
      const counts = await db
        .select({
          typeId: grades.typeId,
          count: sql<number>`count(*)`.mapWith(Number),
        })
        .from(grades)
        .where(eq(grades.yearId, year.id))
        .groupBy(grades.typeId);
      const used = new Map(counts.map((row) => [row.typeId, row.count]));

      return rows.map((row) => ({ ...row, gradeCount: used.get(row.id) ?? 0 }));
    }),

  create: protectedProcedure
    .input(gradeTypeCreateInputSchema.extend({ yearId: z.string() }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const year = await requireYear(userId, input.yearId);
      const [{ count } = { count: 0 }] = await db
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(gradeTypes)
        .where(eq(gradeTypes.yearId, year.id));
      // A bound rather than a policy: a year with fifty kinds of assessment has no kinds
      // of assessment, and every picker that offers them becomes unusable.
      if (count >= 24) badRequest("This year already has enough grade types");

      const id = newId("gtype");
      await db.insert(gradeTypes).values({
        id,
        name: input.name,
        titlePrefix: input.titlePrefix,
        coefficient: input.coefficient,
        outOf: input.outOf,
        accent: input.accent,
        sortOrder: count,
        yearId: year.id,
        userId,
      });
      return { id };
    }),

  update: protectedProcedure
    .input(gradeTypePatchInputSchema.extend({ typeId: z.string() }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const { typeId, ...patch } = input;
      const [updated] = await db
        .update(gradeTypes)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(gradeTypes.id, typeId), eq(gradeTypes.userId, userId)))
        .returning({ id: gradeTypes.id });
      if (!updated) badRequest("This grade type no longer exists");
      /**
       * Results already written are left exactly as they are.
       *
       * Changing a template must not rewrite history: somebody who fixes a typo in "DS"
       * is naming future results, not restating past ones, and a coefficient that
       * propagated backwards would silently move an average.
       */
      return updated;
    }),

  reorder: protectedProcedure
    .input(
      z.object({
        yearId: z.string(),
        // Distinct, like the grades table's own multi-select asks: the length check
        // below counts, so ["a","a"] against a two-type year passed both tests and then
        // wrote one of them twice, leaving the other at its old position.
        typeIds: z
          .array(z.string())
          .refine((ids) => new Set(ids).size === ids.length, {
            message: "Each type may only appear once",
          }),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const year = await requireYear(userId, input.yearId);
      const owned = await db
        .select({ id: gradeTypes.id })
        .from(gradeTypes)
        .where(eq(gradeTypes.yearId, year.id));
      const known = new Set(owned.map((row) => row.id));
      // The exact set, as the card grid's own reorder demands: a partial order is an
      // order about a list that is no longer on screen.
      if (
        input.typeIds.length !== known.size ||
        input.typeIds.some((id) => !known.has(id))
      ) {
        badRequest("That order is out of date");
      }
      const statements = input.typeIds.map((id, index) =>
        db
          .update(gradeTypes)
          .set({ sortOrder: index, updatedAt: new Date() })
          .where(and(eq(gradeTypes.id, id), eq(gradeTypes.userId, userId))),
      );
      if (statements.length > 0) {
        await db.batch(
          statements as [(typeof statements)[number], ...typeof statements],
        );
      }
      return { ordered: input.typeIds.length };
    }),

  delete: protectedProcedure
    .input(z.object({ typeId: z.string() }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      // The results keep their marks and lose their label — `set null` on the column, so
      // nothing here has to remember to spare them.
      const [deleted] = await db
        .delete(gradeTypes)
        .where(
          and(eq(gradeTypes.id, input.typeId), eq(gradeTypes.userId, userId)),
        )
        .returning({ id: gradeTypes.id });
      if (!deleted) badRequest("This grade type no longer exists");
      return { deleted: true };
    }),
};
