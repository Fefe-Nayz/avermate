import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  accounts,
  announcementPresetTargets,
  announcementViews,
  announcements,
  customAverageEntries,
  customAverages,
  dashboardCards,
  feedback,
  gradeComponents,
  goals,
  grades,
  periods,
  preferences,
  subjects,
  users,
  yearReviewViews,
  years,
} from "../db/schema";
import { protectedProcedure } from "../lib/orpc";
import { exportSocialData } from "./social/account";

/**
 * Account preferences.
 *
 * Stored server-side so a phone and a laptop agree, and mirrored into a cookie
 * by the web app so the first paint is already in the right theme and language
 * instead of flashing the default one.
 */

const chartSettings = z.object({
  autoZoom: z.boolean().default(true),
  showTrend: z.boolean().default(false),
  trendSubdivisions: z.number().int().min(1).max(12).default(1),
  showPoints: z.boolean().default(true),
  showSubSubjects: z.boolean().default(true),
});

const themeShape = z.object({
  // Named choices stay short, but a migrated v1 theme can carry a complete,
  // user-authored CSS font stack. The web renderer validates how it is used.
  font: z.string().max(160).default("inter"),
  headingFont: z.string().max(160).default("inherit"),
  radius: z.number().min(0).max(2).default(0.625),
});

const themePalette = z.record(z.string(), z.string());
const modeAwareCustomTheme = z
  .object({
    light: themePalette.default({}),
    dark: themePalette.default({}),
  })
  .strict();

/**
 * Older rewrite clients sent one flat palette. Accept it during the rollout
 * and apply it to both modes; every response uses the lossless mode-aware
 * shape so migrated v1 light/dark palettes remain distinct.
 */
const customThemeInput = z
  .union([modeAwareCustomTheme, themePalette])
  .transform((theme) =>
    "light" in theme &&
    "dark" in theme &&
    typeof theme.light === "object" &&
    typeof theme.dark === "object"
      ? theme
      : { light: theme, dark: theme },
  );

const preferencesInput = z.object({
  theme: z.enum(["system", "light", "dark"]),
  language: z.enum(["system", "en", "fr"]),
  themePreset: z.string().max(32),
  customTheme: customThemeInput,
  themeShape,
  seasonalThemesEnabled: z.boolean(),
  seasonalTheme: z.string().max(32),
  hapticsEnabled: z.boolean(),
  reduceMotion: z.boolean(),
  compactMode: z.boolean(),
  chartSettings,
  unlockedThemes: z.array(z.string().max(32)),
  seenCelebrations: z.array(z.string().max(48)),
});

export type Preferences = z.infer<typeof preferencesInput>;
export type ModeAwareCustomTheme = Preferences["customTheme"];

const DEFAULTS: Preferences = {
  theme: "system",
  language: "system",
  themePreset: "default",
  customTheme: { light: {}, dark: {} },
  themeShape: { font: "inter", headingFont: "inherit", radius: 0.625 },
  seasonalThemesEnabled: true,
  seasonalTheme: "auto",
  hapticsEnabled: true,
  reduceMotion: false,
  compactMode: false,
  chartSettings: {
    autoZoom: true,
    showTrend: false,
    trendSubdivisions: 1,
    showPoints: true,
    showSubSubjects: true,
  },
  unlockedThemes: [],
  seenCelebrations: [],
};

function parse<T>(raw: string, fallback: T): T {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

function hydrate(row: typeof preferences.$inferSelect): Preferences {
  const storedTheme = customThemeInput.safeParse(
    parse<unknown>(row.customTheme, {}),
  );
  return {
    theme: row.theme as Preferences["theme"],
    language: row.language as Preferences["language"],
    themePreset: row.themePreset,
    customTheme: storedTheme.success ? storedTheme.data : DEFAULTS.customTheme,
    themeShape: { ...DEFAULTS.themeShape, ...parse(row.themeShape, {}) },
    seasonalThemesEnabled: row.seasonalThemesEnabled,
    seasonalTheme: row.seasonalTheme,
    hapticsEnabled: row.hapticsEnabled,
    reduceMotion: row.reduceMotion,
    compactMode: row.compactMode,
    chartSettings: {
      ...DEFAULTS.chartSettings,
      ...parse(row.chartSettings, {}),
    },
    unlockedThemes: parse(row.unlockedThemes, DEFAULTS.unlockedThemes),
    seenCelebrations: parse(row.seenCelebrations, DEFAULTS.seenCelebrations),
  };
}

async function load(userId: string): Promise<Preferences> {
  const [row] = await db
    .select()
    .from(preferences)
    .where(eq(preferences.userId, userId))
    .limit(1);
  if (row) return hydrate(row);

  const [created] = await db
    .insert(preferences)
    .values({ userId })
    .onConflictDoNothing()
    .returning();
  return created ? hydrate(created) : DEFAULTS;
}

export const preferencesRouter = {
  get: protectedProcedure.handler(({ context }) =>
    load(context.session.user.id),
  ),

  update: protectedProcedure
    .input(preferencesInput.partial())
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await load(userId);

      await db
        .update(preferences)
        .set({
          ...(input.theme !== undefined ? { theme: input.theme } : {}),
          ...(input.language !== undefined ? { language: input.language } : {}),
          ...(input.themePreset !== undefined
            ? { themePreset: input.themePreset }
            : {}),
          ...(input.customTheme !== undefined
            ? { customTheme: JSON.stringify(input.customTheme) }
            : {}),
          ...(input.themeShape !== undefined
            ? { themeShape: JSON.stringify(input.themeShape) }
            : {}),
          ...(input.seasonalThemesEnabled !== undefined
            ? { seasonalThemesEnabled: input.seasonalThemesEnabled }
            : {}),
          ...(input.seasonalTheme !== undefined
            ? { seasonalTheme: input.seasonalTheme }
            : {}),
          ...(input.hapticsEnabled !== undefined
            ? { hapticsEnabled: input.hapticsEnabled }
            : {}),
          ...(input.reduceMotion !== undefined
            ? { reduceMotion: input.reduceMotion }
            : {}),
          ...(input.compactMode !== undefined
            ? { compactMode: input.compactMode }
            : {}),
          ...(input.chartSettings !== undefined
            ? { chartSettings: JSON.stringify(input.chartSettings) }
            : {}),
          ...(input.unlockedThemes !== undefined
            ? { unlockedThemes: JSON.stringify(input.unlockedThemes) }
            : {}),
          ...(input.seenCelebrations !== undefined
            ? { seenCelebrations: JSON.stringify(input.seenCelebrations) }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(preferences.userId, userId));

      return load(userId);
    }),

  /** Marks a one-off celebration as shown, so it never fires twice. */
  markCelebrationSeen: protectedProcedure
    .input(z.object({ key: z.string().max(48) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const current = await load(userId);
      if (current.seenCelebrations.includes(input.key)) return current;

      const seenCelebrations = [...current.seenCelebrations, input.key];
      await db
        .update(preferences)
        .set({
          seenCelebrations: JSON.stringify(seenCelebrations),
          updatedAt: new Date(),
        })
        .where(eq(preferences.userId, userId));
      return { ...current, seenCelebrations };
    }),

  unlockTheme: protectedProcedure
    .input(z.object({ theme: z.string().max(32) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const current = await load(userId);
      if (current.unlockedThemes.includes(input.theme)) return current;

      const unlockedThemes = [...current.unlockedThemes, input.theme];
      await db
        .update(preferences)
        .set({
          unlockedThemes: JSON.stringify(unlockedThemes),
          updatedAt: new Date(),
        })
        .where(eq(preferences.userId, userId));
      return { ...current, unlockedThemes };
    }),

  /**
   * Wipe every year, subject and grade while keeping the account. Preferences
   * survive: someone starting over rarely wants their theme reset too.
   */
  resetData: protectedProcedure
    .input(z.object({ confirmation: z.literal("RESET") }))
    .handler(async ({ context }) => {
      const userId = context.session.user.id;
      // Years cascade into periods, subjects, grades, averages, goals and cards.
      await db.delete(years).where(eq(years.userId, userId));
      return { ok: true };
    }),

  /**
   * A relationship-complete application export. Password hashes, OAuth
   * tokens, sessions and verification secrets are intentionally never read.
   */
  exportData: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const [
      account,
      providerRows,
      preferenceRows,
      yearRows,
      periodRows,
      subjectRows,
      gradeRows,
      componentRows,
      averageRows,
      averageEntryRows,
      goalRows,
      cardRows,
      reviewViewRows,
      announcementViewRows,
      createdAnnouncementRows,
      createdAnnouncementTargetRows,
      feedbackRows,
      socialData,
    ] = await Promise.all([
      db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          emailVerified: users.emailVerified,
          avatarUrl: users.avatarUrl,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1),
      db
        .select({ providerId: accounts.providerId })
        .from(accounts)
        .where(eq(accounts.userId, userId)),
      db.select().from(preferences).where(eq(preferences.userId, userId)),
      db.select().from(years).where(eq(years.userId, userId)),
      db.select().from(periods).where(eq(periods.userId, userId)),
      db.select().from(subjects).where(eq(subjects.userId, userId)),
      db.select().from(grades).where(eq(grades.userId, userId)),
      db
        .select()
        .from(gradeComponents)
        .where(eq(gradeComponents.userId, userId)),
      db.select().from(customAverages).where(eq(customAverages.userId, userId)),
      db
        .select({ entry: customAverageEntries })
        .from(customAverageEntries)
        .innerJoin(
          customAverages,
          eq(customAverageEntries.averageId, customAverages.id),
        )
        .where(eq(customAverages.userId, userId)),
      db.select().from(goals).where(eq(goals.userId, userId)),
      db.select().from(dashboardCards).where(eq(dashboardCards.userId, userId)),
      db
        .select()
        .from(yearReviewViews)
        .where(eq(yearReviewViews.userId, userId)),
      db
        .select()
        .from(announcementViews)
        .where(eq(announcementViews.userId, userId)),
      db
        .select()
        .from(announcements)
        .where(eq(announcements.createdByUserId, userId)),
      db
        .select({ target: announcementPresetTargets })
        .from(announcementPresetTargets)
        .innerJoin(
          announcements,
          eq(announcementPresetTargets.announcementId, announcements.id),
        )
        .where(eq(announcements.createdByUserId, userId)),
      db.select().from(feedback).where(eq(feedback.userId, userId)),
      exportSocialData(userId),
    ]);

    return {
      exportedAt: new Date().toISOString(),
      version: 5,
      account: account[0] ?? null,
      authentication: {
        providers: [...new Set(providerRows.map((row) => row.providerId))],
        excludedForSecurity: [
          "passwordHashes",
          "oauthTokens",
          "sessions",
          "verificationSecrets",
        ],
      },
      preferences: preferenceRows[0] ? hydrate(preferenceRows[0]) : DEFAULTS,
      years: yearRows,
      periods: periodRows,
      subjects: subjectRows,
      grades: gradeRows,
      gradeComponents: componentRows,
      customAverages: averageRows,
      customAverageEntries: averageEntryRows.map((row) => row.entry),
      goals: goalRows,
      dashboardCards: cardRows,
      yearReviewViews: reviewViewRows,
      announcementViews: announcementViewRows,
      createdAnnouncements: createdAnnouncementRows,
      createdAnnouncementPresetTargets: createdAnnouncementTargetRows.map(
        (row) => row.target,
      ),
      feedback: feedbackRows,
      social: socialData,
    };
  }),
};
