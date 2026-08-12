import { SubjectGraph, type Subject } from "@avermate/core";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import {
  friendships,
  grades,
  groupMemberships,
  socialGroups,
  socialNotifications,
  socialProfiles,
  socialReports,
  socialSharedSubjects,
  subjects,
  userBlocks,
  users,
  years,
} from "../../db/schema";
import { normalizeHandle } from "../../lib/social-policy";

export const handleSchema = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^@?[a-zA-Z0-9][a-zA-Z0-9._-]*$/, "Invalid profile handle")
  .transform(normalizeHandle);

/**
 * Who someone is, socially: their account name and avatar, plus the handle
 * they can be found by. There is no separate social persona any more — a
 * friend is a person you know, and they look like themselves.
 */
export async function identity(userId: string) {
  const [row] = await db
    .select({
      userId: users.id,
      name: users.name,
      avatar: users.avatarUrl,
      handle: socialProfiles.handle,
    })
    .from(users)
    .leftJoin(socialProfiles, eq(socialProfiles.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

export async function identities(userIds: readonly string[]) {
  const unique = [...new Set(userIds)];
  const out = new Map<
    string,
    { userId: string; name: string; avatar: string | null; handle: string | null }
  >();
  if (unique.length === 0) return out;
  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      avatar: users.avatarUrl,
      handle: socialProfiles.handle,
    })
    .from(users)
    .leftJoin(socialProfiles, eq(socialProfiles.userId, users.id))
    .where(or(...unique.map((id) => eq(users.id, id))));
  for (const row of rows) out.set(row.userId, row);
  return out;
}

/** The sharing row, created with its defaults the first time it is needed. */
export async function ensureProfile(userId: string) {
  const [existing] = await db
    .select()
    .from(socialProfiles)
    .where(eq(socialProfiles.userId, userId))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(socialProfiles)
    .values({ userId })
    .onConflictDoNothing({ target: socialProfiles.userId })
    .returning();
  if (created) return created;
  const [raced] = await db
    .select()
    .from(socialProfiles)
    .where(eq(socialProfiles.userId, userId))
    .limit(1);
  return raced as typeof socialProfiles.$inferSelect;
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

export function friendOf(
  friendship: typeof friendships.$inferSelect,
  userId: string,
) {
  return friendship.userLowId === userId
    ? friendship.userHighId
    : friendship.userLowId;
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

/**
 * The year whose figures a user shares: their explicit choice if it still
 * exists, otherwise the current year. Falling back keeps sharing alive
 * across a school-year rollover without anyone repeating setup.
 */
export async function resolveSharedYear(
  userId: string,
  sharedYearId: string | null,
) {
  if (sharedYearId) {
    const [chosen] = await db
      .select()
      .from(years)
      .where(and(eq(years.id, sharedYearId), eq(years.userId, userId)))
      .limit(1);
    if (chosen) return chosen;
  }
  const now = new Date();
  const candidates = await db
    .select()
    .from(years)
    .where(and(eq(years.userId, userId), isNull(years.archivedAt)))
    .orderBy(desc(years.startsAt));
  return (
    candidates.find((year) => year.startsAt <= now && year.endsAt >= now) ??
    candidates[0] ??
    null
  );
}

export interface SharedSubjectView {
  id: string;
  name: string;
  average: number | null;
  gradeCount: number;
}

export interface SharedAcademics {
  year: { name: string; scale: number; decimals: number };
  /** Ratio in 0..1, formatted by the reader on the owner's scale. */
  generalAverage: number | null;
  gradeCount: number;
  shareGeneralAverage: boolean;
  subjects: SharedSubjectView[];
}

/**
 * What `ownerUserId` currently shares, computed live from their real grades
 * with the same engine the apps use. Subject averages are only reported for
 * shared leaf subjects; the general average also respects the lock.
 */
export async function sharedAcademics(
  ownerUserId: string,
): Promise<SharedAcademics | null> {
  const profile = await ensureProfile(ownerUserId);
  if (
    !profile.shareGeneralAverage &&
    profile.shareSubjectsMode === "none"
  ) {
    return null;
  }
  const year = await resolveSharedYear(ownerUserId, profile.sharedYearId);
  if (!year) return null;

  const [subjectRows, gradeRows, sharedRows] = await Promise.all([
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
        and(eq(subjects.userId, ownerUserId), eq(subjects.yearId, year.id)),
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
      .where(and(eq(grades.userId, ownerUserId), eq(grades.yearId, year.id))),
    profile.shareSubjectsMode === "selected"
      ? db
          .select({ subjectId: socialSharedSubjects.subjectId })
          .from(socialSharedSubjects)
          .where(eq(socialSharedSubjects.userId, ownerUserId))
      : Promise.resolve([] as { subjectId: string }[]),
  ]);

  const gradesBySubject = new Map<string, typeof gradeRows>();
  for (const grade of gradeRows) {
    const list = gradesBySubject.get(grade.subjectId) ?? [];
    list.push(grade);
    gradesBySubject.set(grade.subjectId, list);
  }
  const graphSubjects: Subject[] = subjectRows.map((subject) => ({
    ...subject,
    kind: subject.kind === "category" ? "category" : "subject",
    grades: (gradesBySubject.get(subject.id) ?? []).map((grade) => ({
      ...grade,
      components: [],
    })),
  }));
  const graph = new SubjectGraph(graphSubjects);

  const allowed =
    profile.shareSubjectsMode === "all"
      ? null
      : new Set(sharedRows.map((row) => row.subjectId));
  const shared: SharedSubjectView[] = [];
  if (profile.shareSubjectsMode !== "none") {
    for (const subject of graphSubjects) {
      if (subject.kind !== "subject") continue;
      if (allowed && !allowed.has(subject.id)) continue;
      shared.push({
        id: subject.id,
        name: subject.name,
        average: graph.ratio(subject.id),
        gradeCount: graph.allGrades(subject.id).length,
      });
    }
    shared.sort((left, right) => left.name.localeCompare(right.name));
  }

  return {
    year: { name: year.name, scale: year.scale, decimals: year.decimals },
    generalAverage: profile.shareGeneralAverage ? graph.ratio(null) : null,
    gradeCount: gradeRows.length,
    shareGeneralAverage: profile.shareGeneralAverage,
    subjects: shared,
  };
}

/** The user's social relations, for the account export. */
export async function exportSocialData(userId: string) {
  const [profile, sharedRows, friendRows, membershipRows, blockRows, reportRows] =
    await Promise.all([
      ensureProfile(userId),
      db
        .select({ subjectId: socialSharedSubjects.subjectId })
        .from(socialSharedSubjects)
        .where(eq(socialSharedSubjects.userId, userId)),
      db
        .select()
        .from(friendships)
        .where(
          or(
            eq(friendships.userLowId, userId),
            eq(friendships.userHighId, userId),
          ),
        ),
      db
        .select({
          groupName: socialGroups.name,
          role: groupMemberships.role,
          shareAverage: groupMemberships.shareAverage,
          joinedAt: groupMemberships.createdAt,
        })
        .from(groupMemberships)
        .innerJoin(socialGroups, eq(socialGroups.id, groupMemberships.groupId))
        .where(eq(groupMemberships.userId, userId)),
      db
        .select({
          blockedUserId: userBlocks.blockedUserId,
          createdAt: userBlocks.createdAt,
        })
        .from(userBlocks)
        .where(eq(userBlocks.blockerUserId, userId)),
      db
        .select({
          category: socialReports.category,
          status: socialReports.status,
          createdAt: socialReports.createdAt,
        })
        .from(socialReports)
        .where(eq(socialReports.reporterUserId, userId)),
    ]);
  const named = await identities(
    friendRows.map((row) => friendOf(row, userId)),
  );
  return {
    sharing: {
      handle: profile.handle,
      shareGeneralAverage: profile.shareGeneralAverage,
      shareSubjectsMode: profile.shareSubjectsMode,
      sharedYearId: profile.sharedYearId,
      sharedSubjectIds: sharedRows.map((row) => row.subjectId),
    },
    friends: friendRows.map((row) => ({
      name: named.get(friendOf(row, userId))?.name ?? "",
      since: row.createdAt,
    })),
    groups: membershipRows,
    blocks: blockRows,
    reports: reportRows,
  };
}

/**
 * Just the general average, for group leaderboards. Cheaper than the full
 * view and indifferent to the subject locks — inside a group the only lock
 * is the membership's own `shareAverage`.
 */
export async function generalAverageOf(ownerUserId: string): Promise<{
  average: number | null;
  scale: number;
  decimals: number;
} | null> {
  const profile = await ensureProfile(ownerUserId);
  const year = await resolveSharedYear(ownerUserId, profile.sharedYearId);
  if (!year) return null;
  const [subjectRows, gradeRows] = await Promise.all([
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
        and(eq(subjects.userId, ownerUserId), eq(subjects.yearId, year.id)),
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
      .where(and(eq(grades.userId, ownerUserId), eq(grades.yearId, year.id))),
  ]);
  const gradesBySubject = new Map<string, typeof gradeRows>();
  for (const grade of gradeRows) {
    const list = gradesBySubject.get(grade.subjectId) ?? [];
    list.push(grade);
    gradesBySubject.set(grade.subjectId, list);
  }
  const graph = new SubjectGraph(
    subjectRows.map(
      (subject): Subject => ({
        ...subject,
        kind: subject.kind === "category" ? "category" : "subject",
        grades: (gradesBySubject.get(subject.id) ?? []).map((grade) => ({
          ...grade,
          components: [],
        })),
      }),
    ),
  );
  return {
    average: graph.ratio(null),
    scale: year.scale,
    decimals: year.decimals,
  };
}
