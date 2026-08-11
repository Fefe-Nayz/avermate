import { ORPCError } from "@orpc/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import {
  goals,
  grades,
  groupMemberConsentFields,
  groupMemberConsents,
  groupMemberships,
  groupPolicyFields,
  groupPolicyVersions,
  socialAggregateCache,
  socialGroups,
  subjects,
  years,
  type SocialMetric,
} from "../../db/schema";
import { notFound } from "../../lib/orpc";
import {
  SOCIAL_METRICS,
  deriveAcademicMetrics,
  type GroupPolicyInput,
} from "../../lib/social-policy";
import { assertSocialAccess, blocked, eligibilityView } from "./shared";

export const socialMetricSchema = z.enum(SOCIAL_METRICS);
export const policyFieldSchema = z
  .object({
    fieldKey: socialMetricSchema,
    required: z.boolean().default(false),
    exposure: z.enum(["aggregate_only", "member_visible", "ranking"]),
  })
  .refine(
    (field) =>
      field.exposure !== "ranking" ||
      ["normalizedAverage", "median", "genericGoalProgress"].includes(
        field.fieldKey,
      ),
    { message: "Only numeric derived metrics can be ranked" },
  );

export const groupPolicyInputSchema = z.object({
  purpose: z.string().trim().min(10).max(500),
  audienceDescription: z.string().trim().min(3).max(240),
  window: z.enum(["current_academic_year", "last_90_days", "last_30_days"]),
  rankingsEnabled: z.boolean().default(false),
  fields: z
    .array(policyFieldSchema)
    .min(1)
    .max(SOCIAL_METRICS.length)
    .superRefine((fields, context) => {
      const seen = new Set<string>();
      fields.forEach((field, index) => {
        if (seen.has(field.fieldKey)) {
          context.addIssue({
            code: "custom",
            path: [index, "fieldKey"],
            message: "Each metric may appear only once",
          });
        }
        seen.add(field.fieldKey);
      });
    }),
});

export async function groupAccess(
  groupId: string,
  userId: string,
  options: { allowIneligible?: boolean } = {},
) {
  if (!options.allowIneligible) await assertSocialAccess(userId);
  const [row] = await db
    .select({ group: socialGroups, membership: groupMemberships })
    .from(socialGroups)
    .innerJoin(groupMemberships, eq(groupMemberships.groupId, socialGroups.id))
    .where(
      and(
        eq(socialGroups.id, groupId),
        eq(groupMemberships.userId, userId),
        inArray(groupMemberships.state, ["active", "consent_required"]),
      ),
    )
    .limit(1);
  if (!row) notFound("Group");
  return row;
}

export function assertGroupOperational(
  access: Awaited<ReturnType<typeof groupAccess>>,
) {
  if (access.group.state !== "active") {
    throw new ORPCError("FORBIDDEN", {
      message: "This group is not currently active",
    });
  }
}

export function assertOwner(access: Awaited<ReturnType<typeof groupAccess>>) {
  assertGroupOperational(access);
  if (
    access.group.ownerUserId !== access.membership.userId ||
    access.membership.role !== "owner" ||
    access.membership.state !== "active"
  ) {
    throw new ORPCError("FORBIDDEN", {
      message: "Group owner access required",
    });
  }
}

export function assertManager(access: Awaited<ReturnType<typeof groupAccess>>) {
  assertGroupOperational(access);
  if (
    access.membership.state !== "active" ||
    (access.membership.role !== "owner" &&
      access.membership.role !== "moderator")
  ) {
    throw new ORPCError("FORBIDDEN", {
      message: "Group manager access required",
    });
  }
}

export async function currentPolicy(groupId: string, version: number) {
  const [policy] = await db
    .select()
    .from(groupPolicyVersions)
    .where(
      and(
        eq(groupPolicyVersions.groupId, groupId),
        eq(groupPolicyVersions.version, version),
      ),
    )
    .limit(1);
  if (!policy) notFound("Group policy");
  const fields = await db
    .select({
      fieldKey: groupPolicyFields.fieldKey,
      required: groupPolicyFields.required,
      exposure: groupPolicyFields.exposure,
    })
    .from(groupPolicyFields)
    .where(eq(groupPolicyFields.policyVersionId, policy.id))
    .orderBy(asc(groupPolicyFields.fieldKey));
  return { policy, fields };
}

export function policyDto(policy: Awaited<ReturnType<typeof currentPolicy>>) {
  return {
    id: policy.policy.id,
    version: policy.policy.version,
    purpose: policy.policy.purpose,
    audienceDescription: policy.policy.audienceDescription,
    window: policy.policy.window,
    digest: policy.policy.digest,
    rankingsEnabled: policy.policy.rankingsEnabled,
    createdAt: policy.policy.createdAt,
    fields: policy.fields,
  };
}

export function groupDto(
  group: typeof socialGroups.$inferSelect,
  membership: typeof groupMemberships.$inferSelect,
  memberCount: number,
) {
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    type: group.type,
    classAuthority:
      group.type === "class"
        ? {
            mode: "self_declared" as const,
            declarationVersion: group.classDeclarationVersion,
            declaredAt: group.classDeclaredAt,
          }
        : null,
    state: group.state,
    currentPolicyVersion: group.currentPolicyVersion,
    revision: group.revision,
    role: membership.role,
    membershipState: membership.state,
    membershipId: membership.id,
    memberCount,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  };
}

export async function assertOwnedYear(userId: string, yearId: string) {
  const [year] = await db
    .select()
    .from(years)
    .where(and(eq(years.id, yearId), eq(years.userId, userId)))
    .limit(1);
  if (!year) notFound("Year");
  return year;
}

export async function metricProjection(input: {
  membership: typeof groupMemberships.$inferSelect;
  policy: Awaited<ReturnType<typeof currentPolicy>>;
  metric: SocialMetric;
}) {
  if (!input.membership.sharedYearId) {
    return { metric: input.metric, numeric: null, band: "insufficient_data" };
  }
  const [year] = await db
    .select()
    .from(years)
    .where(
      and(
        eq(years.id, input.membership.sharedYearId),
        eq(years.userId, input.membership.userId),
      ),
    )
    .limit(1);
  if (!year)
    return { metric: input.metric, numeric: null, band: "insufficient_data" };
  const [subjectRows, gradeRows, goalRows] = await Promise.all([
    db
      .select({
        id: subjects.id,
        name: subjects.name,
        shortName: subjects.shortName,
        parentId: subjects.parentId,
        coefficient: subjects.coefficient,
        kind: subjects.kind,
        isMain: subjects.isMain,
        sortOrder: subjects.sortOrder,
      })
      .from(subjects)
      .where(
        and(
          eq(subjects.userId, input.membership.userId),
          eq(subjects.yearId, year.id),
        ),
      ),
    db
      .select({
        id: grades.id,
        name: grades.name,
        value: grades.value,
        outOf: grades.outOf,
        coefficient: grades.coefficient,
        passedAt: grades.passedAt,
        createdAt: grades.createdAt,
        subjectId: grades.subjectId,
        periodId: grades.periodId,
        note: grades.note,
      })
      .from(grades)
      .where(
        and(
          eq(grades.userId, input.membership.userId),
          eq(grades.yearId, year.id),
        ),
      ),
    db
      .select({ achievedAt: goals.achievedAt })
      .from(goals)
      .where(
        and(
          eq(goals.userId, input.membership.userId),
          eq(goals.yearId, year.id),
        ),
      ),
  ]);
  return deriveAcademicMetrics({
    window: input.policy.policy.window,
    yearStartsAt: year.startsAt,
    yearEndsAt: year.endsAt,
    passingRatio: year.passingRatio,
    subjects: subjectRows.map((subject) => ({
      ...subject,
      kind:
        subject.kind === "category"
          ? ("category" as const)
          : ("subject" as const),
    })),
    grades: gradeRows,
    goals: goalRows,
  })[input.metric];
}

export async function consentedMemberships(input: {
  groupId: string;
  policy: Awaited<ReturnType<typeof currentPolicy>>;
  metric: SocialMetric;
  viewerUserId: string;
}) {
  const rows = await db
    .select({ membership: groupMemberships, consent: groupMemberConsents })
    .from(groupMemberships)
    .innerJoin(
      groupMemberConsents,
      and(
        eq(groupMemberConsents.groupId, groupMemberships.groupId),
        eq(groupMemberConsents.userId, groupMemberships.userId),
      ),
    )
    .innerJoin(
      groupMemberConsentFields,
      eq(groupMemberConsentFields.consentId, groupMemberConsents.id),
    )
    .where(
      and(
        eq(groupMemberships.groupId, input.groupId),
        eq(groupMemberships.state, "active"),
        eq(groupMemberConsents.policyVersion, input.policy.policy.version),
        eq(groupMemberConsents.policyDigest, input.policy.policy.digest),
        eq(groupMemberConsents.status, "accepted"),
        eq(groupMemberConsentFields.fieldKey, input.metric),
      ),
    );
  const allowed = [] as typeof rows;
  for (const row of rows) {
    if (
      (await eligibilityView(row.membership.userId)).canUseSocial &&
      (row.membership.userId === input.viewerUserId ||
        !(await blocked(input.viewerUserId, row.membership.userId)))
    ) {
      allowed.push(row);
    }
  }
  return allowed;
}

export async function invalidateGroup(groupId: string) {
  await db
    .delete(socialAggregateCache)
    .where(eq(socialAggregateCache.groupId, groupId));
}

export function asPolicyInput(
  value: z.infer<typeof groupPolicyInputSchema>,
): GroupPolicyInput {
  return value;
}
