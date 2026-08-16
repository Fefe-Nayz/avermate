import { useSyncExternalStore } from "react";
import { useColorScheme } from "react-native";
import {
  nativeSeasonOverrides,
  nativeThemeOverrides,
} from "@/lib/theme-presets";

/**
 * The palette.
 *
 * Deliberately narrow: two surfaces, three text weights, one accent, and the
 * five result bands. Everything on screen is either paper, ink, or a mark —
 * which is what keeps a screen full of numbers from looking like a dashboard
 * for its own sake.
 *
 * The values match the web app's tokens so a student moving between the two
 * sees the same colour mean the same thing.
 */

export interface Palette {
  background: string;
  surface: string;
  surfaceRaised: string;
  border: string;
  hairline: string;

  text: string;
  textMuted: string;
  textFaint: string;

  accent: string;
  accentText: string;
  accentSoft: string;

  positive: string;
  negative: string;

  /** The web's --chart-1 token; palette presets may override it. */
  chart1: string;

  band: Record<ResultBand, string>;
  bandSoft: Record<ResultBand, string>;
}

export type ResultBand = "excellent" | "good" | "fair" | "weak" | "poor";

const light: Palette = {
  // The web's exact base tokens (globals.css :root, oklch → sRGB): pure
  // neutral, white paper, near-black ink.
  background: "#FFFFFF",
  surface: "#FFFFFF",
  surfaceRaised: "#FFFFFF",
  border: "#E5E5E5",
  hairline: "#EDEDED",

  text: "#0A0A0A",
  textMuted: "#737373",
  textFaint: "#A1A1A1",

  accent: "#171717",
  accentText: "#FAFAFA",
  accentSoft: "#F5F5F5",

  positive: "#2F855A",
  negative: "#DC2626",

  chart1: "#D4D4D4",

  band: {
    excellent: "#1E7A4E",
    good: "#3F8F5B",
    fair: "#B0821F",
    weak: "#C4661F",
    poor: "#C0392B",
  },
  bandSoft: {
    excellent: "#E8F3ED",
    good: "#EBF3EC",
    fair: "#F7F0DE",
    weak: "#F8EDE2",
    poor: "#F8EAE7",
  },
};

const dark: Palette = {
  // globals.css .dark: raised cards on a darker ground, translucent borders.
  background: "#0A0A0A",
  surface: "#171717",
  surfaceRaised: "#171717",
  border: "rgba(255, 255, 255, 0.10)",
  hairline: "rgba(255, 255, 255, 0.08)",

  text: "#FAFAFA",
  textMuted: "#A1A1A1",
  textFaint: "#737373",

  accent: "#E5E5E5",
  accentText: "#171717",
  accentSoft: "#262626",

  positive: "#5BBE8A",
  negative: "#F87171",

  chart1: "#D4D4D4",

  band: {
    excellent: "#5BBE8A",
    good: "#7CC292",
    fair: "#DCB65C",
    weak: "#E09A62",
    poor: "#E3796B",
  },
  bandSoft: {
    excellent: "#16241D",
    good: "#18231B",
    fair: "#26210F",
    weak: "#271B10",
    poor: "#261613",
  },
};

export type ThemePreference = "system" | "light" | "dark";
let preferredTheme: ThemePreference = "system";
const themeListeners = new Set<() => void>();
let paletteOverrides = { light: {}, dark: {} } as {
  light: Partial<Palette>;
  dark: Partial<Palette>;
};
let seasonOverrides = { light: {}, dark: {} } as {
  light: Partial<Palette>;
  dark: Partial<Palette>;
};
let appearanceRevision = 0;

export function setThemePreference(value: ThemePreference): void {
  if (preferredTheme === value) return;
  preferredTheme = value;
  appearanceRevision += 1;
  for (const listener of themeListeners) listener();
}

export function setThemePalette(id: string, customTheme: unknown): void {
  paletteOverrides = nativeThemeOverrides(id, customTheme);
  appearanceRevision += 1;
  for (const listener of themeListeners) listener();
}

export function setSeasonalTheme(enabled: boolean, preference: string): void {
  seasonOverrides = nativeSeasonOverrides(enabled, preference);
  appearanceRevision += 1;
  for (const listener of themeListeners) listener();
}

export function themePreference(): ThemePreference {
  return preferredTheme;
}

function subscribeTheme(listener: () => void): () => void {
  themeListeners.add(listener);
  return () => themeListeners.delete(listener);
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribeTheme, themePreference, themePreference);
}

export function usePalette(): Palette {
  const isDark = useIsDark();
  useSyncExternalStore(
    subscribeTheme,
    () => appearanceRevision,
    () => 0,
  );
  return isDark
    ? { ...dark, ...paletteOverrides.dark, ...seasonOverrides.dark }
    : { ...light, ...paletteOverrides.light, ...seasonOverrides.light };
}

export function useIsDark(): boolean {
  const system = useColorScheme();
  const preference = useThemePreference();
  return preference === "system" ? system === "dark" : preference === "dark";
}

/** A four-step rhythm. Anything between these values is a mistake. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

/**
 * The web's --radius is 10px: buttons sit at radius−2, cards at radius+4,
 * exactly Tailwind's rounded-md / rounded-lg / rounded-xl ladder.
 */
export const radius = {
  sm: 6,
  md: 8,
  lg: 10,
  xl: 14,
  pill: 999,
} as const;

/**
 * Type scale, matched to the web app chrome: 24/600 page titles
 * (text-2xl semibold), 14/500 section titles (text-sm font-medium),
 * 12-uppercase card labels (text-xs tracking-wide), 15 body text. Numbers
 * get tabular figures to stop the layout jittering as they change.
 */
export const type = {
  hero: { fontSize: 56, lineHeight: 60, fontWeight: "700" as const },
  display: { fontSize: 34, lineHeight: 38, fontWeight: "700" as const },
  title: { fontSize: 24, lineHeight: 30, fontWeight: "600" as const },
  /** The web's auth-screen headline: text-3xl semibold. */
  titleLarge: { fontSize: 30, lineHeight: 36, fontWeight: "600" as const },
  heading: { fontSize: 17, lineHeight: 22, fontWeight: "600" as const },
  section: { fontSize: 14, lineHeight: 19, fontWeight: "500" as const },
  body: { fontSize: 15, lineHeight: 21, fontWeight: "400" as const },
  callout: { fontSize: 14, lineHeight: 19, fontWeight: "500" as const },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: "400" as const },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: "400" as const },
  label: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "500" as const,
    letterSpacing: 0.6,
    textTransform: "uppercase" as const,
  },
} as const;

export const numeric = {
  fontVariant: ["tabular-nums" as const],
};
