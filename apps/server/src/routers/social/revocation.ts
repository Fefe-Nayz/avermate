import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  groupMemberConsents,
  groupMemberships,
  groupRankingOptIns,
  socialAggregateCache,
  socialGroups,
  socialProfileGrants,
  socialProfiles,
} from "../../db/schema";

type SocialTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Immediate fail-closed projection revocation, reused by every consent path. */
export async function revokeSocialSharing(
  tx: SocialTransaction,
  userId: string,
  now: Date,
) {
  const affectedGroups = tx
    .select({ id: groupMemberships.groupId })
    .from(groupMemberships)
    .where(eq(groupMemberships.userId, userId));
  await tx
    .update(groupMemberConsents)
    .set({ status: "withdrawn", withdrawnAt: now, updatedAt: now })
    .where(
      and(
        eq(groupMemberConsents.userId, userId),
        eq(groupMemberConsents.status, "accepted"),
      ),
    );
  await tx
    .update(groupMemberships)
    .set({ state: "consent_required", sharedYearId: null, updatedAt: now })
    .where(
      and(
        eq(groupMemberships.userId, userId),
        eq(groupMemberships.state, "active"),
      ),
    );
  await tx
    .update(groupRankingOptIns)
    .set({ enabled: false, updatedAt: now })
    .where(eq(groupRankingOptIns.userId, userId));
  await tx
    .update(socialGroups)
    .set({ revision: sql`${socialGroups.revision} + 1`, updatedAt: now })
    .where(inArray(socialGroups.id, affectedGroups));
  await tx
    .delete(socialAggregateCache)
    .where(inArray(socialAggregateCache.groupId, affectedGroups));
  await tx
    .update(socialProfileGrants)
    .set({ withdrawnAt: now })
    .where(
      and(
        eq(socialProfileGrants.userId, userId),
        sql`${socialProfileGrants.withdrawnAt} is null`,
      ),
    );
  await tx
    .update(socialProfiles)
    .set({
      status: "off",
      revision: sql`${socialProfiles.revision} + 1`,
      updatedAt: now,
    })
    .where(eq(socialProfiles.userId, userId));
}
