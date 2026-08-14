import {
  and,
  asc,
  desc,
  eq,
  exists,
  isNull,
  inArray,
  ne,
  notExists,
  or,
} from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  customAverages,
  dashboardCards,
  grades,
  goals,
  periods,
  subjects,
  yearReviewViews,
  years,
} from "../db/schema";
import { badRequest, protectedProcedure } from "../lib/orpc";
import { requireYear } from "../lib/ownership";
import { newId } from "../lib/id";
import { assertPeriodRangesWithinYear } from "../lib/academic-periods";
import { academicCardRows } from "../lib/academic-setup";
import { getYearPresetStatus } from "../lib/preset-membership";

const yearInput = z.object({
  name: z.string().trim().min(1).max(64),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  scale: z.number().positive().max(1000).default(20),
  defaultOutOf: z.number().positive().max(1000).default(20),
  passingRatio: z.number().min(0).max(1).default(0.5),
  decimals: z.number().int().min(0).max(4).default(2),
});

function assertRange(startsAt: Date, endsAt: Date) {
  if (endsAt.getTime() <= startsAt.getTime()) {
    badRequest("The year must end after it starts");
  }
}

/** Every year seeds the dashboard it starts with — an empty grid reads as broken. */
export const yearsRouter = {
  list: protectedProcedure.handler(async ({ context }) =>
    db
      .select()
      .from(years)
      .where(eq(years.userId, context.session.user.id))
      .orderBy(asc(years.sortOrder), desc(years.startsAt)),
  ),

  get: protectedProcedure
    .input(z.object({ yearId: z.string() }))
    .handler(({ context, input }) =>
      requireYear(context.session.user.id, input.yearId),
    ),

  /**
   * Small, ownership-scoped resume payload for the year configuration flow.
   * Counts are intentionally computed on the server so clients do not need to
   * download a full snapshot merely to choose the next onboarding step.
   */
  configurationStatus: protectedProcedure
    .input(z.object({ yearId: z.string() }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const year = await requireYear(userId, input.yearId);
      const [
        subjectRows,
        periodRows,
        averageRows,
        gradeRows,
        goalRows,
        preset,
      ] = await Promise.all([
        db
          .select({ id: subjects.id })
          .from(subjects)
          .where(eq(subjects.yearId, year.id)),
        db
          .select({ id: periods.id })
          .from(periods)
          .where(eq(periods.yearId, year.id)),
        db
          .select({ id: customAverages.id })
          .from(customAverages)
          .where(eq(customAverages.yearId, year.id)),
        db
          .select({ id: grades.id })
          .from(grades)
          .where(eq(grades.yearId, year.id)),
        db
          .select({ id: goals.id })
          .from(goals)
          .where(eq(goals.yearId, year.id)),
        getYearPresetStatus(userId, year.id),
      ]);
      const counts = {
        subjects: subjectRows.length,
        periods: periodRows.length,
        customAverages: averageRows.length,
        grades: gradeRows.length,
        goals: goalRows.length,
      };
      const recommendedStep =
        counts.subjects === 0
          ? ("subjects" as const)
          : counts.periods === 0
            ? ("periods" as const)
            : ("complete" as const);

      return {
        year,
        counts,
        preset: {
          state: preset.state,
          presetId:
            preset.membership?.presetId ?? preset.preset?.id ?? year.presetId,
        },
        recommendedStep,
        canReplacePreset: counts.grades === 0,
      };
    }),

  create: protectedProcedure
    .input(yearInput)
    .handler(async ({ context, input }) => {
      assertRange(input.startsAt, input.endsAt);
      const userId = context.session.user.id;
      const yearId = newId("y");
      const insertYear = db
        .insert(years)
        .values({ id: yearId, ...input, userId });
      const insertCards = db
        .insert(dashboardCards)
        .values(academicCardRows(userId, yearId));
      await db.batch([insertYear, insertCards]);

      const [created] = await db
        .select()
        .from(years)
        .where(eq(years.id, yearId))
        .limit(1);
      if (!created) badRequest("The year could not be created");
      return created;
    }),

  update: protectedProcedure
    .input(yearInput.partial().extend({ yearId: z.string() }))
    .handler(async ({ context, input }) => {
      const { yearId, ...patch } = input;
      const existing = await requireYear(context.session.user.id, yearId);

      const startsAt = patch.startsAt ?? existing.startsAt;
      const endsAt = patch.endsAt ?? existing.endsAt;
      assertRange(startsAt, endsAt);
      if (patch.startsAt !== undefined || patch.endsAt !== undefined) {
        const periodRows = await db
          .select({
            name: periods.name,
            startAt: periods.startAt,
            endAt: periods.endAt,
            isCumulative: periods.isCumulative,
          })
          .from(periods)
          .where(eq(periods.yearId, yearId));
        assertPeriodRangesWithinYear({ startsAt, endsAt }, periodRows);
      }

      const [updated] = await db
        .update(years)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(years.id, yearId))
        .returning();
      return updated;
    }),

  reorder: protectedProcedure
    .input(z.object({ yearIds: z.array(z.string()).min(1) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      if (new Set(input.yearIds).size !== input.yearIds.length) {
        badRequest("A year can only appear once in its order");
      }
      const selected = await db
        .select({ id: years.id })
        .from(years)
        .where(and(eq(years.userId, userId), inArray(years.id, input.yearIds)));
      if (selected.length !== input.yearIds.length) {
        badRequest("Every reordered year must belong to this account");
      }
      const current = await db
        .select({ id: years.id })
        .from(years)
        .where(eq(years.userId, userId))
        .orderBy(asc(years.sortOrder), desc(years.startsAt));
      const requested = new Set(input.yearIds);
      const orderedIds = [
        ...input.yearIds,
        ...current.map((year) => year.id).filter((id) => !requested.has(id)),
      ];
      const statements = orderedIds.map((yearId, index) =>
        db
          .update(years)
          .set({ sortOrder: index, updatedAt: new Date() })
          .where(and(eq(years.id, yearId), eq(years.userId, userId))),
      );
      await db.batch(
        statements as [
          (typeof statements)[number],
          ...(typeof statements)[number][],
        ],
      );
      return { ok: true };
    }),

  archive: protectedProcedure
    .input(z.object({ yearId: z.string(), archived: z.boolean() }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const existing = await requireYear(userId, input.yearId);
      if (Boolean(existing.archivedAt) === input.archived) return existing;

      const anotherActiveYear = db
        .select({ id: years.id })
        .from(years)
        .where(
          and(
            eq(years.userId, userId),
            isNull(years.archivedAt),
            ne(years.id, input.yearId),
          ),
        );
      const [updated] = await db
        .update(years)
        .set({
          archivedAt: input.archived ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(years.id, input.yearId),
            eq(years.userId, userId),
            input.archived ? exists(anotherActiveYear) : undefined,
          ),
        )
        .returning();
      if (!updated) {
        badRequest("The last active year cannot be archived");
      }
      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ yearId: z.string() }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const existing = await requireYear(userId, input.yearId);
      const anotherYear = db
        .select({ id: years.id })
        .from(years)
        .where(and(eq(years.userId, userId), ne(years.id, input.yearId)));
      const anotherActiveYear = db
        .select({ id: years.id })
        .from(years)
        .where(
          and(
            eq(years.userId, userId),
            isNull(years.archivedAt),
            ne(years.id, input.yearId),
          ),
        );

      const [deleted] = await db
        .delete(years)
        .where(
          and(
            eq(years.id, input.yearId),
            eq(years.userId, userId),
            existing.archivedAt
              ? undefined
              : or(notExists(anotherYear), exists(anotherActiveYear)),
          ),
        )
        .returning({ id: years.id });
      if (!deleted) {
        badRequest(
          "The last active year cannot be deleted while archived years remain",
        );
      }
      return { ok: true };
    }),

  /** Counts shown before a destructive action, so the warning is concrete. */
  contents: protectedProcedure
    .input(z.object({ yearId: z.string() }))
    .handler(async ({ context, input }) => {
      await requireYear(context.session.user.id, input.yearId);
      const [
        subjectRows,
        gradeRows,
        periodRows,
        averageRows,
        goalRows,
        cardRows,
        reviewRows,
      ] = await Promise.all([
        db
          .select({ id: subjects.id })
          .from(subjects)
          .where(eq(subjects.yearId, input.yearId)),
        db
          .select({ id: grades.id })
          .from(grades)
          .where(eq(grades.yearId, input.yearId)),
        db
          .select({ id: periods.id })
          .from(periods)
          .where(eq(periods.yearId, input.yearId)),
        db
          .select({ id: customAverages.id })
          .from(customAverages)
          .where(eq(customAverages.yearId, input.yearId)),
        db
          .select({ id: goals.id })
          .from(goals)
          .where(eq(goals.yearId, input.yearId)),
        db
          .select({ id: dashboardCards.id })
          .from(dashboardCards)
          .where(eq(dashboardCards.yearId, input.yearId)),
        db
          .select({ id: yearReviewViews.id })
          .from(yearReviewViews)
          .where(eq(yearReviewViews.yearId, input.yearId)),
      ]);
      return {
        subjects: subjectRows.length,
        grades: gradeRows.length,
        periods: periodRows.length,
        averages: averageRows.length,
        goals: goalRows.length,
        cards: cardRows.length,
        recaps: reviewRows.length,
      };
    }),
};
