import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  customAverages,
  goals,
  grades,
  preferences,
  subjects,
  years,
} from "../db/schema";
import { protectedProcedure } from "../lib/orpc";

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
});

const themeShape = z.object({
  font: z.string().max(48).default("inter"),
  headingFont: z.string().max(48).default("inherit"),
  radius: z.number().min(0).max(2).default(0.625),
});

const preferencesInput = z.object({
  theme: z.enum(["system", "light", "dark"]),
  language: z.enum(["system", "en", "fr"]),
  themePreset: z.string().max(32),
  customTheme: z.record(z.string(), z.string()),
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

const DEFAULTS: Preferences = {
  theme: "system",
  language: "system",
  themePreset: "default",
  customTheme: {},
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
  return {
    theme: row.theme as Preferences["theme"],
    language: row.language as Preferences["language"],
    themePreset: row.themePreset,
    customTheme: parse(row.customTheme, DEFAULTS.customTheme),
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

  /** Everything the account holds, as one JSON document. */
  exportData: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const [yearRows, subjectRows, gradeRows, averageRows, goalRows] =
      await Promise.all([
        db.select().from(years).where(eq(years.userId, userId)),
        db.select().from(subjects).where(eq(subjects.userId, userId)),
        db.select().from(grades).where(eq(grades.userId, userId)),
        db.select().from(customAverages).where(eq(customAverages.userId, userId)),
        db.select().from(goals).where(eq(goals.userId, userId)),
      ]);

    return {
      exportedAt: new Date().toISOString(),
      version: 2,
      years: yearRows,
      subjects: subjectRows,
      grades: gradeRows,
      customAverages: averageRows,
      goals: goalRows,
    };
  }),
};
