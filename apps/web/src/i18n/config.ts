/** Shared i18n constants. The app has no locale-based routing. */
export const locales = ["en", "fr"] as const
export type AppLocale = (typeof locales)[number]

/**
 * French is the default: Avermate models French grading conventions and that
 * is where nearly every account is. English is a first-class translation, not
 * a fallback.
 */
export const defaultLocale: AppLocale = "fr"

export const LOCALE_COOKIE = "avermate-locale"

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && locales.includes(value as AppLocale)
}

export const LOCALE_LABELS: Record<AppLocale, string> = {
  en: "English",
  fr: "Français",
}
