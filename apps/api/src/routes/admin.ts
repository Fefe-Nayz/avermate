import { db } from "@/db";
import {
  accounts,
  customAverages,
  grades,
  periods,
  sessions,
  subjects,
  users,
  years,
} from "@/db/schema";
import { type Session, type User } from "@/lib/auth";
import { env } from "@/lib/env";
import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

const app = new Hono<{
  Variables: {
    session: {
      user: User;
      session: Session;
    } | null;
  };
}>();

const DEFAULT_TIMELINE_DAYS = 90;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

type TimelineRangeQueryValue = number | "always";

const timelineQuerySchema = z.object({
  days: z
    .union([z.literal("always"), z.coerce.number().int().min(7).max(365)])
    .optional()
    .default(DEFAULT_TIMELINE_DAYS),
});

const userParamSchema = z.object({
  userId: z.string().min(1).max(64),
});

const configuredAdminUserIds = env.ADMIN_USER_IDS
  ?.split(",")
  .map((id) => id.trim())
  .filter(Boolean) ?? [];

function parseRoleList(role: string | null | undefined): string[] {
  if (!role) {
    return [];
  }

  return role
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function isAdminSession(session: { user: User; session: Session } | null): boolean {
  if (!session) {
    return false;
  }

  if (configuredAdminUserIds.includes(session.user.id)) {
    return true;
  }

  const roleValue = (session.user as User & { role?: string | null }).role;
  return parseRoleList(roleValue).includes("admin");
}

function ensureAdminSession(session: { user: User; session: Session } | null) {
  if (!session) {
    throw new HTTPException(401);
  }

  if (!isAdminSession(session)) {
    throw new HTTPException(403);
  }
}

function toDate(input: Date | string | number): Date {
  if (input instanceof Date) {
    return input;
  }

  if (typeof input === "number") {
    const normalized = input < 1_000_000_000_000 ? input * 1000 : input;
    return new Date(normalized);
  }

  if (/^\d+$/.test(input)) {
    const numeric = Number(input);
    const normalized = numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
    return new Date(normalized);
  }

  return new Date(input);
}

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
}

function addUtcDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function getEarliestDate(
  candidates: Array<Date | string | number | null | undefined>
): Date | null {
  let earliest: Date | null = null;

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const date = toDate(candidate);
    if (Number.isNaN(date.getTime())) {
      continue;
    }

    if (earliest === null || date < earliest) {
      earliest = date;
    }
  }

  return earliest;
}

function resolveTimelineWindow(
  selection: TimelineRangeQueryValue,
  today: Date,
  earliestDate: Date | null
): { startDate: Date; days: number } {
  if (selection !== "always") {
    return {
      startDate: addUtcDays(today, -(selection - 1)),
      days: selection,
    };
  }

  if (!earliestDate) {
    return {
      startDate: today,
      days: 1,
    };
  }

  const earliestDay = startOfUtcDay(earliestDate);
  const spanDays =
    Math.floor((today.getTime() - earliestDay.getTime()) / MILLISECONDS_PER_DAY) +
    1;

  return {
    startDate: earliestDay,
    days: Math.max(1, spanDays),
  };
}

interface AverageSubjectEntry {
  id: string;
  parentId: string | null;
  coefficient: number | null;
  isDisplaySubject: boolean;
}

interface AverageWorkspaceSubjectEntry extends AverageSubjectEntry {
  yearId: string;
}

interface AverageGradeEntry {
  subjectId: string;
  value: number;
  outOf: number;
  coefficient: number | null;
}

interface AverageSubjectNode extends AverageSubjectEntry {
  grades: AverageGradeEntry[];
}

function getAllNonDisplaySubjects(
  subject: AverageSubjectNode,
  subjects: AverageSubjectNode[],
  descendantsCache: Map<string, AverageSubjectNode[]>
): AverageSubjectNode[] {
  const cached = descendantsCache.get(subject.id);
  if (cached) {
    return cached;
  }

  const children = subjects.filter((entry) => entry.parentId === subject.id);
  let nonDisplayList: AverageSubjectNode[] = [];

  if (!subject.isDisplaySubject) {
    nonDisplayList.push(subject);
  }

  for (const child of children) {
    if (child.isDisplaySubject) {
      nonDisplayList = nonDisplayList.concat(
        getAllNonDisplaySubjects(child, subjects, descendantsCache)
      );
    } else {
      nonDisplayList.push(child);
    }
  }

  descendantsCache.set(subject.id, nonDisplayList);
  return nonDisplayList;
}

function calculateAverageForSubject(
  subject: AverageSubjectNode,
  subjects: AverageSubjectNode[],
  averageCache: Map<string, number | null>,
  descendantsCache: Map<string, AverageSubjectNode[]>
): number | null {
  if (averageCache.has(subject.id)) {
    return averageCache.get(subject.id) ?? null;
  }

  let totalWeightedPercentages = 0;
  let totalCoefficients = 0;

  for (const grade of subject.grades) {
    const gradeValue = grade.value / 100;
    const outOf = grade.outOf / 100;
    const gradeCoefficient = (grade.coefficient ?? 100) / 100;

    if (outOf === 0) {
      continue;
    }

    const percentage = gradeValue / outOf;
    totalWeightedPercentages += percentage * gradeCoefficient;
    totalCoefficients += gradeCoefficient;
  }

  const descendants = getAllNonDisplaySubjects(subject, subjects, descendantsCache)
    .filter((entry) => entry.id !== subject.id);

  for (const child of descendants) {
    const childAverage = calculateAverageForSubject(
      child,
      subjects,
      averageCache,
      descendantsCache
    );

    if (childAverage === null) {
      continue;
    }

    const childPercentage = childAverage / 20;
    const childCoefficient = (child.coefficient ?? 100) / 100;
    totalWeightedPercentages += childPercentage * childCoefficient;
    totalCoefficients += childCoefficient;
  }

  const result =
    totalCoefficients > 0
      ? (totalWeightedPercentages / totalCoefficients) * 20
      : null;

  averageCache.set(subject.id, result);
  return result;
}

function computeGlobalAverageForUser(
  subjectEntries: AverageSubjectEntry[],
  gradeEntries: AverageGradeEntry[]
): number | null {
  if (subjectEntries.length === 0) {
    return null;
  }

  const gradesBySubject = new Map<string, AverageGradeEntry[]>();
  for (const grade of gradeEntries) {
    const current = gradesBySubject.get(grade.subjectId) ?? [];
    current.push(grade);
    gradesBySubject.set(grade.subjectId, current);
  }

  const subjectsWithGrades: AverageSubjectNode[] = subjectEntries.map((subject) => ({
    ...subject,
    grades: gradesBySubject.get(subject.id) ?? [],
  }));

  const globalSubjectId = "__GLOBAL_SUBJECT_ID__";
  const rootSubjects = subjectsWithGrades.filter((subject) => subject.parentId === null);
  const otherSubjects = subjectsWithGrades.filter((subject) => subject.parentId !== null);

  const globalSubject: AverageSubjectNode = {
    id: globalSubjectId,
    parentId: null,
    coefficient: 1,
    isDisplaySubject: true,
    grades: [],
  };

  const subjectTree: AverageSubjectNode[] = [
    globalSubject,
    ...rootSubjects.map((subject) => ({
      ...subject,
      parentId: globalSubjectId,
    })),
    ...otherSubjects,
  ];

  const averageCache = new Map<string, number | null>();
  const descendantsCache = new Map<string, AverageSubjectNode[]>();
  return calculateAverageForSubject(
    globalSubject,
    subjectTree,
    averageCache,
    descendantsCache
  );
}

function computeAverage(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const sum = values.reduce((total, value) => total + value, 0);
  return sum / values.length;
}

function computeUserAverageAcrossWorkspaces(
  yearIds: string[],
  subjectEntries: AverageWorkspaceSubjectEntry[],
  gradeEntries: AverageGradeEntry[]
): number | null {
  if (yearIds.length === 0 || subjectEntries.length === 0) {
    return null;
  }

  const subjectsByYearId = new Map<string, AverageSubjectEntry[]>();
  for (const subject of subjectEntries) {
    const current = subjectsByYearId.get(subject.yearId) ?? [];
    current.push({
      id: subject.id,
      parentId: subject.parentId,
      coefficient: subject.coefficient,
      isDisplaySubject: subject.isDisplaySubject,
    });
    subjectsByYearId.set(subject.yearId, current);
  }

  const gradesBySubjectId = new Map<string, AverageGradeEntry[]>();
  for (const grade of gradeEntries) {
    const current = gradesBySubjectId.get(grade.subjectId) ?? [];
    current.push(grade);
    gradesBySubjectId.set(grade.subjectId, current);
  }

  const workspaceAverages: number[] = [];
  for (const yearId of yearIds) {
    const workspaceSubjects = subjectsByYearId.get(yearId) ?? [];

    const workspaceGrades = workspaceSubjects.flatMap(
      (subject) => gradesBySubjectId.get(subject.id) ?? []
    );

    const workspaceAverage = computeGlobalAverageForUser(
      workspaceSubjects,
      workspaceGrades
    );

    if (workspaceAverage !== null) {
      workspaceAverages.push(workspaceAverage);
    }
  }

  return computeAverage(workspaceAverages);
}

function buildCumulativeTimeline(
  startDate: Date,
  days: number,
  baselineAccounts: number,
  baselineGrades: number,
  baselineSubjects: number,
  accountEntries: Array<{ createdAt: Date }>,
  gradeEntries: Array<{ createdAt: Date }>,
  subjectEntries: Array<{ createdAt: Date }>
) {
  const timeline: Array<{
    date: string;
    accounts: number;
    grades: number;
    subjects: number;
    newAccounts: number;
    newGrades: number;
    newSubjects: number;
  }> = [];

  let accountCursor = 0;
  let gradeCursor = 0;
  let subjectCursor = 0;
  let accountCumulative = baselineAccounts;
  let gradeCumulative = baselineGrades;
  let subjectCumulative = baselineSubjects;

  for (let index = 0; index < days; index += 1) {
    const dayStart = addUtcDays(startDate, index);
    const dayEnd = addUtcDays(dayStart, 1);

    let newAccounts = 0;
    while (
      accountCursor < accountEntries.length &&
      toDate(accountEntries[accountCursor].createdAt) < dayEnd
    ) {
      accountCursor += 1;
      accountCumulative += 1;
      newAccounts += 1;
    }

    let newGrades = 0;
    while (
      gradeCursor < gradeEntries.length &&
      toDate(gradeEntries[gradeCursor].createdAt) < dayEnd
    ) {
      gradeCursor += 1;
      gradeCumulative += 1;
      newGrades += 1;
    }

    let newSubjects = 0;
    while (
      subjectCursor < subjectEntries.length &&
      toDate(subjectEntries[subjectCursor].createdAt) < dayEnd
    ) {
      subjectCursor += 1;
      subjectCumulative += 1;
      newSubjects += 1;
    }

    timeline.push({
      date: dayStart.toISOString(),
      accounts: accountCumulative,
      grades: gradeCumulative,
      subjects: subjectCumulative,
      newAccounts,
      newGrades,
      newSubjects,
    });
  }

  return timeline;
}

function buildUserGradeTimeline(
  startDate: Date,
  days: number,
  baselineGrades: number,
  gradeEntries: Array<{ createdAt: Date }>
) {
  const timeline: Array<{
    date: string;
    grades: number;
    newGrades: number;
  }> = [];

  let gradeCursor = 0;
  let gradeCumulative = baselineGrades;

  for (let index = 0; index < days; index += 1) {
    const dayStart = addUtcDays(startDate, index);
    const dayEnd = addUtcDays(dayStart, 1);

    let newGrades = 0;
    while (
      gradeCursor < gradeEntries.length &&
      toDate(gradeEntries[gradeCursor].createdAt) < dayEnd
    ) {
      gradeCursor += 1;
      gradeCumulative += 1;
      newGrades += 1;
    }

    timeline.push({
      date: dayStart.toISOString(),
      grades: gradeCumulative,
      newGrades,
    });
  }

  return timeline;
}

app.get("/access", async (c) => {
  const session = c.get("session");
  return c.json({
    isAdmin: isAdminSession(session),
  });
});

/**
 * Global admin overview
 */
app.get("/overview", zValidator("query", timelineQuerySchema), async (c) => {
  const session = c.get("session");
  ensureAdminSession(session);

  const { days: timelineRange } = c.req.valid("query");
  const today = startOfUtcDay(new Date());
  const oldestGradeRow = await db
    .select({
      createdAt: grades.createdAt,
    })
    .from(grades)
    .orderBy(asc(grades.createdAt))
    .limit(1);

  const overviewEarliestDate = getEarliestDate([oldestGradeRow[0]?.createdAt]);
  const { startDate, days } = resolveTimelineWindow(
    timelineRange,
    today,
    overviewEarliestDate
  );
  const last30DaysStart = addUtcDays(today, -29);
  const last7DaysStart = addUtcDays(today, -6);

  const gradeCountExpr = sql<number>`count(${grades.id})`;
  const providerCountExpr = sql<number>`count(${accounts.id})`;
  const subjectGradeCountExpr = sql<number>`count(${grades.id})`;

  const [
    totalUsers,
    totalGrades,
    totalSubjects,
    totalYears,
    totalPeriods,
    totalSessions,
    bannedUsers,
    verifiedUsers,
    usersWithRoles,
    usersWithGradesRows,
    newUsersLast30Days,
    newGradesLast30Days,
    activeUsersLast30Days,
    newUsersLast7Days,
    newGradesLast7Days,
    activeUsersLast7Days,
    providerRows,
    topUsersRows,
    topSubjectsRows,
    yearRowsForAverage,
    subjectRowsForAverage,
    gradeRowsForAverage,
    accountEntries,
    gradeEntries,
    subjectEntries,
    baselineAccounts,
    baselineGrades,
    baselineSubjects,
  ] = await Promise.all([
    db.$count(users),
    db.$count(grades),
    db.$count(subjects),
    db.$count(years),
    db.$count(periods),
    db.$count(sessions),
    db.$count(users, eq(users.banned, true)),
    db.$count(users, eq(users.emailVerified, true)),
    db.select({ id: users.id, role: users.role }).from(users),
    db.selectDistinct({ userId: grades.userId }).from(grades),
    db.$count(users, gte(users.createdAt, last30DaysStart)),
    db.$count(grades, gte(grades.createdAt, last30DaysStart)),
    db
      .selectDistinct({ userId: grades.userId })
      .from(grades)
      .where(gte(grades.createdAt, last30DaysStart)),
    db.$count(users, gte(users.createdAt, last7DaysStart)),
    db.$count(grades, gte(grades.createdAt, last7DaysStart)),
    db
      .selectDistinct({ userId: grades.userId })
      .from(grades)
      .where(gte(grades.createdAt, last7DaysStart)),
    db
      .select({
        providerId: accounts.providerId,
        count: providerCountExpr,
      })
      .from(accounts)
      .groupBy(accounts.providerId)
      .orderBy(desc(providerCountExpr)),
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        banned: users.banned,
        gradeCount: gradeCountExpr,
        lastGradeAt: sql<Date | null>`max(${grades.createdAt})`,
      })
      .from(users)
      .leftJoin(grades, eq(users.id, grades.userId))
      .groupBy(users.id)
      .orderBy(desc(gradeCountExpr), asc(users.createdAt))
      .limit(8),
    db
      .select({
        id: subjects.id,
        name: subjects.name,
        gradeCount: subjectGradeCountExpr,
      })
      .from(subjects)
      .leftJoin(grades, eq(grades.subjectId, subjects.id))
      .groupBy(subjects.id)
      .orderBy(desc(subjectGradeCountExpr), asc(subjects.name))
      .limit(8),
    db
      .select({
        id: years.id,
        userId: years.userId,
      })
      .from(years),
    db
      .select({
        id: subjects.id,
        userId: subjects.userId,
        yearId: subjects.yearId,
        parentId: subjects.parentId,
        coefficient: subjects.coefficient,
        isDisplaySubject: subjects.isDisplaySubject,
      })
      .from(subjects),
    db
      .select({
        userId: grades.userId,
        subjectId: grades.subjectId,
        value: grades.value,
        outOf: grades.outOf,
        coefficient: grades.coefficient,
      })
      .from(grades),
    db
      .select({ createdAt: users.createdAt })
      .from(users)
      .where(gte(users.createdAt, startDate))
      .orderBy(asc(users.createdAt)),
    db
      .select({ createdAt: grades.createdAt })
      .from(grades)
      .where(gte(grades.createdAt, startDate))
      .orderBy(asc(grades.createdAt)),
    db
      .select({ createdAt: subjects.createdAt })
      .from(subjects)
      .where(gte(subjects.createdAt, startDate))
      .orderBy(asc(subjects.createdAt)),
    db.$count(users, lt(users.createdAt, startDate)),
    db.$count(grades, lt(grades.createdAt, startDate)),
    db.$count(subjects, lt(subjects.createdAt, startDate)),
  ]);

  const adminUsers = usersWithRoles.filter((row) => {
    if (configuredAdminUserIds.includes(row.id)) {
      return true;
    }

    return parseRoleList(row.role).includes("admin");
  }).length;

  const timeline = buildCumulativeTimeline(
    startDate,
    days,
    baselineAccounts,
    baselineGrades,
    baselineSubjects,
    accountEntries,
    gradeEntries,
    subjectEntries
  );

  const usersWithGrades = usersWithGradesRows.length;

  const verificationRate = totalUsers > 0 ? (verifiedUsers / totalUsers) * 100 : 0;
  const adoptionRate = totalUsers > 0 ? (usersWithGrades / totalUsers) * 100 : 0;
  const averageGradesPerUser = totalUsers > 0 ? totalGrades / totalUsers : 0;
  const averageGradesPerActiveUser =
    usersWithGrades > 0 ? totalGrades / usersWithGrades : 0;

  const workspaceSubjectsByUserId = new Map<string, AverageWorkspaceSubjectEntry[]>();
  for (const row of subjectRowsForAverage) {
    const workspaceCurrent = workspaceSubjectsByUserId.get(row.userId) ?? [];
    workspaceCurrent.push({
      id: row.id,
      yearId: row.yearId,
      parentId: row.parentId,
      coefficient: row.coefficient,
      isDisplaySubject: Boolean(row.isDisplaySubject),
    });
    workspaceSubjectsByUserId.set(row.userId, workspaceCurrent);
  }

  const gradesByUserId = new Map<string, AverageGradeEntry[]>();
  for (const row of gradeRowsForAverage) {
    const current = gradesByUserId.get(row.userId) ?? [];
    current.push({
      subjectId: row.subjectId,
      value: row.value,
      outOf: row.outOf,
      coefficient: row.coefficient,
    });
    gradesByUserId.set(row.userId, current);
  }

  const yearIdsByUserId = new Map<string, string[]>();
  for (const row of yearRowsForAverage) {
    const current = yearIdsByUserId.get(row.userId) ?? [];
    current.push(row.id);
    yearIdsByUserId.set(row.userId, current);
  }

  const userGlobalAverages = usersWithRoles
    .map((row) => {
      const userWorkspaceSubjects = workspaceSubjectsByUserId.get(row.id) ?? [];
      const userYearIds =
        yearIdsByUserId.get(row.id) ??
        [...new Set(userWorkspaceSubjects.map((subject) => subject.yearId))];

      return computeUserAverageAcrossWorkspaces(
        userYearIds,
        userWorkspaceSubjects,
        gradesByUserId.get(row.id) ?? []
      );
    })
    .filter((value): value is number => value !== null);

  const globalAverageOn20 = computeAverage(userGlobalAverages);
  const passRateOn20 =
    userGlobalAverages.length > 0
      ? (userGlobalAverages.filter((value) => value >= 10).length /
          userGlobalAverages.length) *
        100
      : null;

  const roleCountMap = new Map<string, number>();
  for (const row of usersWithRoles) {
    const roles = parseRoleList(row.role);
    const normalizedRoles = roles.length > 0 ? roles : ["user"];

    if (
      configuredAdminUserIds.includes(row.id) &&
      !normalizedRoles.includes("admin")
    ) {
      normalizedRoles.push("admin");
    }

    const uniqueRoles = [...new Set(normalizedRoles)];
    for (const role of uniqueRoles) {
      roleCountMap.set(role, (roleCountMap.get(role) ?? 0) + 1);
    }
  }

  const roleDistribution = [...roleCountMap.entries()]
    .map(([role, count]) => ({ role, count }))
    .sort((a, b) => b.count - a.count || a.role.localeCompare(b.role));

  const providerDistribution = providerRows.map((row) => ({
    providerId: row.providerId,
    count: Number(row.count),
  }));

  const topSubjects = topSubjectsRows
    .map((row) => ({
      id: row.id,
      name: row.name,
      gradeCount: Number(row.gradeCount),
    }))
    .filter((row) => row.gradeCount > 0);

  const topUsers = topUsersRows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    banned: Boolean(row.banned),
    gradeCount: Number(row.gradeCount),
    lastGradeAt: row.lastGradeAt ? toDate(row.lastGradeAt).toISOString() : null,
  }));

  const mostActiveDayByGrades = timeline.reduce<{
    date: string | null;
    count: number;
  }>(
    (current, point) =>
      point.newGrades > current.count
        ? { date: point.date, count: point.newGrades }
        : current,
    { date: null, count: 0 }
  );

  const mostActiveDayByUsers = timeline.reduce<{
    date: string | null;
    count: number;
  }>(
    (current, point) =>
      point.newAccounts > current.count
        ? { date: point.date, count: point.newAccounts }
        : current,
    { date: null, count: 0 }
  );

  return c.json({
    generatedAt: new Date().toISOString(),
    totals: {
      users: totalUsers,
      grades: totalGrades,
      subjects: totalSubjects,
      years: totalYears,
      periods: totalPeriods,
      sessions: totalSessions,
      admins: adminUsers,
      bannedUsers,
    },
    health: {
      verifiedUsers,
      usersWithGrades,
      verificationRate,
      adoptionRate,
      averageGradesPerUser,
      averageGradesPerActiveUser,
      globalAverageOn20,
      passRateOn20,
    },
    last7Days: {
      newUsers: newUsersLast7Days,
      newGrades: newGradesLast7Days,
      activeUsers: activeUsersLast7Days.length,
    },
    last30Days: {
      newUsers: newUsersLast30Days,
      newGrades: newGradesLast30Days,
      activeUsers: activeUsersLast30Days.length,
    },
    distribution: {
      roles: roleDistribution,
      providers: providerDistribution,
    },
    topSubjects,
    timeline,
    topUsers,
    insights: {
      mostActiveDayByGrades,
      mostActiveDayByUsers,
    },
  });
});

/**
 * Individual user deep stats
 */
app.get(
  "/users/:userId/stats",
  zValidator("param", userParamSchema),
  zValidator("query", timelineQuerySchema),
  async (c) => {
    const session = c.get("session");
    ensureAdminSession(session);

    const { userId } = c.req.valid("param");
    const { days: timelineRange } = c.req.valid("query");

    const targetUser = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!targetUser) {
      throw new HTTPException(404);
    }

    const today = startOfUtcDay(new Date());
    const oldestUserGradeRow = await db
      .select({
        createdAt: grades.createdAt,
      })
      .from(grades)
      .where(eq(grades.userId, userId))
      .orderBy(asc(grades.createdAt))
      .limit(1);

    const { startDate, days } = resolveTimelineWindow(
      timelineRange,
      today,
      getEarliestDate([oldestUserGradeRow[0]?.createdAt])
    );
    const last30DaysStart = addUtcDays(today, -29);

    const toTwentyScale = sql<number | null>`CASE WHEN ${grades.outOf} > 0 THEN CAST(${grades.value} AS REAL) * 20.0 / CAST(${grades.outOf} AS REAL) END`;
    const subjectGradeCountExpr = sql<number>`count(${grades.id})`;

    const [
      gradeTotal,
      subjectTotal,
      yearTotal,
      periodTotal,
      sessionTotal,
      accountTotal,
      customAverageTotal,
      newGradesLast30Days,
      baselineGrades,
      gradeEntries,
      gradeStatsRows,
      yearRowsForAverage,
      subjectRowsForAverage,
      gradeRowsForAverage,
      topSubjectsRows,
      recentGradesRows,
    ] = await Promise.all([
      db.$count(grades, eq(grades.userId, userId)),
      db.$count(subjects, eq(subjects.userId, userId)),
      db.$count(years, eq(years.userId, userId)),
      db.$count(periods, eq(periods.userId, userId)),
      db.$count(sessions, eq(sessions.userId, userId)),
      db.$count(accounts, eq(accounts.userId, userId)),
      db.$count(customAverages, eq(customAverages.userId, userId)),
      db.$count(
        grades,
        and(eq(grades.userId, userId), gte(grades.createdAt, last30DaysStart))
      ),
      db.$count(
        grades,
        and(eq(grades.userId, userId), lt(grades.createdAt, startDate))
      ),
      db
        .select({ createdAt: grades.createdAt })
        .from(grades)
        .where(and(eq(grades.userId, userId), gte(grades.createdAt, startDate)))
        .orderBy(asc(grades.createdAt)),
      db
        .select({
          averageOn20: sql<number | null>`avg(${toTwentyScale})`,
          bestOn20: sql<number | null>`max(${toTwentyScale})`,
          worstOn20: sql<number | null>`min(${toTwentyScale})`,
        })
        .from(grades)
        .where(eq(grades.userId, userId)),
      db
        .select({
          id: years.id,
        })
        .from(years)
        .where(eq(years.userId, userId)),
      db
        .select({
          id: subjects.id,
          yearId: subjects.yearId,
          parentId: subjects.parentId,
          coefficient: subjects.coefficient,
          isDisplaySubject: subjects.isDisplaySubject,
        })
        .from(subjects)
        .where(eq(subjects.userId, userId)),
      db
        .select({
          subjectId: grades.subjectId,
          value: grades.value,
          outOf: grades.outOf,
          coefficient: grades.coefficient,
        })
        .from(grades)
        .where(eq(grades.userId, userId)),
      db
        .select({
          subjectId: subjects.id,
          name: subjects.name,
          gradeCount: subjectGradeCountExpr,
        })
        .from(subjects)
        .leftJoin(
          grades,
          and(eq(grades.subjectId, subjects.id), eq(grades.userId, userId))
        )
        .where(eq(subjects.userId, userId))
        .groupBy(subjects.id)
        .orderBy(desc(subjectGradeCountExpr), asc(subjects.name))
        .limit(5),
      db
        .select({
          id: grades.id,
          name: grades.name,
          value: grades.value,
          outOf: grades.outOf,
          coefficient: grades.coefficient,
          createdAt: grades.createdAt,
          passedAt: grades.passedAt,
          subjectName: subjects.name,
        })
        .from(grades)
        .leftJoin(subjects, eq(subjects.id, grades.subjectId))
        .where(eq(grades.userId, userId))
        .orderBy(desc(grades.createdAt))
        .limit(10),
    ]);

    const gradeStats = gradeStatsRows[0] ?? {
      averageOn20: null,
      bestOn20: null,
      worstOn20: null,
    };

    const userYearIdsFromRows = yearRowsForAverage.map((row) => row.id);
    const userYearIds =
      userYearIdsFromRows.length > 0
        ? userYearIdsFromRows
        : [...new Set(subjectRowsForAverage.map((subject) => subject.yearId))];

    const averageOn20 = computeUserAverageAcrossWorkspaces(
      userYearIds,
      subjectRowsForAverage,
      gradeRowsForAverage
    );

    const timeline = buildUserGradeTimeline(
      startDate,
      days,
      baselineGrades,
      gradeEntries
    );

    return c.json({
      generatedAt: new Date().toISOString(),
      user: {
        id: targetUser.id,
        name: targetUser.name,
        email: targetUser.email,
        emailVerified: targetUser.emailVerified,
        role: targetUser.role ?? "user",
        banned: Boolean(targetUser.banned),
        banReason: targetUser.banReason,
        banExpires: targetUser.banExpires,
        createdAt: targetUser.createdAt,
        updatedAt: targetUser.updatedAt,
      },
      totals: {
        grades: gradeTotal,
        subjects: subjectTotal,
        years: yearTotal,
        periods: periodTotal,
        sessions: sessionTotal,
        accounts: accountTotal,
        customAverages: customAverageTotal,
      },
      last30Days: {
        newGrades: newGradesLast30Days,
      },
      gradeStats: {
        averageOn20,
        bestOn20:
          gradeStats.bestOn20 !== null ? Number(gradeStats.bestOn20) : null,
        worstOn20:
          gradeStats.worstOn20 !== null ? Number(gradeStats.worstOn20) : null,
      },
      timeline,
      topSubjects: topSubjectsRows.map((row) => ({
        subjectId: row.subjectId,
        name: row.name,
        gradeCount: Number(row.gradeCount),
      })),
      recentGrades: recentGradesRows.map((row) => ({
        id: row.id,
        name: row.name,
        value: row.value,
        outOf: row.outOf,
        coefficient: row.coefficient,
        createdAt: row.createdAt,
        passedAt: row.passedAt,
        subjectName: row.subjectName ?? null,
      })),
    });
  }
);

export default app;
