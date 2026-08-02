/**
 * Migrates an Avermate v1 database into the v2 schema.
 *
 *   LEGACY_DATABASE_URL=file:../api/dev.db bun scripts/migrate-legacy.ts [--dry-run]
 *
 * The two schemas differ in three ways that matter, and each is handled here
 * rather than left for the application to work around:
 *
 *   - Coefficients were stored ×100 as integers. They are real numbers now,
 *     so everything divides by 100 on the way in.
 *   - `isDisplaySubject` became `kind: "category"`, which is the same idea
 *     with a name that says what it does.
 *   - Custom averages kept their subject list as a JSON blob. It is a table
 *     now, so deleting a subject cleans up after itself.
 *
 * Ids are preserved throughout: a bookmarked link to a grade still resolves
 * after the migration, and re-running the script is idempotent.
 */
import { createClient } from "@libsql/client";
import { eq, sql } from "drizzle-orm";
import { db } from "../src/db";
import {
  accounts,
  customAverageEntries,
  customAverages,
  dashboardCards,
  gradeComponents,
  grades,
  periods,
  preferences,
  sessions,
  subjects,
  users,
  verifications,
  years,
} from "../src/db/schema";
import { defaultCards } from "@avermate/core";

const LEGACY_URL = process.env.LEGACY_DATABASE_URL ?? "file:../api/dev.db";
const DRY_RUN = process.argv.includes("--dry-run");

const legacy = createClient({
  url: LEGACY_URL,
  authToken: process.env.LEGACY_DATABASE_AUTH_TOKEN,
});

type Row = Record<string, unknown>;

/**
 * v1's tables are snake_case on disk even though its schema file reads as
 * camelCase — drizzle's casing was doing the translation. Normalising here
 * means the rest of this script can name columns the way the code does.
 */
function camelKeys(row: Row): Row {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = value;
    const camel = key.replace(/_([a-z])/g, (_, letter: string) =>
      letter.toUpperCase(),
    );
    if (camel !== key) out[camel] = value;
  }
  return out;
}

async function read(table: string): Promise<Row[]> {
  try {
    const result = await legacy.execute(`select * from ${table}`);
    return (result.rows as unknown as Row[]).map(camelKeys);
  } catch (error) {
    console.warn(`  · ${table}: unreadable (${String(error)})`);
    return [];
  }
}

const asString = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

const asNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const asBoolean = (value: unknown): boolean =>
  value === true || value === 1 || value === "1";

/** Legacy timestamps are seconds or milliseconds depending on the column. */
const asDate = (value: unknown, fallback = new Date()): Date => {
  if (value === null || value === undefined) return fallback;
  const raw = Number(value);
  if (!Number.isFinite(raw)) {
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? fallback : parsed;
  }
  // Anything below this is far too small to be milliseconds since the epoch.
  return new Date(raw < 100_000_000_000 ? raw * 1000 : raw);
};

/** v1 stored coefficients and grade values scaled by 100. */
const unscale = (value: unknown, fallback = 1): number => {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return fallback;
  return raw / 100;
};

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** Drizzle refuses an empty `values()`, and a filtered list is often empty. */
async function insertMany<T>(
  run: (rows: T[]) => Promise<unknown>,
  rows: T[],
): Promise<void> {
  if (rows.length === 0) return;
  await run(rows);
}

async function main() {
  console.info(`Reading the v1 database at ${LEGACY_URL}`);

  const [
    legacyUsers,
    legacyAccounts,
    legacySessions,
    legacyVerifications,
    legacySettings,
    legacyYears,
    legacyPeriods,
    legacySubjects,
    legacyGrades,
    legacyComponents,
    legacyAverages,
  ] = await Promise.all([
    read("users"),
    read("accounts"),
    read("sessions"),
    read("verifications"),
    read("user_settings"),
    read("years"),
    read("periods"),
    read("subjects"),
    read("grades"),
    read("grade_components"),
    read("custom_averages"),
  ]);

  const counts = {
    users: legacyUsers.length,
    years: legacyYears.length,
    periods: legacyPeriods.length,
    subjects: legacySubjects.length,
    grades: legacyGrades.length,
    components: legacyComponents.length,
    averages: legacyAverages.length,
  };
  console.info("Found:", counts);

  if (DRY_RUN) {
    console.info("Dry run — nothing written.");
    return;
  }

  const userIds = new Set(legacyUsers.map((row) => String(row.id)));

  await insertMany(
    (rows) => db.insert(users).values(rows).onConflictDoNothing(),
    legacyUsers.map((row) => ({
      id: String(row.id),
      name: asString(row.name) ?? "",
      email: String(row.email),
      emailVerified: asBoolean(row.emailVerified),
      avatarUrl: asString(row.avatarUrl),
      role: asString(row.role) ?? "user",
      banned: asBoolean(row.banned),
      banReason: asString(row.banReason),
      banExpires: row.banExpires ? asDate(row.banExpires) : null,
      createdAt: asDate(row.createdAt),
      updatedAt: asDate(row.updatedAt),
    })),
  );

  await insertMany(
    (rows) => db.insert(accounts).values(rows).onConflictDoNothing(),
    legacyAccounts
        .filter((row) => userIds.has(String(row.userId)))
        .map((row) => ({
          id: String(row.id),
          accountId: String(row.accountId),
          providerId: String(row.providerId),
          userId: String(row.userId),
          accessToken: asString(row.accessToken),
          accessTokenExpiresAt: row.accessTokenExpiresAt
            ? asDate(row.accessTokenExpiresAt)
            : null,
          refreshToken: asString(row.refreshToken),
          refreshTokenExpiresAt: row.refreshTokenExpiresAt
            ? asDate(row.refreshTokenExpiresAt)
            : null,
          scope: asString(row.scope),
          idToken: asString(row.idToken),
          password: asString(row.password),
          createdAt: asDate(row.createdAt),
          updatedAt: asDate(row.updatedAt),
        })),
  );

  // Sessions carry over so nobody is signed out by the migration.
  {
    await insertMany(
      (rows) => db.insert(sessions).values(rows).onConflictDoNothing(),
      legacySessions
          .filter((row) => userIds.has(String(row.userId)))
          .map((row) => ({
            id: String(row.id),
            token: String(row.token),
            expiresAt: asDate(row.expiresAt),
            createdAt: asDate(row.createdAt),
            updatedAt: asDate(row.updatedAt),
            ipAddress: asString(row.ipAddress),
            userAgent: asString(row.userAgent),
            impersonatedBy: asString(row.impersonatedBy),
            userId: String(row.userId),
          })),
    );
  }

  {
    await insertMany(
      (rows) => db.insert(verifications).values(rows).onConflictDoNothing(),
      legacyVerifications.map((row) => ({
          id: String(row.id),
          identifier: String(row.identifier),
          value: String(row.value),
          expiresAt: asDate(row.expiresAt),
          createdAt: asDate(row.createdAt),
          updatedAt: asDate(row.updatedAt),
      })),
    );
  }

  // v1 kept the display scale implicit at 20 and `defaultOutOf` scaled by 100.
  const yearIds = new Set(legacyYears.map((row) => String(row.id)));
  {
    await insertMany(
      (rows) => db.insert(years).values(rows).onConflictDoNothing(),
      legacyYears
          .filter((row) => userIds.has(String(row.userId)))
          .map((row, index) => ({
            id: String(row.id),
            name: asString(row.name) ?? "",
            startsAt: asDate(row.startDate),
            endsAt: asDate(row.endDate),
            scale: 20,
            defaultOutOf: unscale(row.defaultOutOf, 20) || 20,
            passingRatio: 0.5,
            decimals: 2,
            sortOrder: index,
            userId: String(row.userId),
            createdAt: asDate(row.createdAt),
            updatedAt: asDate(row.createdAt),
          })),
    );
  }

  {
    await insertMany(
      (rows) => db.insert(periods).values(rows).onConflictDoNothing(),
      legacyPeriods
          .filter((row) => yearIds.has(String(row.yearId)))
          .map((row, index) => ({
            id: String(row.id),
            name: asString(row.name) ?? "",
            startAt: asDate(row.startAt),
            endAt: asDate(row.endAt),
            isCumulative: asBoolean(row.isCumulative),
            sortOrder: index,
            yearId: String(row.yearId),
            userId: String(row.userId),
            createdAt: asDate(row.createdAt),
            updatedAt: asDate(row.createdAt),
          })),
    );
  }

  const subjectIds = new Set(legacySubjects.map((row) => String(row.id)));
  {
    await insertMany(
      (rows) => db.insert(subjects).values(rows).onConflictDoNothing(),
      legacySubjects
          .filter((row) => yearIds.has(String(row.yearId)))
          .map((row, index) => ({
            id: String(row.id),
            name: asString(row.name) ?? "",
            shortName: null,
            parentId: asString(row.parentId),
            coefficient: unscale(row.coefficient, 1),
            kind: asBoolean(row.isDisplaySubject) ? "category" : "subject",
            isMain: asBoolean(row.isMainSubject),
            sortOrder: index,
            yearId: String(row.yearId),
            userId: String(row.userId),
            createdAt: asDate(row.createdAt),
            updatedAt: asDate(row.createdAt),
          })),
    );
  }

  const gradeIds = new Set(legacyGrades.map((row) => String(row.id)));
  {
    await insertMany(
      (rows) => db.insert(grades).values(rows).onConflictDoNothing(),
      legacyGrades
          .filter((row) => subjectIds.has(String(row.subjectId)))
          .map((row) => ({
            id: String(row.id),
            name: asString(row.name) ?? "",
            value: unscale(row.value, 0),
            outOf: unscale(row.outOf, 20) || 20,
            coefficient: unscale(row.coefficient, 1),
            isComposite: asBoolean(row.isComposite),
            note: null,
            passedAt: asDate(row.passedAt),
            subjectId: String(row.subjectId),
            periodId: asString(row.periodId),
            yearId: String(row.yearId),
            userId: String(row.userId),
            createdAt: asDate(row.createdAt),
            updatedAt: asDate(row.createdAt),
          })),
    );
  }

  {
    await insertMany(
      (rows) => db.insert(gradeComponents).values(rows).onConflictDoNothing(),
      legacyComponents
          .filter((row) => gradeIds.has(String(row.gradeId)))
          .map((row, index) => ({
            id: String(row.id),
            gradeId: String(row.gradeId),
            name: asString(row.name) ?? "",
            value: unscale(row.value, 0),
            outOf: unscale(row.outOf, 20) || 20,
            coefficient: unscale(row.coefficient, 1),
            sortOrder: index,
            userId: String(row.userId),
            createdAt: asDate(row.createdAt),
            updatedAt: asDate(row.updatedAt),
          })),
    );
  }

  // The JSON blob becomes rows. Entries pointing at subjects that no longer
  // exist are dropped rather than carried forward as dangling ids.
  interface LegacyEntry {
    id?: string;
    customCoefficient?: number | null;
    includeChildren?: boolean;
  }

  for (const [index, row] of legacyAverages.entries()) {
    if (!yearIds.has(String(row.yearId))) continue;

    await db
      .insert(customAverages)
      .values({
        id: String(row.id),
        name: asString(row.name) ?? "",
        isMain: asBoolean(row.isMainAverage),
        sortOrder: index,
        yearId: String(row.yearId),
        userId: String(row.userId),
        createdAt: asDate(row.createdAt),
        updatedAt: asDate(row.createdAt),
      })
      .onConflictDoNothing();

    const entries = parseJson<LegacyEntry[]>(row.subjects, []).filter(
      (entry) => entry.id && subjectIds.has(entry.id),
    );
    if (entries.length === 0) continue;

    await insertMany(
      (rows) => db.insert(customAverageEntries).values(rows).onConflictDoNothing(),
      entries.map((entry) => ({
          averageId: String(row.id),
          subjectId: String(entry.id),
          coefficient:
            entry.customCoefficient === null ||
            entry.customCoefficient === undefined
              ? null
              : Number(entry.customCoefficient),
        includeChildren: entry.includeChildren ?? true,
      })),
    );
  }

  // Preferences move across where the shapes still line up; the rest fall back
  // to defaults, which is the honest outcome for settings that no longer exist.
  for (const row of legacySettings) {
    if (!userIds.has(String(row.userId))) continue;
    const chart = parseJson<Record<string, unknown>>(row.chartSettings, {});

    await db
      .insert(preferences)
      .values({
        userId: String(row.userId),
        theme: asString(row.theme) ?? "system",
        language: asString(row.language) ?? "system",
        themePreset: "default",
        customTheme: typeof row.customTheme === "string" ? row.customTheme : "{}",
        themeShape: "{}",
        seasonalThemesEnabled: asBoolean(row.seasonalThemesEnabled),
        seasonalTheme: asString(row.seasonalTheme) ?? "auto",
        hapticsEnabled:
          row.hapticsEnabled === undefined ? true : asBoolean(row.hapticsEnabled),
        reduceMotion: false,
        compactMode: false,
        chartSettings: JSON.stringify({
          autoZoom: chart.autoZoomYAxis ?? true,
          showTrend: chart.showTrendLine ?? false,
          trendSubdivisions: chart.trendLineSubdivisions ?? 1,
          showPoints: true,
        }),
        unlockedThemes: asBoolean(row.mokattamThemeAvailable)
          ? JSON.stringify(["mokattam"])
          : "[]",
        seenCelebrations: "[]",
      })
      .onConflictDoNothing();
  }

  // v1 had no dashboard cards, so every migrated year starts on the default
  // layout instead of an empty grid.
  const migratedYears = await db.select({ id: years.id, userId: years.userId }).from(years);
  for (const year of migratedYears) {
    const [{ total = 0 } = {}] = await db
      .select({ total: sql<number>`count(*)` })
      .from(dashboardCards)
      .where(eq(dashboardCards.yearId, year.id));
    if (total > 0) continue;

    await db.insert(dashboardCards).values(
      defaultCards().map((card) => ({
        surface: "overview",
        metric: card.metric,
        targetKind: card.target.kind,
        targetId: card.target.referenceId,
        goalId: null,
        display: card.display,
        span: card.span,
        title: card.title,
        accent: card.accent,
        sortOrder: card.sortOrder,
        hidden: card.hidden,
        yearId: year.id,
        userId: year.userId,
      })),
    );
  }

  console.info("Migration complete.");
}

await main();
process.exit(0);
