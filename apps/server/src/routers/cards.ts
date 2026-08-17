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
  type WidgetDefinitionV1,
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
import { badRequest, protectedProcedure } from "../lib/orpc";
import { newId } from "../lib/id";
import {
  requireCustomAverage,
  requireDashboardCard,
  requireGoal,
  requireSubject,
  requireYear,
} from "../lib/ownership";

interface PreparedSemantics {
  definition: WidgetDefinitionV1;
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
