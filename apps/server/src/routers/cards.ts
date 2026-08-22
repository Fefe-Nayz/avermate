import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  CARD_METRICS,
  defaultCards,
  defaultInsightWidgets,
  widgetDefinitionFromCard,
  WIDGET_DEFINITION_VERSION,
  type CardDisplay,
  type CardMetric,
  type WidgetDefinition,
  type CardSemantics,
  type WidgetSurface,
} from "@avermate/core";
import { db } from "../db";
import { dashboardCardReferences, dashboardCards } from "../db/schema";
import {
  cardCreateInputSchema,
  cardSurfaceSchema,
  cardUpdateInputSchema,
  compileOwnedWidgetDefinition,
  hasWidgetDefinition,
  widgetReferenceReplacementStatements,
  widgetReferenceRows,
  widgetSemanticColumns,
  type CardCreateInput,
  type CardUpdateInput,
} from "../lib/card-storage";
import {
  assertSameYear,
  normalizeTargetReference,
  type TargetKind,
} from "../lib/domain-integrity";
import { badRequest, conflict, protectedProcedure } from "../lib/orpc";
import { newId } from "../lib/id";
import {
  requireCustomAverage,
  requireDashboardCard,
  requireGoal,
  requireSubject,
  requireYear,
} from "../lib/ownership";

interface PreparedSemantics {
  definition: WidgetDefinition;
  columns: ReturnType<typeof widgetSemanticColumns>;
}

/**
 * The definition a write stores, compiled against what this account owns.
 *
 * Both of these used to have a second branch for a card described by the old
 * columns, and an update could arrive as a patch of them. Those shapes are no
 * longer accepted — see `cardCreateInputSchema` — so there is one path, and a
 * stored card can only ever have come through it.
 */
async function semanticsForCreate(
  userId: string,
  input: CardCreateInput,
): Promise<PreparedSemantics> {
  const definition = await compileOwnedWidgetDefinition(
    userId,
    input.yearId,
    input.surface,
    input.definitionJson,
  );
  return { definition, columns: widgetSemanticColumns(definition) };
}

async function semanticsForUpdate(
  userId: string,
  row: typeof dashboardCards.$inferSelect,
  definitionJson: unknown,
  surface: WidgetSurface,
): Promise<PreparedSemantics> {
  const definition = await compileOwnedWidgetDefinition(
    userId,
    row.yearId,
    surface,
    definitionJson,
  );
  return { definition, columns: widgetSemanticColumns(definition) };
}

export const cardsRouter = {
  list: protectedProcedure
    .input(
      z.object({
        yearId: z.string(),
        surface: cardSurfaceSchema.default("overview"),
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
    .input(cardCreateInputSchema)
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await requireYear(userId, input.yearId);
      const semantics = await semanticsForCreate(userId, input);
      const existing = await db
        .select({ sortOrder: dashboardCards.sortOrder })
        .from(dashboardCards)
        .where(
          and(
            eq(dashboardCards.yearId, input.yearId),
            eq(dashboardCards.surface, input.surface),
          ),
        );

      const cardId = newId("card");
      const references = widgetReferenceRows(cardId, semantics.definition);
      const statements = [
        db.insert(dashboardCards).values({
          id: cardId,
          surface: input.surface,
          span: input.span,
          title: input.title,
          accent: input.accent,
          hidden: input.hidden,
          ...semantics.columns,
          sortOrder: existing.reduce(
            (max, row) => Math.max(max, row.sortOrder + 1),
            0,
          ),
          yearId: input.yearId,
          userId,
        }),
        ...(references.length > 0
          ? [db.insert(dashboardCardReferences).values(references)]
          : []),
      ];
      await db.batch(
        statements as [
          (typeof statements)[number],
          ...(typeof statements)[number][],
        ],
      );
      return requireDashboardCard(userId, cardId);
    }),

  update: protectedProcedure
    .input(cardUpdateInputSchema)
    .handler(async ({ context, input }) => {
      const { cardId } = input;
      const userId = context.session.user.id;
      const existing = await requireDashboardCard(userId, cardId);
      const surface = cardSurfaceSchema.parse(
        input.surface ?? existing.surface,
      );
      if (surface !== existing.surface) {
        badRequest("A card cannot change surface through an update");
      }
      if (!hasWidgetDefinition(input)) {
        await db
          .update(dashboardCards)
          .set({
            ...(input.span !== undefined ? { span: input.span } : {}),
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.accent !== undefined ? { accent: input.accent } : {}),
            ...(input.hidden !== undefined ? { hidden: input.hidden } : {}),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(dashboardCards.id, cardId),
              eq(dashboardCards.userId, userId),
            ),
          );
        return requireDashboardCard(userId, cardId);
      }
      const semantics = await semanticsForUpdate(
        userId,
        existing,
        input.definitionJson,
        surface,
      );
      const statements = [
        db
          .update(dashboardCards)
          .set({
            surface,
            ...(input.span !== undefined ? { span: input.span } : {}),
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.accent !== undefined ? { accent: input.accent } : {}),
            ...(input.hidden !== undefined ? { hidden: input.hidden } : {}),
            ...semantics.columns,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(dashboardCards.id, cardId),
              eq(dashboardCards.userId, userId),
            ),
          ),
        ...widgetReferenceReplacementStatements(cardId, semantics.definition),
      ];
      await db.batch(
        statements as [
          (typeof statements)[number],
          ...(typeof statements)[number][],
        ],
      );
      return requireDashboardCard(userId, cardId);
    }),

  reorder: protectedProcedure
    .input(
      z.object({
        cardIds: z.array(z.string()).min(1),
        /**
         * The order the caller believed was stored when it computed `cardIds`.
         *
         * A compare-and-swap on the layout itself, which is available because a
         * reorder already has to name every card on the surface — so the client
         * holds the whole thing and can say what it was working from. No revision
         * column and no extra round trip: the content *is* the version.
         */
        expectedCardIds: z.array(z.string()).min(1),
      }),
    )
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
      /**
       * The whole surface, or nothing.
       *
       * This used to accept any subset and quietly append the cards the caller had
       * not mentioned — which reads as leniency and behaves as data loss. A client
       * that sent only its *visible* cards had every hidden one renumbered to the
       * end of the layout, losing the position it was hidden at; unhide it later
       * and it comes back somewhere it never was. There is no partial order that
       * says anything useful about a layout, so there is no partial order to
       * interpret. Sets are equal here rather than merely the same size: the ids
       * are already known to be unique, to belong to this account, and to share
       * this year and surface, so `current` is the same collection.
       */
      if (current.length !== input.cardIds.length) {
        badRequest("A reorder must list every card on the surface");
      }

      /**
       * Reject a layout computed against an arrangement that has since changed.
       *
       * Each request carries a complete, absolute order rather than a relative move,
       * so the last write wins unconditionally — and "last" is decided by the
       * network, not by the person. Two devices, or two tabs, each reordering from
       * the same starting point: whichever answer arrives second overwrites the
       * other, silently, and the loser's refetch then shows them their own gesture
       * undone with no explanation.
       *
       * Comparing against what the caller thought it was reordering closes that. The
       * client already sends every card, so it can also say which arrangement it
       * started from, and this is a compare-and-swap without a revision column to
       * keep in step. Order-sensitive, deliberately: a *different sequence* of the
       * same cards is precisely the conflict, and set equality would miss it.
       */
      const stored = current.map((card) => card.id);
      const stale =
        stored.length !== input.expectedCardIds.length ||
        stored.some((id, index) => id !== input.expectedCardIds[index]);
      if (stale) {
        conflict("This layout was changed somewhere else");
      }
      const statements = input.cardIds.map((id, index) =>
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
      await db
        .delete(dashboardCards)
        .where(
          and(
            eq(dashboardCards.id, input.cardId),
            eq(dashboardCards.userId, context.session.user.id),
          ),
        );
      return { ok: true };
    }),

  /** Restore an explicit recommended layout; an empty surface stays empty. */
  reset: protectedProcedure
    .input(
      z.object({
        yearId: z.string(),
        surface: cardSurfaceSchema.default("overview"),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await requireYear(userId, input.yearId);

      const presets =
        input.surface === "overview"
          ? defaultCards().map((card) => ({
              definition: widgetDefinitionFromCard({
                metric: card.metric,
                targetKind: card.target.kind,
                targetId: card.target.referenceId,
                goalId: null,
                display: card.display,
              }),
              presentation: {
                span: card.span,
                title: card.title,
                accent: card.accent,
              },
            }))
          : input.surface === "insights"
            ? defaultInsightWidgets()
            : [];

      const rows = await Promise.all(
        presets.map(async (preset, sortOrder) => {
          const definition = await compileOwnedWidgetDefinition(
            userId,
            input.yearId,
            input.surface,
            preset.definition,
          );
          const id = newId("card");
          return {
            id,
            surface: input.surface,
            ...widgetSemanticColumns(definition),
            span: preset.presentation.span,
            title: preset.presentation.title,
            accent: preset.presentation.accent,
            sortOrder,
            hidden: false,
            yearId: input.yearId,
            userId,
          };
        }),
      );

      const removeExisting = db
        .delete(dashboardCards)
        .where(
          and(
            eq(dashboardCards.yearId, input.yearId),
            eq(dashboardCards.surface, input.surface),
          ),
        );
      if (rows.length === 0) {
        await removeExisting;
        return [];
      }
      const references = rows.flatMap((row) =>
        widgetReferenceRows(row.id, row.definitionJson),
      );
      const statements = [
        removeExisting,
        db.insert(dashboardCards).values(rows),
        ...(references.length > 0
          ? [db.insert(dashboardCardReferences).values(references)]
          : []),
      ];
      await db.batch(
        statements as [
          (typeof statements)[number],
          ...(typeof statements)[number][],
        ],
      );
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
