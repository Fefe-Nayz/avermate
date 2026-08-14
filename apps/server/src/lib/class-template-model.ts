import { z } from "zod";
import { managedPresetConfigurationSchema } from "../data/managed-presets";
import type { ManagedPresetSubject } from "../data/preset-types";

const templatePeriodSchema = z.object({
  name: z.string(),
  startAt: z.number().int(),
  endAt: z.number().int(),
  isCumulative: z.boolean(),
  sortOrder: z.number().int(),
});

export const classTemplateSchema = z.object({
  version: z.literal(1),
  year: z.object({
    name: z.string(),
    startsAt: z.number().int(),
    endsAt: z.number().int(),
    scale: z.number().positive(),
    defaultOutOf: z.number().positive(),
    passingRatio: z.number().min(0).max(1),
    decimals: z.number().int().min(0).max(4),
  }),
  periods: z.array(templatePeriodSchema),
  configuration: managedPresetConfigurationSchema,
  source: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("preset"),
      presetId: z.string(),
      presetVersion: z.number().int().positive(),
    }),
    z.object({ kind: z.literal("custom"), yearId: z.string() }),
  ]),
});

export type ClassTemplate = z.infer<typeof classTemplateSchema>;
export type ClassYearStatus = "connected" | "not_connected" | "incompatible";

export function buildClassTemplate(input: {
  year: {
    name: string;
    startsAt: Date;
    endsAt: Date;
    scale: number;
    defaultOutOf: number;
    passingRatio: number;
    decimals: number;
  };
  periods: Array<{
    name: string;
    startAt: Date;
    endAt: Date;
    isCumulative: boolean;
    sortOrder: number;
  }>;
  configuration: z.infer<typeof managedPresetConfigurationSchema>;
  source: ClassTemplate["source"];
}): ClassTemplate {
  return classTemplateSchema.parse({
    version: 1,
    year: {
      ...input.year,
      startsAt: input.year.startsAt.getTime(),
      endsAt: input.year.endsAt.getTime(),
    },
    periods: input.periods.map((period) => ({
      ...period,
      startAt: period.startAt.getTime(),
      endAt: period.endAt.getTime(),
    })),
    configuration: input.configuration,
    source: input.source,
  });
}

/** Accept timestamp encoding drift, but reject a full-day offset. */
export function sameAcademicDay(left: number, right: number) {
  return Math.abs(left - right) <= 18 * 60 * 60 * 1_000;
}

export function parseClassTemplate(value: string | null): ClassTemplate | null {
  if (!value) return null;
  try {
    const parsed = classTemplateSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function serializeClassTemplate(template: ClassTemplate): string {
  return JSON.stringify(classTemplateSchema.parse(template));
}

export function classTemplateSummary(template: ClassTemplate) {
  const countSubjects = (nodes: readonly ManagedPresetSubject[]): number =>
    nodes.reduce((total, node) => total + 1 + countSubjects(node.children), 0);
  return {
    yearName: template.year.name,
    startsAt: new Date(template.year.startsAt),
    endsAt: new Date(template.year.endsAt),
    scale: template.year.scale,
    subjectCount: countSubjects(template.configuration.subjects),
    averageCount: template.configuration.averages.length,
    periodCount: template.periods.length,
    source: template.source.kind,
  };
}

export function classTemplateSubjects(template: ClassTemplate) {
  const flatten = (
    nodes: readonly ManagedPresetSubject[],
  ): Array<{ key: string; name: string }> =>
    nodes.flatMap((node) => [
      { key: node.key, name: node.name },
      ...flatten(node.children),
    ]);
  return flatten(template.configuration.subjects);
}
