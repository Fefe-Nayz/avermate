import { ORPCError } from "@orpc/server";
import { and, count, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import {
  customAverageEntries,
  customAverages,
  groupComparisons,
  groupInvitations,
  groupMemberships,
  periods,
  socialGroups,
  subjects,
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
  blocked,
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

async function groupAccess(groupId: string, userId: string) {
  const [row] = await db
    .select({ group: socialGroups, membership: groupMemberships })
    .from(socialGroups)
    .innerJoin(groupMemberships, eq(groupMemberships.groupId, socialGroups.id))
    .where(
      and(eq(socialGroups.id, groupId), eq(groupMemberships.userId, userId)),
    )
    .limit(1);
  if (!row) notFound("Group");
  return row;
}

function assertActive(group: typeof socialGroups.$inferSelect) {
  if (group.state !== "active") {
    throw new ORPCError("FORBIDDEN", {
      message: "This group is on an administrative hold",
    });
  }
}

function assertOwner(access: Awaited<ReturnType<typeof groupAccess>>) {
  if (access.membership.role !== "owner") {
    throw new ORPCError("FORBIDDEN", { message: "Group owner access required" });
  }
}

function flattenedSubjectCount(
  nodes: readonly ManagedPresetSubject[],
): number {
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
        kind: z.enum(["friends", "study", "class"]).default("friends"),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const [group] = await db
        .insert(socialGroups)
        .values({
          ownerUserId: userId,
          name: input.name,
          description: input.description,
          kind: input.kind,
        })
        .returning();
      if (!group) badRequest("The group could not be created");
      await db.insert(groupMemberships).values({
        groupId: group.id,
        userId,
        role: "owner",
      });
      await db
        .insert(groupComparisons)
        .values({ groupId: group.id, kind: "general", sortOrder: 0 });
      return { id: group.id };
    }),

  list: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const rows = await db
      .select({ group: socialGroups, membership: groupMemberships })
      .from(groupMemberships)
      .innerJoin(socialGroups, eq(socialGroups.id, groupMemberships.groupId))
      .where(eq(groupMemberships.userId, userId))
      .orderBy(desc(socialGroups.createdAt));
    return Promise.all(
      rows.map(async (row) => ({
        id: row.group.id,
        name: row.group.name,
        description: row.group.description,
        kind: row.group.kind,
        state: row.group.state,
        role: row.membership.role,
        shareAverage: row.membership.shareAverage,
        memberCount: await memberCountOf(row.group.id),
        createdAt: row.group.createdAt,
      })),
    );
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
      }));
      const figureOptions = {
        scopes,
        includeTrend: access.group.showTrend,
        includeGradeCount: access.group.showGradeCount,
      };
      const members = await Promise.all(
        memberships.map(async (row) => {
          const who = named.get(row.userId);
          const shares = !frozen && row.shareAverage;
          const academic =
            shares && scopes.length > 0
              ? await groupFigures(row.userId, figureOptions)
              : null;
          return {
            membershipId: row.id,
            userId: row.userId,
            name: who?.name ?? "",
            avatar: who?.avatar ?? null,
            handle: who?.handle ?? null,
            role: row.role,
            shareAverage: row.shareAverage,
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
        sharedSetupYearId: access.group.sharedSetupYearId,
        sharedSetup,
        /** The builder's editable draft; only the owner's screen loads it. */
        sharedSetupDraft:
          access.membership.role === "owner"
            ? parseSharedSetupConfig(access.group)
            : null,
        comparisons: comparisonRows.map((row) => ({
          id: row.id,
          kind: row.kind,
          subjectName: row.subjectName,
        })),
        availableSubjects,
        state: access.group.state,
        ownerUserId: access.group.ownerUserId,
        createdAt: access.group.createdAt,
        viewer: {
          membershipId: access.membership.id,
          role: access.membership.role,
          shareAverage: access.membership.shareAverage,
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
          subjectName: z.string().trim().min(1).max(100).optional(),
        }),
      )
      .handler(async ({ context, input }) => {
        const access = await groupAccess(
          input.groupId,
          context.session.user.id,
        );
        assertActive(access.group);
        assertOwner(access);
        if (input.kind === "subject" && !input.subjectName) {
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
              (row.subjectName ?? "").toLowerCase() ===
                (input.subjectName ?? "").toLowerCase()),
        );
        if (duplicate) badRequest("That comparison already exists");
        const [created] = await db
          .insert(groupComparisons)
          .values({
            groupId: input.groupId,
            kind: input.kind,
            subjectName:
              input.kind === "subject" ? (input.subjectName ?? null) : null,
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
        assertActive(access.group);
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
      assertActive(access.group);
      assertOwner(access);
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
                ...(input.sharedSetupConfig
                  ? { sharedSetupYearId: null }
                  : {}),
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
      await db.delete(socialGroups).where(eq(socialGroups.id, input.groupId));
      return { deleted: true };
    }),

  leave: protectedProcedure
    .input(z.object({ groupId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const access = await groupAccess(input.groupId, context.session.user.id);
      if (access.membership.role === "owner") {
        if ((await memberCountOf(input.groupId)) > 1) {
          badRequest(
            "Transfer or remove the other members first, or delete the group",
          );
        }
        await db
          .delete(socialGroups)
          .where(eq(socialGroups.id, input.groupId));
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
      await db
        .update(groupMemberships)
        .set({ shareAverage: input.shareAverage, updatedAt: new Date() })
        .where(eq(groupMemberships.id, access.membership.id));
      return { shareAverage: input.shareAverage };
    }),

  /**
   * Copy the group's common configuration — year settings, periods, the
   * subject tree, custom averages — into a fresh year of the caller's own.
   * Grades never travel, and nothing links back: adopting is a copy, so a
   * member owns their year completely afterwards.
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
      assertActive(access.group);
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
        const [created] = await db
          .insert(years)
          .values({
            name: input.name?.trim() || access.group.name,
            startsAt: own?.startsAt ?? septemberFirst,
            endsAt:
              own?.endsAt ??
              new Date(septemberFirst.getFullYear() + 1, 6, 1),
            scale: own?.scale ?? 20,
            defaultOutOf: own?.defaultOutOf ?? 20,
            passingRatio: own?.passingRatio ?? 0.5,
            decimals: own?.decimals ?? 2,
            userId,
          })
          .returning();
        if (!created) badRequest("The year could not be created");
        const materialized = materializePresetConfiguration(
          builderConfig,
          created.id,
          userId,
        );
        if (materialized.subjectRows.length > 0) {
          await db.insert(subjects).values(materialized.subjectRows);
        }
        if (materialized.averageRows.length > 0) {
          await db.insert(customAverages).values(materialized.averageRows);
        }
        if (materialized.entryRows.length > 0) {
          await db
            .insert(customAverageEntries)
            .values(materialized.entryRows);
        }
        return { yearId: created.id };
      }

      const [reference] = await db
        .select()
        .from(years)
        .where(eq(years.id, access.group.sharedSetupYearId ?? ""))
        .limit(1);
      if (!reference) notFound("Year");

      const [subjectRows, periodRows, averageRows] = await Promise.all([
        db.select().from(subjects).where(eq(subjects.yearId, reference.id)),
        db.select().from(periods).where(eq(periods.yearId, reference.id)),
        db
          .select()
          .from(customAverages)
          .where(eq(customAverages.yearId, reference.id)),
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

      const [created] = await db
        .insert(years)
        .values({
          name: input.name?.trim() || reference.name,
          startsAt: reference.startsAt,
          endsAt: reference.endsAt,
          scale: reference.scale,
          defaultOutOf: reference.defaultOutOf,
          passingRatio: reference.passingRatio,
          decimals: reference.decimals,
          userId,
        })
        .returning();
      if (!created) badRequest("The year could not be created");

      // Ids are drawn up front so parent links and average entries can be
      // remapped in one pass — the schema deliberately has no subject FK.
      const subjectIds = new Map(
        subjectRows.map((row) => [row.id, newId("sub")]),
      );
      if (subjectRows.length > 0) {
        await db.insert(subjects).values(
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
            yearId: created.id,
            userId,
          })),
        );
      }
      if (periodRows.length > 0) {
        await db.insert(periods).values(
          periodRows.map((row) => ({
            name: row.name,
            startAt: row.startAt,
            endAt: row.endAt,
            isCumulative: row.isCumulative,
            sortOrder: row.sortOrder,
            yearId: created.id,
            userId,
          })),
        );
      }
      for (const average of averageRows) {
        const [copied] = await db
          .insert(customAverages)
          .values({
            name: average.name,
            isMain: average.isMain,
            sortOrder: average.sortOrder,
            yearId: created.id,
            userId,
          })
          .returning({ id: customAverages.id });
        if (!copied) continue;
        const entries = entryRows.filter(
          (entry) =>
            entry.averageId === average.id && subjectIds.has(entry.subjectId),
        );
        if (entries.length > 0) {
          await db.insert(customAverageEntries).values(
            entries.map((entry) => ({
              averageId: copied.id,
              subjectId: subjectIds.get(entry.subjectId) as string,
              coefficient: entry.coefficient,
              includeChildren: entry.includeChildren,
            })),
          );
        }
      }
      return { yearId: created.id };
    }),

  removeMember: protectedProcedure
    .input(
      z.object({ groupId: z.string().min(1), membershipId: z.string().min(1) }),
    )
    .handler(async ({ context, input }) => {
      const access = await groupAccess(input.groupId, context.session.user.id);
      assertOwner(access);
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
      assertActive(access.group);
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
      return {
        group: {
          name: group.name,
          description: group.description,
          kind: group.kind,
          hasSharedSetup: Boolean(
            group.sharedSetupYearId || group.sharedSetupConfig,
          ),
          memberCount,
        },
        inviter: inviter
          ? { name: inviter.name, avatar: inviter.avatar }
          : null,
        alreadyMember: existing.length > 0,
        expiresAt: invitation.expiresAt,
      };
    }),

  accept: protectedProcedure
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
      if (await blocked(userId, group.ownerUserId)) notFound("Invitation");

      const [existing] = await db
        .select({ id: groupMemberships.id })
        .from(groupMemberships)
        .where(
          and(
            eq(groupMemberships.groupId, group.id),
            eq(groupMemberships.userId, userId),
          ),
        )
        .limit(1);
      if (existing) return { groupId: group.id, joined: false };

      await db.insert(groupMemberships).values({
        groupId: group.id,
        userId,
        role: "member",
      });
      await db
        .update(groupInvitations)
        .set({ useCount: invitation.useCount + 1 })
        .where(eq(groupInvitations.id, invitation.id));
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
      return { groupId: group.id, joined: true };
    }),
};
