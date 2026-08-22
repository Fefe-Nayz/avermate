"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
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
  const { preferences, isLoading, isSaving, update } = usePreferences()
  const { setTheme } = useTheme()
  const router = useRouter()

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
    // Waiting for the write to settle, not for the optimistic value: the
    // refresh below re-runs the layout's own read of the account, and starting
    // it while the change is still in flight raced it — the server answered
    // with the language from before the click and streamed it back over the
    // optimistic one, so the setting visibly reverted to "Match my device"
    // before landing. Settled first, then refresh, and both agree.
    if (isLoading || isSaving) return
    if (preferences.language === "system") return
    if (!isAppLocale(preferences.language)) return

    const current = document.cookie
      .split("; ")
      .find((entry) => entry.startsWith(`${LOCALE_COOKIE}=`))
      ?.split("=")[1]

    if (current === preferences.language) return
    document.cookie = `${LOCALE_COOKIE}=${preferences.language}; path=/; max-age=31536000; samesite=lax`
    // The message catalogue is chosen on the server, so the new language only
    // takes effect on the next render pass from it — and a *server* render is
    // all that is needed. `location.reload()` also asked for a new document,
    // which threw away the query cache, every piece of component state, the
    // scroll position and the loaded images, so changing one word in Settings
    // made the whole app flicker back through its empty states. A refresh
    // re-renders the server tree in place: the cookie above picks the
    // catalogue, `NextIntlClientProvider` receives it, and everything the
    // browser had built stays where it was.
    router.refresh()
  }, [isLoading, isSaving, preferences.language, router])

  return null
}
