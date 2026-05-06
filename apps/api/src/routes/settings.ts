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
  showSubSubjectsInSubjectCharts: z.boolean(),
});

const customThemePaletteSchema = z.object({
  background: z.string().min(1).max(80),
  foreground: z.string().min(1).max(80),
  primary: z.string().min(1).max(80),
  primaryForeground: z.string().min(1).max(80),
  secondary: z.string().min(1).max(80),
  secondaryForeground: z.string().min(1).max(80),
  destructive: z.string().min(1).max(80),
  card: z.string().min(1).max(80),
  cardForeground: z.string().min(1).max(80),
  popover: z.string().min(1).max(80),
  popoverForeground: z.string().min(1).max(80),
  accent: z.string().min(1).max(80),
  accentForeground: z.string().min(1).max(80),
  muted: z.string().min(1).max(80),
  mutedForeground: z.string().min(1).max(80),
  border: z.string().min(1).max(80),
  input: z.string().min(1).max(80),
  ring: z.string().min(1).max(80),
  chart1: z.string().min(1).max(80),
  chart2: z.string().min(1).max(80),
  chart3: z.string().min(1).max(80),
  chart4: z.string().min(1).max(80),
  chart5: z.string().min(1).max(80),
  sidebar: z.string().min(1).max(80),
  sidebarForeground: z.string().min(1).max(80),
  sidebarPrimary: z.string().min(1).max(80),
  sidebarPrimaryForeground: z.string().min(1).max(80),
  sidebarAccent: z.string().min(1).max(80),
  sidebarAccentForeground: z.string().min(1).max(80),
  sidebarBorder: z.string().min(1).max(80),
  sidebarRing: z.string().min(1).max(80),
});

const customThemeSchema = z.object({
  enabled: z.boolean(),
  preset: z.string().min(1).max(40),
  radius: z.number().min(0).max(2),
  fontSans: z.string().min(1).max(160),
  light: customThemePaletteSchema,
  dark: customThemePaletteSchema,
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
    customTheme: customThemeSchema.partial().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one setting must be provided",
  });

const defaultChartSettings = {
  autoZoomYAxis: true,
  showTrendLine: false,
  trendLineSubdivisions: 1,
  showSubSubjectsInSubjectCharts: true,
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
  customTheme: {
    enabled: false,
    preset: "default",
    radius: 0.625,
    fontSans:
      "var(--font-gabarito), var(--font-inter), ui-sans-serif, system-ui, sans-serif",
    light: {
      background: "oklch(1 0 0)",
      foreground: "oklch(0.145 0 0)",
      primary: "oklch(0.205 0 0)",
      primaryForeground: "oklch(0.985 0 0)",
      secondary: "oklch(0.97 0 0)",
      secondaryForeground: "oklch(0.205 0 0)",
      destructive: "oklch(0.577 0.245 27.325)",
      card: "oklch(1 0 0)",
      cardForeground: "oklch(0.145 0 0)",
      popover: "oklch(1 0 0)",
      popoverForeground: "oklch(0.145 0 0)",
      accent: "oklch(0.97 0 0)",
      accentForeground: "oklch(0.205 0 0)",
      muted: "oklch(0.97 0 0)",
      mutedForeground: "oklch(0.556 0 0)",
      border: "oklch(0.922 0 0)",
      input: "oklch(0.922 0 0)",
      ring: "oklch(0.708 0 0)",
      chart1: "#2662d9",
      chart2: "oklch(0.6 0.118 184.704)",
      chart3: "oklch(0.398 0.07 227.392)",
      chart4: "oklch(0.828 0.189 84.429)",
      chart5: "oklch(0.769 0.188 70.08)",
      sidebar: "oklch(0.985 0 0)",
      sidebarForeground: "oklch(0.145 0 0)",
      sidebarPrimary: "oklch(0.205 0 0)",
      sidebarPrimaryForeground: "oklch(0.985 0 0)",
      sidebarAccent: "oklch(0.97 0 0)",
      sidebarAccentForeground: "oklch(0.205 0 0)",
      sidebarBorder: "oklch(0.922 0 0)",
      sidebarRing: "oklch(0.708 0 0)",
    },
    dark: {
      background: "oklch(0.145 0 0)",
      foreground: "oklch(0.985 0 0)",
      primary: "oklch(0.922 0 0)",
      primaryForeground: "oklch(0.205 0 0)",
      secondary: "oklch(0.269 0 0)",
      secondaryForeground: "oklch(0.985 0 0)",
      destructive: "oklch(0.704 0.191 22.216)",
      card: "oklch(0.205 0 0)",
      cardForeground: "oklch(0.985 0 0)",
      popover: "oklch(0.205 0 0)",
      popoverForeground: "oklch(0.985 0 0)",
      accent: "oklch(0.269 0 0)",
      accentForeground: "oklch(0.985 0 0)",
      muted: "oklch(0.269 0 0)",
      mutedForeground: "oklch(0.708 0 0)",
      border: "oklch(1 0 0 / 10%)",
      input: "oklch(1 0 0 / 15%)",
      ring: "oklch(0.556 0 0)",
      chart1: "#60a5fa",
      chart2: "oklch(0.696 0.17 162.48)",
      chart3: "oklch(0.769 0.188 70.08)",
      chart4: "oklch(0.627 0.265 303.9)",
      chart5: "oklch(0.645 0.246 16.439)",
      sidebar: "oklch(0.205 0 0)",
      sidebarForeground: "oklch(0.985 0 0)",
      sidebarPrimary: "oklch(0.488 0.243 264.376)",
      sidebarPrimaryForeground: "oklch(0.985 0 0)",
      sidebarAccent: "oklch(0.269 0 0)",
      sidebarAccentForeground: "oklch(0.985 0 0)",
      sidebarBorder: "oklch(1 0 0 / 10%)",
      sidebarRing: "oklch(0.556 0 0)",
    },
  },
};

function parseChartSettings(value?: string | null) {
  if (!value) {
    return defaultChartSettings;
  }

  try {
    return chartSettingsSchema.parse({
      ...defaultChartSettings,
      ...JSON.parse(value),
    });
  } catch {
    return defaultChartSettings;
  }
}

function parseCustomTheme(value?: string | null) {
  if (!value) {
    return defaultSettings.customTheme;
  }

  try {
    const parsed = JSON.parse(value);
    return customThemeSchema.parse({
      ...defaultSettings.customTheme,
      ...parsed,
      light: {
        ...defaultSettings.customTheme.light,
        ...parsed.light,
      },
      dark: {
        ...defaultSettings.customTheme.dark,
        ...parsed.dark,
      },
    });
  } catch {
    return defaultSettings.customTheme;
  }
}

function mergeCustomTheme(
  current: typeof defaultSettings.customTheme,
  updates?: Partial<z.infer<typeof customThemeSchema>>
) {
  if (!updates) {
    return current;
  }

  return customThemeSchema.parse({
    ...current,
    ...updates,
    light: {
      ...current.light,
      ...updates.light,
    },
    dark: {
      ...current.dark,
      ...updates.dark,
    },
  });
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
    customTheme: parseCustomTheme(row.customTheme),
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
  const nextCustomTheme = mergeCustomTheme(
    parseCustomTheme(existing?.customTheme),
    updates.customTheme
  );

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
    customTheme: JSON.stringify(nextCustomTheme),
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
        customTheme: values.customTheme,
        updatedAt: values.updatedAt,
      },
    })
    .returning()
    .get();

  return c.json({ settings: serializeSettings(settings ?? null) });
});

export default app;
