import { createHash, createHmac, randomBytes } from "node:crypto";
import { SubjectGraph, averageOverTime, type Subject } from "@avermate/core";
import { ORPCError } from "@orpc/server";
import { and, eq, lt, lte, sql } from "drizzle-orm";
import { db } from "../db";
import {
  socialRateLimits,
  type SocialAgeBand,
  type SocialMetric,
  type SocialMetricProjection,
} from "../db/schema";
import { env } from "./env";

export const SOCIAL_FEATURE_KEY = "social-v1";
export const SOCIAL_POLICY_VERSION = "2026-08-11.1";
export const MIN_AGGREGATE_MEMBERS = 5;
export const MIN_BUCKET_MEMBERS = 3;
export const MIN_RANKING_MEMBERS = 7;
export const FRIEND_REQUEST_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
export const GROUP_INVITATION_MAX_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

export const SOCIAL_PROFILE_FIELDS = [
  "displayName",
  "avatar",
  "bio",
  "educationBand",
] as const;

export const SOCIAL_METRICS = [
  "normalizedAverage",
  "median",
  "trendBand",
  "passRateBand",
  "gradeCountBand",
  "genericGoalProgress",
] as const satisfies readonly SocialMetric[];

export type SocialEligibilityStatus =
  | "feature_disabled"
  | "age_unknown"
  | "consent_required"
  | "guardian_required"
  | "verification_expired"
  | "active"
  | "frozen";

type ConsentEvidence = {
  actorType: "child" | "user" | "guardian";
  event: "granted" | "withdrawn";
  occurredAt: Date;
  guardianProviderRef: string | null;
};

export type EligibilityEvidence = {
  enabled: boolean;
  ageBand: SocialAgeBand;
  assuranceLevel:
    "none" | "self_declared" | "guardian_verified" | "trusted_provider";
  providerRef: string | null;
  expiresAt: Date | null;
  profileStatus: "off" | "active" | "frozen";
  revision: number;
  consents: readonly ConsentEvidence[];
};

function latestConsent(
  consents: readonly ConsentEvidence[],
  actorType: ConsentEvidence["actorType"],
): ConsentEvidence | undefined {
  return consents
    .filter((entry) => entry.actorType === actorType)
    .sort(
      (left, right) => right.occurredAt.getTime() - left.occurredAt.getTime(),
    )[0];
}

export function resolveEligibility(
  evidence: EligibilityEvidence,
  now = new Date(),
) {
  const guardianRequired = evidence.ageBand === "under15";
  const userActor = guardianRequired ? "child" : "user";
  const userConsent = latestConsent(evidence.consents, userActor);
  const guardianConsent = latestConsent(evidence.consents, "guardian");
  const guardianVerified = Boolean(
    guardianConsent?.event === "granted" &&
    guardianConsent.guardianProviderRef &&
    ["guardian_verified", "trusted_provider"].includes(
      evidence.assuranceLevel,
    ) &&
    evidence.providerRef,
  );

  let status: SocialEligibilityStatus;
  if (!evidence.enabled) status = "feature_disabled";
  else if (evidence.ageBand === "unknown") status = "age_unknown";
  else if (evidence.expiresAt && evidence.expiresAt <= now)
    status = "verification_expired";
  else if (userConsent?.event !== "granted") status = "consent_required";
  else if (guardianRequired && !guardianVerified) status = "guardian_required";
  else if (evidence.profileStatus === "frozen") status = "frozen";
  else status = "active";

  return {
    enabled: evidence.enabled,
    status,
    reason: status,
    ageBand: evidence.ageBand,
    guardianRequired,
    guardianVerified,
    canUseSocial: status === "active",
    policyVersion: SOCIAL_POLICY_VERSION,
    profileStatus: evidence.profileStatus,
    revision: evidence.revision,
  } as const;
}

export function canonicalPair(left: string, right: string): [string, string] {
  if (left === right) {
    throw new ORPCError("BAD_REQUEST", {
      message: "An account cannot target itself",
    });
  }
  return left < right ? [left, right] : [right, left];
}

export function normalizeHandle(value: string): string {
  return value.trim().toLowerCase().replace(/^@/, "");
}

export function hashOpaque(value: string): string {
  return createHmac("sha256", env.BETTER_AUTH_SECRET)
    .update(value.trim().toLowerCase(), "utf8")
    .digest("hex");
}

export function issueOpaqueToken(bytes = 32): {
  token: string;
  tokenHash: string;
  tokenPrefix: string;
} {
  const token = randomBytes(bytes).toString("base64url");
  return {
    token,
    tokenHash: hashOpaque(token),
    tokenPrefix: token.slice(0, 8),
  };
}

export type GroupPolicyInput = {
  purpose: string;
  audienceDescription: string;
  window: "current_academic_year" | "last_90_days" | "last_30_days";
  rankingsEnabled: boolean;
  fields: readonly {
    fieldKey: SocialMetric;
    required: boolean;
    exposure: "aggregate_only" | "member_visible" | "ranking";
  }[];
};

export function groupPolicyDigest(input: GroupPolicyInput): string {
  const stable = {
    purpose: input.purpose.trim(),
    audienceDescription: input.audienceDescription.trim(),
    window: input.window,
    rankingsEnabled: input.rankingsEnabled,
    fields: [...input.fields]
      .map((field) => ({ ...field }))
      .sort((left, right) => left.fieldKey.localeCompare(right.fieldKey)),
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

export type AcademicProjectionInput = {
  window: GroupPolicyInput["window"];
  yearStartsAt: Date;
  yearEndsAt: Date;
  passingRatio: number;
  now?: Date;
  subjects: readonly Omit<Subject, "grades">[];
  grades: readonly {
    id: string;
    name: string;
    value: number;
    outOf: number;
    coefficient: number;
    passedAt: Date;
    createdAt: Date;
    subjectId: string;
    periodId: string | null;
    note: string | null;
  }[];
  goals: readonly { achievedAt: Date | null }[];
};

function roundPercent(ratio: number): number {
  return Math.round(ratio * 1_000) / 10;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) return ordered[middle] ?? null;
  return ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2;
}

export function deriveAcademicMetrics(
  input: AcademicProjectionInput,
): Record<SocialMetric, SocialMetricProjection> {
  const now = input.now ?? new Date();
  const windowStart =
    input.window === "last_30_days"
      ? new Date(now.getTime() - 30 * 86_400_000)
      : input.window === "last_90_days"
        ? new Date(now.getTime() - 90 * 86_400_000)
        : input.yearStartsAt;
  const windowEnd =
    input.window === "current_academic_year"
      ? input.yearEndsAt < now
        ? input.yearEndsAt
        : now
      : now;
  const grades = input.grades
    .filter(
      (grade) =>
        grade.outOf > 0 &&
        grade.coefficient > 0 &&
        grade.passedAt >= windowStart &&
        grade.passedAt <= windowEnd,
    )
    .sort((left, right) => left.passedAt.getTime() - right.passedAt.getTime());
  const ratios = grades.map((grade) =>
    Math.max(0, Math.min(1, grade.value / grade.outOf)),
  );
  const gradesBySubject = new Map<string, Array<(typeof grades)[number]>>();
  for (const grade of grades) {
    const entries = gradesBySubject.get(grade.subjectId) ?? [];
    entries.push(grade);
    gradesBySubject.set(grade.subjectId, entries);
  }
  const graphSubjects: Subject[] = input.subjects.map((subject) => ({
    ...subject,
    grades: (gradesBySubject.get(subject.id) ?? []).map((grade) => ({
      ...grade,
      components: [],
    })),
  }));
  const average = new SubjectGraph(graphSubjects).ratio(null);
  const timeline = averageOverTime(
    graphSubjects,
    [...new Set(grades.map((grade) => grade.passedAt.getTime()))]
      .sort((left, right) => left - right)
      .map((time) => new Date(time)),
  ).flatMap((point) => (point.ratio === null ? [] : [point.ratio]));
  const delta =
    timeline.length < 2 ? null : (timeline.at(-1) ?? 0) - (timeline[0] ?? 0);
  const passRatio =
    ratios.length === 0
      ? null
      : ratios.filter((ratio) => ratio >= input.passingRatio).length /
        ratios.length;
  const goalRatio =
    input.goals.length === 0
      ? null
      : input.goals.filter((goal) => goal.achievedAt !== null).length /
        input.goals.length;

  return {
    normalizedAverage: {
      metric: "normalizedAverage",
      numeric: average === null ? null : roundPercent(average),
      band: null,
    },
    median: {
      metric: "median",
      numeric:
        median(ratios) === null ? null : roundPercent(median(ratios) ?? 0),
      band: null,
    },
    trendBand: {
      metric: "trendBand",
      numeric: null,
      band:
        delta === null
          ? "insufficient_data"
          : delta >= 0.03
            ? "improving"
            : delta <= -0.03
              ? "declining"
              : "stable",
    },
    passRateBand: {
      metric: "passRateBand",
      numeric: null,
      band:
        passRatio === null
          ? "insufficient_data"
          : passRatio >= 0.8
            ? "high"
            : passRatio >= 0.5
              ? "medium"
              : "low",
    },
    gradeCountBand: {
      metric: "gradeCountBand",
      numeric: null,
      band: grades.length < 5 ? "low" : grades.length < 15 ? "medium" : "high",
    },
    genericGoalProgress: {
      metric: "genericGoalProgress",
      numeric: goalRatio === null ? null : roundPercent(goalRatio),
      band: null,
    },
  };
}

export type AggregateBucket = { key: string; count: number };

/**
 * Primary and complementary suppression. If one small bucket is hidden, the
 * smallest remaining bucket is hidden too so subtraction cannot reveal it.
 */
export function suppressSmallBuckets(
  buckets: readonly AggregateBucket[],
  threshold = MIN_BUCKET_MEMBERS,
): Array<AggregateBucket & { suppressed: boolean }> {
  const suppressed = new Set(
    buckets
      .filter((bucket) => bucket.count < threshold)
      .map((bucket) => bucket.key),
  );
  if (suppressed.size > 0 && suppressed.size < buckets.length) {
    const complement = buckets
      .filter((bucket) => !suppressed.has(bucket.key))
      .sort((left, right) => left.count - right.count)[0];
    if (complement) suppressed.add(complement.key);
  }
  return buckets.map((bucket) => ({
    ...bucket,
    count: suppressed.has(bucket.key) ? 0 : bucket.count,
    suppressed: suppressed.has(bucket.key),
  }));
}

export function numericSummary(values: readonly number[]) {
  const ordered = [...values].sort((a, b) => a - b);
  const percentile = (fraction: number) => {
    if (ordered.length === 0) return null;
    const position = (ordered.length - 1) * fraction;
    const low = Math.floor(position);
    const high = Math.ceil(position);
    const value =
      low === high
        ? (ordered[low] ?? 0)
        : (ordered[low] ?? 0) +
          ((ordered[high] ?? 0) - (ordered[low] ?? 0)) * (position - low);
    return Math.round(value * 10) / 10;
  };
  return {
    minimum: percentile(0),
    lowerQuartile: percentile(0.25),
    median: percentile(0.5),
    upperQuartile: percentile(0.75),
    maximum: percentile(1),
  };
}

export function tiedRanks<T extends { score: number }>(rows: readonly T[]) {
  const ordered = [...rows].sort((left, right) => right.score - left.score);
  let previousScore: number | undefined;
  let previousRank = 0;
  return ordered.map((row, index) => {
    const rank = row.score === previousScore ? previousRank : index + 1;
    previousScore = row.score;
    previousRank = rank;
    return { ...row, rank };
  });
}

/** Atomic DB-backed limiter with bounded cleanup, safe across replicas. */
export async function reserveSocialRateLimit(input: {
  subject: string;
  action: string;
  limit: number;
  windowMs: number;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  const windowStartedAt = new Date(
    Math.floor(now.getTime() / input.windowMs) * input.windowMs,
  );
  const expiresAt = new Date(windowStartedAt.getTime() + input.windowMs * 2);
  const subjectHash = hashOpaque(input.subject);

  const reserved = await db.transaction(async (tx) => {
    // Bounded by the expiry index and only performed when a social write occurs.
    await tx
      .delete(socialRateLimits)
      .where(lt(socialRateLimits.expiresAt, now));
    const inserted = await tx
      .insert(socialRateLimits)
      .values({
        subjectHash,
        action: input.action,
        windowStartedAt,
        count: 1,
        expiresAt,
      })
      .onConflictDoNothing({
        target: [
          socialRateLimits.subjectHash,
          socialRateLimits.action,
          socialRateLimits.windowStartedAt,
        ],
      })
      .returning({ id: socialRateLimits.id });
    if (inserted.length === 1) return true;

    const incremented = await tx
      .update(socialRateLimits)
      .set({ count: sql`${socialRateLimits.count} + 1` })
      .where(
        and(
          eq(socialRateLimits.subjectHash, subjectHash),
          eq(socialRateLimits.action, input.action),
          eq(socialRateLimits.windowStartedAt, windowStartedAt),
          lte(socialRateLimits.count, input.limit - 1),
        ),
      )
      .returning({ id: socialRateLimits.id });
    return incremented.length === 1;
  });

  if (!reserved) {
    throw new ORPCError("TOO_MANY_REQUESTS", {
      message: "Too many requests. Try again later.",
    });
  }
}
