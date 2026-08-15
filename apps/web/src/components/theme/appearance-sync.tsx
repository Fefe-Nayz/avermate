"use client"

import { useEffect, useRef } from "react"
import { useTheme } from "next-themes"
import { THEME_HOTKEY_EVENT } from "@/components/theme-provider"
import {
  applyPreferences,
  usePreferences,
  type Preferences,
} from "@/hooks/use-preferences"
import { LOCALE_COOKIE, isAppLocale } from "@/i18n/config"

/**
 * Keeps the browser in step with the account.
 *
 * The server holds the truth; the cookie holds what the next first paint
 * needs. This bridges them once the session resolves, and only writes when
 * something actually differs so a normal navigation costs nothing.
 */
export function AppearanceSync() {
  const { preferences, isLoading, update } = usePreferences()
  const { setTheme } = useTheme()

  useEffect(() => {
    if (isLoading) return
    applyPreferences(preferences)
  }, [isLoading, preferences])

  // Asserts the stored theme only when the stored value itself changes —
  // never because the live theme moved. Reconciling on divergence looked
  // equivalent, but next-themes mirrors the live theme across tabs, and a
  // sibling tab whose preference cache was still stale would shove the old
  // theme back, this tab would shove the new one, and the app blinked
  // between light and dark until a tab closed.
  const appliedTheme = useRef<Preferences["theme"] | null>(null)
  useEffect(() => {
    if (isLoading) return
    if (appliedTheme.current === preferences.theme) return
    appliedTheme.current = preferences.theme
    setTheme(preferences.theme)
  }, [isLoading, preferences.theme, setTheme])

  // The global "d" hotkey lives above the session providers, so it cannot
  // store its choice itself; it announces the flip and the account keeps it.
  useEffect(() => {
    const persist = (event: Event) => {
      const next = (event as CustomEvent<unknown>).detail
      if (next === "light" || next === "dark") update({ theme: next })
    }
    window.addEventListener(THEME_HOTKEY_EVENT, persist)
    return () => window.removeEventListener(THEME_HOTKEY_EVENT, persist)
  }, [update])

  useEffect(() => {
    if (isLoading) return
    if (preferences.language === "system") return
    if (!isAppLocale(preferences.language)) return

    const current = document.cookie
      .split("; ")
      .find((entry) => entry.startsWith(`${LOCALE_COOKIE}=`))
      ?.split("=")[1]

    if (current === preferences.language) return
    document.cookie = `${LOCALE_COOKIE}=${preferences.language}; path=/; max-age=31536000; samesite=lax`
    // The message catalogue is chosen on the server, so the new language only
    // takes effect on the next render pass from it.
    window.location.reload()
  }, [isLoading, preferences.language])

  return null
}
