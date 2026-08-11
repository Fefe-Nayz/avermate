export interface LegacyThemeRow {
  customTheme?: unknown;
  mokattamThemeAvailable?: unknown;
  mokattamThemeEnabled?: unknown;
  mokattamThemeCelebrationSeenAt?: unknown;
}

interface LegacyCustomTheme {
  enabled?: unknown;
  radius?: unknown;
  fontSans?: unknown;
  light?: unknown;
  dark?: unknown;
}

export interface MigratedTheme {
  themePreset: string;
  customTheme: { light: Record<string, string>; dark: Record<string, string> };
  themeShape: { font: string; headingFont: string; radius: number };
  unlockedThemes: string[];
  seenCelebrations: string[];
}

const truthy = (value: unknown): boolean =>
  value === true || value === 1 || value === "1";

function parseObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** v1 used camelCase token names while v2 writes CSS variable names. */
export function legacyTokenName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Za-z])(\d)/g, "$1-$2")
    .toLowerCase();
}

function palette(value: unknown): Record<string, string> {
  const source = parseObject(value);
  return Object.fromEntries(
    Object.entries(source)
      .filter(([, token]) => typeof token === "string" && token.trim() !== "")
      .map(([name, token]) => [legacyTokenName(name), String(token)]),
  );
}

/** Lossless conversion from main's light/dark editor to rewrite's contract. */
export function migrateLegacyTheme(row: LegacyThemeRow): MigratedTheme {
  const source = parseObject(row.customTheme) as LegacyCustomTheme;
  const radius = Number(source.radius);
  const available = truthy(row.mokattamThemeAvailable);
  const mokattamActive = available && truthy(row.mokattamThemeEnabled);
  const customActive = truthy(source.enabled);

  return {
    themePreset: mokattamActive
      ? "mokattam"
      : customActive
        ? "custom"
        : "default",
    customTheme: {
      light: palette(source.light),
      dark: palette(source.dark),
    },
    themeShape: {
      font:
        typeof source.fontSans === "string" && source.fontSans.trim() !== ""
          ? source.fontSans
          : "inter",
      headingFont: "inherit",
      radius:
        Number.isFinite(radius) && radius >= 0 && radius <= 2 ? radius : 0.625,
    },
    unlockedThemes: available ? ["mokattam"] : [],
    seenCelebrations:
      available && row.mokattamThemeCelebrationSeenAt ? ["mokattam"] : [],
  };
}

export function migrateLegacySeason(value: unknown): string {
  if (value === "april-fools") return "aprilFools";
  return typeof value === "string" && value ? value : "auto";
}
