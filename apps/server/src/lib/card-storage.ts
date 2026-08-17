import { z } from "zod";
import {
  CARD_METRICS,
  collectWidgetReferences,
  compileWidgetDefinition,
  WIDGET_DEFINITION_VERSION,
  WIDGET_SURFACES,
  cardSemanticsFromDefinition,
  type WidgetCompileOptions,
  type WidgetDefinitionV1,
  type WidgetSurface,
} from "@avermate/core";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import {
  customAverages,
  dashboardCardReferences,
  goals,
  periods,
  subjects,
} from "../db/schema";
import { badRequest } from "./orpc";

/** Stable surfaces stored in `dashboard_cards.surface` and shared by every API. */
export const cardSurfaceSchema = z.enum(WIDGET_SURFACES);

export type CardSurface = z.infer<typeof cardSurfaceSchema>;

const envelope = {
  surface: cardSurfaceSchema.default("overview"),
  span: z.number().int().min(1).max(4).default(1),
  title: z.string().trim().max(48).nullable().default(null),
  accent: z.string().trim().max(24).nullable().default(null),
  hidden: z.boolean().default(false),
};

const definition = {
  definitionVersion: z.literal(WIDGET_DEFINITION_VERSION),
  definitionJson: z.custom<WidgetDefinitionV1>(
    (value) =>
      value !== null && typeof value === "object" && !Array.isArray(value),
    "Widget definition must be an object",
  ),
};

/**
 * A card is its definition.
 *
 * There used to be a second accepted shape here — `metric`, `targetKind`,
 * `display` and friends — and a card created that way stored *only* those
 * columns. The clients then had to read both, and the fallback they read was
 * drawn by a different renderer, so the same card could look like two different
 * cards depending on which screen resolved it. Accepting one representation is
 * what makes that impossible rather than merely unlikely.
 */
export const cardCreateInputSchema = z
  .object({ yearId: z.string(), ...envelope, ...definition })
  .strict();

// Patch schemas intentionally omit defaults: applying create defaults during
// an update would turn a presentation-only change into a semantic rewrite.
const envelopePatch = z
  .object({
    surface: cardSurfaceSchema,
    span: z.number().int().min(1).max(4),
    title: z.string().trim().max(48).nullable(),
    accent: z.string().trim().max(24).nullable(),
    hidden: z.boolean(),
  })
  .partial();

const presentationUpdate = envelopePatch
  .extend({ cardId: z.string() })
  .strict();

const definitionUpdate = envelopePatch
  .extend({ cardId: z.string(), ...definition })
  .strict();

/** Presentation-only patches are valid; the semantics arrive whole or not at all. */
export const cardUpdateInputSchema = z.union([
  definitionUpdate,
  presentationUpdate,
]);

export type CardCreateInput = z.infer<typeof cardCreateInputSchema>;
export type CardUpdateInput = z.infer<typeof cardUpdateInputSchema>;

export function hasWidgetDefinition(
  input: CardCreateInput | CardUpdateInput,
): input is Extract<typeof input, { definitionVersion: 1 }> {
  return (
    "definitionVersion" in input &&
    input.definitionVersion === WIDGET_DEFINITION_VERSION
  );
}

export interface WidgetReferenceExclusions {
  subjectIds?: ReadonlySet<string>;
  customAverageIds?: ReadonlySet<string>;
  goalIds?: ReadonlySet<string>;
  periodIds?: ReadonlySet<string>;
}

/**
 * Resolve the references a stored widget may use. Callers preparing a delete
 * can exclude rows that still exist until the final atomic batch executes.
 */
export async function ownedWidgetReferenceSets(
  userId: string,
  yearId: string,
  exclusions: WidgetReferenceExclusions = {},
) {
  const [subjectRows, averageRows, goalRows, periodRows] = await Promise.all([
    db
      .select({ id: subjects.id })
      .from(subjects)
      .where(and(eq(subjects.userId, userId), eq(subjects.yearId, yearId))),
    db
      .select({ id: customAverages.id })
      .from(customAverages)
      .where(
        and(
          eq(customAverages.userId, userId),
          eq(customAverages.yearId, yearId),
        ),
      ),
    db
      .select({ id: goals.id })
      .from(goals)
      .where(and(eq(goals.userId, userId), eq(goals.yearId, yearId))),
    db
      .select({ id: periods.id })
      .from(periods)
      .where(and(eq(periods.userId, userId), eq(periods.yearId, yearId))),
  ]);

  const withoutExcluded = (
    rows: Array<{ id: string }>,
    excluded: ReadonlySet<string> | undefined,
  ) =>
    new Set(
      rows
        .map((row) => row.id)
        .filter((referenceId) => !excluded?.has(referenceId)),
    );

  return {
    subjectIds: withoutExcluded(subjectRows, exclusions.subjectIds),
    customAverageIds: withoutExcluded(averageRows, exclusions.customAverageIds),
    goalIds: withoutExcluded(goalRows, exclusions.goalIds),
    periodIds: withoutExcluded(periodRows, exclusions.periodIds),
  };
}

export async function compileOwnedWidgetDefinition(
  userId: string,
  yearId: string,
  surface: WidgetSurface,
  input: unknown,
  exclusions: WidgetReferenceExclusions = {},
): Promise<WidgetDefinitionV1> {
  return compileStoredWidgetDefinition(
    surface,
    input,
    await ownedWidgetReferenceSets(userId, yearId, exclusions),
  );
}

export function compileStoredWidgetDefinition(
  surface: WidgetSurface,
  input: unknown,
  references: NonNullable<WidgetCompileOptions["references"]>,
): WidgetDefinitionV1 {
  const compiled = compileWidgetDefinition(input, {
    surface,
    references,
  });
  if (!compiled.valid || !compiled.plan) {
    const detail = compiled.issues
      .slice(0, 4)
      .map((issue) => `${issue.path || "definition"}: ${issue.messageKey}`)
      .join("; ");
    badRequest(`Invalid widget definition${detail ? ` (${detail})` : ""}`);
  }
  return compiled.plan.definition;
}

/**
 * The row a definition writes.
 *
 * `definitionJson` is canonical. The `metric` / `targetKind` / `targetId` /
 * `goalId` / `display` columns beside it are a projection of it and are no longer
 * read by anything — they are still written because they are `NOT NULL` on a
 * table whose rows predate the definition column. Dropping them needs a backfill
 * for those rows first (`0017` added the column without filling it in), which is
 * a data decision rather than a refactor; until then they are derived, never a
 * second source of truth.
 */
export function widgetSemanticColumns(definition: WidgetDefinitionV1) {
  return {
    ...cardSemanticsFromDefinition(definition),
    definitionVersion: WIDGET_DEFINITION_VERSION,
    definitionJson: definition,
  };
}

export function widgetReferenceRows(
  cardId: string,
  definition: WidgetDefinitionV1,
) {
  const references = collectWidgetReferences(definition);
  return [
    ...references.subjectIds.map((referenceId) => ({
      cardId,
      kind: "subject" as const,
      referenceId,
    })),
    ...references.customAverageIds.map((referenceId) => ({
      cardId,
      kind: "custom-average" as const,
      referenceId,
    })),
    ...references.goalIds.map((referenceId) => ({
      cardId,
      kind: "goal" as const,
      referenceId,
    })),
    ...references.periodIds.map((referenceId) => ({
      cardId,
      kind: "period" as const,
      referenceId,
    })),
  ];
}

/** Derived rows always replace the previous set in the same write batch. */
export function widgetReferenceReplacementStatements(
  cardId: string,
  definition: WidgetDefinitionV1,
) {
  const references = widgetReferenceRows(cardId, definition);
  return [
    db
      .delete(dashboardCardReferences)
      .where(eq(dashboardCardReferences.cardId, cardId)),
    ...(references.length > 0
      ? [db.insert(dashboardCardReferences).values(references)]
      : []),
  ];
}
