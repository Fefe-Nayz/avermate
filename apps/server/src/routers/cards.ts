import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { dashboardCards } from "../db/schema";
import { badRequest, protectedProcedure } from "../lib/orpc";
import {
  assertSameYear,
  normalizeTargetReference,
  type TargetKind,
} from "../lib/domain-integrity";
import {
  requireCustomAverage,
  requireDashboardCard,
  requireGoal,
  requireSubject,
  requireYear,
} from "../lib/ownership";
import { CARD_METRICS, defaultCards } from "@avermate/core";

const cardInput = z.object({
  surface: z.enum(["overview", "subject", "grade"]).default("overview"),
  metric: z.enum(CARD_METRICS),
  targetKind: z.enum(["general", "subject", "custom"]).default("general"),
  targetId: z.string().nullable().default(null),
  goalId: z.string().nullable().default(null),
  display: z
    .enum(["value", "sparkline", "chart", "list", "gauge"])
    .default("value"),
  span: z.number().int().min(1).max(4).default(1),
  title: z.string().trim().max(48).nullable().default(null),
  accent: z.string().trim().max(24).nullable().default(null),
  hidden: z.boolean().default(false),
});

async function validateCardScope(
  userId: string,
  yearId: string,
  targetKind: TargetKind,
  targetId: string | null | undefined,
  goalId: string | null,
): Promise<{ targetId: string | null; goalId: string | null }> {
  const normalizedTarget = normalizeTargetReference(
    targetKind,
    targetId,
    "Card target",
  );
  if (targetKind === "subject" && normalizedTarget) {
    const subject = await requireSubject(userId, normalizedTarget);
    assertSameYear("Card subject", yearId, subject.yearId);
  }
  if (targetKind === "custom" && normalizedTarget) {
    const average = await requireCustomAverage(userId, normalizedTarget);
    assertSameYear("Card average", yearId, average.yearId);
  }
  if (goalId) {
    const goal = await requireGoal(userId, goalId);
    assertSameYear("Card goal", yearId, goal.yearId);
  }
  return { targetId: normalizedTarget, goalId };
}

export const cardsRouter = {
  list: protectedProcedure
    .input(
      z.object({
        yearId: z.string(),
        surface: z.enum(["overview", "subject", "grade"]).default("overview"),
      }),
    )
    .handler(async ({ context, input }) => {
      await requireYear(context.session.user.id, input.yearId);
      return db
        .select()
        .from(dashboardCards)
        .where(
          and(
            eq(dashboardCards.yearId, input.yearId),
            eq(dashboardCards.surface, input.surface),
          ),
        )
        .orderBy(asc(dashboardCards.sortOrder));
    }),

  create: protectedProcedure
    .input(cardInput.extend({ yearId: z.string() }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await requireYear(userId, input.yearId);
      const scope = await validateCardScope(
        userId,
        input.yearId,
        input.targetKind,
        input.targetId,
        input.goalId,
      );

      const existing = await db
        .select({ sortOrder: dashboardCards.sortOrder })
        .from(dashboardCards)
        .where(
          and(
            eq(dashboardCards.yearId, input.yearId),
            eq(dashboardCards.surface, input.surface),
          ),
        );

      const [created] = await db
        .insert(dashboardCards)
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
    .input(cardInput.partial().extend({ cardId: z.string() }))
    .handler(async ({ context, input }) => {
      const { cardId, ...patch } = input;
      const userId = context.session.user.id;
      const existing = await requireDashboardCard(userId, cardId);
      const targetKind = z
        .enum(["general", "subject", "custom"])
        .parse(patch.targetKind ?? existing.targetKind);
      const changedKind =
        patch.targetKind !== undefined &&
        patch.targetKind !== existing.targetKind;
      const targetId =
        patch.targetId !== undefined
          ? patch.targetId
          : changedKind
            ? null
            : existing.targetId;
      const goalId =
        patch.goalId !== undefined ? patch.goalId : existing.goalId;
      const scope = await validateCardScope(
        userId,
        existing.yearId,
        targetKind,
        targetId,
        goalId,
      );
      const [updated] = await db
        .update(dashboardCards)
        .set({ ...patch, targetKind, ...scope, updatedAt: new Date() })
        .where(
          and(eq(dashboardCards.id, cardId), eq(dashboardCards.userId, userId)),
        )
        .returning();
      return updated;
    }),

  reorder: protectedProcedure
    .input(z.object({ cardIds: z.array(z.string()).min(1) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      if (new Set(input.cardIds).size !== input.cardIds.length) {
        badRequest("A card can only appear once in its order");
      }
      const selected = await db
        .select()
        .from(dashboardCards)
        .where(
          and(
            eq(dashboardCards.userId, userId),
            inArray(dashboardCards.id, input.cardIds),
          ),
        );
      if (selected.length !== input.cardIds.length) {
        badRequest("Every reordered card must belong to this account");
      }
      const first = selected[0];
      if (!first) badRequest("At least one card is required");
      if (
        selected.some(
          (card) =>
            card.yearId !== first.yearId || card.surface !== first.surface,
        )
      ) {
        badRequest("Every reordered card must share a year and surface");
      }
      const current = await db
        .select({ id: dashboardCards.id })
        .from(dashboardCards)
        .where(
          and(
            eq(dashboardCards.userId, userId),
            eq(dashboardCards.yearId, first.yearId),
            eq(dashboardCards.surface, first.surface),
          ),
        )
        .orderBy(asc(dashboardCards.sortOrder));
      const requested = new Set(input.cardIds);
      const orderedIds = [
        ...input.cardIds,
        ...current.map((card) => card.id).filter((id) => !requested.has(id)),
      ];
      const statements = orderedIds.map((id, index) =>
          db
            .update(dashboardCards)
            .set({ sortOrder: index, updatedAt: new Date() })
            .where(
              and(eq(dashboardCards.id, id), eq(dashboardCards.userId, userId)),
            ),
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
    .input(z.object({ cardId: z.string() }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await db
        .delete(dashboardCards)
        .where(
          and(
            eq(dashboardCards.id, input.cardId),
            eq(dashboardCards.userId, userId),
          ),
        );
      return { ok: true };
    }),

  /** Back to the starting dashboard, for when a layout gets away from someone. */
  reset: protectedProcedure
    .input(
      z.object({
        yearId: z.string(),
        surface: z.enum(["overview", "subject", "grade"]).default("overview"),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await requireYear(userId, input.yearId);

      const removeExisting = db
        .delete(dashboardCards)
        .where(
          and(
            eq(dashboardCards.yearId, input.yearId),
            eq(dashboardCards.surface, input.surface),
          ),
        );

      if (input.surface !== "overview") {
        await removeExisting;
        return [];
      }

      const insertDefaults = db
        .insert(dashboardCards)
        .values(
          defaultCards().map((card) => ({
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
            yearId: input.yearId,
            userId,
          })),
        );
      await db.batch([removeExisting, insertDefaults]);
      return db
        .select()
        .from(dashboardCards)
        .where(
          and(
            eq(dashboardCards.yearId, input.yearId),
            eq(dashboardCards.surface, input.surface),
          ),
        )
        .orderBy(asc(dashboardCards.sortOrder));
    }),
};
