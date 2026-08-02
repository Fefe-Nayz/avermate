import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  dashboardCards,
  grades,
  periods,
  subjects,
  years,
} from "../db/schema";
import { badRequest, protectedProcedure } from "../lib/orpc";
import { requireYear } from "../lib/ownership";
import { defaultCards } from "@avermate/core";

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
async function seedCards(userId: string, yearId: string) {
  const cards = defaultCards();
  await db.insert(dashboardCards).values(
    cards.map((card) => ({
      surface: "overview",
      metric: card.metric,
      targetKind: card.target.kind,
      targetId: card.target.referenceId,
      goalId: null,
      display: card.display,
      span: card.span,
      title: card.title,
      accent: card.accent,
      sortOrder: card.sortOrder,
      hidden: card.hidden,
      yearId,
      userId,
    })),
  );
}

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

  create: protectedProcedure
    .input(yearInput)
    .handler(async ({ context, input }) => {
      assertRange(input.startsAt, input.endsAt);
      const userId = context.session.user.id;

      const [created] = await db
        .insert(years)
        .values({ ...input, userId })
        .returning();
      if (!created) badRequest("The year could not be created");

      await seedCards(userId, created.id);
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
      await Promise.all(
        input.yearIds.map((yearId, index) =>
          db
            .update(years)
            .set({ sortOrder: index, updatedAt: new Date() })
            .where(and(eq(years.id, yearId), eq(years.userId, userId))),
        ),
      );
      return { ok: true };
    }),

  archive: protectedProcedure
    .input(z.object({ yearId: z.string(), archived: z.boolean() }))
    .handler(async ({ context, input }) => {
      await requireYear(context.session.user.id, input.yearId);
      const [updated] = await db
        .update(years)
        .set({
          archivedAt: input.archived ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(years.id, input.yearId))
        .returning();
      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ yearId: z.string() }))
    .handler(async ({ context, input }) => {
      await requireYear(context.session.user.id, input.yearId);
      await db.delete(years).where(eq(years.id, input.yearId));
      return { ok: true };
    }),

  /** Counts shown before a destructive action, so the warning is concrete. */
  contents: protectedProcedure
    .input(z.object({ yearId: z.string() }))
    .handler(async ({ context, input }) => {
      await requireYear(context.session.user.id, input.yearId);
      const [subjectRows, gradeRows, periodRows] = await Promise.all([
        db.select({ id: subjects.id }).from(subjects).where(eq(subjects.yearId, input.yearId)),
        db.select({ id: grades.id }).from(grades).where(eq(grades.yearId, input.yearId)),
        db.select({ id: periods.id }).from(periods).where(eq(periods.yearId, input.yearId)),
      ]);
      return {
        subjects: subjectRows.length,
        grades: gradeRows.length,
        periods: periodRows.length,
      };
    }),
};
