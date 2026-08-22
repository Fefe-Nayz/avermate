import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  compileWidgetDefinition,
  WIDGET_DEFINITION_VERSION,
  WIDGET_SURFACES,
  type WidgetDefinition,
  type WidgetSurface,
} from "@avermate/core";
import { db } from "../db";
import { cardTemplates } from "../db/schema";
import {
  adminProcedure,
  badRequest,
  notFound,
  protectedProcedure,
} from "../lib/orpc";

/**
 * The card gallery catalog.
 *
 * Reads are for everyone and only ever see published rows. Writes are admin
 * work: drafts are editable, published templates are immutable (archive and
 * re-create to change one — the `presetVersions` philosophy), and publishing
 * is where a definition earns its place: it must parse, target the current
 * definition version and fit its declared surfaces. A definition MAY
 * reference the author's own entities (a subject, a custom average…):
 * those references are the template's SLOTS — the essential options every
 * installer re-points at their own entities in the gallery before the card
 * is created. Installation is not here on purpose — clients install through
 * the existing `cards.create`, the single write path for cards.
 */

const surfacesInput = z
  .array(z.enum(WIDGET_SURFACES))
  .min(1)
  .max(WIDGET_SURFACES.length);

const templateFields = {
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(280),
  surfaces: surfacesInput,
  category: z.string().trim().min(1).max(48),
  definitionVersion: z.number().int().positive(),
  definitionJson: z.record(z.string(), z.unknown()),
  sortOrder: z.number().int().min(0).max(10_000),
};
const templateCreateInput = z.object({
  ...templateFields,
  description: templateFields.description.default(""),
  category: templateFields.category.default("general"),
  sortOrder: templateFields.sortOrder.default(0),
});

const templateUpdateInput = z
  .object(templateFields)
  .partial()
  .extend({
    templateId: z.string().min(1),
  });

async function requireTemplate(templateId: string) {
  const [row] = await db
    .select()
    .from(cardTemplates)
    .where(eq(cardTemplates.id, templateId))
    .limit(1);
  if (!row) notFound("Card template");
  return row;
}

/** The full publish gate; returns the compiled definition for storage. */
function validatePublishable(
  definitionJson: unknown,
  definitionVersion: number,
  surfaces: readonly string[],
): WidgetDefinition {
  if (definitionVersion !== WIDGET_DEFINITION_VERSION) {
    badRequest(
      `Card templates must target definition version ${WIDGET_DEFINITION_VERSION}.`,
    );
  }
  let definition: WidgetDefinition | null = null;
  for (const surface of surfaces) {
    const compiled = compileWidgetDefinition(definitionJson, {
      surface: surface as WidgetSurface,
    });
    if (!compiled.valid || !compiled.plan) {
      const detail = compiled.issues
        .slice(0, 4)
        .map((issue) => `${issue.path || "definition"}: ${issue.messageKey}`)
        .join("; ");
      badRequest(
        `The definition is not valid for the ${surface} surface${detail ? ` (${detail})` : ""}.`,
      );
    }
    definition ??= compiled.plan.definition;
  }
  if (!definition) badRequest("A template needs at least one surface.");
  return definition;
}

export const cardTemplatesRouter = {
  /** Published templates, grouped for the gallery. */
  list: protectedProcedure.handler(() =>
    db
      .select()
      .from(cardTemplates)
      .where(eq(cardTemplates.status, "published"))
      .orderBy(asc(cardTemplates.category), asc(cardTemplates.sortOrder)),
  ),

  get: protectedProcedure
    .input(z.object({ templateId: z.string().min(1) }))
    .handler(async ({ input }) => {
      const row = await requireTemplate(input.templateId);
      if (row.status !== "published") notFound("Card template");
      return row;
    }),

  adminList: adminProcedure.handler(() =>
    db
      .select()
      .from(cardTemplates)
      .orderBy(asc(cardTemplates.category), asc(cardTemplates.sortOrder)),
  ),

  create: adminProcedure
    .input(templateCreateInput)
    .handler(async ({ context, input }) => {
      const [created] = await db
        .insert(cardTemplates)
        .values({
          title: input.title,
          description: input.description,
          surfaces: [...input.surfaces],
          category: input.category,
          definitionVersion: input.definitionVersion,
          definitionJson: input.definitionJson as unknown as WidgetDefinition,
          sortOrder: input.sortOrder,
          status: "draft",
          createdByUserId: context.session.user.id,
        })
        .returning();
      return created;
    }),

  update: adminProcedure
    .input(templateUpdateInput)
    .handler(async ({ input }) => {
      const row = await requireTemplate(input.templateId);
      if (row.status !== "draft") {
        badRequest(
          "A published template is immutable; archive it and create a successor instead.",
        );
      }
      const { templateId, definitionJson, surfaces, ...rest } = input;
      const [updated] = await db
        .update(cardTemplates)
        .set({
          ...rest,
          ...(surfaces !== undefined ? { surfaces: [...surfaces] } : {}),
          ...(definitionJson !== undefined
            ? {
                definitionJson: definitionJson as unknown as WidgetDefinition,
              }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(cardTemplates.id, templateId))
        .returning();
      return updated;
    }),

  publish: adminProcedure
    .input(z.object({ templateId: z.string().min(1) }))
    .handler(async ({ input }) => {
      const row = await requireTemplate(input.templateId);
      if (row.status !== "draft") {
        badRequest("Only a draft can be published.");
      }
      const definition = validatePublishable(
        row.definitionJson,
        row.definitionVersion,
        row.surfaces,
      );
      const [published] = await db
        .update(cardTemplates)
        .set({
          status: "published",
          definitionJson: definition,
          updatedAt: new Date(),
        })
        .where(eq(cardTemplates.id, input.templateId))
        .returning();
      return published;
    }),

  archive: adminProcedure
    .input(z.object({ templateId: z.string().min(1) }))
    .handler(async ({ input }) => {
      await requireTemplate(input.templateId);
      const [archived] = await db
        .update(cardTemplates)
        .set({ status: "archived", updatedAt: new Date() })
        .where(eq(cardTemplates.id, input.templateId))
        .returning();
      return archived;
    }),
};
