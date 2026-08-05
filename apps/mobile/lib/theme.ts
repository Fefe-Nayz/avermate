import { useColorScheme } from "react-native";

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

  band: Record<ResultBand, string>;
  bandSoft: Record<ResultBand, string>;
}

export type ResultBand = "excellent" | "good" | "fair" | "weak" | "poor";

const light: Palette = {
  background: "#FBFBFA",
  surface: "#FFFFFF",
  surfaceRaised: "#FFFFFF",
  border: "#E7E6E3",
  hairline: "#EFEEEB",

  text: "#121211",
  textMuted: "#6B6A66",
  textFaint: "#A3A29D",

  accent: "#121211",
  accentText: "#FFFFFF",
  accentSoft: "#F1F0EE",

  positive: "#2F855A",
  negative: "#C0392B",

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
  background: "#0B0B0A",
  surface: "#141413",
  surfaceRaised: "#1B1B19",
  border: "#2A2A27",
  hairline: "#232322",

  text: "#F5F4F1",
  textMuted: "#A1A09B",
  textFaint: "#6E6D69",

  accent: "#F5F4F1",
  accentText: "#121211",
  accentSoft: "#232322",

  positive: "#5BBE8A",
  negative: "#E3796B",

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

export function usePalette(): Palette {
  return useColorScheme() === "dark" ? dark : light;
}

export function useIsDark(): boolean {
  return useColorScheme() === "dark";
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

export const radius = {
  sm: 8,
  md: 12,
  lg: 18,
  xl: 24,
  pill: 999,
} as const;

/**
 * Type scale. Numbers get their own entries because they carry the meaning
 * here and need tabular figures to stop the layout jittering as they change.
 */
export const type = {
  hero: { fontSize: 56, lineHeight: 60, fontWeight: "700" as const },
  display: { fontSize: 34, lineHeight: 38, fontWeight: "700" as const },
  title: { fontSize: 22, lineHeight: 28, fontWeight: "600" as const },
  heading: { fontSize: 17, lineHeight: 22, fontWeight: "600" as const },
  body: { fontSize: 16, lineHeight: 22, fontWeight: "400" as const },
  callout: { fontSize: 15, lineHeight: 20, fontWeight: "500" as const },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: "400" as const },
  label: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "600" as const,
    letterSpacing: 0.8,
    textTransform: "uppercase" as const,
  },
} as const;

export const numeric = {
  fontVariant: ["tabular-nums" as const],
};
