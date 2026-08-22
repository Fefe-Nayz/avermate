/**
 * Theming: palettes, seasonal accents and the custom-colour editor.
 *
 * A palette is a named set of CSS variables declared in `theme.css`; the
 * editor writes arbitrary overrides on top. Both are applied to <html>, so a
 * single attribute swap restyles the whole app without re-rendering anything.
 */

import {
  THEME_FONT_CHOICES,
  THEME_FONT_STACKS,
  THEME_PALETTE_IDS,
  THEME_SEASON_IDS,
  THEME_TOKEN_NAMES,
  UNLOCKABLE_THEME_PALETTE_IDS,
  type ThemeFontId,
} from "@avermate/core"

export const PALETTES = THEME_PALETTE_IDS

export type Palette = (typeof PALETTES)[number]

export function isPalette(value: unknown): value is Palette {
  return typeof value === "string" && PALETTES.includes(value as Palette)
}

/**
 * Themes that are not offered until they are earned. They live in the same
 * palette space as the rest, so an unlocked one behaves like any other choice.
 */
export const UNLOCKABLE_PALETTES = UNLOCKABLE_THEME_PALETTE_IDS

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
export const THEME_TOKENS = THEME_TOKEN_NAMES

export type ThemeToken = (typeof THEME_TOKENS)[number]

export const SEASONS = THEME_SEASON_IDS

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

export interface ModeAwareCustomTheme {
  light: Record<string, string>
  dark: Record<string, string>
}

const SAFE_COLOR_FUNCTIONS = new Set([
  "calc",
  "clamp",
  "color",
  "color-mix",
  "hsl",
  "hsla",
  "hwb",
  "lab",
  "lch",
  "light-dark",
  "max",
  "min",
  "oklab",
  "oklch",
  "rgb",
  "rgba",
  "var",
])

/**
 * A CSS colour token is data, never stylesheet syntax. Keep the accepted
 * language deliberately small while retaining modern colours and migrated
 * `var()`/`color-mix()` values.
 */
export function sanitizeThemeValue(value: string): string | null {
  const candidate = value.trim()
  if (!candidate || candidate.length > 240) return null
  if (/[;{}<>"'\\\r\n]/.test(candidate)) return null
  if (candidate.includes("/*") || candidate.includes("*/")) return null
  if (/(?:url|expression)\s*\(|@import|javascript\s*:/i.test(candidate)) {
    return null
  }
  // Hex, named colours, numbers, CSS math and function punctuation only.
  if (!/^[#a-zA-Z0-9\s%.,()+\-*/]+$/.test(candidate)) return null

  let depth = 0
  for (const character of candidate) {
    if (character === "(") depth += 1
    if (character === ")") depth -= 1
    if (depth < 0 || depth > 8) return null
  }
  if (depth !== 0) return null

  for (const match of candidate.matchAll(/([a-zA-Z][a-zA-Z-]*)\s*\(/g)) {
    if (!SAFE_COLOR_FUNCTIONS.has(match[1].toLowerCase())) return null
  }
  return candidate
}

function themeDeclarations(overrides: Record<string, string>): string {
  return Object.entries(overrides)
    .flatMap(([token, value]) => {
      if (!(THEME_TOKENS as readonly string[]).includes(token)) return []
      const safeValue = sanitizeThemeValue(value)
      return safeValue ? [`  --${token}: ${safeValue};`] : []
    })
    .join("\n")
}

/** CSS text for separate light and dark user palettes. */
export function customThemeCss(overrides: ModeAwareCustomTheme): string {
  const light = themeDeclarations(overrides.light)
  const dark = themeDeclarations(overrides.dark)
  if (!light && !dark) return ""

  return [
    light ? `:root[data-palette="custom"] {\n${light}\n}` : "",
    dark ? `:root.dark[data-palette="custom"] {\n${dark}\n}` : "",
  ]
    .filter(Boolean)
    .join("\n")
}

/** Validate the exact stylesheet grammar written to the first-paint cookie. */
export function sanitizeCustomThemeCss(css: string): string {
  if (!css || css.length > 20_000 || /<\/style|<script/i.test(css)) return ""
  const lines = css.split("\n")
  const selectors = new Set([
    ':root[data-palette="custom"] {',
    ':root.dark[data-palette="custom"] {',
  ])
  let inside = false
  for (const line of lines) {
    if (selectors.has(line)) {
      if (inside) return ""
      inside = true
      continue
    }
    if (line === "}") {
      if (!inside) return ""
      inside = false
      continue
    }
    if (!inside) return ""
    const declaration = line.match(/^  --([a-z0-9-]+): (.+);$/)
    if (!declaration) return ""
    if (!(THEME_TOKENS as readonly string[]).includes(declaration[1])) return ""
    if (sanitizeThemeValue(declaration[2]) !== declaration[2]) return ""
  }
  return inside ? "" : css
}

export const FONT_CHOICES = THEME_FONT_CHOICES

export type FontChoice = ThemeFontId

export const FONT_STACKS: Record<FontChoice, string> = THEME_FONT_STACKS

/** Resolve exact IDs and legacy v1 font stacks to one stable preference ID. */
export function fontChoiceOf(
  value: string,
  fallback: FontChoice = "inter"
): FontChoice {
  if (value in FONT_STACKS) return value as FontChoice

  const exact = Object.entries(FONT_STACKS).find(
    ([, stack]) => stack === value
  )?.[0]
  if (exact) return exact as FontChoice

  const normalized = value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "")
  const aliases: Array<[FontChoice, readonly string[]]> = [
    ["avermate", ["fontgabarito", "gabarito"]],
    ["plusJakarta", ["fontplusjakarta", "plusjakarta"]],
    ["dmSans", ["fontdmsans", "dmsans"]],
    ["playfair", ["fontplayfair", "playfairdisplay"]],
    ["jetbrains", ["fontjetbrainsmono", "jetbrainsmono"]],
    ["firaCode", ["fontfiracode", "firacode"]],
    ["sourceCode", ["fontsizecodepro", "sourcecodepro"]],
    ["merriweather", ["fontmerriweather", "merriweather"]],
    ["montserrat", ["fontmontserrat", "montserrat"]],
    ["poppins", ["fontpoppins", "poppins"]],
    ["outfit", ["fontoutfit", "outfit"]],
    ["nunito", ["fontnunito", "nunito"]],
    ["roboto", ["fontroboto", "roboto"]],
    ["geist", ["fontgeist", "geist"]],
    ["inter", ["fontinter", "inter"]],
    ["lora", ["fontlora", "lora"]],
  ]
  return (
    aliases.find(([, names]) =>
      names.some((name) => normalized.includes(name))
    )?.[0] ?? fallback
  )
}

/** Named choices plus sanitized legacy stacks imported from the first app. */
export function fontStack(
  value: string,
  fallback: FontChoice = "inter"
): string {
  if (value in FONT_STACKS) return FONT_STACKS[value as FontChoice]
  if (
    value.length <= 160 &&
    !/[;{}]/.test(value) &&
    !/url\s*\(/i.test(value) &&
    /^[\w\s'",.()\-]+$/.test(value)
  ) {
    return value
  }
  return FONT_STACKS[fallback]
}
