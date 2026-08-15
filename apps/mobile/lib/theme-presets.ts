export interface NativeThemeOverride {
  background?: string;
  surface?: string;
  surfaceRaised?: string;
  border?: string;
  hairline?: string;
  text?: string;
  textMuted?: string;
  textFaint?: string;
  accent?: string;
  accentText?: string;
  accentSoft?: string;
}

type Seed = readonly [
  background: string,
  foreground: string,
  surface: string,
  muted: string,
  mutedForeground: string,
  primary: string,
  primaryForeground: string,
  secondary: string,
  border: string,
];

interface Pair {
  light: Seed;
  dark: Seed;
  shape?: { font: string; headingFont: string; radius: number };
}

const seed = (...values: Seed): Seed => values;

/** Exact semantic colours from the web theme studio, expressed as native hex. */
const STUDIO: Record<string, Pair> = {
  marshmallow: {
    light: seed(
      "#f8f7fc",
      "#29272d",
      "#ffffff",
      "#eeeef3",
      "#605c68",
      "#ed78ae",
      "#24151d",
      "#d7e8ff",
      "#d9d7df",
    ),
    dark: seed(
      "#242225",
      "#f7f4f8",
      "#302e31",
      "#39363b",
      "#c9c3cc",
      "#ed78ae",
      "#24151d",
      "#473c5a",
      "#4a464d",
    ),
    shape: { font: "nunito", headingFont: "nunito", radius: 1 },
  },
  "vs-code": {
    light: seed(
      "#f3f8fb",
      "#18202b",
      "#f9fcfe",
      "#e2eaf0",
      "#465867",
      "#168bd2",
      "#ffffff",
      "#dcebf5",
      "#c5d3dd",
    ),
    dark: seed(
      "#181a25",
      "#dce4e9",
      "#20232f",
      "#292d3a",
      "#a3afbb",
      "#2998d6",
      "#07131a",
      "#292e42",
      "#363b49",
    ),
    shape: { font: "sourceCode", headingFont: "sourceCode", radius: 0 },
  },
  spotify: {
    light: seed(
      "#f6f8f6",
      "#151815",
      "#ffffff",
      "#e6ebe7",
      "#56615a",
      "#1db954",
      "#07150b",
      "#dff5e6",
      "#ccd5ce",
    ),
    dark: seed(
      "#101211",
      "#f4f7f5",
      "#191c1a",
      "#242824",
      "#aeb9b1",
      "#1ed760",
      "#06170a",
      "#203729",
      "#303632",
    ),
    shape: { font: "dmSans", headingFont: "dmSans", radius: 0.75 },
  },
  "neo-brutalism": {
    light: seed(
      "#fffdf2",
      "#111111",
      "#ffffff",
      "#f0e9cf",
      "#39362d",
      "#ff5c35",
      "#111111",
      "#65d9ff",
      "#111111",
    ),
    dark: seed(
      "#181818",
      "#fffdf2",
      "#242424",
      "#353535",
      "#d4d0c4",
      "#ff7454",
      "#111111",
      "#65d9ff",
      "#f3efdf",
    ),
    shape: { font: "outfit", headingFont: "outfit", radius: 0 },
  },
  caffeine: {
    light: seed(
      "#f7f0e5",
      "#38291e",
      "#fffaf3",
      "#eadfce",
      "#756250",
      "#8a5a3b",
      "#fffaf3",
      "#dfc7ab",
      "#d4c1ac",
    ),
    dark: seed(
      "#211a16",
      "#f4eadc",
      "#2b221c",
      "#392e27",
      "#c9b8a5",
      "#c68e63",
      "#25170f",
      "#4a392c",
      "#4a3b31",
    ),
    shape: { font: "lora", headingFont: "lora", radius: 0.35 },
  },
  "material-design": {
    light: seed(
      "#f7f7fb",
      "#202124",
      "#ffffff",
      "#e8e8ef",
      "#5f6368",
      "#3f51b5",
      "#ffffff",
      "#e4e7fa",
      "#d5d7df",
    ),
    dark: seed(
      "#17181c",
      "#f1f1f5",
      "#212227",
      "#2c2e34",
      "#b6b8c0",
      "#8c9eff",
      "#11152a",
      "#303650",
      "#393b43",
    ),
    shape: { font: "roboto", headingFont: "roboto", radius: 0.5 },
  },
  "modern-minimal": {
    light: seed(
      "#fafafa",
      "#171717",
      "#ffffff",
      "#f0f0f0",
      "#666666",
      "#2563eb",
      "#ffffff",
      "#e9eefc",
      "#dedede",
    ),
    dark: seed(
      "#111111",
      "#f4f4f4",
      "#191919",
      "#242424",
      "#aaaaaa",
      "#60a5fa",
      "#0c1b2d",
      "#202d42",
      "#303030",
    ),
    shape: { font: "geist", headingFont: "geist", radius: 0.4 },
  },
  nature: {
    light: seed(
      "#f5f6ed",
      "#293226",
      "#fbfcf5",
      "#e5e8d8",
      "#626c5b",
      "#557a46",
      "#ffffff",
      "#dce7ce",
      "#cbd1bd",
    ),
    dark: seed(
      "#192019",
      "#edf1e7",
      "#222a21",
      "#2d372c",
      "#b5c0ad",
      "#89b477",
      "#13200f",
      "#35452f",
      "#3d493b",
    ),
    shape: { font: "merriweather", headingFont: "merriweather", radius: 0.7 },
  },
  "pastel-dreams": {
    light: seed(
      "#fbf8ff",
      "#332d3d",
      "#ffffff",
      "#f0eaf5",
      "#6c6278",
      "#a978c7",
      "#211329",
      "#d8f0e5",
      "#ddd4e4",
    ),
    dark: seed(
      "#211d27",
      "#f4eef8",
      "#2b2632",
      "#37303f",
      "#c8bdcf",
      "#c49bdd",
      "#24152c",
      "#335245",
      "#443a4d",
    ),
    shape: { font: "poppins", headingFont: "poppins", radius: 1.1 },
  },
  "midnight-bloom": {
    light: seed(
      "#f8f6fb",
      "#241d31",
      "#ffffff",
      "#ece7f1",
      "#665b73",
      "#7447a8",
      "#ffffff",
      "#e8dcf2",
      "#d9d0e2",
    ),
    dark: seed(
      "#13101b",
      "#f1ebf7",
      "#1d1728",
      "#292134",
      "#bfb1ca",
      "#b78add",
      "#1d1026",
      "#392748",
      "#3b3047",
    ),
    shape: { font: "plusJakarta", headingFont: "playfair", radius: 0.85 },
  },
  claude: {
    light: seed(
      "#f7f3ec",
      "#2f2a25",
      "#fcfaf6",
      "#ebe5dc",
      "#70665d",
      "#c15f3c",
      "#ffffff",
      "#ead9cd",
      "#d8cec1",
    ),
    dark: seed(
      "#211d19",
      "#f1eae2",
      "#2a2520",
      "#373029",
      "#c5b9ad",
      "#dc805e",
      "#2a130b",
      "#49352b",
      "#493f36",
    ),
    shape: { font: "lora", headingFont: "lora", radius: 0.55 },
  },
  perplexity: {
    light: seed(
      "#f6faf9",
      "#162321",
      "#ffffff",
      "#e5efed",
      "#536764",
      "#198e8c",
      "#ffffff",
      "#d6efed",
      "#cbdad8",
    ),
    dark: seed(
      "#111817",
      "#edf5f4",
      "#19211f",
      "#242e2c",
      "#aebfbc",
      "#52b8b5",
      "#08211f",
      "#263c3a",
      "#33403e",
    ),
    shape: { font: "inter", headingFont: "inter", radius: 0.3 },
  },
};

const ACCENTS: Record<
  string,
  readonly [light: string, dark: string, soft: string]
> = {
  ocean: ["#287fa8", "#6ab5dc", "#e2f1f8"],
  forest: ["#348456", "#6fc78e", "#e4f3e8"],
  sunset: ["#d75f36", "#ed9869", "#f9e9df"],
  grape: ["#8b4fc0", "#bc84e8", "#f1e6f8"],
  rose: ["#c94a68", "#e8849a", "#f9e5ea"],
  amber: ["#d49a24", "#e8b956", "#f9efd4"],
  mokattam: ["#dc7135", "#ef9b68", "#f8e8df"],
};

export const NATIVE_THEME_IDS = [
  "default",
  "ocean",
  "forest",
  "sunset",
  "grape",
  "rose",
  "amber",
] as const;

export const NATIVE_STUDIO_IDS = Object.keys(STUDIO);

export function themeShapeOf(id: string) {
  return STUDIO[id]?.shape;
}

function fromSeed(value: Seed): NativeThemeOverride {
  const [
    background,
    foreground,
    surface,
    muted,
    mutedForeground,
    primary,
    primaryForeground,
    secondary,
    border,
  ] = value;
  return {
    background,
    surface,
    surfaceRaised: surface,
    border,
    hairline: border,
    text: foreground,
    textMuted: mutedForeground,
    textFaint: mutedForeground,
    accent: primary,
    accentText: primaryForeground,
    accentSoft: secondary || muted,
  };
}

function safeColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return /^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))$/i.test(value)
    ? value
    : undefined;
}

function fromCustom(tokens: Record<string, string>): NativeThemeOverride {
  const background = safeColor(tokens.background);
  const foreground = safeColor(tokens.foreground);
  const surface = safeColor(tokens.card);
  const muted = safeColor(tokens.muted);
  const mutedForeground = safeColor(tokens["muted-foreground"]);
  const primary = safeColor(tokens.primary);
  const primaryForeground = safeColor(tokens["primary-foreground"]);
  const secondary = safeColor(tokens.secondary);
  const border = safeColor(tokens.border);
  return {
    background,
    surface,
    surfaceRaised: surface,
    border,
    hairline: border,
    text: foreground,
    textMuted: mutedForeground,
    textFaint: mutedForeground,
    accent: primary,
    accentText: primaryForeground,
    accentSoft: secondary || muted,
  };
}

export function nativeThemeOverrides(
  id: string,
  customInput: unknown,
): { light: NativeThemeOverride; dark: NativeThemeOverride } {
  const candidate =
    customInput && typeof customInput === "object"
      ? (customInput as Record<string, unknown>)
      : {};
  const custom =
    candidate.light &&
    typeof candidate.light === "object" &&
    candidate.dark &&
    typeof candidate.dark === "object"
      ? {
          light: candidate.light as Record<string, string>,
          dark: candidate.dark as Record<string, string>,
        }
      : {
          light: candidate as Record<string, string>,
          dark: candidate as Record<string, string>,
        };
  const studio = STUDIO[id];
  if (studio)
    return { light: fromSeed(studio.light), dark: fromSeed(studio.dark) };
  if (id === "custom") {
    return { light: fromCustom(custom.light), dark: fromCustom(custom.dark) };
  }
  const accent = ACCENTS[id];
  if (accent) {
    return {
      light: {
        accent: accent[0],
        accentText: "#ffffff",
        accentSoft: accent[2],
      },
      dark: { accent: accent[1], accentText: "#111111", accentSoft: "#2d2a27" },
    };
  }
  return { light: {}, dark: {} };
}

export const NATIVE_SEASON_IDS = [
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

function seasonOf(
  date = new Date(),
): Exclude<(typeof NATIVE_SEASON_IDS)[number], "auto"> {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  if (month === 4 && day === 1) return "aprilFools";
  if ((month === 12 && day >= 20) || (month === 1 && day <= 6))
    return "newYear";
  if (month === 10 && day >= 24) return "halloween";
  if (month === 11) return "autumn";
  if (month === 12 || month <= 2) return "winter";
  if (month <= 5) return "spring";
  if (month <= 8) return "summer";
  return "autumn";
}

export function nativeSeasonOverrides(
  enabled: boolean,
  preference: string,
): { light: NativeThemeOverride; dark: NativeThemeOverride } {
  const resolved = !enabled
    ? "none"
    : preference === "auto"
      ? seasonOf()
      : preference;
  const accents: Record<string, readonly [string, string, string]> = {
    newYear: ["#665ac9", "#9d95e8", "#eceafd"],
    spring: ["#3a9560", "#75c893", "#e5f5e9"],
    summer: ["#2695ad", "#68c4d5", "#e2f5f8"],
    autumn: ["#b9662f", "#dc996c", "#f8e9df"],
    halloween: ["#de7737", "#f0a16c", "#fae9dd"],
    winter: ["#4e8aad", "#86bad5", "#e7f2f8"],
    aprilFools: ["#d64c9f", "#ef8cc7", "#ffe4f5"],
  };
  const colors = accents[resolved];
  if (!colors) return { light: {}, dark: {} };
  return {
    light: {
      accent: colors[0],
      accentText: "#ffffff",
      accentSoft: colors[2],
    },
    dark: {
      accent: colors[1],
      accentText: "#151515",
      accentSoft: "#32282e",
    },
  };
}
