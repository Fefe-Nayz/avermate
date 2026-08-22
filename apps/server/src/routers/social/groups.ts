import { ORPCError } from "@orpc/server";
import { and, count, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import {
  customAverageEntries,
  customAverages,
  dashboardCards,
  gradeTypes,
  groupComparisons,
  groupInvitations,
  groupMemberships,
  periods,
  socialGroups,
  subjects,
  yearPresetMemberships,
  years,
} from "../../db/schema";
import {
  managedPresetConfigurationSchema,
  parsePresetConfiguration,
  serializePresetConfiguration,
} from "../../data/managed-presets";
import type {
  ManagedPresetConfiguration,
  ManagedPresetSubject,
} from "../../data/preset-types";
import {
  academicCardRows,
  academicPeriodsInput,
  academicYearInput,
  assertAcademicYearRange,
  periodRowsForSetup,
} from "../../lib/academic-setup";
import {
  buildClassTemplate,
  classTemplateSubjects,
  classTemplateSummary,
  classYearInsertStatements,
  classYearStatus,
  classYearStatuses,
  compatibleClassYears,
  parseClassTemplate,
  serializeClassTemplate,
  snapshotClassTemplate,
} from "../../lib/class-template";
import { newId } from "../../lib/id";
import { materializePresetConfiguration } from "../../lib/preset-membership";
import {
  findPresetDefinition,
  findPresetVersion,
} from "../../lib/preset-catalog";
import { badRequest, notFound, protectedProcedure } from "../../lib/orpc";
import {
  GROUP_INVITATION_TTL_MS,
  hashOpaque,
  issueOpaqueToken,
} from "../../lib/social-policy";
import {
  assertActiveGroup,
  blocked,
  groupAccess,
  groupFigures,
  identities,
  identity,
  notify,
  resolveSharedYear,
  ensureProfile,
} from "./shared";

const comparisonKindSchema = z.enum([
  "general",
  "subject",
  "median",
  "passRate",
  "goalProgress",
]);

const invitationYearSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("existing"), yearId: z.string().min(1) }),
  z.object({
    mode: z.literal("copy"),
    name: z.string().trim().min(1).max(100).optional(),
  }),
]);

const classCreationTemplateSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("year"), yearId: z.string().min(1) }),
  z.object({
    mode: z.literal("builder"),
    year: academicYearInput,
    presetId: z.string().min(1).nullable().default(null),
    configuration: managedPresetConfigurationSchema,
    periods: academicPeriodsInput,
  }),
]);

/**
 * The subject names an owner can point a comparison at: the template year's
 * if the group has one, otherwise the owner's own shared year. Names, never
 * ids — comparisons match every member's tree by name.
 */
async function comparableSubjectNames(
  group: typeof socialGroups.$inferSelect,
): Promise<string[]> {
  const config = parseSharedSetupConfig(group);
  if (config) {
    return [...new Set(configSubjectNames(config.subjects))].sort((a, b) =>
      a.localeCompare(b),
    );
  }
  let yearId = group.sharedSetupYearId;
  if (!yearId) {
    const profile = await ensureProfile(group.ownerUserId);
    const year = await resolveSharedYear(
      group.ownerUserId,
      profile.sharedYearId,
    );
    yearId = year?.id ?? null;
  }
  if (!yearId) return [];
  const rows = await db
    .select({ name: subjects.name, kind: subjects.kind })
    .from(subjects)
    .where(eq(subjects.yearId, yearId));
  return [...new Set(rows.map((row) => row.name))].sort((a, b) =>
    a.localeCompare(b),
  );
}

/**
 * A group is a named room whose members compare general averages. Joining
 * is one link, sharing is one switch, and the leaderboard shows everyone
 * who left the switch on — real values, no minimum head-count.
 */

const nameSchema = z.string().trim().min(2).max(100);
const descriptionSchema = z.string().trim().max(500);

function assertOwner(access: Awaited<ReturnType<typeof groupAccess>>) {
  if (access.membership.role !== "owner") {
    throw new ORPCError("FORBIDDEN", {
      message: "Group owner access required",
    });
  }
}

function flattenedSubjectCount(nodes: readonly ManagedPresetSubject[]): number {
  return nodes.reduce(
    (total, node) => total + 1 + flattenedSubjectCount(node.children),
    0,
  );
}

function configSubjectNames(nodes: readonly ManagedPresetSubject[]): string[] {
  return nodes.flatMap((node) => [
    node.name,
    ...configSubjectNames(node.children),
  ]);
}

function parseSharedSetupConfig(
  group: typeof socialGroups.$inferSelect,
): ManagedPresetConfiguration | null {
  if (!group.sharedSetupConfig) return null;
  try {
    return parsePresetConfiguration(group.sharedSetupConfig);
  } catch {
    return null;
  }
}

/** What the common configuration contains, for the join/adopt cards. */
async function sharedSetupSummary(group: typeof socialGroups.$inferSelect) {
  const config = parseSharedSetupConfig(group);
  if (config) {
    return {
      source: "builder" as const,
      yearName: null,
      scale: null,
      subjectCount: flattenedSubjectCount(config.subjects),
      averageCount: config.averages.length,
      gradeTypeCount: config.gradeTypes.length,
      periodCount: 0,
    };
  }
  if (!group.sharedSetupYearId) return null;
  const [year] = await db
    .select()
    .from(years)
    .where(eq(years.id, group.sharedSetupYearId))
    .limit(1);
  if (!year) return null;
  const [subjectRows, averageRows, periodRows] = await Promise.all([
    db
      .select({ value: count() })
      .from(subjects)
      .where(eq(subjects.yearId, year.id)),
    db
      .select({ value: count() })
      .from(customAverages)
      .where(eq(customAverages.yearId, year.id)),
    db
      .select({ value: count() })
      .from(periods)
      .where(eq(periods.yearId, year.id)),
  ]);
  return {
    source: "year" as const,
    yearName: year.name,
    scale: year.scale,
    subjectCount: subjectRows[0]?.value ?? 0,
    averageCount: averageRows[0]?.value ?? 0,
    periodCount: periodRows[0]?.value ?? 0,
  };
}

async function memberCountOf(groupId: string) {
  const [row] = await db
    .select({ value: count() })
    .from(groupMemberships)
    .where(eq(groupMemberships.groupId, groupId));
  return row?.value ?? 0;
}

export const socialGroupsRouter = {
  create: protectedProcedure
    .input(
      z.object({
        name: nameSchema,
        description: descriptionSchema.default(""),
        template: classCreationTemplateSchema,
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      if (input.template.mode === "year") {
        const template = await snapshotClassTemplate(
          userId,
          input.template.yearId,
        );
        if (!template) {
          badRequest(
            "The template year must belong to you and contain subjects",
          );
        }
        const groupId = newId("sg");
        await db.batch([
          db.insert(socialGroups).values({
            id: groupId,
            ownerUserId: userId,
            name: input.name,
            description: input.description,
            kind: "class",
            classTemplate: serializeClassTemplate(template),
          }),
          db.insert(groupMemberships).values({
            groupId,
            userId,
            role: "owner",
            yearId: input.template.yearId,
            shareAverage: false,
          }),
          db
            .insert(groupComparisons)
            .values({ groupId, kind: "general", sortOrder: 0 }),
        ]);
        return { id: groupId, yearId: input.template.yearId };
      }

      assertAcademicYearRange(
        input.template.year.startsAt,
        input.template.year.endsAt,
      );
      const presetDefinition = input.template.presetId
        ? await findPresetDefinition(input.template.presetId)
        : null;
      if (
        input.template.presetId &&
        (!presetDefinition || presetDefinition.archived)
      ) {
        notFound("Preset");
      }
      const presetVersion = presetDefinition
        ? await findPresetVersion(
            presetDefinition.id,
            presetDefinition.currentVersion,
          )
        : null;
      if (presetDefinition && !presetVersion) notFound("Preset version");
      const presetConfiguration = presetVersion
        ? parsePresetConfiguration(presetVersion.configuration)
        : null;
      const remainsPresetLinked = Boolean(
        presetDefinition &&
        presetConfiguration &&
        JSON.stringify(presetConfiguration) ===
          JSON.stringify(input.template.configuration),
      );

      const groupId = newId("sg");
      const yearId = newId("y");
      const periodRows = periodRowsForSetup(
        input.template.periods,
        { id: yearId, ...input.template.year },
        userId,
      );
      const materialized = materializePresetConfiguration(
        input.template.configuration,
        yearId,
        userId,
      );
      const template = buildClassTemplate({
        year: input.template.year,
        periods: periodRows,
        configuration: input.template.configuration,
        source:
          remainsPresetLinked && presetDefinition
            ? {
                kind: "preset",
                presetId: presetDefinition.id,
                presetVersion: presetDefinition.currentVersion,
              }
            : { kind: "custom", yearId },
      });
      const statements = [
        db.insert(years).values({
          id: yearId,
          ...input.template.year,
          presetId: remainsPresetLinked ? presetDefinition?.id : null,
          userId,
        }),
        db.insert(dashboardCards).values(academicCardRows(userId, yearId)),
        ...(periodRows.length ? [db.insert(periods).values(periodRows)] : []),
        db.insert(subjects).values(materialized.subjectRows),
        ...(materialized.averageRows.length
          ? [db.insert(customAverages).values(materialized.averageRows)]
          : []),
        ...(materialized.entryRows.length
          ? [db.insert(customAverageEntries).values(materialized.entryRows)]
          : []),
        // The owner's own year has to *be* the template, types included — otherwise the
        // first status check reads their year as incompatible with the class they made.
        ...(materialized.gradeTypeRows.length
          ? [db.insert(gradeTypes).values(materialized.gradeTypeRows)]
          : []),
        ...(remainsPresetLinked && presetDefinition
          ? [
              db.insert(yearPresetMemberships).values({
                yearId,
                presetId: presetDefinition.id,
                appliedVersion: presetDefinition.currentVersion,
                mode: "linked",
                userId,
              }),
            ]
          : []),
        db.insert(socialGroups).values({
          id: groupId,
          ownerUserId: userId,
          name: input.name,
          description: input.description,
          kind: "class",
          classTemplate: serializeClassTemplate(template),
        }),
        db.insert(groupMemberships).values({
          groupId,
          userId,
          role: "owner",
          yearId,
          shareAverage: false,
        }),
        db
          .insert(groupComparisons)
          .values({ groupId, kind: "general", sortOrder: 0 }),
      ];
      await db.batch(
        statements as [
          (typeof statements)[number],
          ...(typeof statements)[number][],
        ],
      );
      return { id: groupId, yearId };
    }),

  list: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const rows = await db
      .select({ group: socialGroups, membership: groupMemberships })
      .from(groupMemberships)
      .innerJoin(socialGroups, eq(socialGroups.id, groupMemberships.groupId))
      .where(eq(groupMemberships.userId, userId))
      .orderBy(desc(socialGroups.createdAt));
    // One batched status pass, one year-name lookup and one grouped count
    // for the whole list — this handler used to fan out per group.
    const templates = rows.map((row) =>
      parseClassTemplate(row.group.classTemplate),
    );
    const statuses = await classYearStatuses(
      rows.map((row, index) => ({
        userId,
        yearId: row.membership.yearId,
        template: templates[index] ?? null,
      })),
    );
    const linkedYearIds = [
      ...new Set(
        rows.flatMap((row) =>
          row.membership.yearId ? [row.membership.yearId] : [],
        ),
      ),
    ];
    const yearNameRows =
      linkedYearIds.length === 0
        ? []
        : await db
            .select({ id: years.id, name: years.name })
            .from(years)
            .where(
              and(inArray(years.id, linkedYearIds), eq(years.userId, userId)),
            );
    const yearNames = new Map(yearNameRows.map((row) => [row.id, row.name]));
    const groupIds = rows.map((row) => row.group.id);
    const countRows =
      groupIds.length === 0
        ? []
        : await db
            .select({ groupId: groupMemberships.groupId, value: count() })
            .from(groupMemberships)
            .where(inArray(groupMemberships.groupId, groupIds))
            .groupBy(groupMemberships.groupId);
    const memberCounts = new Map(
      countRows.map((row) => [row.groupId, row.value]),
    );

    return rows.map((row, index) => ({
      id: row.group.id,
      name: row.group.name,
      description: row.group.description,
      kind: row.group.kind,
      state: row.group.state,
      role: row.membership.role,
      shareAverage: row.membership.shareAverage,
      setupRequired: !templates[index],
      yearStatus: statuses[index] as NonNullable<(typeof statuses)[number]>,
      linkedYearName: row.membership.yearId
        ? (yearNames.get(row.membership.yearId) ?? null)
        : null,
      memberCount: memberCounts.get(row.group.id) ?? 0,
      createdAt: row.group.createdAt,
    }));
  }),

  get: protectedProcedure
    .input(z.object({ groupId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const access = await groupAccess(input.groupId, userId);
      const memberships = await db
        .select()
        .from(groupMemberships)
        .where(eq(groupMemberships.groupId, input.groupId))
        .orderBy(groupMemberships.createdAt);
      const named = await identities(memberships.map((row) => row.userId));

      const frozen = access.group.state !== "active";
      const classTemplate = parseClassTemplate(access.group.classTemplate);
      const [sharedSetup, comparisonRows, availableSubjects] =
        await Promise.all([
          sharedSetupSummary(access.group),
          db
            .select()
            .from(groupComparisons)
            .where(eq(groupComparisons.groupId, input.groupId))
            .orderBy(groupComparisons.sortOrder, groupComparisons.createdAt),
          comparableSubjectNames(access.group),
        ]);
      const scopes = comparisonRows.map((row) => ({
        id: row.id,
        kind: row.kind,
        subjectName: row.subjectName,
        subjectKey: row.subjectKey,
      }));
      const figureOptions = {
        scopes,
        includeTrend: access.group.showTrend,
        includeGradeCount: access.group.showGradeCount,
      };
      // One batched status pass for every member instead of a five-query
      // fan-out per member.
      const memberStatuses = await classYearStatuses(
        memberships.map((row) => ({
          userId: row.userId,
          yearId: row.yearId,
          template: classTemplate,
        })),
      );
      const members = await Promise.all(
        memberships.map(async (row, index) => {
          const who = named.get(row.userId);
          const yearStatus = memberStatuses[index] as NonNullable<
            (typeof memberStatuses)[number]
          >;
          const shares =
            !frozen && row.shareAverage && yearStatus === "connected";
          const academic =
            shares && scopes.length > 0 && row.yearId
              ? await groupFigures(row.userId, row.yearId, figureOptions)
              : null;
          return {
            membershipId: row.id,
            userId: row.userId,
            name: who?.name ?? "",
            avatar: who?.avatar ?? null,
            handle: who?.handle ?? null,
            role: row.role,
            shareAverage: row.shareAverage,
            yearStatus,
            joinedAt: row.createdAt,
            scale: academic?.scale ?? null,
            decimals: academic?.decimals ?? null,
            figures: academic?.figures ?? [],
          };
        }),
      );

      const sharingCount = members.filter(
        (member) => member.figures.length > 0,
      ).length;

      return {
        id: access.group.id,
        name: access.group.name,
        description: access.group.description,
        kind: access.group.kind,
        showTrend: access.group.showTrend,
        showGradeCount: access.group.showGradeCount,
        // Whether members may put this comparison on their own dashboards. Read here so
        // the owner's screen can show the switch; changed through its own route.
        cohortEnabled: access.group.cohortEnabled,
        sharedSetupYearId: access.group.sharedSetupYearId,
        sharedSetup,
        setupRequired: !classTemplate,
        classTemplate: classTemplate
          ? classTemplateSummary(classTemplate)
          : null,
        compatibleYears: await compatibleClassYears(userId, classTemplate),
        /** The builder's editable draft; only the owner's screen loads it. */
        sharedSetupDraft:
          access.membership.role === "owner"
            ? parseSharedSetupConfig(access.group)
            : null,
        comparisons: comparisonRows.map((row) => ({
          id: row.id,
          kind: row.kind,
          subjectName: row.subjectName,
          subjectKey: row.subjectKey,
        })),
        availableSubjects,
        availableSubjectOptions: classTemplate
          ? classTemplateSubjects(classTemplate)
          : [],
        state: access.group.state,
        ownerUserId: access.group.ownerUserId,
        createdAt: access.group.createdAt,
        viewer: {
          membershipId: access.membership.id,
          role: access.membership.role,
          shareAverage: access.membership.shareAverage,
          yearId: access.membership.yearId,
          yearStatus: await classYearStatus(
            userId,
            access.membership.yearId,
            classTemplate,
          ),
        },
        members,
        sharingCount,
      };
    }),

  comparisons: {
    /** Owner adds a board: a metric, or a subject matched by name. */
    add: protectedProcedure
      .input(
        z.object({
          groupId: z.string().min(1),
          kind: comparisonKindSchema,
          subjectKey: z.string().trim().min(1).max(128).optional(),
          subjectName: z.string().trim().min(1).max(100).optional(),
        }),
      )
      .handler(async ({ context, input }) => {
        const access = await groupAccess(
          input.groupId,
          context.session.user.id,
        );
        assertActiveGroup(access.group);
        assertOwner(access);
        const template = parseClassTemplate(access.group.classTemplate);
        let subjectName = input.subjectName ?? null;
        let subjectKey = input.subjectKey ?? null;
        if (template) {
          if (input.kind !== "general" && input.kind !== "subject") {
            badRequest("Classes only compare general and subject averages");
          }
          if (input.kind === "subject") {
            const subject = classTemplateSubjects(template).find(
              (candidate) => candidate.key === input.subjectKey,
            );
            if (!subject)
              badRequest("Choose a subject from the class template");
            subjectKey = subject.key;
            subjectName = subject.name;
          }
        } else if (input.kind === "subject" && !input.subjectName) {
          badRequest("A subject comparison needs a subject name");
        }
        const existing = await db
          .select()
          .from(groupComparisons)
          .where(eq(groupComparisons.groupId, input.groupId));
        if (existing.length >= 8) {
          badRequest("Eight comparisons is the ceiling");
        }
        const duplicate = existing.some(
          (row) =>
            row.kind === input.kind &&
            (input.kind !== "subject" ||
              (subjectKey
                ? row.subjectKey === subjectKey
                : (row.subjectName ?? "").toLowerCase() ===
                  (subjectName ?? "").toLowerCase())),
        );
        if (duplicate) badRequest("That comparison already exists");
        const [created] = await db
          .insert(groupComparisons)
          .values({
            groupId: input.groupId,
            kind: input.kind,
            subjectName: input.kind === "subject" ? subjectName : null,
            subjectKey: input.kind === "subject" ? subjectKey : null,
            sortOrder: existing.length,
          })
          .returning({ id: groupComparisons.id });
        return { id: created?.id ?? null };
      }),

    remove: protectedProcedure
      .input(
        z.object({
          groupId: z.string().min(1),
          comparisonId: z.string().min(1),
        }),
      )
      .handler(async ({ context, input }) => {
        const access = await groupAccess(
          input.groupId,
          context.session.user.id,
        );
        assertActiveGroup(access.group);
        assertOwner(access);
        const [deleted] = await db
          .delete(groupComparisons)
          .where(
            and(
              eq(groupComparisons.id, input.comparisonId),
              eq(groupComparisons.groupId, input.groupId),
            ),
          )
          .returning({ id: groupComparisons.id });
        if (!deleted) notFound("Comparison");
        return { removed: true };
      }),
  },

  /** Configure one preserved legacy group as a class exactly once. */
  configureClass: protectedProcedure
    .input(
      z.object({
        groupId: z.string().min(1),
        templateYearId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const access = await groupAccess(input.groupId, userId);
      assertActiveGroup(access.group);
      assertOwner(access);
      if (parseClassTemplate(access.group.classTemplate)) {
        badRequest("This class already has an academic template");
      }
      const template = await snapshotClassTemplate(
        userId,
        input.templateYearId,
      );
      if (!template) {
        badRequest("The template year must belong to you and contain subjects");
      }
      await db.batch([
        db
          .update(socialGroups)
          .set({
            kind: "class",
            classTemplate: serializeClassTemplate(template),
            updatedAt: new Date(),
          })
          .where(eq(socialGroups.id, input.groupId)),
        db
          .update(groupMemberships)
          .set({
            yearId: input.templateYearId,
            shareAverage: false,
            updatedAt: new Date(),
          })
          .where(eq(groupMemberships.id, access.membership.id)),
        db
          .update(groupMemberships)
          .set({ shareAverage: false, updatedAt: new Date() })
          .where(eq(groupMemberships.groupId, input.groupId)),
        db
          .delete(groupComparisons)
          .where(eq(groupComparisons.groupId, input.groupId)),
        db
          .insert(groupComparisons)
          .values({ groupId: input.groupId, kind: "general", sortOrder: 0 }),
      ]);
      return { configured: true };
    }),

  selectYear: protectedProcedure
    .input(z.object({ groupId: z.string().min(1), yearId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const access = await groupAccess(input.groupId, userId);
      assertActiveGroup(access.group);
      const template = parseClassTemplate(access.group.classTemplate);
      if (!template) badRequest("This class still needs an academic template");
      if (
        (await classYearStatus(userId, input.yearId, template)) !== "connected"
      ) {
        badRequest("This year is not compatible with the class template");
      }
      await db
        .update(groupMemberships)
        .set({
          yearId: input.yearId,
          shareAverage: false,
          updatedAt: new Date(),
        })
        .where(eq(groupMemberships.id, access.membership.id));
      return { yearId: input.yearId };
    }),

  update: protectedProcedure
    .input(
      z.object({
        groupId: z.string().min(1),
        name: nameSchema.optional(),
        description: descriptionSchema.optional(),
        kind: z.enum(["friends", "study", "class"]).optional(),
        showTrend: z.boolean().optional(),
        showGradeCount: z.boolean().optional(),
        sharedSetupYearId: z.string().min(1).nullable().optional(),
        sharedSetupConfig: managedPresetConfigurationSchema
          .nullable()
          .optional(),
        /** Copies the curated preset's current version into the group. */
        sharedSetupFromPresetId: z.string().min(1).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const access = await groupAccess(input.groupId, context.session.user.id);
      assertActiveGroup(access.group);
      assertOwner(access);
      if (
        parseClassTemplate(access.group.classTemplate) &&
        (input.kind !== undefined ||
          input.sharedSetupYearId !== undefined ||
          input.sharedSetupConfig !== undefined ||
          input.sharedSetupFromPresetId !== undefined)
      ) {
        badRequest("A class academic template cannot be changed");
      }
      let presetConfig: string | undefined;
      if (input.sharedSetupFromPresetId) {
        const definition = await findPresetDefinition(
          input.sharedSetupFromPresetId,
        );
        if (!definition || definition.archived) notFound("Preset");
        const version = await findPresetVersion(
          definition.id,
          definition.currentVersion,
        );
        if (!version) notFound("Preset");
        // Stored as a snapshot the builder can edit afterwards — one
        // materialisation path, no version subscriptions.
        presetConfig = version.configuration;
      }
      if (input.sharedSetupYearId) {
        const [owned] = await db
          .select({ id: years.id })
          .from(years)
          .where(
            and(
              eq(years.id, input.sharedSetupYearId),
              eq(years.userId, context.session.user.id),
            ),
          )
          .limit(1);
        if (!owned) notFound("Year");
      }
      await db
        .update(socialGroups)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          ...(input.kind !== undefined ? { kind: input.kind } : {}),
          ...(input.showTrend !== undefined
            ? { showTrend: input.showTrend }
            : {}),
          ...(input.showGradeCount !== undefined
            ? { showGradeCount: input.showGradeCount }
            : {}),
          // The three template sources are exclusive: choosing one clears
          // the others.
          ...(input.sharedSetupYearId !== undefined
            ? {
                sharedSetupYearId: input.sharedSetupYearId,
                ...(input.sharedSetupYearId ? { sharedSetupConfig: null } : {}),
              }
            : {}),
          ...(input.sharedSetupConfig !== undefined
            ? {
                sharedSetupConfig: input.sharedSetupConfig
                  ? serializePresetConfiguration(input.sharedSetupConfig)
                  : null,
                ...(input.sharedSetupConfig ? { sharedSetupYearId: null } : {}),
              }
            : {}),
          ...(presetConfig !== undefined
            ? { sharedSetupConfig: presetConfig, sharedSetupYearId: null }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(socialGroups.id, input.groupId));
      return { updated: true };
    }),

  delete: protectedProcedure
    .input(z.object({ groupId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const access = await groupAccess(input.groupId, context.session.user.id);
      assertOwner(access);
      // A frozen group is an administrative hold: the reported owner must
      // not be able to destroy the evidence while moderation looks at it.
      assertActiveGroup(access.group);
      await db.delete(socialGroups).where(eq(socialGroups.id, input.groupId));
      return { deleted: true };
    }),

  leave: protectedProcedure
    .input(z.object({ groupId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const access = await groupAccess(input.groupId, context.session.user.id);
      if (access.membership.role === "owner") {
        if ((await memberCountOf(input.groupId)) > 1) {
          badRequest("Remove the other members first, or delete the group");
        }
        // Owner-leave of an empty group deletes it, so the moderation hold
        // applies here exactly as it does to delete.
        assertActiveGroup(access.group);
        await db.delete(socialGroups).where(eq(socialGroups.id, input.groupId));
        return { left: true };
      }
      await db
        .delete(groupMemberships)
        .where(eq(groupMemberships.id, access.membership.id));
      return { left: true };
    }),

  setSharing: protectedProcedure
    .input(z.object({ groupId: z.string().min(1), shareAverage: z.boolean() }))
    .handler(async ({ context, input }) => {
      const access = await groupAccess(input.groupId, context.session.user.id);
      if (input.shareAverage && access.group.kind === "class") {
        const template = parseClassTemplate(access.group.classTemplate);
        if (
          !template ||
          (await classYearStatus(
            context.session.user.id,
            access.membership.yearId,
            template,
          )) !== "connected"
        ) {
          badRequest("Connect a compatible year before sharing class results");
        }
      }
      await db
        .update(groupMemberships)
        .set({ shareAverage: input.shareAverage, updatedAt: new Date() })
        .where(eq(groupMemberships.id, access.membership.id));
      return { shareAverage: input.shareAverage };
    }),

  /**
   * Copy the group's common configuration — year settings, periods, the
   * subject tree, custom averages — into a fresh year of the caller's own.
   * Grades never travel. A class membership records the new year explicitly;
   * the copied academic data remains independently owned by the member.
   */
  adoptSetup: protectedProcedure
    .input(
      z.object({
        groupId: z.string().min(1),
        name: z.string().trim().min(1).max(100).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const access = await groupAccess(input.groupId, userId);
      assertActiveGroup(access.group);
      const classTemplate = parseClassTemplate(access.group.classTemplate);
      if (classTemplate) {
        const copy = classYearInsertStatements({
          userId,
          template: classTemplate,
          name: input.name,
        });
        const statements = [
          ...copy.statements,
          db
            .update(groupMemberships)
            .set({
              yearId: copy.yearId,
              shareAverage: false,
              updatedAt: new Date(),
            })
            .where(eq(groupMemberships.id, access.membership.id)),
        ];
        await db.batch(
          statements as [
            (typeof statements)[number],
            ...(typeof statements)[number][],
          ],
        );
        return { yearId: copy.yearId };
      }
      const builderConfig = parseSharedSetupConfig(access.group);
      if (!access.group.sharedSetupYearId && !builderConfig) {
        badRequest("This group has no common configuration");
      }

      if (builderConfig) {
        // A built configuration has no dates or scale of its own, so those
        // come from the adopter's current year when there is one.
        const profile = await ensureProfile(userId);
        const own = await resolveSharedYear(userId, profile.sharedYearId);
        const now = new Date();
        const septemberFirst = new Date(
          now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1,
          8,
          1,
        );
        // The year id is drawn up front so the whole adoption — year,
        // subjects, averages, entries and the membership repoint — commits
        // as one batch instead of a trail of partial writes.
        const yearId = newId("y");
        const materialized = materializePresetConfiguration(
          builderConfig,
          yearId,
          userId,
        );
        const statements = [
          db.insert(years).values({
            id: yearId,
            name: input.name?.trim() || access.group.name,
            startsAt: own?.startsAt ?? septemberFirst,
            endsAt:
              own?.endsAt ?? new Date(septemberFirst.getFullYear() + 1, 6, 1),
            scale: own?.scale ?? 20,
            defaultOutOf: own?.defaultOutOf ?? 20,
            passingRatio: own?.passingRatio ?? 0.5,
            decimals: own?.decimals ?? 2,
            userId,
          }),
          ...(materialized.subjectRows.length > 0
            ? [db.insert(subjects).values(materialized.subjectRows)]
            : []),
          ...(materialized.averageRows.length > 0
            ? [db.insert(customAverages).values(materialized.averageRows)]
            : []),
          ...(materialized.entryRows.length > 0
            ? [db.insert(customAverageEntries).values(materialized.entryRows)]
            : []),
          ...(materialized.gradeTypeRows.length > 0
            ? [db.insert(gradeTypes).values(materialized.gradeTypeRows)]
            : []),
          db
            .update(groupMemberships)
            .set({ yearId, shareAverage: false, updatedAt: new Date() })
            .where(eq(groupMemberships.id, access.membership.id)),
        ];
        await db.batch(
          statements as [
            (typeof statements)[number],
            ...(typeof statements)[number][],
          ],
        );
        return { yearId };
      }

      const [reference] = await db
        .select()
        .from(years)
        .where(eq(years.id, access.group.sharedSetupYearId ?? ""))
        .limit(1);
      if (!reference) notFound("Year");

      const [subjectRows, periodRows, averageRows, gradeTypeRows] =
        await Promise.all([
          db.select().from(subjects).where(eq(subjects.yearId, reference.id)),
          db.select().from(periods).where(eq(periods.yearId, reference.id)),
          db
            .select()
            .from(customAverages)
            .where(eq(customAverages.yearId, reference.id)),
          db
            .select()
            .from(gradeTypes)
            .where(eq(gradeTypes.yearId, reference.id)),
        ]);
      const entryRows =
        averageRows.length === 0
          ? []
          : await db
              .select()
              .from(customAverageEntries)
              .where(
                inArray(
                  customAverageEntries.averageId,
                  averageRows.map((row) => row.id),
                ),
              );

      // Ids are drawn up front so parent links and average entries can be
      // remapped in one pass — the schema deliberately has no subject FK —
      // and so the whole copy plus the membership repoint commits as one
      // batch instead of a trail of partial writes.
      const yearId = newId("y");
      const subjectIds = new Map(
        subjectRows.map((row) => [row.id, newId("sub")]),
      );
      const averageIds = new Map(
        averageRows.map((row) => [row.id, newId("avg")]),
      );
      const copiedEntryRows = entryRows.flatMap((entry) => {
        const averageId = averageIds.get(entry.averageId);
        const subjectId = subjectIds.get(entry.subjectId);
        if (!averageId || !subjectId) return [];
        return [
          {
            averageId,
            subjectId,
            coefficient: entry.coefficient,
            includeChildren: entry.includeChildren,
          },
        ];
      });
      const statements = [
        db.insert(years).values({
          id: yearId,
          name: input.name?.trim() || reference.name,
          startsAt: reference.startsAt,
          endsAt: reference.endsAt,
          scale: reference.scale,
          defaultOutOf: reference.defaultOutOf,
          passingRatio: reference.passingRatio,
          decimals: reference.decimals,
          userId,
        }),
        ...(subjectRows.length > 0
          ? [
              db.insert(subjects).values(
                subjectRows.map((row) => ({
                  id: subjectIds.get(row.id),
                  name: row.name,
                  shortName: row.shortName,
                  parentId: row.parentId
                    ? (subjectIds.get(row.parentId) ?? null)
                    : null,
                  coefficient: row.coefficient,
                  kind: row.kind,
                  isMain: row.isMain,
                  sortOrder: row.sortOrder,
                  yearId,
                  userId,
                })),
              ),
            ]
          : []),
        ...(periodRows.length > 0
          ? [
              db.insert(periods).values(
                periodRows.map((row) => ({
                  name: row.name,
                  startAt: row.startAt,
                  endAt: row.endAt,
                  isCumulative: row.isCumulative,
                  sortOrder: row.sortOrder,
                  yearId,
                  userId,
                })),
              ),
            ]
          : []),
        ...(averageRows.length > 0
          ? [
              db.insert(customAverages).values(
                averageRows.map((row) => ({
                  id: averageIds.get(row.id),
                  name: row.name,
                  isMain: false,
                  sortOrder: row.sortOrder,
                  yearId,
                  userId,
                })),
              ),
            ]
          : []),
        ...(copiedEntryRows.length > 0
          ? [db.insert(customAverageEntries).values(copiedEntryRows)]
          : []),
        // The kinds of assessment travel with the shape of the year: the copy is what
        // somebody writes their own results into, and a template that fills nothing in
        // is half the year. The results themselves never travel, so nothing points at
        // these yet.
        ...(gradeTypeRows.length > 0
          ? [
              db.insert(gradeTypes).values(
                gradeTypeRows.map((row) => ({
                  name: row.name,
                  titlePrefix: row.titlePrefix,
                  coefficient: row.coefficient,
                  outOf: row.outOf,
                  accent: row.accent,
                  sortOrder: row.sortOrder,
                  yearId,
                  userId,
                })),
              ),
            ]
          : []),
        db
          .update(groupMemberships)
          .set({ yearId, shareAverage: false, updatedAt: new Date() })
          .where(eq(groupMemberships.id, access.membership.id)),
      ];
      await db.batch(
        statements as [
          (typeof statements)[number],
          ...(typeof statements)[number][],
        ],
      );
      return { yearId };
    }),

  removeMember: protectedProcedure
    .input(
      z.object({ groupId: z.string().min(1), membershipId: z.string().min(1) }),
    )
    .handler(async ({ context, input }) => {
      const access = await groupAccess(input.groupId, context.session.user.id);
      assertOwner(access);
      // Members are part of what moderation is looking at; a frozen group
      // keeps them. Each member remains free to leave on their own.
      assertActiveGroup(access.group);
      if (input.membershipId === access.membership.id) {
        badRequest("Use leave or delete for your own membership");
      }
      const [removed] = await db
        .delete(groupMemberships)
        .where(
          and(
            eq(groupMemberships.id, input.membershipId),
            eq(groupMemberships.groupId, input.groupId),
          ),
        )
        .returning({ userId: groupMemberships.userId });
      if (!removed) notFound("Member");
      await notify({
        userId: removed.userId,
        actorUserId: context.session.user.id,
        kind: "group_removed",
        entityType: "group",
        entityId: input.groupId,
        safeParams: { groupName: access.group.name },
      });
      return { removed: true };
    }),
};

export const socialGroupInvitationsRouter = {
  create: protectedProcedure
    .input(z.object({ groupId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const access = await groupAccess(input.groupId, userId);
      assertActiveGroup(access.group);
      assertOwner(access);
      if (!parseClassTemplate(access.group.classTemplate)) {
        badRequest("Configure the class before inviting members");
      }
      const { token, tokenHash, tokenPrefix } = issueOpaqueToken();
      const expiresAt = new Date(Date.now() + GROUP_INVITATION_TTL_MS);
      const [invitation] = await db
        .insert(groupInvitations)
        .values({
          groupId: input.groupId,
          createdByUserId: userId,
          tokenHash,
          tokenPrefix,
          expiresAt,
        })
        .returning();
      if (!invitation) badRequest("The invitation could not be created");
      return { id: invitation.id, token, tokenPrefix, expiresAt };
    }),

  list: protectedProcedure
    .input(z.object({ groupId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const access = await groupAccess(input.groupId, context.session.user.id);
      assertOwner(access);
      const rows = await db
        .select()
        .from(groupInvitations)
        .where(
          and(
            eq(groupInvitations.groupId, input.groupId),
            eq(groupInvitations.createdByUserId, access.group.ownerUserId),
            isNull(groupInvitations.revokedAt),
            gt(groupInvitations.expiresAt, new Date()),
          ),
        )
        .orderBy(desc(groupInvitations.createdAt));
      const named = await identities(rows.map((row) => row.createdByUserId));
      return rows.map((row) => ({
        id: row.id,
        tokenPrefix: row.tokenPrefix,
        expiresAt: row.expiresAt,
        useCount: row.useCount,
        createdAt: row.createdAt,
        createdBy: named.get(row.createdByUserId)?.name ?? "",
      }));
    }),

  revoke: protectedProcedure
    .input(
      z.object({ groupId: z.string().min(1), invitationId: z.string().min(1) }),
    )
    .handler(async ({ context, input }) => {
      const access = await groupAccess(input.groupId, context.session.user.id);
      assertOwner(access);
      const [updated] = await db
        .update(groupInvitations)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(groupInvitations.id, input.invitationId),
            eq(groupInvitations.groupId, input.groupId),
            isNull(groupInvitations.revokedAt),
          ),
        )
        .returning({ id: groupInvitations.id });
      if (!updated) notFound("Invitation");
      return { revoked: true };
    }),

  preview: protectedProcedure
    .input(z.object({ token: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const [invitation] = await db
        .select()
        .from(groupInvitations)
        .where(eq(groupInvitations.tokenHash, hashOpaque(input.token)))
        .limit(1);
      if (
        !invitation ||
        invitation.revokedAt ||
        invitation.expiresAt < new Date()
      ) {
        notFound("Invitation");
      }
      const [group] = await db
        .select()
        .from(socialGroups)
        .where(eq(socialGroups.id, invitation.groupId))
        .limit(1);
      if (!group || group.state !== "active") notFound("Invitation");
      if (invitation.createdByUserId !== group.ownerUserId) {
        notFound("Invitation");
      }
      if (await blocked(userId, group.ownerUserId)) notFound("Invitation");
      const [inviter, memberCount, existing] = await Promise.all([
        identity(invitation.createdByUserId),
        memberCountOf(group.id),
        db
          .select({ id: groupMemberships.id })
          .from(groupMemberships)
          .where(
            and(
              eq(groupMemberships.groupId, group.id),
              eq(groupMemberships.userId, userId),
            ),
          )
          .limit(1),
      ]);
      const template = parseClassTemplate(group.classTemplate);
      return {
        group: {
          name: group.name,
          description: group.description,
          kind: group.kind,
          hasSharedSetup: Boolean(
            group.sharedSetupYearId || group.sharedSetupConfig,
          ),
          setupRequired: !template,
          classTemplate: template ? classTemplateSummary(template) : null,
          memberCount,
        },
        inviter: inviter
          ? { name: inviter.name, avatar: inviter.avatar }
          : null,
        alreadyMember: existing.length > 0,
        compatibleYears: await compatibleClassYears(userId, template),
        expiresAt: invitation.expiresAt,
      };
    }),

  accept: protectedProcedure
    .input(
      z.object({
        token: z.string().min(1),
        year: invitationYearSchema,
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const [invitation] = await db
        .select()
        .from(groupInvitations)
        .where(eq(groupInvitations.tokenHash, hashOpaque(input.token)))
        .limit(1);
      if (
        !invitation ||
        invitation.revokedAt ||
        invitation.expiresAt < new Date()
      ) {
        notFound("Invitation");
      }
      const [group] = await db
        .select()
        .from(socialGroups)
        .where(eq(socialGroups.id, invitation.groupId))
        .limit(1);
      if (!group || group.state !== "active") notFound("Invitation");
      if (invitation.createdByUserId !== group.ownerUserId) {
        notFound("Invitation");
      }
      if (await blocked(userId, group.ownerUserId)) notFound("Invitation");

      const [existing] = await db
        .select({ id: groupMemberships.id, yearId: groupMemberships.yearId })
        .from(groupMemberships)
        .where(
          and(
            eq(groupMemberships.groupId, group.id),
            eq(groupMemberships.userId, userId),
          ),
        )
        .limit(1);
      if (existing) {
        return {
          groupId: group.id,
          joined: false,
          yearId: existing.yearId,
        };
      }

      const template = parseClassTemplate(group.classTemplate);
      if (!template) badRequest("This class still needs an academic template");
      const choice = input.year;
      let yearId: string | null = null;
      let copyStatements: ReturnType<
        typeof classYearInsertStatements
      >["statements"] = [];
      if (choice.mode === "existing") {
        if (
          !template ||
          (await classYearStatus(userId, choice.yearId, template)) !==
            "connected"
        ) {
          badRequest("This year is not compatible with the class template");
        }
        yearId = choice.yearId;
      } else if (choice.mode === "copy") {
        if (!template)
          badRequest("This class still needs an academic template");
        const copy = classYearInsertStatements({
          userId,
          template,
          name: choice.name,
        });
        yearId = copy.yearId;
        copyStatements = copy.statements;
      }

      const statements = [
        ...copyStatements,
        db.insert(groupMemberships).values({
          groupId: group.id,
          userId,
          role: "member",
          yearId,
          shareAverage: false,
        }),
        db
          .update(groupInvitations)
          .set({ useCount: invitation.useCount + 1 })
          .where(eq(groupInvitations.id, invitation.id)),
      ];
      await db.batch(
        statements as [
          (typeof statements)[number],
          ...(typeof statements)[number][],
        ],
      );
      if (group.ownerUserId !== userId) {
        await notify({
          userId: group.ownerUserId,
          actorUserId: userId,
          kind: "group_joined",
          entityType: "group",
          entityId: group.id,
          safeParams: { groupName: group.name },
        });
      }
      return { groupId: group.id, joined: true, yearId };
    }),
};
