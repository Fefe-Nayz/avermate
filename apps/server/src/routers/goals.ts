import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { goals } from "../db/schema";
import { protectedProcedure } from "../lib/orpc";
import { requireGoal, requireYear } from "../lib/ownership";

const goalInput = z.object({
  name: z.string().trim().min(1).max(96),
  kind: z.enum(["general", "subject", "custom"]).default("general"),
  referenceId: z.string().nullable().default(null),
  /**
   * Stored as a ratio rather than a mark: a student who switches their year
   * from /20 to /100 keeps the goal they set, instead of aiming for 14%.
   */
  targetRatio: z.number().min(0).max(1),
  periodId: z.string().nullable().default(null),
  dueAt: z.coerce.date().nullable().default(null),
  isPinned: z.boolean().default(false),
});

export const goalsRouter = {
  list: protectedProcedure
    .input(z.object({ yearId: z.string() }))
    .handler(async ({ context, input }) => {
      await requireYear(context.session.user.id, input.yearId);
      return db
        .select()
        .from(goals)
        .where(eq(goals.yearId, input.yearId))
        .orderBy(asc(goals.sortOrder), asc(goals.createdAt));
    }),

  create: protectedProcedure
    .input(goalInput.extend({ yearId: z.string() }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await requireYear(userId, input.yearId);

      const existing = await db
        .select({ sortOrder: goals.sortOrder })
        .from(goals)
        .where(eq(goals.yearId, input.yearId));

      const [created] = await db
        .insert(goals)
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
    .input(goalInput.partial().extend({ goalId: z.string() }))
    .handler(async ({ context, input }) => {
      const { goalId, ...patch } = input;
      await requireGoal(context.session.user.id, goalId);
      const [updated] = await db
        .update(goals)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(goals.id, goalId))
        .returning();
      return updated;
    }),

  /**
   * Recorded once, the first time the target is met. Keeping the date means a
   * goal reached in November still reads as reached in June, even if the
   * average has drifted since.
   */
  markAchieved: protectedProcedure
    .input(z.object({ goalId: z.string(), achieved: z.boolean() }))
    .handler(async ({ context, input }) => {
      const goal = await requireGoal(context.session.user.id, input.goalId);
      if (input.achieved && goal.achievedAt) return goal;

      const [updated] = await db
        .update(goals)
        .set({
          achievedAt: input.achieved ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(goals.id, input.goalId))
        .returning();
      return updated;
    }),

  reorder: protectedProcedure
    .input(z.object({ goalIds: z.array(z.string()).min(1) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await Promise.all(
        input.goalIds.map((id, index) =>
          db
            .update(goals)
            .set({ sortOrder: index, updatedAt: new Date() })
            .where(and(eq(goals.id, id), eq(goals.userId, userId))),
        ),
      );
      return { ok: true };
    }),

  delete: protectedProcedure
    .input(z.object({ goalId: z.string() }))
    .handler(async ({ context, input }) => {
      await requireGoal(context.session.user.id, input.goalId);
      await db.delete(goals).where(eq(goals.id, input.goalId));
      return { ok: true };
    }),
};
