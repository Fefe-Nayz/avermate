import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  ManagedPresetAverage,
  ManagedPresetConfiguration,
  ManagedPresetGradeType,
  ManagedPresetSubject,
  Preset,
  PresetSubject,
} from "./preset-types";

const nodeKey = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9:._-]+$/);

const managedSubjectSchema: z.ZodType<ManagedPresetSubject> = z.lazy(() =>
  z.object({
    key: nodeKey,
    name: z.string().trim().min(1).max(96),
    shortName: z.string().trim().max(24).optional(),
    kind: z.enum(["subject", "category"]),
    isMain: z.boolean(),
    coefficient: z.number().min(0).max(1000),
    children: z.array(managedSubjectSchema).max(200),
  }),
);

const managedAverageSchema: z.ZodType<ManagedPresetAverage> = z.object({
  key: nodeKey,
  name: z.string().trim().min(1).max(64),
  // Accept old preset payloads, but headline custom averages are retired.
  isMain: z
    .boolean()
    .optional()
    .transform(() => false),
  entries: z
    .array(
      z.object({
        subjectKey: nodeKey,
        coefficient: z.number().min(0).max(1000).nullable(),
        includeChildren: z.boolean(),
      }),
    )
    .min(1)
    .max(200),
});

const managedGradeTypeSchema: z.ZodType<ManagedPresetGradeType> = z.object({
  key: nodeKey,
  name: z.string().trim().min(1).max(48),
  // Not trimmed: the trailing space is the point. "DS " is what turns into "DS 3" in
  // the name box, and "DS" would leave somebody deleting the join every time.
  titlePrefix: z.string().max(48).default(""),
  coefficient: z.number().min(0).max(1000).default(1),
  outOf: z.number().positive().max(100_000).default(20),
  accent: z.string().trim().max(32).nullable().default(null),
});

export const managedPresetConfigurationSchema = z
  .object({
    subjects: z.array(managedSubjectSchema).min(1).max(300),
    averages: z.array(managedAverageSchema).max(100),
    // Absent in every payload published before assessment types existed, and a preset is
    // immutable once published — so the field defaults rather than being backfilled.
    gradeTypes: z.array(managedGradeTypeSchema).max(24).default([]),
  })
  .superRefine((configuration, context) => {
    const subjectKeys = new Set<string>();
    const visit = (nodes: readonly ManagedPresetSubject[]) => {
      for (const node of nodes) {
        if (subjectKeys.has(node.key)) {
          context.addIssue({
            code: "custom",
            message: `Duplicate subject key: ${node.key}`,
          });
        }
        subjectKeys.add(node.key);
        if (node.kind === "subject" && node.children.length > 0) {
          context.addIssue({
            code: "custom",
            message: `Plain subject ${node.key} cannot have children`,
          });
        }
        visit(node.children);
      }
    };
    visit(configuration.subjects);

    const typeKeys = new Set<string>();
    for (const type of configuration.gradeTypes) {
      if (typeKeys.has(type.key)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate grade type key: ${type.key}`,
        });
      }
      typeKeys.add(type.key);
    }

    const averageKeys = new Set<string>();
    for (const average of configuration.averages) {
      if (averageKeys.has(average.key)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate average key: ${average.key}`,
        });
      }
      averageKeys.add(average.key);
      const entryKeys = new Set<string>();
      for (const entry of average.entries) {
        if (!subjectKeys.has(entry.subjectKey)) {
          context.addIssue({
            code: "custom",
            message: `Average ${average.key} references unknown subject ${entry.subjectKey}`,
          });
        }
        if (entryKeys.has(entry.subjectKey)) {
          context.addIssue({
            code: "custom",
            message: `Average ${average.key} repeats subject ${entry.subjectKey}`,
          });
        }
        entryKeys.add(entry.subjectKey);
      }
    }
  });

function slug(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "node"
  );
}

/** Convert the seven legacy constants to stable-key managed version payloads. */
export function normalizeLegacyPreset(
  preset: Preset,
): ManagedPresetConfiguration {
  const keyByName = new Map<string, string>();

  const subjects = (
    nodes: readonly PresetSubject[],
    indexPath: readonly number[],
  ): ManagedPresetSubject[] =>
    nodes.map((node, index) => {
      const path = [...indexPath, index];
      const key =
        node.key ?? `legacy-subject:${path.join(".")}:${slug(node.name)}`;
      keyByName.set(node.name, key);
      return {
        key,
        name: node.name,
        ...(node.shortName ? { shortName: node.shortName } : {}),
        kind: node.kind === "category" ? "category" : "subject",
        isMain: node.isMain ?? false,
        coefficient: node.coefficient ?? 1,
        children: subjects(node.children ?? [], path),
      };
    });

  const configuration: ManagedPresetConfiguration = {
    subjects: subjects(preset.subjects, []),
    gradeTypes: (preset.gradeTypes ?? []).map((type, index) => ({
      key: type.key ?? `legacy-type:${index}:${slug(type.name)}`,
      name: type.name,
      titlePrefix: type.titlePrefix ?? "",
      coefficient: type.coefficient ?? 1,
      outOf: type.outOf ?? 20,
      accent: type.accent ?? null,
    })),
    averages: preset.averages.map((average, index) => ({
      key: average.key ?? `legacy-average:${index}:${slug(average.name)}`,
      name: average.name,
      isMain: false,
      entries: average.entries.map((entry) => {
        const subjectKey =
          entry.subjectKey ??
          (entry.name ? keyByName.get(entry.name) : undefined);
        if (!subjectKey) {
          throw new Error(
            `Preset ${preset.id} average ${average.name} references an unknown subject`,
          );
        }
        return {
          subjectKey,
          coefficient: entry.coefficient ?? null,
          includeChildren: entry.includeChildren ?? false,
        };
      }),
    })),
  };

  return managedPresetConfigurationSchema.parse(configuration);
}

export function parsePresetConfiguration(
  value: string,
): ManagedPresetConfiguration {
  return managedPresetConfigurationSchema.parse(JSON.parse(value));
}

export function serializePresetConfiguration(
  configuration: ManagedPresetConfiguration,
): string {
  return JSON.stringify(managedPresetConfigurationSchema.parse(configuration));
}

/** Stable hash used to reject an idempotency key reused with another payload. */
export function hashPresetSetupInput(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
