import { ORPCError } from "@orpc/server";
import { and, desc, eq, inArray, like, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  groupInvitations,
  groupMemberConsents,
  groupMemberships,
  groupRankingOptIns,
  socialAggregateCache,
  socialAuditEvents,
  socialEligibility,
  socialFeatureConsents,
  socialFeatureFlags,
  socialGroups,
  socialProfiles,
  socialReports,
  users,
} from "../db/schema";
import { adminIds } from "../lib/admin";
import { adminProcedure, badRequest, notFound } from "../lib/orpc";
import {
  SOCIAL_FEATURE_KEY,
  SOCIAL_POLICY_VERSION,
  hashOpaque,
} from "../lib/social-policy";
import { revokeSocialSharing } from "./social/revocation";

const reportStatusSchema = z.enum([
  "open",
  "investigating",
  "resolved",
  "dismissed",
]);
const reportPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);
const ageBandSchema = z.enum(["unknown", "under15", "15to17", "adult"]);

function changedKeys(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

async function assertAdminAssignee(userId: string | null | undefined) {
  if (!userId) return;
  const bootstrap = adminIds();
  const [assignee] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, userId),
        or(
          eq(users.role, "admin"),
          bootstrap.length > 0 ? inArray(users.id, bootstrap) : undefined,
        ),
      ),
    )
    .limit(1);
  if (!assignee) badRequest("The report assignee must be an administrator");
}

export const adminSocialRouter = {
  socialFeatureStatus: adminProcedure.handler(async () => {
    const [flag] = await db
      .select()
      .from(socialFeatureFlags)
      .where(eq(socialFeatureFlags.key, SOCIAL_FEATURE_KEY))
      .limit(1);
    return {
      key: SOCIAL_FEATURE_KEY,
      enabled: flag?.enabled ?? false,
      revision: flag?.revision ?? 0,
      changedAt: flag?.updatedAt ?? null,
    };
  }),

  setSocialFeatureEnabled: adminProcedure
    .input(
      z.object({
        enabled: z.boolean(),
        expectedRevision: z.number().int().min(0),
        reason: z.string().trim().min(10).max(500),
      }),
    )
    .handler(async ({ context, input }) => {
      const now = new Date();
      const result = await db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(socialFeatureFlags)
          .where(eq(socialFeatureFlags.key, SOCIAL_FEATURE_KEY))
          .limit(1);
        if (existing) {
          if (existing.revision !== input.expectedRevision) {
            throw new ORPCError("CONFLICT", {
              message: "The social feature flag changed",
            });
          }
          const rows = await tx
            .update(socialFeatureFlags)
            .set({
              enabled: input.enabled,
              changedByUserId: context.session.user.id,
              revision: sql`${socialFeatureFlags.revision} + 1`,
              updatedAt: now,
            })
            .where(
              and(
                eq(socialFeatureFlags.key, SOCIAL_FEATURE_KEY),
                eq(socialFeatureFlags.revision, input.expectedRevision),
              ),
            )
            .returning();
          if (rows.length !== 1)
            throw new ORPCError("CONFLICT", {
              message: "The social feature flag changed",
            });
        } else {
          if (input.expectedRevision !== 0)
            throw new ORPCError("CONFLICT", {
              message: "The social feature flag changed",
            });
          await tx.insert(socialFeatureFlags).values({
            key: SOCIAL_FEATURE_KEY,
            enabled: input.enabled,
            changedByUserId: context.session.user.id,
            createdAt: now,
            updatedAt: now,
          });
        }
        if (!input.enabled) await tx.delete(socialAggregateCache);
        await tx.insert(socialAuditEvents).values({
          actorUserId: context.session.user.id,
          action: input.enabled ? "feature.enabled" : "feature.disabled",
          entityType: "social_feature_flag",
          entityId: SOCIAL_FEATURE_KEY,
          changedKeys: JSON.stringify(["enabled", "reason"]),
          requestId: hashOpaque(input.reason),
        });
      });
      void result;
      return {
        key: SOCIAL_FEATURE_KEY,
        enabled: input.enabled,
        revision: input.expectedRevision + 1,
        changedAt: now,
      };
    }),

  socialOverview: adminProcedure.handler(async () => {
    const [profiles, groups, memberships, reports, ageBands] =
      await Promise.all([
        db
          .select({ key: socialProfiles.status, count: sql<number>`count(*)` })
          .from(socialProfiles)
          .groupBy(socialProfiles.status),
        db
          .select({ key: socialGroups.state, count: sql<number>`count(*)` })
          .from(socialGroups)
          .groupBy(socialGroups.state),
        db
          .select({ key: groupMemberships.state, count: sql<number>`count(*)` })
          .from(groupMemberships)
          .groupBy(groupMemberships.state),
        db
          .select({ key: socialReports.status, count: sql<number>`count(*)` })
          .from(socialReports)
          .groupBy(socialReports.status),
        db
          .select({
            key: socialEligibility.ageBand,
            count: sql<number>`count(*)`,
          })
          .from(socialEligibility)
          .groupBy(socialEligibility.ageBand),
      ]);
    return {
      profiles: Object.fromEntries(
        profiles.map((row) => [row.key, Number(row.count)]),
      ),
      groups: Object.fromEntries(
        groups.map((row) => [row.key, Number(row.count)]),
      ),
      memberships: Object.fromEntries(
        memberships.map((row) => [row.key, Number(row.count)]),
      ),
      reports: Object.fromEntries(
        reports.map((row) => [row.key, Number(row.count)]),
      ),
      ageBands: Object.fromEntries(
        ageBands.map((row) => [row.key, Number(row.count)]),
      ),
    };
  }),

  socialGroups: adminProcedure
    .input(
      z.object({
        state: z.enum(["active", "frozen", "archived", "all"]).default("all"),
        type: z.enum(["friends", "study_group", "class", "all"]).default("all"),
        search: z.string().trim().max(100).default(""),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .handler(async ({ input }) => {
      const filters = and(
        input.state === "all" ? undefined : eq(socialGroups.state, input.state),
        input.type === "all" ? undefined : eq(socialGroups.type, input.type),
        input.search ? like(socialGroups.name, `%${input.search}%`) : undefined,
      );
      const [rows, totals] = await Promise.all([
        db
          .select({
            group: socialGroups,
            ownerId: users.id,
            ownerName: users.name,
            ownerEmail: users.email,
            memberCount: sql<number>`(
              select count(*) from ${groupMemberships} gm
              where gm.groupId = ${socialGroups.id}
                and gm.state in ('active', 'consent_required')
            )`,
          })
          .from(socialGroups)
          .innerJoin(users, eq(users.id, socialGroups.ownerUserId))
          .where(filters)
          .orderBy(desc(socialGroups.updatedAt))
          .limit(input.limit)
          .offset(input.offset),
        db
          .select({ count: sql<number>`count(*)` })
          .from(socialGroups)
          .where(filters),
      ]);
      return {
        items: rows.map((row) => ({
          id: row.group.id,
          name: row.group.name,
          description: row.group.description,
          type: row.group.type,
          state: row.group.state,
          currentPolicyVersion: row.group.currentPolicyVersion,
          revision: row.group.revision,
          memberCount: Number(row.memberCount),
          classSelfDeclared: row.group.type === "class",
          owner: {
            id: row.ownerId,
            name: row.ownerName,
            email: row.ownerEmail,
          },
          createdAt: row.group.createdAt,
          updatedAt: row.group.updatedAt,
        })),
        total: Number(totals[0]?.count ?? 0),
        limit: input.limit,
        offset: input.offset,
      };
    }),

  freezeSocialGroup: adminProcedure
    .input(
      z.object({
        groupId: z.string().min(1),
        frozen: z.boolean(),
        expectedRevision: z.number().int().min(1),
        reason: z.string().trim().min(10).max(500),
      }),
    )
    .handler(async ({ context, input }) => {
      const now = new Date();
      const updated = await db.transaction(async (tx) => {
        const [group] = await tx
          .update(socialGroups)
          .set({
            state: input.frozen ? "frozen" : "active",
            revision: sql`${socialGroups.revision} + 1`,
            updatedAt: now,
          })
          .where(
            and(
              eq(socialGroups.id, input.groupId),
              eq(socialGroups.revision, input.expectedRevision),
              input.frozen
                ? ne(socialGroups.state, "archived")
                : eq(socialGroups.state, "frozen"),
            ),
          )
          .returning({
            id: socialGroups.id,
            state: socialGroups.state,
            revision: socialGroups.revision,
          });
        if (!group)
          throw new ORPCError("CONFLICT", {
            message: "The social group changed",
          });
        if (input.frozen) {
          await tx
            .update(groupMemberConsents)
            .set({ status: "withdrawn", withdrawnAt: now, updatedAt: now })
            .where(
              and(
                eq(groupMemberConsents.groupId, input.groupId),
                eq(groupMemberConsents.status, "accepted"),
              ),
            );
          await tx
            .update(groupMemberships)
            .set({
              state: "consent_required",
              sharedYearId: null,
              updatedAt: now,
            })
            .where(
              and(
                eq(groupMemberships.groupId, input.groupId),
                eq(groupMemberships.state, "active"),
              ),
            );
          await tx
            .update(groupRankingOptIns)
            .set({ enabled: false, updatedAt: now })
            .where(eq(groupRankingOptIns.groupId, input.groupId));
          await tx
            .update(groupInvitations)
            .set({ revokedAt: now })
            .where(
              and(
                eq(groupInvitations.groupId, input.groupId),
                sql`${groupInvitations.consumedAt} is null`,
                sql`${groupInvitations.revokedAt} is null`,
              ),
            );
        }
        await tx
          .delete(socialAggregateCache)
          .where(eq(socialAggregateCache.groupId, input.groupId));
        await tx.insert(socialAuditEvents).values({
          actorUserId: context.session.user.id,
          action: input.frozen ? "group.frozen" : "group.unfrozen",
          entityType: "social_group",
          entityId: input.groupId,
          changedKeys: JSON.stringify([
            "state",
            "reason",
            ...(input.frozen ? ["consents", "invitations"] : []),
          ]),
          requestId: hashOpaque(input.reason),
        });
        return group;
      });
      return updated;
    }),

  freezeSocialProfile: adminProcedure
    .input(
      z.object({
        userId: z.string().min(1),
        frozen: z.boolean(),
        reason: z.string().trim().min(10).max(500),
      }),
    )
    .handler(async ({ context, input }) => {
      const now = new Date();
      await db.transaction(async (tx) => {
        if (input.frozen) await revokeSocialSharing(tx, input.userId, now);
        const [profile] = await tx
          .update(socialProfiles)
          .set({
            status: input.frozen ? "frozen" : "off",
            discovery: "off",
            revision: sql`${socialProfiles.revision} + 1`,
            updatedAt: now,
          })
          .where(eq(socialProfiles.userId, input.userId))
          .returning({
            status: socialProfiles.status,
            revision: socialProfiles.revision,
          });
        if (!profile) notFound("Social profile");
        await tx.insert(socialAuditEvents).values({
          actorUserId: context.session.user.id,
          subjectUserId: input.userId,
          action: input.frozen ? "profile.frozen" : "profile.unfrozen",
          entityType: "social_profile",
          changedKeys: JSON.stringify(["status", "reason"]),
          requestId: hashOpaque(input.reason),
        });
      });
      return {
        ok: true,
        status: input.frozen ? ("frozen" as const) : ("off" as const),
      };
    }),

  socialReports: adminProcedure
    .input(
      z.object({
        statuses: z.array(reportStatusSchema).max(4).default([]),
        priorities: z.array(reportPrioritySchema).max(4).default([]),
        search: z.string().trim().max(100).default(""),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .handler(async ({ input }) => {
      const filters = and(
        input.statuses.length
          ? inArray(socialReports.status, input.statuses)
          : undefined,
        input.priorities.length
          ? inArray(socialReports.priority, input.priorities)
          : undefined,
        input.search
          ? like(socialReports.message, `%${input.search}%`)
          : undefined,
      );
      const [rows, totals] = await Promise.all([
        db
          .select({
            report: socialReports,
            reporterId: users.id,
            reporterName: users.name,
            reporterEmail: users.email,
          })
          .from(socialReports)
          .innerJoin(users, eq(users.id, socialReports.reporterUserId))
          .where(filters)
          .orderBy(
            sql`case ${socialReports.priority}
              when 'urgent' then 4 when 'high' then 3 when 'normal' then 2 else 1 end desc`,
            desc(socialReports.updatedAt),
          )
          .limit(input.limit)
          .offset(input.offset),
        db
          .select({ count: sql<number>`count(*)` })
          .from(socialReports)
          .where(filters),
      ]);
      return {
        items: rows.map((row) => ({
          id: row.report.id,
          category: row.report.category,
          message: row.report.message,
          status: row.report.status,
          priority: row.report.priority,
          assignedToUserId: row.report.assignedToUserId,
          groupId: row.report.groupId,
          hasTargetUser: Boolean(row.report.targetUserId),
          revision: row.report.revision,
          reporter: {
            id: row.reporterId,
            name: row.reporterName,
            email: row.reporterEmail,
          },
          createdAt: row.report.createdAt,
          updatedAt: row.report.updatedAt,
          resolvedAt: row.report.resolvedAt,
        })),
        total: Number(totals[0]?.count ?? 0),
        limit: input.limit,
        offset: input.offset,
      };
    }),

  socialReportDetail: adminProcedure
    .input(z.object({ reportId: z.string().min(1) }))
    .handler(async ({ input }) => {
      const [row] = await db
        .select({
          report: socialReports,
          reporterId: users.id,
          reporterName: users.name,
          reporterEmail: users.email,
        })
        .from(socialReports)
        .innerJoin(users, eq(users.id, socialReports.reporterUserId))
        .where(eq(socialReports.id, input.reportId))
        .limit(1);
      if (!row) notFound("Social report");
      const targetGroup = row.report.groupId
        ? await db
            .select({
              id: socialGroups.id,
              name: socialGroups.name,
              state: socialGroups.state,
              revision: socialGroups.revision,
            })
            .from(socialGroups)
            .where(eq(socialGroups.id, row.report.groupId))
            .limit(1)
            .then((groups) => groups[0] ?? null)
        : null;
      return {
        id: row.report.id,
        category: row.report.category,
        message: row.report.message,
        status: row.report.status,
        priority: row.report.priority,
        assignedToUserId: row.report.assignedToUserId,
        groupId: row.report.groupId,
        targetGroup,
        targetUserId: row.report.targetUserId,
        revision: row.report.revision,
        reporter: {
          id: row.reporterId,
          name: row.reporterName,
          email: row.reporterEmail,
        },
        createdAt: row.report.createdAt,
        updatedAt: row.report.updatedAt,
        resolvedAt: row.report.resolvedAt,
      };
    }),

  updateSocialReport: adminProcedure
    .input(
      z.object({
        reportId: z.string().min(1),
        expectedRevision: z.number().int().min(1),
        status: reportStatusSchema.optional(),
        priority: reportPrioritySchema.optional(),
        assignedToUserId: z.string().min(1).nullable().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      if (
        input.status === undefined &&
        input.priority === undefined &&
        input.assignedToUserId === undefined
      )
        badRequest("At least one report field must change");
      await assertAdminAssignee(input.assignedToUserId);
      const now = new Date();
      const changed = [
        ...(input.status !== undefined ? ["status"] : []),
        ...(input.priority !== undefined ? ["priority"] : []),
        ...(input.assignedToUserId !== undefined ? ["assignedToUserId"] : []),
      ];
      const [updated] = await db.transaction(async (tx) => {
        const rows = await tx
          .update(socialReports)
          .set({
            status: input.status,
            priority: input.priority,
            assignedToUserId: input.assignedToUserId,
            resolvedAt:
              input.status === undefined
                ? undefined
                : input.status === "resolved" || input.status === "dismissed"
                  ? now
                  : null,
            revision: sql`${socialReports.revision} + 1`,
            updatedAt: now,
          })
          .where(
            and(
              eq(socialReports.id, input.reportId),
              eq(socialReports.revision, input.expectedRevision),
            ),
          )
          .returning({
            id: socialReports.id,
            status: socialReports.status,
            priority: socialReports.priority,
            assignedToUserId: socialReports.assignedToUserId,
            revision: socialReports.revision,
          });
        if (rows.length !== 1)
          throw new ORPCError("CONFLICT", {
            message: "The social report changed",
          });
        await tx.insert(socialAuditEvents).values({
          actorUserId: context.session.user.id,
          action: "report.moderated",
          entityType: "social_report",
          entityId: input.reportId,
          changedKeys: JSON.stringify(changed),
        });
        return rows;
      });
      return updated;
    }),

  socialAudit: adminProcedure
    .input(
      z.object({
        action: z.string().trim().max(100).default(""),
        entityType: z.string().trim().max(100).default(""),
        limit: z.number().int().min(1).max(200).default(100),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .handler(async ({ input }) => {
      const filters = and(
        input.action ? eq(socialAuditEvents.action, input.action) : undefined,
        input.entityType
          ? eq(socialAuditEvents.entityType, input.entityType)
          : undefined,
      );
      const [events, totals] = await Promise.all([
        db
          .select({
            id: socialAuditEvents.id,
            actorUserId: socialAuditEvents.actorUserId,
            subjectUserId: socialAuditEvents.subjectUserId,
            action: socialAuditEvents.action,
            entityType: socialAuditEvents.entityType,
            entityId: socialAuditEvents.entityId,
            changedKeys: socialAuditEvents.changedKeys,
            requestId: socialAuditEvents.requestId,
            occurredAt: socialAuditEvents.occurredAt,
          })
          .from(socialAuditEvents)
          .where(filters)
          .orderBy(desc(socialAuditEvents.occurredAt))
          .limit(input.limit)
          .offset(input.offset),
        db
          .select({ count: sql<number>`count(*)` })
          .from(socialAuditEvents)
          .where(filters),
      ]);
      return {
        items: events.map((event) => ({
          ...event,
          changedKeys: changedKeys(event.changedKeys),
        })),
        total: Number(totals[0]?.count ?? 0),
        limit: input.limit,
        offset: input.offset,
      };
    }),

  reviewSocialAgeBand: adminProcedure
    .input(
      z.object({
        userId: z.string().min(1),
        ageBand: ageBandSchema,
        providerReference: z.string().trim().min(8).max(200),
        expiresAt: z.coerce.date(),
        reason: z.string().trim().min(10).max(500),
      }),
    )
    .handler(async ({ context, input }) => {
      if (input.expiresAt <= new Date())
        badRequest("Eligibility evidence must expire in the future");
      const now = new Date();
      const providerRef = hashOpaque(`eligibility:${input.providerReference}`);
      await db.transaction(async (tx) => {
        await revokeSocialSharing(tx, input.userId, now);
        await tx
          .insert(socialEligibility)
          .values({
            userId: input.userId,
            ageBand: input.ageBand,
            assuranceLevel:
              input.ageBand === "unknown" ? "none" : "trusted_provider",
            providerRef: input.ageBand === "unknown" ? null : providerRef,
            verifiedAt: input.ageBand === "unknown" ? null : now,
            expiresAt: input.ageBand === "unknown" ? null : input.expiresAt,
          })
          .onConflictDoUpdate({
            target: socialEligibility.userId,
            set: {
              ageBand: input.ageBand,
              assuranceLevel:
                input.ageBand === "unknown" ? "none" : "trusted_provider",
              providerRef: input.ageBand === "unknown" ? null : providerRef,
              verifiedAt: input.ageBand === "unknown" ? null : now,
              expiresAt: input.ageBand === "unknown" ? null : input.expiresAt,
              updatedAt: now,
            },
          });
        await tx.insert(socialAuditEvents).values({
          actorUserId: context.session.user.id,
          subjectUserId: input.userId,
          action: "eligibility.reviewed",
          entityType: "social_eligibility",
          entityId: input.userId,
          changedKeys: JSON.stringify([
            "ageBand",
            "assuranceLevel",
            "expiresAt",
            "reason",
          ]),
          requestId: hashOpaque(input.reason),
        });
      });
      return {
        ok: true,
        ageBand: input.ageBand,
        assuranceLevel:
          input.ageBand === "unknown"
            ? ("none" as const)
            : ("trusted_provider" as const),
      };
    }),

  verifySocialGuardian: adminProcedure
    .input(
      z.object({
        userId: z.string().min(1),
        providerReference: z.string().trim().min(8).max(200),
        expiresAt: z.coerce.date(),
        reason: z.string().trim().min(10).max(500),
      }),
    )
    .handler(async ({ context, input }) => {
      if (input.expiresAt <= new Date())
        badRequest("Guardian evidence must expire in the future");
      const now = new Date();
      const providerRef = hashOpaque(`guardian:${input.providerReference}`);
      await db.transaction(async (tx) => {
        const [eligibility] = await tx
          .select({ ageBand: socialEligibility.ageBand })
          .from(socialEligibility)
          .where(eq(socialEligibility.userId, input.userId))
          .limit(1);
        if (eligibility?.ageBand !== "under15")
          notFound("Under-15 eligibility");
        await tx
          .update(socialEligibility)
          .set({
            assuranceLevel: "trusted_provider",
            providerRef,
            verifiedAt: now,
            expiresAt: input.expiresAt,
            updatedAt: now,
          })
          .where(eq(socialEligibility.userId, input.userId));
        await tx.insert(socialFeatureConsents).values({
          userId: input.userId,
          policyVersion: SOCIAL_POLICY_VERSION,
          actorType: "guardian",
          event: "granted",
          guardianProviderRef: providerRef,
          channel: "admin_verified",
        });
        await tx.insert(socialAuditEvents).values({
          actorUserId: context.session.user.id,
          subjectUserId: input.userId,
          action: "guardian.provider_verified",
          entityType: "social_eligibility",
          entityId: input.userId,
          changedKeys: JSON.stringify([
            "assuranceLevel",
            "expiresAt",
            "reason",
          ]),
          requestId: hashOpaque(input.reason),
        });
      });
      return {
        ok: true,
        assuranceLevel: "trusted_provider" as const,
        expiresAt: input.expiresAt,
      };
    }),
};
