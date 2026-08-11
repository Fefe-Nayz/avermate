import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { groupRankingOptIns, socialEligibility } from "../../db/schema";
import { notFound, protectedProcedure } from "../../lib/orpc";
import {
  MIN_AGGREGATE_MEMBERS,
  MIN_RANKING_MEMBERS,
  numericSummary,
  suppressSmallBuckets,
  tiedRanks,
} from "../../lib/social-policy";
import {
  consentedMemberships,
  assertGroupOperational,
  currentPolicy,
  groupAccess,
  metricProjection,
  socialMetricSchema,
} from "./groups-shared";

const inputSchema = z.object({
  groupId: z.string().min(1),
  metric: socialMetricSchema,
});

export const socialGroupStatsRouter = {
  stats: protectedProcedure
    .input(inputSchema)
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const access = await groupAccess(input.groupId, userId);
      assertGroupOperational(access);
      if (access.membership.state !== "active") {
        return {
          available: false as const,
          reason: "consent_required" as const,
          metric: input.metric,
          memberCount: 0,
          revision: access.group.revision,
        };
      }
      const policy = await currentPolicy(
        access.group.id,
        access.group.currentPolicyVersion,
      );
      const field = policy.fields.find(
        (candidate) => candidate.fieldKey === input.metric,
      );
      if (!field) notFound("Group metric");
      const members = await consentedMemberships({
        groupId: input.groupId,
        policy,
        metric: input.metric,
        viewerUserId: userId,
      });
      const projected = await Promise.all(
        members.map((row) =>
          metricProjection({
            membership: row.membership,
            policy,
            metric: input.metric,
          }),
        ),
      );
      const valid = projected.filter(
        (row) =>
          row.numeric !== null ||
          (row.band && row.band !== "insufficient_data"),
      );
      if (valid.length < MIN_AGGREGATE_MEMBERS) {
        return {
          available: false as const,
          reason: "minimum_group_size" as const,
          metric: input.metric,
          memberCount: valid.length,
          requiredMemberCount: MIN_AGGREGATE_MEMBERS,
          revision: access.group.revision,
        };
      }
      const numeric = valid.flatMap((row) =>
        row.numeric === null ? [] : [row.numeric],
      );
      if (numeric.length === valid.length) {
        return {
          available: true as const,
          metric: input.metric,
          memberCount: valid.length,
          policyVersion: policy.policy.version,
          revision: access.group.revision,
          summary: numericSummary(numeric),
          buckets: [],
        };
      }
      const bucketCounts = new Map<string, number>();
      for (const row of valid) {
        if (row.band)
          bucketCounts.set(row.band, (bucketCounts.get(row.band) ?? 0) + 1);
      }
      return {
        available: true as const,
        metric: input.metric,
        memberCount: valid.length,
        policyVersion: policy.policy.version,
        revision: access.group.revision,
        summary: null,
        buckets: suppressSmallBuckets(
          [...bucketCounts].map(([key, count]) => ({ key, count })),
        ),
      };
    }),

  rankings: protectedProcedure
    .input(inputSchema)
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const access = await groupAccess(input.groupId, userId);
      assertGroupOperational(access);
      if (access.membership.state !== "active") {
        return {
          available: false as const,
          reason: "consent_required" as const,
          entries: [],
        };
      }
      const policy = await currentPolicy(
        access.group.id,
        access.group.currentPolicyVersion,
      );
      const field = policy.fields.find(
        (candidate) => candidate.fieldKey === input.metric,
      );
      if (!policy.policy.rankingsEnabled || field?.exposure !== "ranking")
        notFound("Ranking metric");
      const members = await consentedMemberships({
        groupId: input.groupId,
        policy,
        metric: input.metric,
        viewerUserId: userId,
      });
      const optIns = await db
        .select({ userId: groupRankingOptIns.userId })
        .from(groupRankingOptIns)
        .where(
          and(
            eq(groupRankingOptIns.groupId, input.groupId),
            eq(groupRankingOptIns.policyVersion, policy.policy.version),
            eq(groupRankingOptIns.metric, input.metric),
            eq(groupRankingOptIns.enabled, true),
          ),
        );
      const opted = new Set(optIns.map((row) => row.userId));
      const participants = (
        await Promise.all(
          members
            .filter((row) => opted.has(row.membership.userId))
            .map(async (row) => {
              const [eligibility] = await db
                .select({ ageBand: socialEligibility.ageBand })
                .from(socialEligibility)
                .where(eq(socialEligibility.userId, row.membership.userId))
                .limit(1);
              const projection = await metricProjection({
                membership: row.membership,
                policy,
                metric: input.metric,
              });
              if (projection.numeric === null) return null;
              return {
                membershipId: row.membership.id,
                alias: row.membership.alias,
                userId: row.membership.userId,
                ageBand: eligibility?.ageBand ?? "unknown",
                score: projection.numeric,
              };
            }),
        )
      ).filter((row): row is NonNullable<typeof row> => row !== null);

      if (participants.length < MIN_RANKING_MEMBERS) {
        return {
          available: false as const,
          reason: "minimum_ranking_size" as const,
          memberCount: participants.length,
          requiredMemberCount: MIN_RANKING_MEMBERS,
          entries: [],
        };
      }
      const viewer = participants.find((row) => row.userId === userId);
      const [viewerEligibility] = await db
        .select({ ageBand: socialEligibility.ageBand })
        .from(socialEligibility)
        .where(eq(socialEligibility.userId, userId))
        .limit(1);
      if (viewerEligibility?.ageBand !== "adult") {
        const ordered = [...participants].sort(
          (left, right) => right.score - left.score,
        );
        const index = viewer
          ? ordered.findIndex((row) => row.userId === userId)
          : -1;
        const percentile =
          index < 0 ? null : 1 - index / Math.max(1, ordered.length - 1);
        return {
          available: true as const,
          mode: "private_percentile" as const,
          memberCount: participants.length,
          viewerPercentileBand:
            percentile === null
              ? null
              : percentile >= 0.75
                ? "top_quartile"
                : percentile >= 0.5
                  ? "upper_middle"
                  : percentile >= 0.25
                    ? "lower_middle"
                    : "bottom_quartile",
          entries: [],
        };
      }
      const adults = participants.filter((row) => row.ageBand === "adult");
      if (adults.length < MIN_RANKING_MEMBERS) {
        return {
          available: false as const,
          reason: "minimum_adult_ranking_size" as const,
          memberCount: adults.length,
          requiredMemberCount: MIN_RANKING_MEMBERS,
          entries: [],
        };
      }
      return {
        available: true as const,
        mode: "named_opt_in" as const,
        memberCount: adults.length,
        entries: tiedRanks(adults).map((row) => ({
          membershipId: row.membershipId,
          alias: row.alias,
          score: row.score,
          rank: row.rank,
        })),
      };
    }),
};
