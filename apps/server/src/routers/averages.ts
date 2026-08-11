import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { customAverageEntries, customAverages } from "../db/schema";
import { badRequest, protectedProcedure } from "../lib/orpc";
import { assertSameYear } from "../lib/domain-integrity";
import { newId } from "../lib/id";
import { detachYearPresetStatement } from "../lib/preset-membership";
import {
  requireCustomAverage,
  requireSubject,
  requireYear,
} from "../lib/ownership";

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

async function assertEntriesBelongToYear(
  userId: string,
  yearId: string,
  entries: readonly z.infer<typeof entryInput>[],
): Promise<void> {
  const uniqueIds = new Set(entries.map((entry) => entry.subjectId));
  if (uniqueIds.size !== entries.length) {
    badRequest("A subject can only appear once in a custom average");
  }

  const referencedSubjects = await Promise.all(
    entries.map((entry) => requireSubject(userId, entry.subjectId)),
  );
  for (const subject of referencedSubjects) {
    assertSameYear("Average subject", yearId, subject.yearId);
  }
}

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
function demoteOthers(yearId: string, keepId: string) {
  return db
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
      await assertEntriesBelongToYear(userId, input.yearId, input.entries);

      const existing = await db
        .select({ sortOrder: customAverages.sortOrder })
        .from(customAverages)
        .where(eq(customAverages.yearId, input.yearId));

      const averageId = newId("avg");
      const insertAverage = db.insert(customAverages).values({
          id: averageId,
          name: input.name,
          isMain: input.isMain,
          sortOrder: existing.reduce(
            (max, row) => Math.max(max, row.sortOrder + 1),
            0,
          ),
          yearId: input.yearId,
          userId,
        });
      const insertEntries = db.insert(customAverageEntries).values(
        input.entries.map((entry) => ({ ...entry, averageId })),
      );
      const demote = input.isMain
        ? [demoteOthers(input.yearId, averageId)]
        : [];
      const statements = [
        insertAverage,
        insertEntries,
        ...demote,
        detachYearPresetStatement(userId, input.yearId, "average_created"),
      ];
      await db.batch(
        statements as [
          (typeof statements)[number],
          ...(typeof statements)[number][],
        ],
      );

      const created = await withEntries(averageId);
      if (!created) badRequest("The average could not be created");
      return created;
    }),

  update: protectedProcedure
    .input(averageInput.partial().extend({ averageId: z.string() }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const { averageId, entries, ...patch } = input;
      const existing = await requireCustomAverage(userId, averageId);

      if (entries) {
        await assertEntriesBelongToYear(userId, existing.yearId, entries);
      }

      const updateAverage = db
        .update(customAverages)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(customAverages.id, averageId));

      const replaceEntries = entries
        ? [
            db
              .delete(customAverageEntries)
              .where(eq(customAverageEntries.averageId, averageId)),
            db
              .insert(customAverageEntries)
              .values(entries.map((entry) => ({ ...entry, averageId }))),
          ]
        : [];
      const demote = patch.isMain
        ? [demoteOthers(existing.yearId, averageId)]
        : [];
      const statements = [
        updateAverage,
        ...replaceEntries,
        ...demote,
        detachYearPresetStatement(userId, existing.yearId, "average_updated"),
      ];
      await db.batch(
        statements as [
          (typeof statements)[number],
          ...(typeof statements)[number][],
        ],
      );

      return withEntries(averageId);
    }),

  reorder: protectedProcedure
    .input(z.object({ averageIds: z.array(z.string()).min(1) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      if (new Set(input.averageIds).size !== input.averageIds.length) {
        badRequest("An average can only appear once in its order");
      }
      const owned = await db
        .select({ id: customAverages.id, yearId: customAverages.yearId })
        .from(customAverages)
        .where(and(eq(customAverages.userId, userId), inArray(customAverages.id, input.averageIds)));
      if (owned.length !== input.averageIds.length) {
        badRequest("Every reordered average must belong to this account");
      }
      const yearId = owned[0]?.yearId;
      if (!yearId || owned.some((average) => average.yearId !== yearId)) {
        badRequest("Every reordered average must belong to the same year");
      }
      const statements = [
        ...input.averageIds.map((id, index) =>
          db
            .update(customAverages)
            .set({ sortOrder: index, updatedAt: new Date() })
            .where(
              and(eq(customAverages.id, id), eq(customAverages.userId, userId)),
            ),
        ),
        detachYearPresetStatement(userId, yearId, "average_reordered"),
      ];
      await db.batch(
        statements as [
          (typeof statements)[number],
          ...(typeof statements)[number][],
        ],
      );
      return { ok: true };
    }),

  delete: protectedProcedure
    .input(z.object({ averageId: z.string() }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const existing = await requireCustomAverage(userId, input.averageId);
      await db.batch([
        db.delete(customAverages).where(eq(customAverages.id, input.averageId)),
        detachYearPresetStatement(userId, existing.yearId, "average_deleted"),
      ]);
      return { ok: true };
    }),
};
