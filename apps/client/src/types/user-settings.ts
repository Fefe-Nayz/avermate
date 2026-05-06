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
  showSubSubjectsInSubjectCharts: boolean;
}

export type CustomThemeMode = "light" | "dark";

export interface CustomThemePalette {
  background: string;
  foreground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  destructive: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  accent: string;
  accentForeground: string;
  muted: string;
  mutedForeground: string;
  border: string;
  input: string;
  ring: string;
  chart1: string;
  chart2: string;
  chart3: string;
  chart4: string;
  chart5: string;
  sidebar: string;
  sidebarForeground: string;
  sidebarPrimary: string;
  sidebarPrimaryForeground: string;
  sidebarAccent: string;
  sidebarAccentForeground: string;
  sidebarBorder: string;
  sidebarRing: string;
}

export interface CustomThemeSettings {
  enabled: boolean;
  preset: string;
  radius: number;
  fontSans: string;
  light: CustomThemePalette;
  dark: CustomThemePalette;
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
  customTheme: CustomThemeSettings;
}

export interface PersistedUserSettings extends UserSettings {
  persisted: boolean;
  updatedAt: string | null;
}

export const defaultChartSettings: ChartSettings = {
  autoZoomYAxis: true,
  showTrendLine: false,
  trendLineSubdivisions: 1,
  showSubSubjectsInSubjectCharts: true,
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
