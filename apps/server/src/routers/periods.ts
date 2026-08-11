import { and, asc, eq, inArray, notInArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { periods } from "../db/schema";
import { newId } from "../lib/id";
import { badRequest, protectedProcedure } from "../lib/orpc";
import { requirePeriod, requireYear } from "../lib/ownership";
import { detachYearPresetStatement } from "../lib/preset-membership";

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

      const periodId = newId("per");
      await db.batch([
        db.insert(periods).values({
          id: periodId,
          ...input,
          sortOrder: existing.reduce(
            (max, row) => Math.max(max, row.sortOrder + 1),
            0,
          ),
          userId,
        }),
        detachYearPresetStatement(userId, input.yearId, "period_created"),
      ]);
      const [created] = await db
        .select()
        .from(periods)
        .where(eq(periods.id, periodId))
        .limit(1);
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

      await db.batch([
        db
          .update(periods)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(periods.id, periodId)),
        detachYearPresetStatement(
          context.session.user.id,
          existing.yearId,
          "period_updated",
        ),
      ]);
      const [updated] = await db
        .select()
        .from(periods)
        .where(eq(periods.id, periodId))
        .limit(1);
      return updated;
    }),

  reorder: protectedProcedure
    .input(z.object({ periodIds: z.array(z.string()).min(1) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      if (new Set(input.periodIds).size !== input.periodIds.length) {
        badRequest("A period can only appear once in its order");
      }
      const selected = await db
        .select()
        .from(periods)
        .where(
          and(eq(periods.userId, userId), inArray(periods.id, input.periodIds)),
        );
      if (selected.length !== input.periodIds.length) {
        badRequest("Every reordered period must belong to this account");
      }
      const first = selected[0];
      if (!first) badRequest("At least one period is required");
      if (selected.some((period) => period.yearId !== first.yearId)) {
        badRequest("Every reordered period must belong to the same year");
      }
      const current = await db
        .select({ id: periods.id })
        .from(periods)
        .where(
          and(eq(periods.userId, userId), eq(periods.yearId, first.yearId)),
        )
        .orderBy(asc(periods.sortOrder), asc(periods.startAt));
      const requested = new Set(input.periodIds);
      const orderedIds = [
        ...input.periodIds,
        ...current
          .map((period) => period.id)
          .filter((id) => !requested.has(id)),
      ];
      const statements = [
        ...orderedIds.map((id, index) =>
          db
            .update(periods)
            .set({ sortOrder: index, updatedAt: new Date() })
            .where(and(eq(periods.id, id), eq(periods.userId, userId))),
        ),
        detachYearPresetStatement(userId, first.yearId, "period_reordered"),
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
    .input(z.object({ periodId: z.string() }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const existing = await requirePeriod(userId, input.periodId);
      // Grades keep their `periodId` set to null and fall back to date
      // matching, so deleting a period never deletes results.
      await db.batch([
        db.delete(periods).where(eq(periods.id, input.periodId)),
        detachYearPresetStatement(userId, existing.yearId, "period_deleted"),
      ]);
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
        periods: z
          .array(periodInput.extend({ periodId: z.string().optional() }))
          .max(12),
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

      const requestedIds = input.periods.flatMap((period) =>
        period.periodId ? [period.periodId] : [],
      );
      if (new Set(requestedIds).size !== requestedIds.length) {
        badRequest("A period cannot appear more than once");
      }

      if (requestedIds.length > 0) {
        const owned = await db
          .select({ id: periods.id })
          .from(periods)
          .where(
            and(
              eq(periods.userId, userId),
              eq(periods.yearId, input.yearId),
              inArray(periods.id, requestedIds),
            ),
          );
        if (owned.length !== requestedIds.length) {
          badRequest("Every retained period must belong to this year");
        }
      }

      const deleteRemoved = db
        .delete(periods)
        .where(
          requestedIds.length === 0
            ? eq(periods.yearId, input.yearId)
            : and(
                eq(periods.yearId, input.yearId),
                notInArray(periods.id, requestedIds),
              ),
        );
      const updates = input.periods.flatMap(({ periodId, ...period }, index) =>
        periodId
          ? [
              db
                .update(periods)
                .set({ ...period, sortOrder: index, updatedAt: new Date() })
                .where(
                  and(
                    eq(periods.id, periodId),
                    eq(periods.userId, userId),
                    eq(periods.yearId, input.yearId),
                  ),
                ),
            ]
          : [],
      );
      const additions = input.periods.flatMap(
        ({ periodId, ...period }, index) =>
          periodId
            ? []
            : [
                {
                  ...period,
                  sortOrder: index,
                  yearId: input.yearId,
                  userId,
                },
              ],
      );
      const insertAdditions =
        additions.length > 0 ? [db.insert(periods).values(additions)] : [];
      const statements = [
        deleteRemoved,
        ...updates,
        ...insertAdditions,
        detachYearPresetStatement(userId, input.yearId, "periods_replaced"),
      ];

      // libSQL batches are atomic and, unlike opening a transaction on a
      // `file::memory:` test database, stay on the client's existing
      // connection. That makes the production and integration-test behavior
      // identical while preserving grade foreign keys for retained rows.
      await db.batch(
        statements as [
          (typeof statements)[number],
          ...(typeof statements)[number][],
        ],
      );

      return db
        .select()
        .from(periods)
        .where(eq(periods.yearId, input.yearId))
        .orderBy(asc(periods.sortOrder), asc(periods.startAt));
    }),
};
