import { SubjectGraph } from "@avermate/core";
import { and, asc, desc, eq, gte, inArray, like, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  accounts,
  announcementPresetTargets,
  announcements,
  customAverages,
  feedback,
  grades,
  periods,
  presetDefinitions,
  preferences,
  sessions,
  subjects,
  users,
  years,
} from "../db/schema";
import { deleteAllUserFiles } from "../lib/storage";
import { isAdmin } from "../lib/admin";
import { isSuspensionActive } from "../lib/access-policy";
import { auth } from "../lib/auth";
import { newId } from "../lib/id";
import {
  adminProcedure,
  badRequest,
  notFound,
  protectedProcedure,
} from "../lib/orpc";
import { adminFeedbackRouter } from "./admin-feedback";
import { adminSocialRouter } from "./admin-social";

const overviewRange = z.union([
  z.number().int().min(7).max(365),
  z.literal("all"),
]);

/** SQLite timestamps use seconds with Drizzle's timestamp mode. */
const dayOf = (column: unknown) => sql<string>`date(${column}, 'unixepoch')`;

function startOfDay(date = new Date()): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function since(days: number): Date {
  const date = startOfDay();
  date.setDate(date.getDate() - (days - 1));
  return date;
}

function listOf(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

const announcementAudience = z.enum(["global", "preset"]);
const announcementPresetIds = z
  .array(z.string().trim().min(1))
  .max(50)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "Preset targets must be unique",
  });

async function normalizeAnnouncementTargets(
  audience: z.infer<typeof announcementAudience>,
  presetIds: string[],
): Promise<string[]> {
  if (audience === "global") {
    if (presetIds.length > 0) {
      badRequest("Global announcements cannot have preset targets");
    }
    return [];
  }
  if (presetIds.length === 0) {
    badRequest("A preset announcement needs at least one preset target");
  }

  const ids = [...new Set(presetIds)];
  const existing = await db
    .select({ id: presetDefinitions.id })
    .from(presetDefinitions)
    .where(inArray(presetDefinitions.id, ids));
  if (existing.length !== ids.length) {
    badRequest("One or more preset targets do not exist");
  }
  return ids;
}

async function listAdminAnnouncements() {
  const [messages, targetRows] = await Promise.all([
    db.select().from(announcements).orderBy(desc(announcements.createdAt)),
    db
      .select({
        announcementId: announcementPresetTargets.announcementId,
        id: presetDefinitions.id,
        name: presetDefinitions.name,
        archived: presetDefinitions.archived,
      })
      .from(announcementPresetTargets)
      .innerJoin(
        presetDefinitions,
        eq(presetDefinitions.id, announcementPresetTargets.presetId),
      )
      .orderBy(asc(presetDefinitions.name)),
  ]);

  const targetsByAnnouncement = new Map<
    string,
    Array<{ id: string; name: string; archived: boolean }>
  >();
  for (const target of targetRows) {
    const targets = targetsByAnnouncement.get(target.announcementId) ?? [];
    targets.push({
      id: target.id,
      name: target.name,
      archived: target.archived,
    });
    targetsByAnnouncement.set(target.announcementId, targets);
  }

  return messages.map((announcement) => {
    const presets = targetsByAnnouncement.get(announcement.id) ?? [];
    return {
      ...announcement,
      presetIds: presets.map((preset) => preset.id),
      presets,
    };
  });
}

function roleList(role: string | null | undefined): string[] {
  const roles = role
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return roles?.length ? roles : ["user"];
}

function ensureDifferentUser(
  actorId: string,
  targetId: string,
  action: string,
) {
  if (actorId === targetId) badRequest(`You cannot ${action} your own account`);
}

function normalizeDailyRows(
  rows: Array<{ day: string | null; count: number }>,
): Array<{ day: string; count: number }> {
  return rows
    .filter((row): row is { day: string; count: number } => Boolean(row.day))
    .map((row) => ({ day: row.day, count: Number(row.count) }));
}

function timelineInsight(rows: Array<{ day: string; count: number }>) {
  return rows.reduce<{ day: string | null; count: number }>(
    (best, row) => (row.count > best.count ? row : best),
    { day: null, count: 0 },
  );
}

type AverageSubjectRow = {
  id: string;
  userId: string;
  yearId: string;
  name: string;
  shortName: string | null;
  parentId: string | null;
  coefficient: number;
  kind: string;
  isMain: boolean;
  sortOrder: number;
};

type AverageGradeRow = {
  id: string;
  userId: string;
  yearId: string;
  subjectId: string;
  name: string;
  value: number;
  outOf: number;
  coefficient: number;
  passedAt: Date;
  createdAt: Date;
  periodId: string | null;
  note: string | null;
};

/** Average every academic workspace with the same hierarchy engine as the app. */
function userWorkspaceRatios(
  subjectRows: AverageSubjectRow[],
  gradeRows: AverageGradeRow[],
): Map<string, number> {
  const gradesBySubject = new Map<string, AverageGradeRow[]>();
  for (const grade of gradeRows) {
    const entries = gradesBySubject.get(grade.subjectId) ?? [];
    entries.push(grade);
    gradesBySubject.set(grade.subjectId, entries);
  }

  const workspacesByUser = new Map<string, Map<string, AverageSubjectRow[]>>();
  for (const subject of subjectRows) {
    const workspaces = workspacesByUser.get(subject.userId) ?? new Map();
    const entries = workspaces.get(subject.yearId) ?? [];
    entries.push(subject);
    workspaces.set(subject.yearId, entries);
    workspacesByUser.set(subject.userId, workspaces);
  }

  const averages = new Map<string, number>();
  for (const [userId, workspaces] of workspacesByUser) {
    const ratios: number[] = [];
    for (const workspaceSubjects of workspaces.values()) {
      const graph = new SubjectGraph(
        workspaceSubjects.map((subject) => ({
          id: subject.id,
          name: subject.name,
          shortName: subject.shortName,
          parentId: subject.parentId,
          coefficient: subject.coefficient,
          kind: subject.kind === "category" ? "category" : "subject",
          isMain: subject.isMain,
          sortOrder: subject.sortOrder,
          grades: (gradesBySubject.get(subject.id) ?? []).map((grade) => ({
            id: grade.id,
            name: grade.name,
            value: grade.value,
            outOf: grade.outOf,
            coefficient: grade.coefficient,
            passedAt: grade.passedAt,
            createdAt: grade.createdAt,
            subjectId: grade.subjectId,
            periodId: grade.periodId,
            note: grade.note,
            components: [],
          })),
        })),
      );
      const ratio = graph.ratio(null);
      if (ratio !== null) ratios.push(ratio);
    }

    if (ratios.length > 0) {
      averages.set(
        userId,
        ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length,
      );
    }
  }

  return averages;
}

export const adminRouter = {
  ...adminFeedbackRouter,
  ...adminSocialRouter,
  /** Navigation can ask this without intentionally producing a 403. */
  access: protectedProcedure.handler(({ context }) => ({
    isAdmin: isAdmin(context.session.user),
  })),

  overview: adminProcedure
    .input(z.object({ days: overviewRange.default(30) }))
    .handler(async ({ input }) => {
      const from = input.days === "all" ? null : since(input.days);
      const last7 = since(7);
      const last30 = since(30);
      const dateFilter = <T>(column: T) =>
        from ? gte(column as never, from) : undefined;
      const [
        [
          totals = {
            users: 0,
            years: 0,
            periods: 0,
            subjects: 0,
            grades: 0,
            sessions: 0,
            bannedUsers: 0,
          },
        ],
        [verified = { count: 0 }],
        roleRows,
        providerRows,
        usersWithGradesRows,
        averageSubjectRows,
        averageGradeRows,
        signupsRaw,
        gradeActivityRaw,
        subjectActivityRaw,
        [weeklyActive = { count: 0 }],
        [openFeedback = { count: 0 }],
        [newUsers7 = { count: 0 }],
        [newGrades7 = { count: 0 }],
        activeUsers7,
        [newUsers30 = { count: 0 }],
        [newGrades30 = { count: 0 }],
        activeUsers30,
        topUsersRows,
        topSubjectsRows,
      ] = await Promise.all([
        db
          .select({
            users: sql<number>`(select count(*) from ${users})`,
            years: sql<number>`(select count(*) from ${years})`,
            periods: sql<number>`(select count(*) from ${periods})`,
            subjects: sql<number>`(select count(*) from ${subjects})`,
            grades: sql<number>`(select count(*) from ${grades})`,
            sessions: sql<number>`(select count(*) from ${sessions})`,
            bannedUsers: sql<number>`(select count(*) from ${users} where ${users.banned} = 1 and (${users.banExpires} is null or ${users.banExpires} > unixepoch()))`,
          })
          .from(sql`(select 1)`),
        db
          .select({ count: sql<number>`count(*)` })
          .from(users)
          .where(eq(users.emailVerified, true)),
        db.select({ id: users.id, role: users.role }).from(users),
        db
          .select({
            providerId: accounts.providerId,
            count: sql<number>`count(*)`,
          })
          .from(accounts)
          .groupBy(accounts.providerId)
          .orderBy(desc(sql<number>`count(*)`)),
        db.selectDistinct({ userId: grades.userId }).from(grades),
        db
          .select({
            id: subjects.id,
            userId: subjects.userId,
            yearId: subjects.yearId,
            name: subjects.name,
            shortName: subjects.shortName,
            parentId: subjects.parentId,
            coefficient: subjects.coefficient,
            kind: subjects.kind,
            isMain: subjects.isMain,
            sortOrder: subjects.sortOrder,
          })
          .from(subjects),
        db
          .select({
            id: grades.id,
            userId: grades.userId,
            yearId: grades.yearId,
            subjectId: grades.subjectId,
            name: grades.name,
            value: grades.value,
            outOf: grades.outOf,
            coefficient: grades.coefficient,
            excludedFromAverage: grades.excludedFromAverage,
            syncExcludedFromAverage: grades.syncExcludedFromAverage,
            passedAt: grades.passedAt,
            createdAt: grades.createdAt,
            periodId: grades.periodId,
            note: grades.note,
          })
          .from(grades),
        db
          .select({ day: dayOf(users.createdAt), count: sql<number>`count(*)` })
          .from(users)
          .where(dateFilter(users.createdAt))
          .groupBy(dayOf(users.createdAt))
          .orderBy(asc(dayOf(users.createdAt))),
        db
          .select({
            day: dayOf(grades.createdAt),
            count: sql<number>`count(*)`,
          })
          .from(grades)
          .where(dateFilter(grades.createdAt))
          .groupBy(dayOf(grades.createdAt))
          .orderBy(asc(dayOf(grades.createdAt))),
        db
          .select({
            day: dayOf(subjects.createdAt),
            count: sql<number>`count(*)`,
          })
          .from(subjects)
          .where(dateFilter(subjects.createdAt))
          .groupBy(dayOf(subjects.createdAt))
          .orderBy(asc(dayOf(subjects.createdAt))),
        db
          .select({ count: sql<number>`count(distinct ${sessions.userId})` })
          .from(sessions)
          .where(gte(sessions.updatedAt, last7)),
        db
          .select({ count: sql<number>`count(*)` })
          .from(feedback)
          .where(eq(feedback.status, "open")),
        db
          .select({ count: sql<number>`count(*)` })
          .from(users)
          .where(gte(users.createdAt, last7)),
        db
          .select({ count: sql<number>`count(*)` })
          .from(grades)
          .where(gte(grades.createdAt, last7)),
        db
          .selectDistinct({ userId: grades.userId })
          .from(grades)
          .where(gte(grades.createdAt, last7)),
        db
          .select({ count: sql<number>`count(*)` })
          .from(users)
          .where(gte(users.createdAt, last30)),
        db
          .select({ count: sql<number>`count(*)` })
          .from(grades)
          .where(gte(grades.createdAt, last30)),
        db
          .selectDistinct({ userId: grades.userId })
          .from(grades)
          .where(gte(grades.createdAt, last30)),
        db
          .select({
            id: users.id,
            name: users.name,
            email: users.email,
            role: users.role,
            banned: users.banned,
            banExpires: users.banExpires,
            gradeCount: sql<number>`count(${grades.id})`,
            lastGradeAt: sql<Date | null>`max(${grades.createdAt})`,
          })
          .from(users)
          .leftJoin(grades, eq(grades.userId, users.id))
          .groupBy(users.id)
          .orderBy(desc(sql<number>`count(${grades.id})`), asc(users.createdAt))
          .limit(8),
        db
          .select({
            id: subjects.id,
            name: subjects.name,
            gradeCount: sql<number>`count(${grades.id})`,
          })
          .from(subjects)
          .leftJoin(grades, eq(grades.subjectId, subjects.id))
          .groupBy(subjects.id)
          .orderBy(desc(sql<number>`count(${grades.id})`), asc(subjects.name))
          .limit(8),
      ]);

      const signups = normalizeDailyRows(signupsRaw);
      const gradeActivity = normalizeDailyRows(gradeActivityRaw);
      const subjectActivity = normalizeDailyRows(subjectActivityRaw);
      const roleCounts = new Map<string, number>();
      for (const row of roleRows) {
        for (const role of new Set(roleList(row.role))) {
          roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
        }
      }
      const averages = [
        ...userWorkspaceRatios(averageSubjectRows, averageGradeRows).values(),
      ].map((ratio) => ratio * 20);
      const usersWithGrades = usersWithGradesRows.length;
      const totalUsers = Number(totals.users);
      const totalGrades = Number(totals.grades);

      return {
        generatedAt: new Date(),
        range: input.days,
        totals: {
          ...totals,
          admins: roleRows.filter((row) => isAdmin(row)).length,
        },
        health: {
          verifiedUsers: Number(verified.count),
          usersWithGrades,
          verificationRate:
            totalUsers > 0 ? (Number(verified.count) / totalUsers) * 100 : 0,
          adoptionRate:
            totalUsers > 0 ? (usersWithGrades / totalUsers) * 100 : 0,
          averageGradesPerUser: totalUsers > 0 ? totalGrades / totalUsers : 0,
          averageGradesPerActiveUser:
            usersWithGrades > 0 ? totalGrades / usersWithGrades : 0,
          globalAverageOn20:
            averages.length > 0
              ? averages.reduce((sum, value) => sum + value, 0) /
                averages.length
              : null,
          passRateOn20:
            averages.length > 0
              ? (averages.filter((value) => value >= 10).length /
                  averages.length) *
                100
              : null,
        },
        last7Days: {
          newUsers: Number(newUsers7.count),
          newGrades: Number(newGrades7.count),
          activeUsers: activeUsers7.length,
        },
        last30Days: {
          newUsers: Number(newUsers30.count),
          newGrades: Number(newGrades30.count),
          activeUsers: activeUsers30.length,
        },
        distribution: {
          roles: [...roleCounts.entries()]
            .map(([role, count]) => ({ role, count }))
            .sort((left, right) => right.count - left.count),
          providers: providerRows.map((row) => ({
            providerId: row.providerId,
            count: Number(row.count),
          })),
        },
        signups,
        gradeActivity,
        subjectActivity,
        weeklyActiveUsers: Number(weeklyActive.count),
        openFeedback: Number(openFeedback.count),
        topUsers: topUsersRows.map((row) => ({
          ...row,
          banned: isSuspensionActive(row),
          gradeCount: Number(row.gradeCount),
        })),
        topSubjects: topSubjectsRows
          .map((row) => ({ ...row, gradeCount: Number(row.gradeCount) }))
          .filter((row) => row.gradeCount > 0),
        insights: {
          mostActiveDayByGrades: timelineInsight(gradeActivity),
          mostActiveDayByUsers: timelineInsight(signups),
        },
      };
    }),

  users: adminProcedure
    .input(
      z.object({
        query: z.string().trim().max(120).default(""),
        limit: z.number().int().min(1).max(100).default(25),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .handler(async ({ input }) => {
      const filter = input.query
        ? or(
            like(sql`lower(${users.email})`, `%${input.query.toLowerCase()}%`),
            like(sql`lower(${users.name})`, `%${input.query.toLowerCase()}%`),
            like(sql`lower(${users.id})`, `%${input.query.toLowerCase()}%`),
          )
        : undefined;

      const rows = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          image: users.avatarUrl,
          emailVerified: users.emailVerified,
          role: users.role,
          banned: users.banned,
          banReason: users.banReason,
          banExpires: users.banExpires,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
          unlockedThemes: preferences.unlockedThemes,
          years: sql<number>`(select count(*) from ${years} where ${years.userId} = ${users.id})`,
          grades: sql<number>`(select count(*) from ${grades} where ${grades.userId} = ${users.id})`,
        })
        .from(users)
        .leftJoin(preferences, eq(preferences.userId, users.id))
        .where(filter)
        .orderBy(desc(users.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const [{ total = 0 } = {}] = await db
        .select({ total: sql<number>`count(*)` })
        .from(users)
        .where(filter);

      return {
        users: rows.map(({ unlockedThemes, ...row }) => ({
          ...row,
          banned: isSuspensionActive(row),
          mokattamThemeAvailable: listOf(unlockedThemes).includes("mokattam"),
        })),
        total: Number(total),
        limit: input.limit,
        offset: input.offset,
      };
    }),

  user: adminProcedure
    .input(z.object({ userId: z.string(), days: overviewRange.default(90) }))
    .handler(async ({ input }) => {
      const [user] = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          image: users.avatarUrl,
          emailVerified: users.emailVerified,
          role: users.role,
          banned: users.banned,
          banReason: users.banReason,
          banExpires: users.banExpires,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
          themePreset: preferences.themePreset,
          unlockedThemes: preferences.unlockedThemes,
        })
        .from(users)
        .leftJoin(preferences, eq(preferences.userId, users.id))
        .where(eq(users.id, input.userId))
        .limit(1);
      if (!user) notFound("User");

      const from = input.days === "all" ? null : since(input.days);
      const ratio = sql<
        number | null
      >`case when ${grades.outOf} > 0 then (${grades.value} * 20.0 / ${grades.outOf}) end`;
      const [
        yearRows,
        sessionRows,
        providerRows,
        [totals],
        [gradeStats],
        averageSubjectRows,
        averageGradeRows,
        activityRaw,
        topSubjects,
        recentGrades,
      ] = await Promise.all([
        db
          .select({
            id: years.id,
            name: years.name,
            startsAt: years.startsAt,
            endsAt: years.endsAt,
            archivedAt: years.archivedAt,
          })
          .from(years)
          .where(eq(years.userId, user.id))
          .orderBy(desc(years.startsAt)),
        db
          .select({
            id: sessions.id,
            createdAt: sessions.createdAt,
            updatedAt: sessions.updatedAt,
            expiresAt: sessions.expiresAt,
            userAgent: sessions.userAgent,
            ipAddress: sessions.ipAddress,
          })
          .from(sessions)
          .where(eq(sessions.userId, user.id))
          .orderBy(desc(sessions.updatedAt))
          .limit(20),
        db
          .select({
            providerId: accounts.providerId,
            createdAt: accounts.createdAt,
          })
          .from(accounts)
          .where(eq(accounts.userId, user.id)),
        db
          .select({
            grades: sql<number>`(select count(*) from ${grades} where ${grades.userId} = ${user.id})`,
            subjects: sql<number>`(select count(*) from ${subjects} where ${subjects.userId} = ${user.id})`,
            years: sql<number>`(select count(*) from ${years} where ${years.userId} = ${user.id})`,
            periods: sql<number>`(select count(*) from ${periods} where ${periods.userId} = ${user.id})`,
            customAverages: sql<number>`(select count(*) from ${customAverages} where ${customAverages.userId} = ${user.id})`,
          })
          .from(sql`(select 1)`),
        db
          .select({
            bestOn20: sql<number | null>`max(${ratio})`,
            worstOn20: sql<number | null>`min(${ratio})`,
          })
          .from(grades)
          .where(and(eq(grades.userId, user.id), sql`${grades.outOf} > 0`)),
        db
          .select({
            id: subjects.id,
            userId: subjects.userId,
            yearId: subjects.yearId,
            name: subjects.name,
            shortName: subjects.shortName,
            parentId: subjects.parentId,
            coefficient: subjects.coefficient,
            kind: subjects.kind,
            isMain: subjects.isMain,
            sortOrder: subjects.sortOrder,
          })
          .from(subjects)
          .where(eq(subjects.userId, user.id)),
        db
          .select({
            id: grades.id,
            userId: grades.userId,
            yearId: grades.yearId,
            subjectId: grades.subjectId,
            name: grades.name,
            value: grades.value,
            outOf: grades.outOf,
            coefficient: grades.coefficient,
            excludedFromAverage: grades.excludedFromAverage,
            syncExcludedFromAverage: grades.syncExcludedFromAverage,
            passedAt: grades.passedAt,
            createdAt: grades.createdAt,
            periodId: grades.periodId,
            note: grades.note,
          })
          .from(grades)
          .where(eq(grades.userId, user.id)),
        db
          .select({
            day: dayOf(grades.createdAt),
            count: sql<number>`count(*)`,
          })
          .from(grades)
          .where(
            and(
              eq(grades.userId, user.id),
              from ? gte(grades.createdAt, from) : undefined,
            ),
          )
          .groupBy(dayOf(grades.createdAt))
          .orderBy(asc(dayOf(grades.createdAt))),
        db
          .select({
            id: subjects.id,
            name: subjects.name,
            gradeCount: sql<number>`count(${grades.id})`,
          })
          .from(subjects)
          .leftJoin(grades, eq(grades.subjectId, subjects.id))
          .where(eq(subjects.userId, user.id))
          .groupBy(subjects.id)
          .orderBy(desc(sql<number>`count(${grades.id})`))
          .limit(6),
        db
          .select({
            id: grades.id,
            name: grades.name,
            value: grades.value,
            outOf: grades.outOf,
            coefficient: grades.coefficient,
            passedAt: grades.passedAt,
            createdAt: grades.createdAt,
            subjectName: subjects.name,
          })
          .from(grades)
          .innerJoin(subjects, eq(subjects.id, grades.subjectId))
          .where(eq(grades.userId, user.id))
          .orderBy(desc(grades.passedAt))
          .limit(12),
      ]);

      const { unlockedThemes, ...safeUser } = user;
      const hierarchicalAverage = userWorkspaceRatios(
        averageSubjectRows,
        averageGradeRows,
      ).get(user.id);
      return {
        generatedAt: new Date(),
        user: {
          ...safeUser,
          banned: isSuspensionActive(safeUser),
          mokattamThemeAvailable: listOf(unlockedThemes).includes("mokattam"),
        },
        totals: {
          ...(totals ?? {
            grades: 0,
            subjects: 0,
            years: 0,
            periods: 0,
            customAverages: 0,
          }),
          sessions: sessionRows.length,
          accounts: providerRows.length,
        },
        gradeStats: {
          averageOn20:
            hierarchicalAverage === undefined ? null : hierarchicalAverage * 20,
          bestOn20:
            gradeStats?.bestOn20 == null ? null : Number(gradeStats.bestOn20),
          worstOn20:
            gradeStats?.worstOn20 == null ? null : Number(gradeStats.worstOn20),
        },
        timeline: normalizeDailyRows(activityRaw),
        topSubjects: topSubjects.map((row) => ({
          ...row,
          gradeCount: Number(row.gradeCount),
        })),
        recentGrades,
        years: yearRows,
        sessions: sessionRows,
        providers: providerRows,
      };
    }),

  createUser: adminProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(120),
        email: z.string().trim().email().max(320),
        password: z.string().min(8).max(128),
        role: z.enum(["user", "admin"]).default("user"),
      }),
    )
    .handler(async ({ context, input }) => {
      try {
        return await auth.api.createUser({
          headers: context.headers,
          body: {
            ...input,
            email: input.email.toLowerCase(),
          },
        });
      } catch (error) {
        badRequest(
          error instanceof Error
            ? error.message
            : "The account could not be created",
        );
      }
    }),

  setRole: adminProcedure
    .input(z.object({ userId: z.string(), role: z.enum(["user", "admin"]) }))
    .handler(async ({ context, input }) => {
      if (input.role === "user") {
        ensureDifferentUser(context.session.user.id, input.userId, "demote");
      }
      const [updated] = await db
        .update(users)
        .set({ role: input.role, updatedAt: new Date() })
        .where(eq(users.id, input.userId))
        .returning();
      if (!updated) notFound("User");
      return updated;
    }),

  setBanned: adminProcedure
    .input(
      z.object({
        userId: z.string(),
        banned: z.boolean(),
        reason: z.string().trim().min(1).max(300).nullable().default(null),
        expiresAt: z.coerce.date().nullable().default(null),
      }),
    )
    .handler(async ({ context, input }) => {
      if (input.banned) {
        ensureDifferentUser(context.session.user.id, input.userId, "suspend");
        if (input.expiresAt && input.expiresAt <= new Date()) {
          badRequest("A suspension expiry must be in the future");
        }
      }
      const [updated] = await db
        .update(users)
        .set({
          banned: input.banned,
          banReason: input.banned ? input.reason : null,
          banExpires: input.banned ? input.expiresAt : null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, input.userId))
        .returning();
      if (!updated) notFound("User");
      if (input.banned) {
        await db.delete(sessions).where(eq(sessions.userId, input.userId));
      }
      return updated;
    }),

  deleteUser: adminProcedure
    .input(z.object({ userId: z.string(), confirmation: z.string() }))
    .handler(async ({ context, input }) => {
      ensureDifferentUser(context.session.user.id, input.userId, "delete");
      if (input.confirmation !== input.userId) {
        badRequest("The confirmation does not match the account id");
      }
      await deleteAllUserFiles(input.userId);
      const [deleted] = await db
        .delete(users)
        .where(eq(users.id, input.userId))
        .returning({ id: users.id });
      if (!deleted) notFound("User");
      return { ok: true };
    }),

  grantTheme: adminProcedure
    .input(
      z.object({
        userId: z.string(),
        theme: z.literal("mokattam"),
        available: z.boolean(),
      }),
    )
    .handler(async ({ input }) => {
      const [target] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);
      if (!target) notFound("User");

      const [stored] = await db
        .select()
        .from(preferences)
        .where(eq(preferences.userId, input.userId))
        .limit(1);
      if (!stored) {
        await db.insert(preferences).values({
          userId: input.userId,
          unlockedThemes: input.available
            ? JSON.stringify([input.theme])
            : "[]",
        });
      } else {
        const unlocked = new Set(listOf(stored.unlockedThemes));
        const seen = new Set(listOf(stored.seenCelebrations));
        if (input.available) {
          unlocked.add(input.theme);
          seen.delete(`${input.theme}-unlocked`);
        } else {
          unlocked.delete(input.theme);
        }
        await db
          .update(preferences)
          .set({
            unlockedThemes: JSON.stringify([...unlocked]),
            seenCelebrations: JSON.stringify([...seen]),
            ...(input.available || stored.themePreset !== input.theme
              ? {}
              : { themePreset: "default" }),
            updatedAt: new Date(),
          })
          .where(eq(preferences.userId, input.userId));
      }
      return {
        userId: input.userId,
        theme: input.theme,
        available: input.available,
      };
    }),

  announcements: adminProcedure.handler(listAdminAnnouncements),

  createAnnouncement: adminProcedure
    .input(
      z
        .object({
          title: z.string().trim().min(1).max(120),
          message: z.string().trim().min(1).max(2000),
          tone: z
            .enum(["info", "success", "warning", "danger"])
            .default("info"),
          audience: announcementAudience.default("global"),
          presetIds: announcementPresetIds.default([]),
          active: z.boolean().default(true),
          startsAt: z.coerce.date().nullable().default(null),
          endsAt: z.coerce.date().nullable().default(null),
        })
        .refine(
          (value) =>
            !value.startsAt || !value.endsAt || value.startsAt <= value.endsAt,
          {
            message: "The end must be after the start",
            path: ["endsAt"],
          },
        ),
    )
    .handler(async ({ context, input }) => {
      const { presetIds, ...announcement } = input;
      const targets = await normalizeAnnouncementTargets(
        announcement.audience,
        presetIds,
      );
      const id = newId("ann");
      const statements = [
        db.insert(announcements).values({
          ...announcement,
          id,
          createdByUserId: context.session.user.id,
        }),
        ...(targets.length > 0
          ? [
              db
                .insert(announcementPresetTargets)
                .values(
                  targets.map((presetId) => ({ announcementId: id, presetId })),
                ),
            ]
          : []),
      ];
      await db.batch(
        statements as [
          (typeof statements)[number],
          ...(typeof statements)[number][],
        ],
      );
      const created = (await listAdminAnnouncements()).find(
        (created) => created.id === id,
      );
      if (!created) notFound("Announcement");
      return created;
    }),

  updateAnnouncement: adminProcedure
    .input(
      z.object({
        announcementId: z.string(),
        title: z.string().trim().min(1).max(120).optional(),
        message: z.string().trim().min(1).max(2000).optional(),
        tone: z.enum(["info", "success", "warning", "danger"]).optional(),
        audience: announcementAudience.optional(),
        presetIds: announcementPresetIds.optional(),
        active: z.boolean().optional(),
        startsAt: z.coerce.date().nullable().optional(),
        endsAt: z.coerce.date().nullable().optional(),
      }),
    )
    .handler(async ({ input }) => {
      const { announcementId, presetIds, ...patch } = input;
      const [[existing], existingTargets] = await Promise.all([
        db
          .select()
          .from(announcements)
          .where(eq(announcements.id, announcementId))
          .limit(1),
        db
          .select({ presetId: announcementPresetTargets.presetId })
          .from(announcementPresetTargets)
          .where(eq(announcementPresetTargets.announcementId, announcementId)),
      ]);
      if (!existing) notFound("Announcement");
      const currentAudience = announcementAudience.parse(existing.audience);
      const finalAudience = patch.audience ?? currentAudience;
      const requestedTargets =
        presetIds ??
        (patch.audience === "global"
          ? []
          : existingTargets.map((target) => target.presetId));
      const targets = await normalizeAnnouncementTargets(
        finalAudience,
        requestedTargets,
      );
      const startsAt =
        patch.startsAt === undefined ? existing.startsAt : patch.startsAt;
      const endsAt =
        patch.endsAt === undefined ? existing.endsAt : patch.endsAt;
      if (startsAt && endsAt && startsAt > endsAt) {
        badRequest("The end must be after the start");
      }
      const statements = [
        db
          .update(announcements)
          .set({ ...patch, audience: finalAudience, updatedAt: new Date() })
          .where(eq(announcements.id, announcementId)),
        db
          .delete(announcementPresetTargets)
          .where(eq(announcementPresetTargets.announcementId, announcementId)),
        ...(targets.length > 0
          ? [
              db
                .insert(announcementPresetTargets)
                .values(
                  targets.map((presetId) => ({ announcementId, presetId })),
                ),
            ]
          : []),
      ];
      await db.batch(
        statements as [
          (typeof statements)[number],
          ...(typeof statements)[number][],
        ],
      );
      const updated = (await listAdminAnnouncements()).find(
        (updated) => updated.id === announcementId,
      );
      if (!updated) notFound("Announcement");
      return updated;
    }),

  deleteAnnouncement: adminProcedure
    .input(z.object({ announcementId: z.string() }))
    .handler(async ({ input }) => {
      const [deleted] = await db
        .delete(announcements)
        .where(eq(announcements.id, input.announcementId))
        .returning({ id: announcements.id });
      if (!deleted) notFound("Announcement");
      return { ok: true };
    }),

  feedback: adminProcedure
    .input(
      z.object({
        status: z.enum(["open", "closed", "all"]).default("open"),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .handler(async ({ input }) => {
      const where =
        input.status === "all" ? undefined : eq(feedback.status, input.status);
      return db
        .select({
          id: feedback.id,
          kind: feedback.kind,
          subject: feedback.subject,
          message: feedback.message,
          attachmentUrl: feedback.attachmentUrl,
          context: feedback.context,
          status: feedback.status,
          createdAt: feedback.createdAt,
          updatedAt: feedback.updatedAt,
          userId: feedback.userId,
          userEmail: users.email,
          userName: users.name,
        })
        .from(feedback)
        .innerJoin(users, eq(feedback.userId, users.id))
        .where(where)
        .orderBy(desc(feedback.createdAt))
        .limit(input.limit)
        .offset(input.offset);
    }),

  setFeedbackStatus: adminProcedure
    .input(
      z.object({
        feedbackId: z.string(),
        status: z.enum(["open", "closed"]),
      }),
    )
    .handler(async ({ input }) => {
      const [updated] = await db
        .update(feedback)
        .set({ status: input.status, updatedAt: new Date() })
        .where(eq(feedback.id, input.feedbackId))
        .returning();
      if (!updated) notFound("Feedback");
      return updated;
    }),
};
