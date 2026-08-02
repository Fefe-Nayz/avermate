import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { periods } from "../db/schema";
import { badRequest, protectedProcedure } from "../lib/orpc";
import { requirePeriod, requireYear } from "../lib/ownership";

const periodInput = z.object({
  name: z.string().trim().min(1).max(64),
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  isCumulative: z.boolean().default(false),
});

export const periodsRouter = {
  list: protectedProcedure
    .input(z.object({ yearId: z.string() }))
    .handler(async ({ context, input }) => {
      await requireYear(context.session.user.id, input.yearId);
      return db
        .select()
        .from(periods)
        .where(eq(periods.yearId, input.yearId))
        .orderBy(asc(periods.sortOrder), asc(periods.startAt));
    }),

  create: protectedProcedure
    .input(periodInput.extend({ yearId: z.string() }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await requireYear(userId, input.yearId);
      if (input.endAt.getTime() <= input.startAt.getTime()) {
        badRequest("A period must end after it starts");
      }

      const existing = await db
        .select({ sortOrder: periods.sortOrder })
        .from(periods)
        .where(eq(periods.yearId, input.yearId));

      const [created] = await db
        .insert(periods)
        .values({
          ...input,
          sortOrder: existing.reduce(
            (max, row) => Math.max(max, row.sortOrder + 1),
            0,
          ),
          userId,
        })
        .returning();
      return created;
    }),

  update: protectedProcedure
    .input(periodInput.partial().extend({ periodId: z.string() }))
    .handler(async ({ context, input }) => {
      const { periodId, ...patch } = input;
      const existing = await requirePeriod(context.session.user.id, periodId);

      const startAt = patch.startAt ?? existing.startAt;
      const endAt = patch.endAt ?? existing.endAt;
      if (endAt.getTime() <= startAt.getTime()) {
        badRequest("A period must end after it starts");
      }

      const [updated] = await db
        .update(periods)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(periods.id, periodId))
        .returning();
      return updated;
    }),

  reorder: protectedProcedure
    .input(z.object({ periodIds: z.array(z.string()).min(1) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await Promise.all(
        input.periodIds.map((id, index) =>
          db
            .update(periods)
            .set({ sortOrder: index, updatedAt: new Date() })
            .where(and(eq(periods.id, id), eq(periods.userId, userId))),
        ),
      );
      return { ok: true };
    }),

  delete: protectedProcedure
    .input(z.object({ periodId: z.string() }))
    .handler(async ({ context, input }) => {
      await requirePeriod(context.session.user.id, input.periodId);
      // Grades keep their `periodId` set to null and fall back to date
      // matching, so deleting a period never deletes results.
      await db.delete(periods).where(eq(periods.id, input.periodId));
      return { ok: true };
    }),

  /**
   * Replace a year's periods in one go. The settings screen edits them as a
   * set — three trimesters, two semesters — so saving them one by one would
   * leave the year in half-migrated states the averages would pick up.
   */
  replaceAll: protectedProcedure
    .input(
      z.object({
        yearId: z.string(),
        periods: z.array(periodInput).max(12),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await requireYear(userId, input.yearId);

      for (const period of input.periods) {
        if (period.endAt.getTime() <= period.startAt.getTime()) {
          badRequest(`"${period.name}" must end after it starts`);
        }
      }

      await db.delete(periods).where(eq(periods.yearId, input.yearId));
      if (input.periods.length === 0) return [];

      return db
        .insert(periods)
        .values(
          input.periods.map((period, index) => ({
            ...period,
            sortOrder: index,
            yearId: input.yearId,
            userId,
          })),
        )
        .returning();
    }),
};
