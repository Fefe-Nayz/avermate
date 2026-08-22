import {
  averageOverTime,
  dayRange,
  gradeRatio,
  SubjectGraph,
  type Subject,
} from "@avermate/core";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { ORPCError } from "@orpc/server";
import { db } from "../../db";
import {
  friendships,
  goals,
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
import { notFound } from "../../lib/orpc";
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

/**
 * The caller's own view of a group, or nothing.
 *
 * The gate every group route passes through: one query that says both "does this group
 * exist" and "is this person in it", so no handler can answer half of that. Shared rather
 * than private to the group routes because the cohort surface needs exactly the same
 * answer — and two implementations of "can they see it" is one too many.
 */
/**
 * A group under an administrative hold answers reads and refuses writes.
 *
 * Here rather than in `groups.ts`, where it began: a hold is a property of the group,
 * not of one router, and the switch that turns a board into a cohort was reachable from
 * the other file without ever asking. Every write against a group belongs behind this.
 */
export function assertActiveGroup(group: typeof socialGroups.$inferSelect) {
  if (group.state !== "active") {
    throw new ORPCError("FORBIDDEN", {
      message: "This group is on an administrative hold",
    });
  }
}

export async function groupAccess(groupId: string, userId: string) {
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

export async function identities(userIds: readonly string[]) {
  const unique = [...new Set(userIds)];
  const out = new Map<
    string,
    {
      userId: string;
      name: string;
      avatar: string | null;
      handle: string | null;
    }
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
  /**
   * The general average as it stood through the year, behind its own lock.
   *
   * `null` when the owner has not opened it, which is the default even for accounts that
   * share everything else — see `shareHistory`. Weekly rather than per mark: a point per
   * result would draw a line whose steps are the days somebody was assessed, which is a
   * calendar of their year rather than a shape.
   */
  history: Array<{ at: Date; ratio: number }> | null;
}

/** How many points a shared curve carries. A school year in weeks, near enough. */
const SHARED_HISTORY_POINTS = 40;

/**
 * When to sample a shared curve.
 *
 * Two things were wrong with a plain weekly range trimmed to the first forty points.
 *
 * It ran to the *end of the year*, so every week between today and July carried the
 * average as it stands — a flat line into the future, drawn as if it had happened. A
 * shared curve is a record, and it stops where the record does.
 *
 * And the trim kept the first forty, which for a school year of about forty-four weeks
 * quietly cut the last month off — the part a reader is most likely looking for. Over the
 * cap the points are now spread across the whole range instead, so a longer year is drawn
 * coarser rather than truncated, and the last point is always the latest one.
 */
function sharedHistoryDates(startsAt: Date, endsAt: Date, now = new Date()) {
  const until = new Date(Math.min(endsAt.getTime(), now.getTime()));
  if (until.getTime() < startsAt.getTime()) return [];
  const weekly = dayRange(startsAt, until, 7);
  if (weekly.length <= SHARED_HISTORY_POINTS) return weekly;
  const last = weekly.length - 1;
  return Array.from({ length: SHARED_HISTORY_POINTS }, (_, index) => {
    const at = weekly[Math.round((index * last) / (SHARED_HISTORY_POINTS - 1))];
    return at as Date;
  });
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
  if (!profile.shareGeneralAverage && profile.shareSubjectsMode === "none") {
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
        excludedFromAverage: grades.excludedFromAverage,
        syncExcludedFromAverage: grades.syncExcludedFromAverage,
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

  /**
   * The curve, if it was opened.
   *
   * Behind both locks: a history of an average nobody shares is a history of nothing, so
   * `shareHistory` alone is not enough. Evenly spaced over the year rather than one point
   * per mark, for the reason on the field.
   */
  const history =
    profile.shareHistory && profile.shareGeneralAverage
      ? averageOverTime(
          graphSubjects,
          // A week apart, which over a school year is about forty points — and, more to
          // the point, a shape rather than a diary of when somebody was assessed.
          sharedHistoryDates(year.startsAt, year.endsAt),
        ).flatMap((point) =>
          point.ratio === null ? [] : [{ at: point.date, ratio: point.ratio }],
        )
      : null;

  return {
    year: { name: year.name, scale: year.scale, decimals: year.decimals },
    generalAverage: profile.shareGeneralAverage ? graph.ratio(null) : null,
    gradeCount: gradeRows.length,
    shareGeneralAverage: profile.shareGeneralAverage,
    subjects: shared,
    history,
  };
}

/** The user's social relations, for the account export. */
export async function exportSocialData(userId: string) {
  const [
    profile,
    sharedRows,
    friendRows,
    membershipRows,
    blockRows,
    reportRows,
  ] = await Promise.all([
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
      // The third lock, and it belongs in the export beside the other two: a file that
      // omits it cannot say whether the curve was shared.
      shareHistory: profile.shareHistory,
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

/** How far a 30-day drift must go before an arrow claims a direction. */
const TREND_THRESHOLD = 0.01;
const TREND_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;

export interface GroupFigureScope {
  id: string;
  kind: "general" | "subject" | "median" | "passRate" | "goalProgress";
  /** Only for subject scopes; matches the member's subjects by name. */
  subjectName: string | null;
  /** Stable subject identity for configured classes. */
  subjectKey: string | null;
}

export interface GroupFigureOptions {
  scopes: readonly GroupFigureScope[];
  includeTrend: boolean;
  includeGradeCount: boolean;
}

export interface GroupFigure {
  scopeId: string;
  average: number | null;
  gradeCount: number | null;
  trend: "up" | "down" | "flat" | null;
}

export interface GroupFigures {
  scale: number;
  decimals: number;
  figures: GroupFigure[];
}

/**
 * One member's figures for a group board — one per configured comparison,
 * all computed from a single load of their shared year. Indifferent to the
 * friend-facing subject locks — inside a group the only lock is the
 * membership's `shareAverage` switch.
 */
export async function groupFigures(
  ownerUserId: string,
  yearId: string,
  options: GroupFigureOptions,
): Promise<GroupFigures | null> {
  const [year] = await db
    .select()
    .from(years)
    .where(and(eq(years.id, yearId), eq(years.userId, ownerUserId)))
    .limit(1);
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
        presetNodeKey: subjects.presetNodeKey,
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
        excludedFromAverage: grades.excludedFromAverage,
        syncExcludedFromAverage: grades.syncExcludedFromAverage,
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
  const toGraph = (rows: typeof gradeRows) => {
    const bySubject = new Map<string, typeof gradeRows>();
    for (const grade of rows) {
      const list = bySubject.get(grade.subjectId) ?? [];
      list.push(grade);
      bySubject.set(grade.subjectId, list);
    }
    return new SubjectGraph(
      subjectRows.map((subject): Subject => ({
        ...subject,
        kind: subject.kind === "category" ? "category" : "subject",
        grades: (bySubject.get(subject.id) ?? []).map((grade) => ({
          ...grade,
          components: [],
        })),
      })),
    );
  };

  // Configured classes use stable template keys. Name matching survives only
  // for preserved legacy comparison rows.
  const scope = (
    graph: SubjectGraph,
    subjectKey: string | null,
    subjectName: string | null,
  ) => {
    if (subjectKey) {
      const matched = subjectRows.find(
        (subject) =>
          subject.presetNodeKey === subjectKey ||
          (subjectKey.startsWith("class-subject:") &&
            subject.id === subjectKey.slice("class-subject:".length)),
      );
      if (!matched) return graph.subset(new Set());
      return graph.subset(
        new Set([
          matched.id,
          ...graph.descendantsOf(matched.id).map((subject) => subject.id),
        ]),
      );
    }
    const needle = subjectName?.trim().toLowerCase();
    if (!needle) return graph;
    const include = new Set<string>();
    for (const subject of graph.subjects) {
      if (!subject.name.toLowerCase().includes(needle)) continue;
      include.add(subject.id);
      for (const descendant of graph.descendantsOf(subject.id)) {
        include.add(descendant.id);
      }
    }
    return graph.subset(include);
  };

  const current = toGraph(gradeRows);
  const cutoff = new Date(Date.now() - TREND_WINDOW_MS);
  const earlierRows = gradeRows.filter((grade) => grade.passedAt <= cutoff);
  const earlier = options.includeTrend ? toGraph(earlierRows) : null;

  const validRatios = (rows: typeof gradeRows) =>
    rows.flatMap((grade) => {
      const ratio = gradeRatio(grade);
      return ratio === null ? [] : [ratio];
    });
  const median = (values: number[]) => {
    if (values.length === 0) return null;
    const ordered = [...values].sort((a, b) => a - b);
    const middle = Math.floor(ordered.length / 2);
    return ordered.length % 2 === 1
      ? (ordered[middle] ?? null)
      : ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2;
  };
  const passRate = (values: number[]) =>
    values.length === 0
      ? null
      : values.filter((ratio) => ratio >= year.passingRatio).length /
        values.length;

  const goalRows = options.scopes.some((entry) => entry.kind === "goalProgress")
    ? await db
        .select({ achievedAt: goals.achievedAt })
        .from(goals)
        .where(and(eq(goals.userId, ownerUserId), eq(goals.yearId, year.id)))
    : [];

  const valueOf = (
    entry: GroupFigureScope,
    rows: typeof gradeRows,
    graph: SubjectGraph,
  ): number | null => {
    switch (entry.kind) {
      case "general":
        return graph.ratio(null);
      case "subject":
        return scope(graph, entry.subjectKey, entry.subjectName).ratio(null);
      case "median":
        return median(validRatios(rows));
      case "passRate":
        return passRate(validRatios(rows));
      case "goalProgress": {
        if (goalRows.length === 0) return null;
        const reference = rows === gradeRows ? null : cutoff;
        const achieved = goalRows.filter((goal) =>
          reference
            ? goal.achievedAt !== null && goal.achievedAt <= reference
            : goal.achievedAt !== null,
        ).length;
        return achieved / goalRows.length;
      }
    }
  };

  const figures = options.scopes.map((entry): GroupFigure => {
    const average = valueOf(entry, gradeRows, current);
    let trend: GroupFigure["trend"] = null;
    if (earlier && average !== null) {
      const before = valueOf(entry, earlierRows, earlier);
      if (before !== null) {
        const delta = average - before;
        trend =
          delta > TREND_THRESHOLD
            ? "up"
            : delta < -TREND_THRESHOLD
              ? "down"
              : "flat";
      }
    }
    return {
      scopeId: entry.id,
      average,
      gradeCount: options.includeGradeCount
        ? entry.kind === "subject"
          ? scope(current, entry.subjectKey, entry.subjectName).allGrades()
              .length
          : gradeRows.length
        : null,
      trend,
    };
  });

  return { scale: year.scale, decimals: year.decimals, figures };
}
