/**
 * Theming: palettes, seasonal accents and the custom-colour editor.
 *
 * A palette is a named set of CSS variables declared in `theme.css`; the
 * editor writes arbitrary overrides on top. Both are applied to <html>, so a
 * single attribute swap restyles the whole app without re-rendering anything.
 */

export const PALETTES = [
  "default",
  "ocean",
  "forest",
  "sunset",
  "grape",
  "rose",
  "amber",
] as const

export type Palette = (typeof PALETTES)[number]

export function isPalette(value: unknown): value is Palette {
  return typeof value === "string" && PALETTES.includes(value as Palette)
}

/**
 * Themes that are not offered until they are earned. They live in the same
 * palette space as the rest, so an unlocked one behaves like any other choice.
 */
export const UNLOCKABLE_PALETTES = ["mokattam"] as const

export type UnlockablePalette = (typeof UNLOCKABLE_PALETTES)[number]

export function isUnlockablePalette(
  value: unknown
): value is UnlockablePalette {
  return (
    typeof value === "string" &&
    UNLOCKABLE_PALETTES.includes(value as UnlockablePalette)
  )
}

/** Tokens the custom-theme editor is allowed to override. */
export const THEME_TOKENS = [
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
  "sidebar-accent",
  "sidebar-border",
] as const

export type ThemeToken = (typeof THEME_TOKENS)[number]

export const SEASONS = [
  "auto",
  "none",
  "newYear",
  "spring",
  "summer",
  "autumn",
  "halloween",
  "winter",
  "aprilFools",
] as const

export type Season = (typeof SEASONS)[number]

/**
 * The season a date falls in. Deliberately coarse — this drives a subtle
 * accent and a decoration, not a different product.
 */
export function seasonOf(date: Date = new Date()): Exclude<Season, "auto"> {
  const month = date.getMonth() + 1
  const day = date.getDate()

  // One day only, and only when the seasonal themes are on. It is a joke, not
  // a redesign, and it has to be leaveable.
  if (month === 4 && day === 1) return "aprilFools"
  if (month === 12 && day >= 20) return "newYear"
  if (month === 1 && day <= 6) return "newYear"
  if (month === 10 && day >= 24) return "halloween"
  if (month === 11) return "autumn"
  if (month === 12 || month <= 2) return "winter"
  if (month <= 5) return "spring"
  if (month <= 8) return "summer"
  return "autumn"
}

export function resolveSeason(
  preference: Season,
  enabled: boolean
): Exclude<Season, "auto"> {
  if (!enabled) return "none"
  if (preference === "auto") return seasonOf()
  return preference
}

/** CSS text for the user's own colour overrides. */
export function customThemeCss(
  overrides: Record<string, string>,
  radius?: number
): string {
  const entries = Object.entries(overrides).filter(
    ([token, value]) =>
      (THEME_TOKENS as readonly string[]).includes(token) &&
      value.trim().length > 0
  )
  if (entries.length === 0 && radius === undefined) return ""

  const declarations = entries
    .map(([token, value]) => `  --${token}: ${value};`)
    .join("\n")
  const radiusRule = radius === undefined ? "" : `  --radius: ${radius}rem;\n`

  return `:root[data-palette="custom"] {\n${radiusRule}${declarations}\n}`
}

export const FONT_CHOICES = [
  { id: "inter", label: "Inter" },
  { id: "geist", label: "Geist" },
  { id: "system", label: "System" },
  { id: "serif", label: "Serif" },
  { id: "mono", label: "Mono" },
] as const

export type FontChoice = (typeof FONT_CHOICES)[number]["id"]

export const FONT_STACKS: Record<FontChoice, string> = {
  inter: "var(--font-inter), ui-sans-serif, system-ui, sans-serif",
  geist: "var(--font-geist), ui-sans-serif, system-ui, sans-serif",
  system: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  serif: "var(--font-serif), ui-serif, Georgia, serif",
  mono: "var(--font-mono), ui-monospace, SFMono-Regular, monospace",
}
