"use client";

import Cookies from "js-cookie";

import {
  defaultChartSettings,
  defaultUserSettings,
  type AppLanguage,
  type AppTheme,
  type ChartSettings,
  type SeasonalThemePreference,
  type UserSettings,
} from "@/types/user-settings";

const USER_SETTINGS_CACHE_KEY = "avermate:user-settings-cache";
const USER_SETTINGS_EVENT = "avermate:user-settings";
const THEME_STORAGE_KEY = "theme";
const CHART_SETTINGS_STORAGE_KEY = "chart-settings";
const HAPTICS_STORAGE_KEY = "avermate:haptics-enabled";
const SEASONAL_THEMES_ENABLED_KEY = "seasonal-themes-enabled";
const SEASONAL_THEME_STORAGE_KEY = "seasonal-theme-settings-force";
const LOCALE_COOKIE_KEY = "locale";

type CachedUserSettingsPayload = {
  settings: UserSettings;
  updatedAt: number;
};

export type LocalUserSettingsSnapshot = {
  settings: UserSettings;
  updatedAt: number;
  hasLocalData: boolean;
};

export function isMokattamThemeActive(settings: UserSettings) {
  return settings.mokattamThemeAvailable && settings.mokattamThemeEnabled;
}

function isBrowser() {
  return typeof window !== "undefined";
}

function parseTheme(value: string | null | undefined): AppTheme | null {
  if (value === "light" || value === "dark" || value === "system") {
    return value;
  }

  return null;
}

function parseLanguage(value: string | null | undefined): AppLanguage | null {
  if (value === "en" || value === "fr" || value === "system") {
    return value;
  }

  return null;
}

function parseSeasonalTheme(
  value: string | null | undefined
): SeasonalThemePreference | null {
  if (
    value === "none" ||
    value === "april-fools" ||
    value === "halloween" ||
    value === "christmas"
  ) {
    return value;
  }

  return null;
}

function parseChartSettings(value: string | null | undefined): ChartSettings | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<ChartSettings>;

    return {
      ...defaultChartSettings,
      ...parsed,
    };
  } catch {
    return null;
  }
}

function readLegacySettings(): LocalUserSettingsSnapshot {
  if (!isBrowser()) {
    return {
      settings: defaultUserSettings,
      updatedAt: 0,
      hasLocalData: false,
    };
  }

  const theme = parseTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
  const language = parseLanguage(Cookies.get(LOCALE_COOKIE_KEY)) ?? "system";
  const chartSettings = parseChartSettings(
    window.localStorage.getItem(CHART_SETTINGS_STORAGE_KEY)
  );
  const seasonalThemesEnabledValue = window.localStorage.getItem(
    SEASONAL_THEMES_ENABLED_KEY
  );
  const seasonalTheme = parseSeasonalTheme(
    window.localStorage.getItem(SEASONAL_THEME_STORAGE_KEY)
  );
  const hapticsEnabledValue = window.localStorage.getItem(HAPTICS_STORAGE_KEY);

  const hasLocalData =
    theme !== null ||
    chartSettings !== null ||
    seasonalThemesEnabledValue !== null ||
    seasonalTheme !== null ||
    hapticsEnabledValue !== null ||
    language !== "system";

  return {
    settings: {
      theme: theme ?? defaultUserSettings.theme,
      language,
      chartSettings: chartSettings ?? defaultUserSettings.chartSettings,
      seasonalThemesEnabled:
        seasonalThemesEnabledValue === null
          ? defaultUserSettings.seasonalThemesEnabled
          : seasonalThemesEnabledValue !== "false",
      seasonalTheme: seasonalTheme ?? defaultUserSettings.seasonalTheme,
      mokattamThemeAvailable: defaultUserSettings.mokattamThemeAvailable,
      mokattamThemeEnabled: defaultUserSettings.mokattamThemeEnabled,
      mokattamThemeCelebrationSeenAt:
        defaultUserSettings.mokattamThemeCelebrationSeenAt,
      hapticsEnabled:
        hapticsEnabledValue === null
          ? defaultUserSettings.hapticsEnabled
          : hapticsEnabledValue === "true",
    },
    updatedAt: 0,
    hasLocalData,
  };
}

function dispatchUserSettingsEvent(settings: UserSettings, updatedAt: number) {
  if (!isBrowser()) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(USER_SETTINGS_EVENT, {
      detail: {
        settings,
        updatedAt,
      } satisfies CachedUserSettingsPayload,
    })
  );
}

export function getUserSettingsStorageEventName() {
  return USER_SETTINGS_EVENT;
}

export function readLocalUserSettings(): LocalUserSettingsSnapshot {
  if (!isBrowser()) {
    return {
      settings: defaultUserSettings,
      updatedAt: 0,
      hasLocalData: false,
    };
  }

  try {
    const cached = window.localStorage.getItem(USER_SETTINGS_CACHE_KEY);

    if (!cached) {
      return readLegacySettings();
    }

    const parsed = JSON.parse(cached) as Partial<CachedUserSettingsPayload>;

    if (!parsed.settings || typeof parsed.updatedAt !== "number") {
      return readLegacySettings();
    }

    return {
      settings: {
        ...defaultUserSettings,
        ...parsed.settings,
        chartSettings: {
          ...defaultChartSettings,
          ...parsed.settings.chartSettings,
        },
      },
      updatedAt: parsed.updatedAt,
      hasLocalData: true,
    };
  } catch {
    return readLegacySettings();
  }
}

export function writeLocalUserSettings(
  settings: UserSettings,
  updatedAt = Date.now()
) {
  if (!isBrowser()) {
    return;
  }

  const nextSettings: UserSettings = {
    ...defaultUserSettings,
    ...settings,
    chartSettings: {
      ...defaultChartSettings,
      ...settings.chartSettings,
    },
  };

  const payload: CachedUserSettingsPayload = {
    settings: nextSettings,
    updatedAt,
  };

  try {
    window.localStorage.setItem(USER_SETTINGS_CACHE_KEY, JSON.stringify(payload));
    window.localStorage.setItem(
      CHART_SETTINGS_STORAGE_KEY,
      JSON.stringify(nextSettings.chartSettings)
    );
    window.localStorage.setItem(
      HAPTICS_STORAGE_KEY,
      String(nextSettings.hapticsEnabled)
    );
    window.localStorage.setItem(
      SEASONAL_THEMES_ENABLED_KEY,
      String(nextSettings.seasonalThemesEnabled)
    );

    if (nextSettings.seasonalTheme === "none") {
      window.localStorage.removeItem(SEASONAL_THEME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(
        SEASONAL_THEME_STORAGE_KEY,
        nextSettings.seasonalTheme
      );
    }
  } catch {
    // localStorage can fail in private mode or strict privacy contexts.
  }

  if (nextSettings.language === "system") {
    Cookies.remove(LOCALE_COOKIE_KEY);
  } else {
    Cookies.set(LOCALE_COOKIE_KEY, nextSettings.language);
  }

  dispatchUserSettingsEvent(nextSettings, updatedAt);
}

export function updateLocalUserSettings(
  updates: Partial<UserSettings>,
  updatedAt = Date.now()
) {
  const current = readLocalUserSettings().settings;
  const nextSettings: UserSettings = {
    ...current,
    ...updates,
    chartSettings: updates.chartSettings
      ? {
          ...current.chartSettings,
          ...updates.chartSettings,
        }
      : current.chartSettings,
  };

  writeLocalUserSettings(nextSettings, updatedAt);

  return nextSettings;
}

export function resolveUpdatedAt(value: string | null | undefined) {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);

  return Number.isNaN(parsed) ? 0 : parsed;
}
