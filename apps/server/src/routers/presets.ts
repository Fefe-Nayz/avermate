import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  customAverageEntries,
  customAverages,
  dashboardCardReferences,
  dashboardCards,
  grades,
  goals,
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
import {
  academicCardRows,
  academicYearInput,
  assertAcademicYearRange,
  PERIOD_TEMPLATES,
  periodRowsFor,
  periodTemplateIds,
} from "../lib/academic-setup";
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

export { PERIOD_TEMPLATES } from "../lib/academic-setup";
export type { PeriodTemplateId } from "../lib/academic-setup";

const presetMetadataInput = z.object({
  name: z.string().trim().min(1).max(96),
  description: z.string().trim().max(1000).default(""),
  tags: z.array(z.string().trim().min(1).max(32)).max(20).default([]),
  featured: z.boolean().default(false),
});

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

async function presetReplacementPlan(
  userId: string,
  year: Awaited<ReturnType<typeof requireYear>>,
  preset: Awaited<ReturnType<typeof currentPresetConfiguration>>,
) {
  const [existingSubjectRows, existingAverageRows] = await Promise.all([
    db.select().from(subjects).where(eq(subjects.yearId, year.id)),
    db.select().from(customAverages).where(eq(customAverages.yearId, year.id)),
  ]);
  const hasConfiguration =
    existingSubjectRows.length > 0 || existingAverageRows.length > 0;

  // Reapplying the same logical preset keeps stable IDs. Goals and dashboard
  // cards can therefore continue pointing at nodes that still exist.
  const canPreservePresetIds = year.presetId === preset.definition.id;
  const existingSubjectIds = canPreservePresetIds
    ? new Map(
        existingSubjectRows.flatMap((row) =>
          row.presetNodeKey ? [[row.presetNodeKey, row.id] as const] : [],
        ),
      )
    : new Map<string, string>();
  const existingAverageIds = canPreservePresetIds
    ? new Map(
        existingAverageRows.flatMap((row) =>
          row.presetNodeKey ? [[row.presetNodeKey, row.id] as const] : [],
        ),
      )
    : new Map<string, string>();
  const materialized = materializePresetConfiguration(
    preset.configuration,
    year.id,
    userId,
    existingSubjectIds,
    existingAverageIds,
  );
  const nextSubjectIds = new Set(
    materialized.subjectRows.map((row) => row.id as string),
  );
  const nextAverageIds = new Set(
    materialized.averageRows.map((row) => row.id as string),
  );
  const oldSubjectIds = new Set(existingSubjectRows.map((row) => row.id));
  const oldAverageIds = new Set(existingAverageRows.map((row) => row.id));
  const [yearGoals, yearCards, yearCardReferences] = hasConfiguration
    ? await Promise.all([
        db.select().from(goals).where(eq(goals.yearId, year.id)),
        db
          .select()
          .from(dashboardCards)
          .where(eq(dashboardCards.yearId, year.id)),
        db
          .select({
            cardId: dashboardCardReferences.cardId,
            kind: dashboardCardReferences.kind,
            referenceId: dashboardCardReferences.referenceId,
          })
          .from(dashboardCardReferences)
          .innerJoin(
            dashboardCards,
            eq(dashboardCards.id, dashboardCardReferences.cardId),
          )
          .where(eq(dashboardCards.yearId, year.id)),
      ])
    : [[], [], []];
  const targetWouldDisappear = (
    kind: string,
    referenceId: string | null,
  ): boolean => {
    if (!referenceId) return false;
    if (kind === "subject") {
      return oldSubjectIds.has(referenceId) && !nextSubjectIds.has(referenceId);
    }
    if (kind === "custom") {
      return oldAverageIds.has(referenceId) && !nextAverageIds.has(referenceId);
    }
    return false;
  };
  const referenceBlockers = [
    ...yearGoals
      .filter((goal) => targetWouldDisappear(goal.kind, goal.referenceId))
      .map((goal) => ({
        resource: "goal" as const,
        id: goal.id,
        label: goal.name,
        targetKind: goal.kind,
        targetId: goal.referenceId,
      })),
    ...yearCards
      .filter(
        (card) =>
          targetWouldDisappear(card.targetKind, card.targetId) ||
          yearCardReferences.some(
            (reference) =>
              reference.cardId === card.id &&
              targetWouldDisappear(
                reference.kind === "custom-average" ? "custom" : reference.kind,
                reference.referenceId,
              ),
          ),
      )
      .map((card) => ({
        resource: "dashboard_card" as const,
        id: card.id,
        label: card.title ?? card.metric,
        targetKind: card.targetKind,
        targetId: card.targetId,
      })),
  ];

  return {
    existingSubjectRows,
    existingAverageRows,
    hasConfiguration,
    materialized,
    referenceBlockers,
  };
}

async function applyManagedPreset(
  userId: string,
  yearId: string,
  presetId: string,
  replaceExisting: boolean,
) {
  const year = await requireYear(userId, yearId);
  const preset = await currentPresetConfiguration(presetId);
  const plan = await presetReplacementPlan(userId, year, preset);
  const {
    existingSubjectRows,
    existingAverageRows,
    hasConfiguration,
    materialized,
    referenceBlockers,
  } = plan;
  if (hasConfiguration && !replaceExisting) {
    badRequest(
      "This year already has a configuration; preview and explicitly reapply the preset instead",
    );
  }
  if (hasConfiguration && (await gradeCountForYear(yearId)) > 0) {
    badRequest("A preset can never replace subjects that already carry grades");
  }
  if (referenceBlockers.length > 0) {
    badRequest(
      "This preset replacement would invalidate goals or dashboard cards; retarget them before continuing",
    );
  }
  const existingSubjectIds = new Set(existingSubjectRows.map((row) => row.id));
  const existingAverageIds = new Set(existingAverageRows.map((row) => row.id));
  const nextSubjectIds = new Set(
    materialized.subjectRows.map((row) => row.id as string),
  );
  const nextAverageIds = new Set(
    materialized.averageRows.map((row) => row.id as string),
  );
  const removedSubjectIds = [...existingSubjectIds].filter(
    (id) => !nextSubjectIds.has(id),
  );
  const removedAverageIds = [...existingAverageIds].filter(
    (id) => !nextAverageIds.has(id),
  );
  const removeObsolete = [
    ...(removedAverageIds.length > 0
      ? [
          db
            .delete(customAverages)
            .where(inArray(customAverages.id, removedAverageIds)),
        ]
      : []),
    ...(removedSubjectIds.length > 0
      ? [db.delete(subjects).where(inArray(subjects.id, removedSubjectIds))]
      : []),
  ];
  const writeSubjects = materialized.subjectRows.map((row) =>
    existingSubjectIds.has(row.id as string)
      ? db
          .update(subjects)
          .set({
            name: row.name,
            shortName: row.shortName,
            parentId: row.parentId,
            coefficient: row.coefficient,
            kind: row.kind,
            isMain: row.isMain,
            sortOrder: row.sortOrder,
            presetNodeKey: row.presetNodeKey,
            updatedAt: new Date(),
          })
          .where(eq(subjects.id, row.id as string))
      : db.insert(subjects).values(row),
  );
  const writeAverages = materialized.averageRows.map((row) =>
    existingAverageIds.has(row.id as string)
      ? db
          .update(customAverages)
          .set({
            name: row.name,
            isMain: row.isMain,
            sortOrder: row.sortOrder,
            presetNodeKey: row.presetNodeKey,
            updatedAt: new Date(),
          })
          .where(eq(customAverages.id, row.id as string))
      : db.insert(customAverages).values(row),
  );
  const preservesStableIds =
    materialized.subjectRows.some((row) =>
      existingSubjectIds.has(row.id as string),
    ) ||
    materialized.averageRows.some((row) =>
      existingAverageIds.has(row.id as string),
    );
  const statements = [
    ...(existingAverageIds.size > 0
      ? [
          db
            .delete(customAverageEntries)
            .where(
              inArray(customAverageEntries.averageId, [...existingAverageIds]),
            ),
        ]
      : []),
    ...(!preservesStableIds ? removeObsolete : []),
    ...writeSubjects,
    ...writeAverages,
    ...(preservesStableIds ? removeObsolete : []),
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
      const userId = context.session.user.id;
      const [year, preset, gradeCount] = await Promise.all([
        requireYear(userId, input.yearId),
        currentPresetConfiguration(input.presetId),
        gradeCountForYear(input.yearId),
      ]);
      const plan = await presetReplacementPlan(userId, year, preset);
      return {
        existing: {
          subjects: plan.existingSubjectRows.length,
          averages: plan.existingAverageRows.length,
        },
        replacement: {
          subjects: subjectCount(preset.configuration),
          averages: preset.configuration.averages.length,
          version: preset.definition.currentVersion,
        },
        gradeCount,
        referenceBlockers: plan.referenceBlockers,
        canReplace: gradeCount === 0 && plan.referenceBlockers.length === 0,
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

  /** Resolve a possibly lost setup response without replaying the write. */
  setupYearStatus: protectedProcedure
    .input(
      z.object({
        idempotencyKey: z.string().trim().min(8).max(128),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const [request] = await db
        .select()
        .from(yearSetupRequests)
        .where(
          and(
            eq(yearSetupRequests.userId, userId),
            eq(yearSetupRequests.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (!request) return null;
      return { year: await requireYear(userId, request.yearId) };
    }),

  /**
   * Atomic, retry-safe first-run/additional-year setup. A failed batch leaves
   * neither a year nor an idempotency record, so the exact request can retry.
   */
  setupYear: protectedProcedure
    .input(
      z.object({
        idempotencyKey: z.string().trim().min(8).max(128),
        year: academicYearInput,
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
      assertAcademicYearRange(input.year.startsAt, input.year.endsAt);
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
        db.insert(dashboardCards).values(academicCardRows(userId, yearId)),
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

  /**
   * Lay an independently chosen period template over an existing year. This
   * remains independent from the managed curriculum preset (subjects and
   * custom averages), so choosing periods never detaches that membership.
   * Grades survive through SET NULL.
   */
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
