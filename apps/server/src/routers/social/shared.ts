import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import {
  friendCircleMembers,
  friendCircles,
  friendships,
  socialAuditEvents,
  socialEligibility,
  socialFeatureConsents,
  socialFeatureFlags,
  socialNotifications,
  socialProfileGrants,
  socialProfiles,
  userBlocks,
  users,
  type SocialProfileField,
} from "../../db/schema";
import { notFound } from "../../lib/orpc";
import {
  SOCIAL_FEATURE_KEY,
  SOCIAL_POLICY_VERSION,
  SOCIAL_PROFILE_FIELDS,
  normalizeHandle,
  resolveEligibility,
} from "../../lib/social-policy";

export const channelSchema = z.enum(["web", "mobile", "mcp"]);
export const profileFieldSchema = z.enum(SOCIAL_PROFILE_FIELDS);
export const handleSchema = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, "Invalid profile handle")
  .transform(normalizeHandle);

type SocialQueryExecutor = Pick<typeof db, "select">;

export async function audit(input: {
  actorUserId: string | null;
  subjectUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  changedKeys?: readonly string[];
}) {
  await db.insert(socialAuditEvents).values({
    actorUserId: input.actorUserId,
    subjectUserId: input.subjectUserId ?? input.actorUserId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    changedKeys: JSON.stringify([...new Set(input.changedKeys ?? [])].sort()),
  });
}

export async function notify(input: {
  userId: string;
  actorUserId?: string | null;
  kind: string;
  entityType: "friend_request" | "group" | "report" | "system";
  entityId?: string | null;
  safeParams?: Record<string, string>;
}) {
  await db.insert(socialNotifications).values({
    userId: input.userId,
    actorUserId: input.actorUserId ?? null,
    kind: input.kind,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    safeParams: JSON.stringify(input.safeParams ?? {}),
  });
}

export async function eligibilityViewFrom(
  executor: SocialQueryExecutor,
  userId: string,
) {
  const [flagRows, eligibilityRows, profileRows, consents] = await Promise.all([
    executor
      .select({ enabled: socialFeatureFlags.enabled })
      .from(socialFeatureFlags)
      .where(eq(socialFeatureFlags.key, SOCIAL_FEATURE_KEY))
      .limit(1),
    executor
      .select()
      .from(socialEligibility)
      .where(eq(socialEligibility.userId, userId))
      .limit(1),
    executor
      .select({
        status: socialProfiles.status,
        revision: socialProfiles.revision,
      })
      .from(socialProfiles)
      .where(eq(socialProfiles.userId, userId))
      .limit(1),
    executor
      .select({
        actorType: socialFeatureConsents.actorType,
        event: socialFeatureConsents.event,
        occurredAt: socialFeatureConsents.occurredAt,
        guardianProviderRef: socialFeatureConsents.guardianProviderRef,
      })
      .from(socialFeatureConsents)
      .where(
        and(
          eq(socialFeatureConsents.userId, userId),
          eq(socialFeatureConsents.policyVersion, SOCIAL_POLICY_VERSION),
        ),
      )
      .orderBy(desc(socialFeatureConsents.occurredAt)),
  ]);
  const eligibility = eligibilityRows[0];
  const profile = profileRows[0];
  return resolveEligibility({
    enabled: flagRows[0]?.enabled ?? false,
    ageBand: eligibility?.ageBand ?? "unknown",
    assuranceLevel: eligibility?.assuranceLevel ?? "none",
    providerRef: eligibility?.providerRef ?? null,
    expiresAt: eligibility?.expiresAt ?? null,
    profileStatus: profile?.status ?? "off",
    revision: profile?.revision ?? 0,
    consents,
  });
}

export function eligibilityView(userId: string) {
  return eligibilityViewFrom(db, userId);
}

export async function assertSocialAccess(userId: string) {
  const view = await eligibilityView(userId);
  if (!view.canUseSocial) {
    throw new ORPCError("FORBIDDEN", {
      message: `Social access unavailable: ${view.reason}`,
      data: { reason: view.reason },
    });
  }
  return view;
}

export async function assertActiveProfile(userId: string) {
  await assertSocialAccess(userId);
  const [profile] = await db
    .select()
    .from(socialProfiles)
    .where(
      and(
        eq(socialProfiles.userId, userId),
        eq(socialProfiles.status, "active"),
      ),
    )
    .limit(1);
  if (!profile) {
    throw new ORPCError("PRECONDITION_FAILED", {
      message: "Enable your social profile before using this feature",
    });
  }
  return profile;
}

export async function assertActiveProfileFrom(
  executor: SocialQueryExecutor,
  userId: string,
) {
  const view = await eligibilityViewFrom(executor, userId);
  if (!view.canUseSocial) notFound("Profile");
  const [profile] = await executor
    .select()
    .from(socialProfiles)
    .where(
      and(
        eq(socialProfiles.userId, userId),
        eq(socialProfiles.status, "active"),
      ),
    )
    .limit(1);
  if (!profile) notFound("Profile");
  return profile;
}

export async function blocked(left: string, right: string) {
  const [row] = await db
    .select({ id: userBlocks.id })
    .from(userBlocks)
    .where(
      or(
        and(
          eq(userBlocks.blockerUserId, left),
          eq(userBlocks.blockedUserId, right),
        ),
        and(
          eq(userBlocks.blockerUserId, right),
          eq(userBlocks.blockedUserId, left),
        ),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function friendshipBetween(left: string, right: string) {
  if (left === right) return null;
  const [low, high] = left < right ? [left, right] : [right, left];
  const [row] = await db
    .select()
    .from(friendships)
    .where(
      and(eq(friendships.userLowId, low), eq(friendships.userHighId, high)),
    )
    .limit(1);
  return row ?? null;
}

export async function areFriends(left: string, right: string) {
  return Boolean(await friendshipBetween(left, right));
}

export type ProjectedProfile = {
  displayName?: string;
  avatar?: string | null;
  bio?: string;
  educationBand?: string;
};

export async function projectFriendProfile(
  viewerUserId: string,
  targetUserId: string,
) {
  if (await blocked(viewerUserId, targetUserId)) return null;
  const friendship = await friendshipBetween(viewerUserId, targetUserId);
  if (!friendship || !(await eligibilityView(targetUserId)).canUseSocial)
    return null;
  const [target] = await db
    .select({
      displayName: socialProfiles.displayName,
      avatar: users.avatarUrl,
      bio: socialProfiles.bio,
      educationBand: socialProfiles.educationBand,
      status: socialProfiles.status,
    })
    .from(socialProfiles)
    .innerJoin(users, eq(users.id, socialProfiles.userId))
    .where(eq(socialProfiles.userId, targetUserId))
    .limit(1);
  if (!target || target.status !== "active") return null;
  const [circleRows, grants] = await Promise.all([
    db
      .select({ id: friendCircles.id })
      .from(friendCircles)
      .innerJoin(
        friendCircleMembers,
        eq(friendCircleMembers.circleId, friendCircles.id),
      )
      .where(
        and(
          eq(friendCircles.ownerUserId, targetUserId),
          eq(friendCircleMembers.friendUserId, viewerUserId),
        ),
      ),
    db
      .select()
      .from(socialProfileGrants)
      .where(
        and(
          eq(socialProfileGrants.userId, targetUserId),
          isNull(socialProfileGrants.withdrawnAt),
        ),
      ),
  ]);
  const circleIds = new Set(circleRows.map((row) => row.id));
  const allowed = new Set<SocialProfileField>();
  for (const grant of grants) {
    if (
      grant.audience === "friends" ||
      (grant.audience === "specific_user" &&
        grant.audienceId === friendship.id) ||
      (grant.audience === "circle" &&
        grant.audienceId &&
        circleIds.has(grant.audienceId))
    ) {
      allowed.add(grant.fieldKey);
    }
  }
  return {
    ...(allowed.has("displayName") ? { displayName: target.displayName } : {}),
    ...(allowed.has("avatar") ? { avatar: target.avatar } : {}),
    ...(allowed.has("bio") ? { bio: target.bio } : {}),
    ...(allowed.has("educationBand")
      ? { educationBand: target.educationBand }
      : {}),
  };
}

export async function requestIdentity(userId: string) {
  const [row] = await db
    .select({
      displayName: socialProfiles.displayName,
      avatar: users.avatarUrl,
      handle: socialProfiles.handle,
    })
    .from(socialProfiles)
    .innerJoin(users, eq(users.id, socialProfiles.userId))
    .where(
      and(
        eq(socialProfiles.userId, userId),
        eq(socialProfiles.status, "active"),
      ),
    )
    .limit(1);
  return row ?? null;
}

export function ownProfileDto(profile: typeof socialProfiles.$inferSelect) {
  return {
    status: profile.status,
    discovery: profile.discovery,
    handle: profile.handle,
    displayName: profile.displayName,
    bio: profile.bio,
    educationBand: profile.educationBand,
    revision: profile.revision,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

export function grantDto(grant: typeof socialProfileGrants.$inferSelect) {
  return {
    id: grant.id,
    fieldKey: grant.fieldKey,
    audience: grant.audience,
    audienceId: grant.audienceId || null,
    grantedAt: grant.grantedAt,
  };
}

export async function listActiveGrants(userId: string) {
  const rows = await db
    .select()
    .from(socialProfileGrants)
    .where(
      and(
        eq(socialProfileGrants.userId, userId),
        isNull(socialProfileGrants.withdrawnAt),
      ),
    )
    .orderBy(asc(socialProfileGrants.fieldKey));
  return rows.map(grantDto);
}

export async function previewOwnProfile(input: {
  ownerUserId: string;
  audience: "friends" | "circle" | "specific_user";
  audienceId: string | null;
}) {
  const [profile] = await db
    .select({
      displayName: socialProfiles.displayName,
      avatar: users.avatarUrl,
      bio: socialProfiles.bio,
      educationBand: socialProfiles.educationBand,
    })
    .from(socialProfiles)
    .innerJoin(users, eq(users.id, socialProfiles.userId))
    .where(eq(socialProfiles.userId, input.ownerUserId))
    .limit(1);
  if (!profile) notFound("Profile");
  let friendshipId: string | null = null;
  let circleIds = new Set<string>();
  if (input.audience === "circle") {
    const [circle] = await db
      .select({ id: friendCircles.id })
      .from(friendCircles)
      .where(
        and(
          eq(friendCircles.id, input.audienceId ?? ""),
          eq(friendCircles.ownerUserId, input.ownerUserId),
        ),
      )
      .limit(1);
    if (!circle) notFound("Circle");
    circleIds = new Set([circle.id]);
  } else if (input.audience === "specific_user") {
    const [friendship] = await db
      .select()
      .from(friendships)
      .where(
        and(
          eq(friendships.id, input.audienceId ?? ""),
          or(
            eq(friendships.userLowId, input.ownerUserId),
            eq(friendships.userHighId, input.ownerUserId),
          ),
        ),
      )
      .limit(1);
    if (!friendship) notFound("Friend");
    friendshipId = friendship.id;
    const friendUserId =
      friendship.userLowId === input.ownerUserId
        ? friendship.userHighId
        : friendship.userLowId;
    const rows = await db
      .select({ id: friendCircles.id })
      .from(friendCircles)
      .innerJoin(
        friendCircleMembers,
        eq(friendCircleMembers.circleId, friendCircles.id),
      )
      .where(
        and(
          eq(friendCircles.ownerUserId, input.ownerUserId),
          eq(friendCircleMembers.friendUserId, friendUserId),
        ),
      );
    circleIds = new Set(rows.map((row) => row.id));
  }
  const grants = await db
    .select()
    .from(socialProfileGrants)
    .where(
      and(
        eq(socialProfileGrants.userId, input.ownerUserId),
        isNull(socialProfileGrants.withdrawnAt),
      ),
    );
  const allowed = new Set<SocialProfileField>();
  for (const grant of grants) {
    if (
      grant.audience === "friends" ||
      (grant.audience === "circle" &&
        grant.audienceId &&
        circleIds.has(grant.audienceId)) ||
      (grant.audience === "specific_user" && grant.audienceId === friendshipId)
    )
      allowed.add(grant.fieldKey);
  }
  return {
    ...(allowed.has("displayName") ? { displayName: profile.displayName } : {}),
    ...(allowed.has("avatar") ? { avatar: profile.avatar } : {}),
    ...(allowed.has("bio") ? { bio: profile.bio } : {}),
    ...(allowed.has("educationBand")
      ? { educationBand: profile.educationBand }
      : {}),
  };
}
