import { db } from "@/db";
import { userSettings } from "@/db/schema";
import type { Session, User } from "@/lib/auth";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
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

const chartSettingsSchema = z.object({
  autoZoomYAxis: z.boolean(),
  showTrendLine: z.boolean(),
  trendLineSubdivisions: z.number().int().min(1).max(10),
});

const updateUserSettingsSchema = z
  .object({
    theme: z.enum(["system", "light", "dark"]).optional(),
    language: z.enum(["system", "en", "fr"]).optional(),
    chartSettings: chartSettingsSchema.partial().optional(),
    seasonalThemesEnabled: z.boolean().optional(),
    seasonalTheme: z
      .enum(["none", "april-fools", "halloween", "christmas"])
      .optional(),
    mokattamThemeEnabled: z.boolean().optional(),
    markMokattamThemeCelebrationSeen: z.boolean().optional(),
    hapticsEnabled: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one setting must be provided",
  });

const defaultChartSettings = {
  autoZoomYAxis: true,
  showTrendLine: false,
  trendLineSubdivisions: 1,
};

const defaultSettings = {
  theme: "system" as const,
  language: "system" as const,
  chartSettings: defaultChartSettings,
  seasonalThemesEnabled: true,
  seasonalTheme: "none" as const,
  mokattamThemeAvailable: false,
  mokattamThemeEnabled: false,
  mokattamThemeCelebrationSeenAt: null as string | null,
  hapticsEnabled: true,
};

function parseChartSettings(value?: string | null) {
  if (!value) {
    return defaultChartSettings;
  }

  try {
    return chartSettingsSchema.parse(JSON.parse(value));
  } catch {
    return defaultChartSettings;
  }
}

function serializeSettings(row: typeof userSettings.$inferSelect | null) {
  if (!row) {
    return {
      ...defaultSettings,
      persisted: false,
      updatedAt: null,
    };
  }

  return {
    theme: row.theme === "light" || row.theme === "dark" ? row.theme : "system",
    language: row.language === "en" || row.language === "fr" ? row.language : "system",
    chartSettings: parseChartSettings(row.chartSettings),
    seasonalThemesEnabled: row.seasonalThemesEnabled,
    seasonalTheme:
      row.seasonalTheme === "april-fools" ||
      row.seasonalTheme === "halloween" ||
      row.seasonalTheme === "christmas"
        ? row.seasonalTheme
        : "none",
    mokattamThemeAvailable: row.mokattamThemeAvailable,
    mokattamThemeEnabled:
      row.mokattamThemeAvailable && row.mokattamThemeEnabled,
    mokattamThemeCelebrationSeenAt: row.mokattamThemeCelebrationSeenAt
      ? row.mokattamThemeCelebrationSeenAt.toISOString()
      : null,
    hapticsEnabled: row.hapticsEnabled,
    persisted: true,
    updatedAt: row.updatedAt.toISOString(),
  };
}

app.get("/", async (c) => {
  const session = c.get("session");

  if (!session) {
    throw new HTTPException(401);
  }

  const settings = await db.query.userSettings.findFirst({
    where: eq(userSettings.userId, session.user.id),
  });

  return c.json({ settings: serializeSettings(settings ?? null) });
});

app.patch("/", zValidator("json", updateUserSettingsSchema), async (c) => {
  const session = c.get("session");

  if (!session) {
    throw new HTTPException(401);
  }

  const updates = c.req.valid("json");
  const existing = await db.query.userSettings.findFirst({
    where: eq(userSettings.userId, session.user.id),
  });

  const nextChartSettings = updates.chartSettings
    ? {
        ...parseChartSettings(existing?.chartSettings),
        ...updates.chartSettings,
      }
    : parseChartSettings(existing?.chartSettings);

  const now = new Date();
  const mokattamThemeAvailable =
    existing?.mokattamThemeAvailable ?? defaultSettings.mokattamThemeAvailable;
  const mokattamThemeEnabled =
    mokattamThemeAvailable &&
    (updates.mokattamThemeEnabled ??
      existing?.mokattamThemeEnabled ??
      defaultSettings.mokattamThemeEnabled);
  const mokattamThemeCelebrationSeenAt =
    updates.markMokattamThemeCelebrationSeen
      ? existing?.mokattamThemeCelebrationSeenAt ?? now
      : existing?.mokattamThemeCelebrationSeenAt ?? null;

  const values = {
    userId: session.user.id,
    theme: updates.theme ?? existing?.theme ?? defaultSettings.theme,
    language: updates.language ?? existing?.language ?? defaultSettings.language,
    chartSettings: JSON.stringify(nextChartSettings),
    seasonalThemesEnabled:
      updates.seasonalThemesEnabled ??
      existing?.seasonalThemesEnabled ??
      defaultSettings.seasonalThemesEnabled,
    seasonalTheme:
      updates.seasonalTheme ?? existing?.seasonalTheme ?? defaultSettings.seasonalTheme,
    mokattamThemeAvailable,
    mokattamThemeEnabled,
    mokattamThemeCelebrationSeenAt,
    hapticsEnabled:
      updates.hapticsEnabled ??
      existing?.hapticsEnabled ??
      defaultSettings.hapticsEnabled,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const settings = await db
    .insert(userSettings)
    .values(values)
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: {
        theme: values.theme,
        language: values.language,
        chartSettings: values.chartSettings,
        seasonalThemesEnabled: values.seasonalThemesEnabled,
        seasonalTheme: values.seasonalTheme,
        mokattamThemeAvailable: values.mokattamThemeAvailable,
        mokattamThemeEnabled: values.mokattamThemeEnabled,
        mokattamThemeCelebrationSeenAt: values.mokattamThemeCelebrationSeenAt,
        hapticsEnabled: values.hapticsEnabled,
        updatedAt: values.updatedAt,
      },
    })
    .returning()
    .get();

  return c.json({ settings: serializeSettings(settings ?? null) });
});

export default app;
