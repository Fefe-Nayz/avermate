/**
 * Platform-neutral design data shared by every Avermate surface.
 *
 * Keep this module free of React, CSS and platform imports. Adapters decide
 * how these values become CSS variables, native palette keys or loaded fonts.
 */

export const THEME_MODES = ["light", "dark"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export const THEME_TOKEN_NAMES = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "border",
  "input",
  "ring",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
  "sidebar",
  "sidebar-foreground",
  "sidebar-primary",
  "sidebar-primary-foreground",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-border",
  "sidebar-ring",
] as const;

export type ThemeTokenName = (typeof THEME_TOKEN_NAMES)[number];
export type ThemeTokenMap = Record<ThemeTokenName, string>;
export type ModeAwareThemeTokens = Record<ThemeMode, ThemeTokenMap>;

export const THEME_PALETTE_IDS = [
  "default",
  "ocean",
  "forest",
  "sunset",
  "grape",
  "rose",
  "amber",
] as const;
export type ThemePaletteId = (typeof THEME_PALETTE_IDS)[number];

export const UNLOCKABLE_THEME_PALETTE_IDS = ["mokattam"] as const;
export type UnlockableThemePaletteId =
  (typeof UNLOCKABLE_THEME_PALETTE_IDS)[number];

export const THEME_SEASON_IDS = [
  "auto",
  "none",
  "newYear",
  "spring",
  "summer",
  "autumn",
  "halloween",
  "winter",
  "aprilFools",
] as const;
export type ThemeSeasonId = (typeof THEME_SEASON_IDS)[number];

export const RESULT_BAND_IDS = [
  "excellent",
  "good",
  "fair",
  "weak",
  "poor",
] as const;
export type ResultBandId = (typeof RESULT_BAND_IDS)[number];

export interface ThemeBandColor {
  background: string;
  foreground: string;
}

/** Exact Web colour values; native adapters may convert them to sRGB. */
export const THEME_RESULT_BAND_COLORS = {
  light: {
    excellent: {
      background: "oklch(0.62 0.15 150)",
      foreground: "oklch(0.99 0.01 150)",
    },
    good: {
      background: "oklch(0.68 0.13 130)",
      foreground: "oklch(0.2 0.04 130)",
    },
    fair: {
      background: "oklch(0.76 0.14 85)",
      foreground: "oklch(0.22 0.05 85)",
    },
    weak: {
      background: "oklch(0.7 0.16 45)",
      foreground: "oklch(0.2 0.05 45)",
    },
    poor: {
      background: "oklch(0.61 0.2 25)",
      foreground: "oklch(0.99 0.01 25)",
    },
  },
  dark: {
    excellent: {
      background: "oklch(0.72 0.15 150)",
      foreground: "oklch(0.18 0.04 150)",
    },
    good: {
      background: "oklch(0.76 0.13 130)",
      foreground: "oklch(0.18 0.04 130)",
    },
    fair: {
      background: "oklch(0.82 0.13 85)",
      foreground: "oklch(0.2 0.05 85)",
    },
    weak: {
      background: "oklch(0.76 0.15 45)",
      foreground: "oklch(0.2 0.05 45)",
    },
    poor: {
      background: "oklch(0.7 0.19 25)",
      foreground: "oklch(0.18 0.05 25)",
    },
  },
} as const satisfies Record<ThemeMode, Record<ResultBandId, ThemeBandColor>>;

export const THEME_RADIUS_SCALE_REM = {
  sm: 0.375,
  md: 0.5,
  lg: 0.625,
  xl: 0.875,
  "2xl": 1.125,
  "3xl": 1.375,
  "4xl": 1.625,
} as const;

export const THEME_FONT_CHOICES = [
  { id: "avermate", label: "Avermate" },
  { id: "inter", label: "Inter" },
  { id: "geist", label: "Geist" },
  { id: "roboto", label: "Roboto" },
  { id: "poppins", label: "Poppins" },
  { id: "montserrat", label: "Montserrat" },
  { id: "outfit", label: "Outfit" },
  { id: "plusJakarta", label: "Plus Jakarta Sans" },
  { id: "dmSans", label: "DM Sans" },
  { id: "nunito", label: "Nunito" },
  { id: "lora", label: "Lora" },
  { id: "merriweather", label: "Merriweather" },
  { id: "playfair", label: "Playfair Display" },
  { id: "jetbrains", label: "JetBrains Mono" },
  { id: "firaCode", label: "Fira Code" },
  { id: "sourceCode", label: "Source Code Pro" },
  { id: "system", label: "System" },
  { id: "serif", label: "Serif" },
  { id: "mono", label: "Mono" },
] as const;

export type ThemeFontId = (typeof THEME_FONT_CHOICES)[number]["id"];

export const THEME_FONT_STACKS = {
  avermate:
    "var(--font-gabarito), var(--font-inter), ui-sans-serif, system-ui, sans-serif",
  inter: "var(--font-inter), ui-sans-serif, system-ui, sans-serif",
  geist: "var(--font-geist), ui-sans-serif, system-ui, sans-serif",
  roboto: "var(--font-roboto), ui-sans-serif, system-ui, sans-serif",
  poppins: "var(--font-poppins), ui-sans-serif, system-ui, sans-serif",
  montserrat: "var(--font-montserrat), ui-sans-serif, system-ui, sans-serif",
  outfit: "var(--font-outfit), ui-sans-serif, system-ui, sans-serif",
  plusJakarta: "var(--font-plus-jakarta), ui-sans-serif, system-ui, sans-serif",
  dmSans: "var(--font-dm-sans), ui-sans-serif, system-ui, sans-serif",
  nunito: "var(--font-nunito), ui-sans-serif, system-ui, sans-serif",
  lora: "var(--font-lora), ui-serif, Georgia, serif",
  merriweather: "var(--font-merriweather), ui-serif, Georgia, serif",
  playfair: "var(--font-playfair), ui-serif, Georgia, serif",
  jetbrains:
    "var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, monospace",
  firaCode: "var(--font-fira-code), ui-monospace, SFMono-Regular, monospace",
  sourceCode:
    "var(--font-source-code-pro), ui-monospace, SFMono-Regular, monospace",
  system: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  serif: "var(--font-serif), ui-serif, Georgia, serif",
  mono: "var(--font-mono), ui-monospace, SFMono-Regular, monospace",
} as const satisfies Record<ThemeFontId, string>;

export type SeasonalAccentToken =
  | "primary"
  | "primary-foreground"
  | "accent"
  | "accent-foreground"
  | "ring"
  | "chart-1"
  | "chart-2";

type SeasonalAccentMap = Partial<Record<SeasonalAccentToken, string>>;

/**
 * Semantic seasonal accents used by the Web adapter. `aprilFools` is the one
 * deliberate full-palette exception; this object records its shared accents.
 */
export const THEME_SEASONAL_ACCENTS = {
  newYear: {
    light: {
      primary: "oklch(0.62 0.16 265)",
      accent: "oklch(0.95 0.03 265)",
      ring: "oklch(0.62 0.16 265)",
      "chart-1": "oklch(0.68 0.16 265)",
      "chart-2": "oklch(0.78 0.11 250)",
    },
    dark: {
      primary: "oklch(0.74 0.13 265)",
      "primary-foreground": "oklch(0.18 0.04 265)",
      accent: "oklch(0.3 0.05 265)",
      "accent-foreground": "oklch(0.95 0.02 265)",
      "chart-1": "oklch(0.74 0.14 265)",
      "chart-2": "oklch(0.82 0.1 250)",
    },
  },
  spring: {
    light: {
      primary: "oklch(0.62 0.14 145)",
      accent: "oklch(0.95 0.04 145)",
      ring: "oklch(0.62 0.14 145)",
      "chart-1": "oklch(0.68 0.14 145)",
      "chart-2": "oklch(0.8 0.12 120)",
    },
    dark: {
      primary: "oklch(0.72 0.13 145)",
      "primary-foreground": "oklch(0.18 0.04 145)",
      accent: "oklch(0.3 0.05 145)",
      "accent-foreground": "oklch(0.95 0.02 145)",
      "chart-1": "oklch(0.74 0.13 145)",
      "chart-2": "oklch(0.84 0.11 120)",
    },
  },
  summer: {
    light: {
      primary: "oklch(0.68 0.15 205)",
      accent: "oklch(0.95 0.04 205)",
      ring: "oklch(0.68 0.15 205)",
      "chart-1": "oklch(0.72 0.14 205)",
      "chart-2": "oklch(0.82 0.12 190)",
    },
    dark: {
      primary: "oklch(0.75 0.12 205)",
      "primary-foreground": "oklch(0.18 0.04 205)",
      accent: "oklch(0.3 0.05 205)",
      "accent-foreground": "oklch(0.95 0.02 205)",
      "chart-1": "oklch(0.76 0.13 205)",
      "chart-2": "oklch(0.86 0.1 190)",
    },
  },
  autumn: {
    light: {
      primary: "oklch(0.6 0.15 55)",
      accent: "oklch(0.95 0.04 55)",
      ring: "oklch(0.6 0.15 55)",
      "chart-1": "oklch(0.68 0.15 55)",
      "chart-2": "oklch(0.78 0.13 75)",
    },
    dark: {
      primary: "oklch(0.74 0.14 55)",
      "primary-foreground": "oklch(0.2 0.04 55)",
      accent: "oklch(0.31 0.05 55)",
      "accent-foreground": "oklch(0.95 0.03 55)",
      "chart-1": "oklch(0.74 0.14 55)",
      "chart-2": "oklch(0.82 0.12 75)",
    },
  },
  halloween: {
    light: {
      primary: "oklch(0.66 0.19 45)",
      "primary-foreground": "oklch(0.16 0.03 45)",
      accent: "oklch(0.95 0.04 45)",
      ring: "oklch(0.66 0.19 45)",
      "chart-1": "oklch(0.68 0.19 45)",
      "chart-2": "oklch(0.52 0.16 300)",
    },
    dark: {
      primary: "oklch(0.76 0.17 45)",
      "primary-foreground": "oklch(0.2 0.04 45)",
      accent: "oklch(0.31 0.06 300)",
      "accent-foreground": "oklch(0.95 0.03 300)",
      "chart-1": "oklch(0.74 0.17 45)",
      "chart-2": "oklch(0.64 0.14 300)",
    },
  },
  winter: {
    light: {
      primary: "oklch(0.62 0.11 230)",
      accent: "oklch(0.95 0.025 230)",
      ring: "oklch(0.62 0.11 230)",
      "chart-1": "oklch(0.7 0.11 230)",
      "chart-2": "oklch(0.82 0.08 215)",
    },
    dark: {
      primary: "oklch(0.74 0.11 230)",
      "primary-foreground": "oklch(0.18 0.04 230)",
      accent: "oklch(0.3 0.04 230)",
      "accent-foreground": "oklch(0.95 0.02 230)",
      "chart-1": "oklch(0.76 0.11 230)",
      "chart-2": "oklch(0.86 0.07 215)",
    },
  },
  aprilFools: {
    light: {
      primary: "oklch(0.62 0.26 40)",
      "primary-foreground": "oklch(0.95 0.08 290)",
      accent: "oklch(0.84 0.17 30)",
      "accent-foreground": "oklch(0.3 0.18 210)",
      ring: "oklch(0.7 0.26 50)",
      "chart-1": "oklch(0.62 0.2 330)",
      "chart-2": "oklch(0.66 0.26 50)",
    },
    dark: {
      primary: "oklch(0.62 0.26 40)",
      "primary-foreground": "oklch(0.95 0.08 290)",
      accent: "oklch(0.84 0.17 30)",
      "accent-foreground": "oklch(0.3 0.18 210)",
      ring: "oklch(0.7 0.26 50)",
      "chart-1": "oklch(0.62 0.2 330)",
      "chart-2": "oklch(0.66 0.26 50)",
    },
  },
} as const satisfies Record<
  Exclude<ThemeSeasonId, "auto" | "none">,
  Record<ThemeMode, SeasonalAccentMap>
>;

interface PaletteSeed {
  background: string;
  foreground: string;
  surface: string;
  muted: string;
  mutedForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  border: string;
  charts: readonly [string, string, string, string, string];
}

export interface ThemePresetShape {
  font: ThemeFontId;
  headingFont: ThemeFontId;
  radius: number;
}

export interface ThemePreset {
  id: string;
  label: string;
  description: string;
  badge: "soft" | "punchy" | "bold" | "clean" | "dark";
  shape: ThemePresetShape;
  palette: ModeAwareThemeTokens;
}

function palette(seed: PaletteSeed): ThemeTokenMap {
  return {
    background: seed.background,
    foreground: seed.foreground,
    card: seed.surface,
    "card-foreground": seed.foreground,
    popover: seed.surface,
    "popover-foreground": seed.foreground,
    primary: seed.primary,
    "primary-foreground": seed.primaryForeground,
    secondary: seed.secondary,
    "secondary-foreground": seed.secondaryForeground,
    muted: seed.muted,
    "muted-foreground": seed.mutedForeground,
    accent: seed.secondary,
    "accent-foreground": seed.secondaryForeground,
    destructive: "#dc2626",
    border: seed.border,
    input: seed.border,
    ring: seed.primary,
    "chart-1": seed.charts[0],
    "chart-2": seed.charts[1],
    "chart-3": seed.charts[2],
    "chart-4": seed.charts[3],
    "chart-5": seed.charts[4],
    sidebar: seed.surface,
    "sidebar-foreground": seed.foreground,
    "sidebar-primary": seed.primary,
    "sidebar-primary-foreground": seed.primaryForeground,
    "sidebar-accent": seed.secondary,
    "sidebar-accent-foreground": seed.secondaryForeground,
    "sidebar-border": seed.border,
    "sidebar-ring": seed.primary,
  };
}

type ThemePresetDefinition = Omit<ThemePreset, "palette"> & {
  light: PaletteSeed;
  dark: PaletteSeed;
};

function preset<const Definition extends ThemePresetDefinition>(
  definition: Definition,
): Omit<Definition, "light" | "dark"> & { palette: ModeAwareThemeTokens } {
  const { light, dark, ...metadata } = definition;
  return {
    ...metadata,
    palette: { light: palette(light), dark: palette(dark) },
  };
}

export const THEME_PRESETS = [
  preset({
    id: "marshmallow",
    label: "Marshmallow",
    description: "Soft pastels and airy surfaces.",
    badge: "soft",
    shape: { font: "nunito", headingFont: "nunito", radius: 1 },
    light: {
      background: "#f8f7fc",
      foreground: "#29272d",
      surface: "#ffffff",
      muted: "#eeeef3",
      mutedForeground: "#605c68",
      primary: "#ed78ae",
      primaryForeground: "#24151d",
      secondary: "#d7e8ff",
      secondaryForeground: "#23344d",
      border: "#d9d7df",
      charts: ["#ed78ae", "#b389e9", "#7bb9e8", "#efb96b", "#8fca6b"],
    },
    dark: {
      background: "#242225",
      foreground: "#f7f4f8",
      surface: "#302e31",
      muted: "#39363b",
      mutedForeground: "#c9c3cc",
      primary: "#ed78ae",
      primaryForeground: "#24151d",
      secondary: "#473c5a",
      secondaryForeground: "#f7f1ff",
      border: "#4a464d",
      charts: ["#ed78ae", "#c8a0f5", "#8bc9f5", "#f4c87e", "#9ed47f"],
    },
  }),
  preset({
    id: "vs-code",
    label: "VS Code",
    description: "A precise editor-inspired blue palette.",
    badge: "clean",
    shape: { font: "sourceCode", headingFont: "sourceCode", radius: 0 },
    light: {
      background: "#f3f8fb",
      foreground: "#18202b",
      surface: "#f9fcfe",
      muted: "#e2eaf0",
      mutedForeground: "#465867",
      primary: "#168bd2",
      primaryForeground: "#ffffff",
      secondary: "#dcebf5",
      secondaryForeground: "#17364b",
      border: "#c5d3dd",
      charts: ["#168bd2", "#5266bd", "#2c9b62", "#b38a22", "#8a4ebb"],
    },
    dark: {
      background: "#181a25",
      foreground: "#dce4e9",
      surface: "#20232f",
      muted: "#292d3a",
      mutedForeground: "#a3afbb",
      primary: "#2998d6",
      primaryForeground: "#07131a",
      secondary: "#292e42",
      secondaryForeground: "#dce4e9",
      border: "#363b49",
      charts: ["#2998d6", "#6f82dd", "#49b97a", "#d2a83c", "#b374dd"],
    },
  }),
  preset({
    id: "spotify",
    label: "Spotify",
    description: "High-energy green on deep neutral surfaces.",
    badge: "punchy",
    shape: { font: "dmSans", headingFont: "dmSans", radius: 0.75 },
    light: {
      background: "#f6f8f6",
      foreground: "#151815",
      surface: "#ffffff",
      muted: "#e6ebe7",
      mutedForeground: "#56615a",
      primary: "#1db954",
      primaryForeground: "#07150b",
      secondary: "#dff5e6",
      secondaryForeground: "#103a20",
      border: "#ccd5ce",
      charts: ["#1db954", "#16883f", "#51cf7b", "#f0b83f", "#865bd6"],
    },
    dark: {
      background: "#101211",
      foreground: "#f4f7f5",
      surface: "#191c1a",
      muted: "#242824",
      mutedForeground: "#aeb9b1",
      primary: "#1ed760",
      primaryForeground: "#06170a",
      secondary: "#203729",
      secondaryForeground: "#eaffef",
      border: "#303632",
      charts: ["#1ed760", "#7be59d", "#2cad58", "#f5c451", "#a27be8"],
    },
  }),
  preset({
    id: "neo-brutalism",
    label: "Neo Brutalism",
    description: "Hard edges, ink borders and unapologetic colour.",
    badge: "bold",
    shape: { font: "outfit", headingFont: "outfit", radius: 0 },
    light: {
      background: "#fffdf2",
      foreground: "#111111",
      surface: "#ffffff",
      muted: "#f0e9cf",
      mutedForeground: "#39362d",
      primary: "#ff5c35",
      primaryForeground: "#111111",
      secondary: "#65d9ff",
      secondaryForeground: "#111111",
      border: "#111111",
      charts: ["#ff5c35", "#65d9ff", "#ffd43b", "#a4e85e", "#bc7cff"],
    },
    dark: {
      background: "#181818",
      foreground: "#fffdf2",
      surface: "#242424",
      muted: "#353535",
      mutedForeground: "#d4d0c4",
      primary: "#ff7454",
      primaryForeground: "#111111",
      secondary: "#65d9ff",
      secondaryForeground: "#111111",
      border: "#f3efdF",
      charts: ["#ff7454", "#65d9ff", "#ffe066", "#b4ef7d", "#ca91ff"],
    },
  }),
  preset({
    id: "caffeine",
    label: "Caffeine",
    description: "Warm coffee browns and creamy paper.",
    badge: "soft",
    shape: { font: "lora", headingFont: "lora", radius: 0.35 },
    light: {
      background: "#f7f0e5",
      foreground: "#38291e",
      surface: "#fffaf3",
      muted: "#eadfce",
      mutedForeground: "#756250",
      primary: "#8a5a3b",
      primaryForeground: "#fffaf3",
      secondary: "#dfc7ab",
      secondaryForeground: "#39271c",
      border: "#d4c1ac",
      charts: ["#8a5a3b", "#b1794f", "#5b7c5b", "#c59a45", "#7d5d91"],
    },
    dark: {
      background: "#211a16",
      foreground: "#f4eadc",
      surface: "#2b221c",
      muted: "#392e27",
      mutedForeground: "#c9b8a5",
      primary: "#c68e63",
      primaryForeground: "#25170f",
      secondary: "#4a392c",
      secondaryForeground: "#f4eadc",
      border: "#4a3b31",
      charts: ["#c68e63", "#e0aa7d", "#89aa82", "#d9b663", "#a88abb"],
    },
  }),
  preset({
    id: "material-design",
    label: "Material Design",
    description: "Clear hierarchy with familiar indigo accents.",
    badge: "clean",
    shape: { font: "roboto", headingFont: "roboto", radius: 0.5 },
    light: {
      background: "#f7f7fb",
      foreground: "#202124",
      surface: "#ffffff",
      muted: "#e8e8ef",
      mutedForeground: "#5f6368",
      primary: "#3f51b5",
      primaryForeground: "#ffffff",
      secondary: "#e4e7fa",
      secondaryForeground: "#273169",
      border: "#d5d7df",
      charts: ["#3f51b5", "#009688", "#ff9800", "#e91e63", "#673ab7"],
    },
    dark: {
      background: "#17181c",
      foreground: "#f1f1f5",
      surface: "#212227",
      muted: "#2c2e34",
      mutedForeground: "#b6b8c0",
      primary: "#8c9eff",
      primaryForeground: "#11152a",
      secondary: "#303650",
      secondaryForeground: "#edf0ff",
      border: "#393b43",
      charts: ["#8c9eff", "#45c6b8", "#ffb74d", "#f06292", "#a789e8"],
    },
  }),
  preset({
    id: "modern-minimal",
    label: "Modern Minimal",
    description: "Quiet monochrome surfaces with a cobalt focus.",
    badge: "clean",
    shape: { font: "geist", headingFont: "geist", radius: 0.4 },
    light: {
      background: "#fafafa",
      foreground: "#171717",
      surface: "#ffffff",
      muted: "#f0f0f0",
      mutedForeground: "#666666",
      primary: "#2563eb",
      primaryForeground: "#ffffff",
      secondary: "#e9eefc",
      secondaryForeground: "#1e3a72",
      border: "#dedede",
      charts: ["#2563eb", "#4f7de8", "#38a169", "#d69e2e", "#805ad5"],
    },
    dark: {
      background: "#111111",
      foreground: "#f4f4f4",
      surface: "#191919",
      muted: "#242424",
      mutedForeground: "#aaaaaa",
      primary: "#60a5fa",
      primaryForeground: "#0c1b2d",
      secondary: "#202d42",
      secondaryForeground: "#edf6ff",
      border: "#303030",
      charts: ["#60a5fa", "#86b9f6", "#68c38a", "#e2b759", "#a88ae0"],
    },
  }),
  preset({
    id: "nature",
    label: "Nature",
    description: "Moss, stone and sun-warmed earth.",
    badge: "soft",
    shape: { font: "merriweather", headingFont: "merriweather", radius: 0.7 },
    light: {
      background: "#f5f6ed",
      foreground: "#293226",
      surface: "#fbfcf5",
      muted: "#e5e8d8",
      mutedForeground: "#626c5b",
      primary: "#557a46",
      primaryForeground: "#ffffff",
      secondary: "#dce7ce",
      secondaryForeground: "#314329",
      border: "#cbd1bd",
      charts: ["#557a46", "#8c9b5e", "#b47648", "#4f8d80", "#8b6d9c"],
    },
    dark: {
      background: "#192019",
      foreground: "#edf1e7",
      surface: "#222a21",
      muted: "#2d372c",
      mutedForeground: "#b5c0ad",
      primary: "#89b477",
      primaryForeground: "#13200f",
      secondary: "#35452f",
      secondaryForeground: "#edf6e9",
      border: "#3d493b",
      charts: ["#89b477", "#b2bf7c", "#cf9363", "#77b4a8", "#b094bd"],
    },
  }),
  preset({
    id: "pastel-dreams",
    label: "Pastel Dreams",
    description: "Lilac, mint and peach without sacrificing contrast.",
    badge: "soft",
    shape: { font: "poppins", headingFont: "poppins", radius: 1.1 },
    light: {
      background: "#fbf8ff",
      foreground: "#332d3d",
      surface: "#ffffff",
      muted: "#f0eaf5",
      mutedForeground: "#6c6278",
      primary: "#a978c7",
      primaryForeground: "#211329",
      secondary: "#d8f0e5",
      secondaryForeground: "#264638",
      border: "#ddd4e4",
      charts: ["#a978c7", "#72bba0", "#ed9a82", "#7fa9dd", "#d1aa50"],
    },
    dark: {
      background: "#211d27",
      foreground: "#f4eef8",
      surface: "#2b2632",
      muted: "#37303f",
      mutedForeground: "#c8bdcf",
      primary: "#c49bdd",
      primaryForeground: "#24152c",
      secondary: "#335245",
      secondaryForeground: "#e8fff5",
      border: "#443a4d",
      charts: ["#c49bdd", "#89ceb5", "#f0aa96", "#99bde9", "#dfc06e"],
    },
  }),
  preset({
    id: "midnight-bloom",
    label: "Midnight Bloom",
    description: "A nocturnal floral palette that shines in dark mode.",
    badge: "dark",
    shape: { font: "plusJakarta", headingFont: "playfair", radius: 0.85 },
    light: {
      background: "#f8f6fb",
      foreground: "#241d31",
      surface: "#ffffff",
      muted: "#ece7f1",
      mutedForeground: "#665b73",
      primary: "#7447a8",
      primaryForeground: "#ffffff",
      secondary: "#e8dcf2",
      secondaryForeground: "#40265e",
      border: "#d9d0e2",
      charts: ["#7447a8", "#c34f87", "#497f91", "#c58c3b", "#6778c8"],
    },
    dark: {
      background: "#13101b",
      foreground: "#f1ebf7",
      surface: "#1d1728",
      muted: "#292134",
      mutedForeground: "#bfb1ca",
      primary: "#b78add",
      primaryForeground: "#1d1026",
      secondary: "#392748",
      secondaryForeground: "#f8edff",
      border: "#3b3047",
      charts: ["#b78add", "#ef7eb0", "#6fb1c3", "#dda95b", "#91a0ed"],
    },
  }),
  preset({
    id: "claude",
    label: "Claude",
    description: "Editorial warmth with terracotta accents.",
    badge: "soft",
    shape: { font: "lora", headingFont: "lora", radius: 0.55 },
    light: {
      background: "#f7f3ec",
      foreground: "#2f2a25",
      surface: "#fcfaf6",
      muted: "#ebe5dc",
      mutedForeground: "#70665d",
      primary: "#c15f3c",
      primaryForeground: "#ffffff",
      secondary: "#ead9cd",
      secondaryForeground: "#573729",
      border: "#d8cec1",
      charts: ["#c15f3c", "#84704f", "#66806a", "#b68d3f", "#8b668f"],
    },
    dark: {
      background: "#211d19",
      foreground: "#f1eae2",
      surface: "#2a2520",
      muted: "#373029",
      mutedForeground: "#c5b9ad",
      primary: "#dc805e",
      primaryForeground: "#2a130b",
      secondary: "#49352b",
      secondaryForeground: "#fff2e9",
      border: "#493f36",
      charts: ["#dc805e", "#aa9270", "#87a28a", "#d3aa5f", "#aa85ad"],
    },
  }),
  preset({
    id: "perplexity",
    label: "Perplexity",
    description: "Technical teal with crisp, information-dense surfaces.",
    badge: "clean",
    shape: { font: "inter", headingFont: "inter", radius: 0.3 },
    light: {
      background: "#f6faf9",
      foreground: "#162321",
      surface: "#ffffff",
      muted: "#e5efed",
      mutedForeground: "#536764",
      primary: "#198e8c",
      primaryForeground: "#ffffff",
      secondary: "#d6efed",
      secondaryForeground: "#1c4b49",
      border: "#cbdad8",
      charts: ["#198e8c", "#4a78b8", "#68a354", "#c18537", "#865ba7"],
    },
    dark: {
      background: "#111817",
      foreground: "#edf5f4",
      surface: "#19211f",
      muted: "#242e2c",
      mutedForeground: "#aebfbc",
      primary: "#52b8b5",
      primaryForeground: "#08211f",
      secondary: "#263c3a",
      secondaryForeground: "#edfffd",
      border: "#33403e",
      charts: ["#52b8b5", "#79a0d5", "#8abc78", "#d6a65f", "#aa82c1"],
    },
  }),
] as const satisfies readonly ThemePreset[];

export function themePreset(id: string): ThemePreset | undefined {
  return THEME_PRESETS.find((item) => item.id === id);
}
