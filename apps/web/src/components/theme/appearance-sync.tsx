"use client"

import { useEffect } from "react"
import { useTheme } from "next-themes"
import { applyPreferences, usePreferences } from "@/hooks/use-preferences"
import { LOCALE_COOKIE, isAppLocale } from "@/i18n/config"

/**
 * Keeps the browser in step with the account.
 *
 * The server holds the truth; the cookie holds what the next first paint
 * needs. This bridges them once the session resolves, and only writes when
 * something actually differs so a normal navigation costs nothing.
 */
export function AppearanceSync() {
  const { preferences, isLoading } = usePreferences()
  const { setTheme, theme } = useTheme()

  useEffect(() => {
    if (isLoading) return
    applyPreferences(preferences)
  }, [isLoading, preferences])

  useEffect(() => {
    if (isLoading) return
    if (preferences.theme !== theme) setTheme(preferences.theme)
  }, [isLoading, preferences.theme, theme, setTheme])

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
