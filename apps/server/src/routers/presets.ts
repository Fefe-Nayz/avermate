import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  customAverageEntries,
  customAverages,
  periods,
  subjects,
  years,
} from "../db/schema";
import { PRESETS } from "../data/presets";
import type { PresetSubject } from "../data/preset-types";
import { badRequest, notFound, protectedProcedure, publicProcedure } from "../lib/orpc";
import { requireYear } from "../lib/ownership";
import { newId } from "../lib/id";

/**
 * Period layouts, as fractions of the school year. Kept separate from the
 * subject presets: a lycéen and a prépa student share trimesters even though
 * nothing else about their years matches.
 */
export const PERIOD_TEMPLATES = [
  {
    id: "trimesters",
    periods: [
      { key: "trimester1", from: 0, to: 1 / 3 },
      { key: "trimester2", from: 1 / 3, to: 2 / 3 },
      { key: "trimester3", from: 2 / 3, to: 1 },
    ],
  },
  {
    id: "semesters",
    periods: [
      { key: "semester1", from: 0, to: 0.5 },
      { key: "semester2", from: 0.5, to: 1 },
    ],
  },
  {
    id: "semesters-cumulative",
    periods: [
      { key: "semester1", from: 0, to: 0.5 },
      { key: "semester2", from: 0.5, to: 1, isCumulative: true },
    ],
  },
  {
    id: "quarters",
    periods: [
      { key: "quarter1", from: 0, to: 0.25 },
      { key: "quarter2", from: 0.25, to: 0.5 },
      { key: "quarter3", from: 0.5, to: 0.75 },
      { key: "quarter4", from: 0.75, to: 1 },
    ],
  },
  { id: "none", periods: [] },
] as const;

export type PeriodTemplateId = (typeof PERIOD_TEMPLATES)[number]["id"];

function at(from: Date, to: Date, fraction: number): Date {
  return new Date(
    from.getTime() + (to.getTime() - from.getTime()) * fraction,
  );
}

interface FlatSubject {
  id: string;
  name: string;
  shortName: string | null;
  parentId: string | null;
  coefficient: number;
  kind: string;
  isMain: boolean;
  sortOrder: number;
  yearId: string;
  userId: string;
}

/** Depth-first flatten, assigning ids so children can point at their parent. */
function flatten(
  tree: readonly PresetSubject[],
  parentId: string | null,
  yearId: string,
  userId: string,
  out: FlatSubject[],
  byName: Map<string, string>,
): void {
  tree.forEach((node, index) => {
    const id = newId("sub");
    out.push({
      id,
      name: node.name,
      shortName: node.shortName ?? null,
      parentId,
      coefficient: node.coefficient ?? 1,
      kind: node.kind === "category" ? "category" : "subject",
      isMain: node.isMain ?? false,
      sortOrder: index,
      yearId,
      userId,
    });
    byName.set(node.name, id);
    if (node.children?.length) {
      flatten(node.children, id, yearId, userId, out, byName);
    }
  });
}

export const presetsRouter = {
  list: publicProcedure.handler(() =>
    PRESETS.filter((preset) => !preset.archived).map((preset) => ({
      id: preset.id,
      name: preset.name,
      description: preset.description,
      tags: preset.tags,
      featured: preset.featured,
      subjectCount: countSubjects(preset.subjects),
      averageCount: preset.averages.length,
    })),
  ),

  get: publicProcedure
    .input(z.object({ presetId: z.string() }))
    .handler(({ input }) => {
      const preset = PRESETS.find((item) => item.id === input.presetId);
      if (!preset) notFound("Preset");
      return preset;
    }),

  periodTemplates: publicProcedure.handler(() =>
    PERIOD_TEMPLATES.map((template) => ({
      id: template.id,
      periods: template.periods.map((period) => ({ ...period })),
    })),
  ),

  /**
   * Write a preset into a year. Additive by default so someone can layer two
   * presets, or start from a preset after having entered a few subjects.
   */
  apply: protectedProcedure
    .input(
      z.object({
        yearId: z.string(),
        presetId: z.string(),
        replaceExisting: z.boolean().default(false),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const year = await requireYear(userId, input.yearId);
      const preset = PRESETS.find((item) => item.id === input.presetId);
      if (!preset) notFound("Preset");

      if (input.replaceExisting) {
        await db.delete(subjects).where(eq(subjects.yearId, year.id));
      }

      const rows: FlatSubject[] = [];
      const byName = new Map<string, string>();
      flatten(preset.subjects, null, year.id, userId, rows, byName);
      if (rows.length === 0) badRequest("That preset has no subjects");

      await db.insert(subjects).values(rows);

      for (const [index, average] of preset.averages.entries()) {
        const entries = average.entries
          .map((entry) => ({
            subjectId: byName.get(entry.name),
            coefficient: entry.coefficient ?? null,
            includeChildren: entry.includeChildren ?? false,
          }))
          .filter(
            (entry): entry is { subjectId: string; coefficient: number | null; includeChildren: boolean } =>
              Boolean(entry.subjectId),
          );
        if (entries.length === 0) continue;

        const [created] = await db
          .insert(customAverages)
          .values({
            name: average.name,
            isMain: average.isMain ?? false,
            sortOrder: index,
            yearId: year.id,
            userId,
          })
          .returning();
        if (!created) continue;

        await db
          .insert(customAverageEntries)
          .values(entries.map((entry) => ({ ...entry, averageId: created.id })));
      }

      await db
        .update(years)
        .set({ presetId: preset.id, updatedAt: new Date() })
        .where(eq(years.id, year.id));

      return { subjects: rows.length, averages: preset.averages.length };
    }),

  /** Lay periods over a year from one of the templates. */
  applyPeriods: protectedProcedure
    .input(
      z.object({
        yearId: z.string(),
        templateId: z.string(),
        /** Localised names, in template order. */
        names: z.array(z.string().trim().min(1).max(64)),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const year = await requireYear(userId, input.yearId);
      const template = PERIOD_TEMPLATES.find(
        (item) => item.id === input.templateId,
      );
      if (!template) notFound("Period template");

      await db.delete(periods).where(eq(periods.yearId, year.id));
      if (template.periods.length === 0) return [];

      return db
        .insert(periods)
        .values(
          template.periods.map((period, index) => ({
            name: input.names[index] ?? `Period ${index + 1}`,
            startAt: at(year.startsAt, year.endsAt, period.from),
            endAt: at(year.startsAt, year.endsAt, period.to),
            isCumulative: "isCumulative" in period ? period.isCumulative : false,
            sortOrder: index,
            yearId: year.id,
            userId,
          })),
        )
        .returning();
    }),
};

function countSubjects(tree: readonly PresetSubject[]): number {
  return tree.reduce(
    (total, node) => total + 1 + countSubjects(node.children ?? []),
    0,
  );
}
