import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { goals } from "../db/schema";
import { badRequest, protectedProcedure } from "../lib/orpc";
import {
  assertSameYear,
  normalizeTargetReference,
  type TargetKind,
} from "../lib/domain-integrity";
import {
  requireCustomAverage,
  requireGoal,
  requirePeriod,
  requireSubject,
  requireYear,
} from "../lib/ownership";

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

async function validateGoalScope(
  userId: string,
  yearId: string,
  kind: TargetKind,
  referenceId: string | null | undefined,
  periodId: string | null,
): Promise<{ referenceId: string | null; periodId: string | null }> {
  const normalizedReference = normalizeTargetReference(
    kind,
    referenceId,
    "Goal",
  );
  if (kind === "subject" && normalizedReference) {
    const subject = await requireSubject(userId, normalizedReference);
    assertSameYear("Goal subject", yearId, subject.yearId);
  }
  if (kind === "custom" && normalizedReference) {
    const average = await requireCustomAverage(userId, normalizedReference);
    assertSameYear("Goal average", yearId, average.yearId);
  }
  if (periodId) {
    const period = await requirePeriod(userId, periodId);
    assertSameYear("Goal period", yearId, period.yearId);
  }
  return { referenceId: normalizedReference, periodId };
}

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
      const scope = await validateGoalScope(
        userId,
        input.yearId,
        input.kind,
        input.referenceId,
        input.periodId,
      );

      const existing = await db
        .select({ sortOrder: goals.sortOrder })
        .from(goals)
        .where(eq(goals.yearId, input.yearId));

      const [created] = await db
        .insert(goals)
        .values({
          ...input,
          ...scope,
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
      const userId = context.session.user.id;
      const existing = await requireGoal(userId, goalId);
      const kind = z
        .enum(["general", "subject", "custom"])
        .parse(patch.kind ?? existing.kind);
      const changedKind =
        patch.kind !== undefined && patch.kind !== existing.kind;
      const referenceId =
        patch.referenceId !== undefined
          ? patch.referenceId
          : changedKind
            ? null
            : existing.referenceId;
      const periodId =
        patch.periodId !== undefined ? patch.periodId : existing.periodId;
      const scope = await validateGoalScope(
        userId,
        existing.yearId,
        kind,
        referenceId,
        periodId,
      );
      const [updated] = await db
        .update(goals)
        .set({ ...patch, kind, ...scope, updatedAt: new Date() })
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
      if (new Set(input.goalIds).size !== input.goalIds.length) {
        badRequest("A goal can only appear once in its order");
      }
      const selected = await db
        .select()
        .from(goals)
        .where(
          and(eq(goals.userId, userId), inArray(goals.id, input.goalIds)),
        );
      if (selected.length !== input.goalIds.length) {
        badRequest("Every reordered goal must belong to this account");
      }
      const first = selected[0];
      if (!first) badRequest("At least one goal is required");
      if (selected.some((goal) => goal.yearId !== first.yearId)) {
        badRequest("Every reordered goal must belong to the same year");
      }
      const current = await db
        .select({ id: goals.id })
        .from(goals)
        .where(and(eq(goals.userId, userId), eq(goals.yearId, first.yearId)))
        .orderBy(asc(goals.sortOrder), asc(goals.createdAt));
      const requested = new Set(input.goalIds);
      const orderedIds = [
        ...input.goalIds,
        ...current.map((goal) => goal.id).filter((id) => !requested.has(id)),
      ];
      const statements = orderedIds.map((id, index) =>
          db
            .update(goals)
            .set({ sortOrder: index, updatedAt: new Date() })
            .where(and(eq(goals.id, id), eq(goals.userId, userId))),
      );
      await db.batch(
        statements as [
          (typeof statements)[number],
          ...(typeof statements)[number][],
        ],
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
