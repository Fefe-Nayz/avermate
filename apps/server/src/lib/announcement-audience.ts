import { and, eq, exists, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import {
  announcementPresetTargets,
  announcements,
  yearPresetMemberships,
  years,
} from "../db/schema";

/**
 * Authoritative visibility predicate shared by every user-facing announcement
 * operation. A targeted announcement follows the logical preset, but only a
 * linked, non-detached membership on a non-archived year grants access.
 *
 * Supplying a year scopes the match to that owned year. Without one (MCP and
 * backwards-compatible clients), any active membership owned by the caller
 * can match. Global announcements are intentionally unaffected.
 */
export function announcementAudienceCondition(
  userId: string,
  yearId?: string,
): SQL {
  const membership = db
    .select({ one: sql<number>`1` })
    .from(announcementPresetTargets)
    .innerJoin(
      yearPresetMemberships,
      eq(yearPresetMemberships.presetId, announcementPresetTargets.presetId),
    )
    .innerJoin(years, eq(years.id, yearPresetMemberships.yearId))
    .where(
      and(
        eq(announcementPresetTargets.announcementId, announcements.id),
        eq(yearPresetMemberships.userId, userId),
        eq(years.userId, userId),
        eq(yearPresetMemberships.mode, "linked"),
        isNull(yearPresetMemberships.detachedAt),
        isNull(years.archivedAt),
        yearId ? eq(yearPresetMemberships.yearId, yearId) : undefined,
      ),
    );

  return or(
    eq(announcements.audience, "global"),
    and(eq(announcements.audience, "preset"), exists(membership)),
  ) as SQL;
}
