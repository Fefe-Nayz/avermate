export type AppTheme = "system" | "light" | "dark";
export type AppLanguage = "system" | "en" | "fr";
export type SeasonalThemePreference =
  | "none"
  | "april-fools"
  | "halloween"
  | "christmas";

export interface ChartSettings {
  autoZoomYAxis: boolean;
  showTrendLine: boolean;
  trendLineSubdivisions: number;
}

export interface UserSettings {
  theme: AppTheme;
  language: AppLanguage;
  chartSettings: ChartSettings;
  seasonalThemesEnabled: boolean;
  seasonalTheme: SeasonalThemePreference;
  mokattamThemeAvailable: boolean;
  mokattamThemeEnabled: boolean;
  mokattamThemeCelebrationSeenAt: string | null;
  hapticsEnabled: boolean;
}

export interface PersistedUserSettings extends UserSettings {
  persisted: boolean;
  updatedAt: string | null;
}

export const defaultChartSettings: ChartSettings = {
  autoZoomYAxis: true,
  showTrendLine: false,
  trendLineSubdivisions: 1,
};

export const defaultUserSettings: UserSettings = {
  theme: "system",
  language: "system",
  chartSettings: defaultChartSettings,
  seasonalThemesEnabled: true,
  seasonalTheme: "none",
  mokattamThemeAvailable: false,
  mokattamThemeEnabled: false,
  mokattamThemeCelebrationSeenAt: null,
  hapticsEnabled: true,
};
