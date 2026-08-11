import { defaultCards } from "@avermate/core";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  customAverageEntries,
  customAverages,
  dashboardCards,
  grades,
  periods,
  presetDefinitions,
  presetVersions,
  subjects,
  yearPresetMemberships,
  yearSetupRequests,
  years,
} from "../db/schema";
import {
  hashPresetSetupInput,
  managedPresetConfigurationSchema,
  parsePresetConfiguration,
  serializePresetConfiguration,
} from "../data/managed-presets";
import type { ManagedPresetConfiguration } from "../data/preset-types";
import { newId } from "../lib/id";
import {
  adminProcedure,
  badRequest,
  notFound,
  protectedProcedure,
  publicProcedure,
} from "../lib/orpc";
import {
  ensurePresetCatalog,
  findPresetDefinition,
  findPresetVersion,
} from "../lib/preset-catalog";
import {
  detachYearPresetStatement,
  getYearPresetStatus,
  materializePresetConfiguration,
  synchronizeYearPreset,
} from "../lib/preset-membership";
import { requireYear } from "../lib/ownership";

/** Period templates remain independent from curriculum preset versioning. */
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

const periodTemplateIds = PERIOD_TEMPLATES.map((template) => template.id) as [
  PeriodTemplateId,
  ...PeriodTemplateId[],
];

const yearInput = z.object({
  name: z.string().trim().min(1).max(64),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  scale: z.number().positive().max(1000).default(20),
  defaultOutOf: z.number().positive().max(1000).default(20),
  passingRatio: z.number().min(0).max(1).default(0.5),
  decimals: z.number().int().min(0).max(4).default(2),
});

const presetMetadataInput = z.object({
  name: z.string().trim().min(1).max(96),
  description: z.string().trim().max(1000).default(""),
  tags: z.array(z.string().trim().min(1).max(32)).max(20).default([]),
  featured: z.boolean().default(false),
});

function at(from: Date, to: Date, fraction: number): Date {
  return new Date(from.getTime() + (to.getTime() - from.getTime()) * fraction);
}

function assertYearRange(startsAt: Date, endsAt: Date) {
  if (endsAt.getTime() <= startsAt.getTime()) {
    badRequest("The year must end after it starts");
  }
}

function parseTags(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((tag): tag is string => typeof tag === "string")
      : [];
  } catch {
    return [];
  }
}

function subjectCount(configuration: ManagedPresetConfiguration): number {
  return configuration.subjects.reduce(
    (count, subject) =>
      count + 1 + subjectCount({ subjects: subject.children, averages: [] }),
    0,
  );
}

function periodRowsFor(
  templateId: PeriodTemplateId,
  names: readonly string[],
  year: { id: string; startsAt: Date; endsAt: Date },
  userId: string,
) {
  const template = PERIOD_TEMPLATES.find(
    (candidate) => candidate.id === templateId,
  );
  if (!template) notFound("Period template");
  return template.periods.map((period, index) => ({
    name: names[index] ?? `Period ${index + 1}`,
    startAt: at(year.startsAt, year.endsAt, period.from),
    endAt: at(year.startsAt, year.endsAt, period.to),
    isCumulative: "isCumulative" in period ? period.isCumulative : false,
    sortOrder: index,
    yearId: year.id,
    userId,
  }));
}

function cardRowsFor(userId: string, yearId: string) {
  return defaultCards().map((card) => ({
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
    yearId,
    userId,
  }));
}

async function currentPresetConfiguration(presetId: string) {
  const definition = await findPresetDefinition(presetId);
  if (!definition || definition.archived) notFound("Preset");
  const version = await findPresetVersion(presetId, definition.currentVersion);
  if (!version) notFound("Preset version");
  return {
    definition,
    version,
    configuration: parsePresetConfiguration(version.configuration),
  };
}

async function gradeCountForYear(yearId: string): Promise<number> {
  return (
    await db
      .select({ id: grades.id })
      .from(grades)
      .where(eq(grades.yearId, yearId))
  ).length;
}

async function configurationCounts(yearId: string) {
  const [subjectRows, averageRows] = await Promise.all([
    db
      .select({ id: subjects.id })
      .from(subjects)
      .where(eq(subjects.yearId, yearId)),
    db
      .select({ id: customAverages.id })
      .from(customAverages)
      .where(eq(customAverages.yearId, yearId)),
  ]);
  return { subjects: subjectRows.length, averages: averageRows.length };
}

async function applyManagedPreset(
  userId: string,
  yearId: string,
  presetId: string,
  replaceExisting: boolean,
) {
  const year = await requireYear(userId, yearId);
  const preset = await currentPresetConfiguration(presetId);
  const existing = await configurationCounts(yearId);
  const hasConfiguration = existing.subjects > 0 || existing.averages > 0;
  if (hasConfiguration && !replaceExisting) {
    badRequest(
      "This year already has a configuration; preview and explicitly reapply the preset instead",
    );
  }
  if (hasConfiguration && (await gradeCountForYear(yearId)) > 0) {
    badRequest("A preset can never replace subjects that already carry grades");
  }

  const materialized = materializePresetConfiguration(
    preset.configuration,
    yearId,
    userId,
  );
  const statements = [
    ...(hasConfiguration
      ? [
          db.delete(customAverages).where(eq(customAverages.yearId, yearId)),
          db.delete(subjects).where(eq(subjects.yearId, yearId)),
        ]
      : []),
    db.insert(subjects).values(materialized.subjectRows),
    ...(materialized.averageRows.length > 0
      ? [db.insert(customAverages).values(materialized.averageRows)]
      : []),
    ...(materialized.entryRows.length > 0
      ? [db.insert(customAverageEntries).values(materialized.entryRows)]
      : []),
    db
      .insert(yearPresetMemberships)
      .values({
        yearId,
        presetId,
        appliedVersion: preset.definition.currentVersion,
        mode: "linked",
        userId,
      })
      .onConflictDoUpdate({
        target: yearPresetMemberships.yearId,
        set: {
          presetId,
          appliedVersion: preset.definition.currentVersion,
          mode: "linked",
          detachedReason: null,
          detachedAt: null,
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
        },
      }),
    db
      .update(years)
      .set({ presetId, updatedAt: new Date() })
      .where(eq(years.id, year.id)),
  ];
  await db.batch(
    statements as [
      (typeof statements)[number],
      ...(typeof statements)[number][],
    ],
  );
  return {
    subjects: materialized.subjectRows.length,
    averages: materialized.averageRows.length,
    version: preset.definition.currentVersion,
  };
}

export const presetsRouter = {
  list: publicProcedure.handler(async () => {
    await ensurePresetCatalog();
    const definitions = await db
      .select()
      .from(presetDefinitions)
      .where(eq(presetDefinitions.archived, false))
      .orderBy(asc(presetDefinitions.name));
    return Promise.all(
      definitions.map(async (definition) => {
        const version = await findPresetVersion(
          definition.id,
          definition.currentVersion,
        );
        if (!version) notFound("Preset version");
        const configuration = parsePresetConfiguration(version.configuration);
        return {
          id: definition.id,
          name: definition.name,
          description: definition.description,
          tags: parseTags(definition.tags),
          featured: definition.featured,
          version: definition.currentVersion,
          subjectCount: subjectCount(configuration),
          averageCount: configuration.averages.length,
        };
      }),
    );
  }),

  get: publicProcedure
    .input(z.object({ presetId: z.string() }))
    .handler(async ({ input }) => {
      const preset = await currentPresetConfiguration(input.presetId);
      return {
        id: preset.definition.id,
        name: preset.definition.name,
        description: preset.definition.description,
        tags: parseTags(preset.definition.tags),
        featured: preset.definition.featured,
        version: preset.definition.currentVersion,
        configuration: preset.configuration,
      };
    }),

  periodTemplates: publicProcedure.handler(() =>
    PERIOD_TEMPLATES.map((template) => ({
      id: template.id,
      periods: template.periods.map((period) => ({ ...period })),
    })),
  ),

  status: protectedProcedure
    .input(z.object({ yearId: z.string() }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const year = await requireYear(userId, input.yearId);
      let status = await getYearPresetStatus(userId, year.id);

      // Conservative one-time migration: old years keep every byte of data but
      // cannot be synchronized without stable node identities.
      if (status.state === "none" && year.presetId) {
        const definition = await findPresetDefinition(year.presetId);
        if (definition) {
          await db
            .insert(yearPresetMemberships)
            .values({
              yearId: year.id,
              presetId: definition.id,
              appliedVersion: 1,
              mode: "customized",
              detachedReason: "legacy_configuration",
              detachedAt: new Date(),
              userId,
            })
            .onConflictDoNothing({ target: yearPresetMemberships.yearId });
          status = await getYearPresetStatus(userId, year.id);
        }
      }
      return status;
    }),

  previewApply: protectedProcedure
    .input(z.object({ yearId: z.string(), presetId: z.string() }))
    .handler(async ({ context, input }) => {
      await requireYear(context.session.user.id, input.yearId);
      const [existing, preset, gradeCount] = await Promise.all([
        configurationCounts(input.yearId),
        currentPresetConfiguration(input.presetId),
        gradeCountForYear(input.yearId),
      ]);
      return {
        existing,
        replacement: {
          subjects: subjectCount(preset.configuration),
          averages: preset.configuration.averages.length,
          version: preset.definition.currentVersion,
        },
        gradeCount,
        canReplace: gradeCount === 0,
      };
    }),

  apply: protectedProcedure
    .input(
      z.object({
        yearId: z.string(),
        presetId: z.string(),
        replaceExisting: z.boolean().default(false),
      }),
    )
    .handler(({ context, input }) =>
      applyManagedPreset(
        context.session.user.id,
        input.yearId,
        input.presetId,
        input.replaceExisting,
      ),
    ),

  reapply: protectedProcedure
    .input(
      z.object({
        yearId: z.string(),
        presetId: z.string(),
        acknowledgeReplacement: z.literal(true),
      }),
    )
    .handler(({ context, input }) =>
      applyManagedPreset(
        context.session.user.id,
        input.yearId,
        input.presetId,
        true,
      ),
    ),

  synchronize: protectedProcedure
    .input(z.object({ yearId: z.string() }))
    .handler(async ({ context, input }) => {
      await requireYear(context.session.user.id, input.yearId);
      try {
        return await synchronizeYearPreset(
          context.session.user.id,
          input.yearId,
        );
      } catch (error) {
        badRequest(
          error instanceof Error ? error.message : "Preset update failed",
        );
      }
    }),

  detach: protectedProcedure
    .input(z.object({ yearId: z.string() }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await requireYear(userId, input.yearId);
      await detachYearPresetStatement(userId, input.yearId, "detached_by_user");
      return getYearPresetStatus(userId, input.yearId);
    }),

  /**
   * Atomic, retry-safe first-run/additional-year setup. A failed batch leaves
   * neither a year nor an idempotency record, so the exact request can retry.
   */
  setupYear: protectedProcedure
    .input(
      z.object({
        idempotencyKey: z.string().trim().min(8).max(128),
        year: yearInput,
        presetId: z.string().nullable().default(null),
        periodTemplateId: z.enum(periodTemplateIds).default("trimesters"),
        periodNames: z
          .array(z.string().trim().min(1).max(64))
          .max(12)
          .default([]),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      assertYearRange(input.year.startsAt, input.year.endsAt);
      const inputHash = hashPresetSetupInput(input);
      const [existing] = await db
        .select()
        .from(yearSetupRequests)
        .where(
          and(
            eq(yearSetupRequests.userId, userId),
            eq(yearSetupRequests.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) {
        if (existing.inputHash !== inputHash) {
          badRequest("This setup key was already used with different options");
        }
        return requireYear(userId, existing.yearId);
      }

      const preset = input.presetId
        ? await currentPresetConfiguration(input.presetId)
        : null;
      const yearId = newId("y");
      const materialized = preset
        ? materializePresetConfiguration(preset.configuration, yearId, userId)
        : null;
      const periodRows = periodRowsFor(
        input.periodTemplateId,
        input.periodNames,
        {
          id: yearId,
          startsAt: input.year.startsAt,
          endsAt: input.year.endsAt,
        },
        userId,
      );
      const statements = [
        db.insert(years).values({
          id: yearId,
          ...input.year,
          presetId: preset?.definition.id ?? null,
          userId,
        }),
        db.insert(dashboardCards).values(cardRowsFor(userId, yearId)),
        ...(periodRows.length > 0
          ? [db.insert(periods).values(periodRows)]
          : []),
        ...(materialized
          ? [db.insert(subjects).values(materialized.subjectRows)]
          : []),
        ...(materialized?.averageRows.length
          ? [db.insert(customAverages).values(materialized.averageRows)]
          : []),
        ...(materialized?.entryRows.length
          ? [db.insert(customAverageEntries).values(materialized.entryRows)]
          : []),
        ...(preset
          ? [
              db.insert(yearPresetMemberships).values({
                yearId,
                presetId: preset.definition.id,
                appliedVersion: preset.definition.currentVersion,
                mode: "linked",
                userId,
              }),
            ]
          : []),
        db.insert(yearSetupRequests).values({
          idempotencyKey: input.idempotencyKey,
          inputHash,
          yearId,
          userId,
        }),
      ];

      try {
        await db.batch(
          statements as [
            (typeof statements)[number],
            ...(typeof statements)[number][],
          ],
        );
      } catch (error) {
        // A concurrent retry may have won the unique-key race.
        const [winner] = await db
          .select()
          .from(yearSetupRequests)
          .where(
            and(
              eq(yearSetupRequests.userId, userId),
              eq(yearSetupRequests.idempotencyKey, input.idempotencyKey),
            ),
          )
          .limit(1);
        if (winner?.inputHash === inputHash)
          return requireYear(userId, winner.yearId);
        throw error;
      }
      return requireYear(userId, yearId);
    }),

  /** Lay periods over an existing year; grades survive through SET NULL. */
  applyPeriods: protectedProcedure
    .input(
      z.object({
        yearId: z.string(),
        templateId: z.enum(periodTemplateIds),
        names: z.array(z.string().trim().min(1).max(64)),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const year = await requireYear(userId, input.yearId);
      const rows = periodRowsFor(input.templateId, input.names, year, userId);
      const removeExisting = db
        .delete(periods)
        .where(eq(periods.yearId, year.id));
      if (rows.length === 0) {
        await removeExisting;
        return [];
      }
      await db.batch([removeExisting, db.insert(periods).values(rows)]);
      return db
        .select()
        .from(periods)
        .where(eq(periods.yearId, year.id))
        .orderBy(periods.sortOrder);
    }),

  admin: {
    list: adminProcedure.handler(async () => {
      await ensurePresetCatalog();
      const [definitions, memberships] = await Promise.all([
        db
          .select()
          .from(presetDefinitions)
          .orderBy(asc(presetDefinitions.name)),
        db.select().from(yearPresetMemberships),
      ]);
      return definitions.map((definition) => {
        const attached = memberships.filter(
          (membership) => membership.presetId === definition.id,
        );
        return {
          ...definition,
          tags: parseTags(definition.tags),
          adoption: {
            linked: attached.filter(
              (membership) => membership.mode === "linked",
            ).length,
            customized: attached.filter(
              (membership) => membership.mode === "customized",
            ).length,
            updateAvailable: attached.filter(
              (membership) =>
                membership.mode === "linked" &&
                membership.appliedVersion < definition.currentVersion,
            ).length,
          },
        };
      });
    }),

    get: adminProcedure
      .input(z.object({ presetId: z.string() }))
      .handler(async ({ input }) => {
        const definition = await findPresetDefinition(input.presetId);
        if (!definition) notFound("Preset");
        const versions = await db
          .select()
          .from(presetVersions)
          .where(eq(presetVersions.presetId, input.presetId))
          .orderBy(asc(presetVersions.version));
        return {
          ...definition,
          tags: parseTags(definition.tags),
          versions: versions.map((version) => ({
            ...version,
            configuration: parsePresetConfiguration(version.configuration),
          })),
        };
      }),

    create: adminProcedure
      .input(
        presetMetadataInput.extend({
          id: z
            .string()
            .trim()
            .min(3)
            .max(80)
            .regex(/^[a-zA-Z0-9_-]+$/),
          configuration: managedPresetConfigurationSchema,
        }),
      )
      .handler(async ({ context, input }) => {
        await ensurePresetCatalog();
        const { configuration, tags, ...definition } = input;
        const statements = [
          db.insert(presetDefinitions).values({
            ...definition,
            tags: JSON.stringify(tags),
            currentVersion: 1,
            createdByUserId: context.session.user.id,
          }),
          db.insert(presetVersions).values({
            presetId: input.id,
            version: 1,
            configuration: serializePresetConfiguration(configuration),
            changeNote: "Initial version",
            createdByUserId: context.session.user.id,
          }),
        ];
        await db.batch(
          statements as [
            (typeof statements)[number],
            ...(typeof statements)[number][],
          ],
        );
        return findPresetDefinition(input.id);
      }),

    publish: adminProcedure
      .input(
        presetMetadataInput.extend({
          presetId: z.string(),
          configuration: managedPresetConfigurationSchema,
          changeNote: z.string().trim().min(1).max(500),
        }),
      )
      .handler(async ({ context, input }) => {
        const existing = await findPresetDefinition(input.presetId);
        if (!existing) notFound("Preset");
        const version = existing.currentVersion + 1;
        const statements = [
          db.insert(presetVersions).values({
            presetId: existing.id,
            version,
            configuration: serializePresetConfiguration(input.configuration),
            changeNote: input.changeNote,
            createdByUserId: context.session.user.id,
          }),
          db
            .update(presetDefinitions)
            .set({
              name: input.name,
              description: input.description,
              tags: JSON.stringify(input.tags),
              featured: input.featured,
              currentVersion: version,
              updatedAt: new Date(),
            })
            .where(eq(presetDefinitions.id, existing.id)),
        ];
        await db.batch(
          statements as [
            (typeof statements)[number],
            ...(typeof statements)[number][],
          ],
        );
        return { presetId: existing.id, version };
      }),

    archive: adminProcedure
      .input(z.object({ presetId: z.string(), archived: z.boolean() }))
      .handler(async ({ input }) => {
        const existing = await findPresetDefinition(input.presetId);
        if (!existing) notFound("Preset");
        const [updated] = await db
          .update(presetDefinitions)
          .set({ archived: input.archived, updatedAt: new Date() })
          .where(eq(presetDefinitions.id, input.presetId))
          .returning();
        return updated;
      }),
  },
};
