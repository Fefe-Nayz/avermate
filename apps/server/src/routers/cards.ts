import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { dashboardCards } from "../db/schema";
import { protectedProcedure } from "../lib/orpc";
import { requireYear } from "../lib/ownership";
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
      const [updated] = await db
        .update(dashboardCards)
        .set({ ...patch, updatedAt: new Date() })
        .where(
          and(eq(dashboardCards.id, cardId), eq(dashboardCards.userId, userId)),
        )
        .returning();
      return updated;
    }),

  reorder: protectedProcedure
    .input(z.object({ cardIds: z.array(z.string()) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await Promise.all(
        input.cardIds.map((id, index) =>
          db
            .update(dashboardCards)
            .set({ sortOrder: index, updatedAt: new Date() })
            .where(
              and(
                eq(dashboardCards.id, id),
                eq(dashboardCards.userId, userId),
              ),
            ),
        ),
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

      await db
        .delete(dashboardCards)
        .where(
          and(
            eq(dashboardCards.yearId, input.yearId),
            eq(dashboardCards.surface, input.surface),
          ),
        );

      if (input.surface !== "overview") return [];

      return db
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
        )
        .returning();
    }),
};
