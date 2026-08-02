import { and, asc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { customAverageEntries, customAverages } from "../db/schema";
import { badRequest, protectedProcedure } from "../lib/orpc";
import { requireCustomAverage, requireYear } from "../lib/ownership";

const entryInput = z.object({
  subjectId: z.string(),
  coefficient: z.number().min(0).max(1000).nullable().default(null),
  includeChildren: z.boolean().default(false),
});

const averageInput = z.object({
  name: z.string().trim().min(1).max(64),
  isMain: z.boolean().default(false),
  entries: z.array(entryInput).min(1).max(200),
});

async function withEntries(averageId: string) {
  const [average] = await db
    .select()
    .from(customAverages)
    .where(eq(customAverages.id, averageId))
    .limit(1);
  const entries = await db
    .select()
    .from(customAverageEntries)
    .where(eq(customAverageEntries.averageId, averageId));
  return average ? { ...average, entries } : null;
}

/** Only one average can stand in for the general one on the dashboard. */
async function demoteOthers(yearId: string, keepId: string) {
  await db
    .update(customAverages)
    .set({ isMain: false, updatedAt: new Date() })
    .where(
      and(eq(customAverages.yearId, yearId), ne(customAverages.id, keepId)),
    );
}

export const averagesRouter = {
  list: protectedProcedure
    .input(z.object({ yearId: z.string() }))
    .handler(async ({ context, input }) => {
      await requireYear(context.session.user.id, input.yearId);
      const averages = await db
        .select()
        .from(customAverages)
        .where(eq(customAverages.yearId, input.yearId))
        .orderBy(asc(customAverages.sortOrder));

      const entries = await db
        .select()
        .from(customAverageEntries)
        .innerJoin(
          customAverages,
          eq(customAverageEntries.averageId, customAverages.id),
        )
        .where(eq(customAverages.yearId, input.yearId));

      return averages.map((average) => ({
        ...average,
        entries: entries
          .filter((row) => row.custom_average_entries.averageId === average.id)
          .map((row) => row.custom_average_entries),
      }));
    }),

  get: protectedProcedure
    .input(z.object({ averageId: z.string() }))
    .handler(async ({ context, input }) => {
      await requireCustomAverage(context.session.user.id, input.averageId);
      return withEntries(input.averageId);
    }),

  create: protectedProcedure
    .input(averageInput.extend({ yearId: z.string() }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await requireYear(userId, input.yearId);

      const existing = await db
        .select({ sortOrder: customAverages.sortOrder })
        .from(customAverages)
        .where(eq(customAverages.yearId, input.yearId));

      const [created] = await db
        .insert(customAverages)
        .values({
          name: input.name,
          isMain: input.isMain,
          sortOrder: existing.reduce(
            (max, row) => Math.max(max, row.sortOrder + 1),
            0,
          ),
          yearId: input.yearId,
          userId,
        })
        .returning();
      if (!created) badRequest("The average could not be created");

      await db.insert(customAverageEntries).values(
        input.entries.map((entry) => ({ ...entry, averageId: created.id })),
      );
      if (input.isMain) await demoteOthers(input.yearId, created.id);

      return withEntries(created.id);
    }),

  update: protectedProcedure
    .input(averageInput.partial().extend({ averageId: z.string() }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const { averageId, entries, ...patch } = input;
      const existing = await requireCustomAverage(userId, averageId);

      await db
        .update(customAverages)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(customAverages.id, averageId));

      if (entries) {
        await db
          .delete(customAverageEntries)
          .where(eq(customAverageEntries.averageId, averageId));
        if (entries.length > 0) {
          await db
            .insert(customAverageEntries)
            .values(entries.map((entry) => ({ ...entry, averageId })));
        }
      }

      if (patch.isMain) await demoteOthers(existing.yearId, averageId);
      return withEntries(averageId);
    }),

  reorder: protectedProcedure
    .input(z.object({ averageIds: z.array(z.string()).min(1) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await Promise.all(
        input.averageIds.map((id, index) =>
          db
            .update(customAverages)
            .set({ sortOrder: index, updatedAt: new Date() })
            .where(
              and(eq(customAverages.id, id), eq(customAverages.userId, userId)),
            ),
        ),
      );
      return { ok: true };
    }),

  delete: protectedProcedure
    .input(z.object({ averageId: z.string() }))
    .handler(async ({ context, input }) => {
      await requireCustomAverage(context.session.user.id, input.averageId);
      await db
        .delete(customAverages)
        .where(eq(customAverages.id, input.averageId));
      return { ok: true };
    }),
};
