"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTheme } from "next-themes"
import { useCallback } from "react"
import { orpc } from "@/lib/orpc"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"
import { setHapticsEnabled } from "@/lib/haptics"
import {
  DEFAULT_APPEARANCE,
  writeAppearanceCookie,
  type Appearance,
} from "@/lib/appearance"
import type { ChartLineStyle } from "@/components/charts/line-style"
import {
  customThemeCss,
  fontStack,
  isPalette,
  isUnlockablePalette,
  resolveSeason,
  type Season,
} from "@/lib/theme"
import { themeStudioPreset } from "@/lib/theme-presets"

export interface Preferences {
  theme: "system" | "light" | "dark"
  language: "system" | "en" | "fr"
  themePreset: string
  customTheme: {
    light: Record<string, string>
    dark: Record<string, string>
  }
  themeShape: { font: string; headingFont: string; radius: number }
  seasonalThemesEnabled: boolean
  seasonalTheme: string
  hapticsEnabled: boolean
  reduceMotion: boolean
  compactMode: boolean
  chartSettings: {
    autoZoom: boolean
    showTrend: boolean
    trendSubdivisions: number
    showPoints: boolean
    showSubSubjects: boolean
    lineStyle: ChartLineStyle
    connectGrades: boolean
  }
  navigation: {
    tabs?: string[]
    sidebar?: string[]
    /**
     * The quick-add action the sidebar offers as a button, by href.
     *
     * Absent means none, which is the default: the sidebar is for going places, and
     * a button that creates something is a different kind of thing to put in it. An
     * account that adds grades every day can have it at the top all the same.
     */
    sidebarAction?: string
  }
  unlockedThemes: string[]
  seenCelebrations: string[]
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "system",
  language: "system",
  themePreset: "default",
  customTheme: { light: {}, dark: {} },
  themeShape: { font: "inter", headingFont: "inherit", radius: 0.625 },
  seasonalThemesEnabled: true,
  seasonalTheme: "auto",
  hapticsEnabled: true,
  reduceMotion: false,
  compactMode: false,
  chartSettings: {
    autoZoom: true,
    showTrend: false,
    trendSubdivisions: 1,
    showPoints: true,
    showSubSubjects: true,
    lineStyle: "smooth",
    connectGrades: false,
  },
  navigation: {},
  unlockedThemes: [],
  seenCelebrations: [],
}

export function appearanceOf(preferences: Preferences): Appearance {
  const palette = preferences.themePreset
  const studioPreset = themeStudioPreset(palette)
  return {
    ...DEFAULT_APPEARANCE,
    palette: studioPreset
      ? "custom"
      : palette === "custom" || isUnlockablePalette(palette)
        ? (palette as Appearance["palette"])
        : isPalette(palette)
          ? palette
          : "default",
    customCss: studioPreset
      ? customThemeCss(studioPreset.palette)
      : palette === "custom"
        ? customThemeCss(preferences.customTheme)
        : "",
    font: preferences.themeShape.font,
    headingFont: preferences.themeShape.headingFont,
    radius: preferences.themeShape.radius,
    reduceMotion: preferences.reduceMotion,
    season: resolveSeason(
      preferences.seasonalTheme as Season,
      preferences.seasonalThemesEnabled
    ),
  }
}

/**
 * Account preferences, with the writes applied optimistically. Changing a
 * theme has to feel like flipping a switch, not like submitting a form.
 */
export function usePreferences() {
  const queryClient = useQueryClient()
  const key = orpc.preferences.get.queryKey()

  const query = useQuery({
    ...orpc.preferences.get.queryOptions(),
    staleTime: COMMON_QUERY_STALE_TIME,
  })

  const mutation = useMutation({
    ...orpc.preferences.update.mutationOptions(),
    onMutate: async (patch: Partial<Preferences>) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<Preferences>(key)
      const next = { ...(previous ?? DEFAULT_PREFERENCES), ...patch }
      queryClient.setQueryData(key, next)
      applyPreferences(next)
      return { previous }
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) {
        queryClient.setQueryData(key, context.previous)
        applyPreferences(context.previous)
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key })
    },
  })

  const preferences =
    (query.data as Preferences | undefined) ?? DEFAULT_PREFERENCES

  const update = useCallback(
    (patch: Partial<Preferences>) => mutation.mutate(patch),
    [mutation]
  )

  return {
    preferences,
    isLoading: query.isLoading,
    update,
    isSaving: mutation.isPending,
  }
}

/**
 * The one way to change the theme.
 *
 * There are four places to flip it — the appearance screen, the user menu, the
 * mobile hub and the command palette — and only the first one used to store
 * the choice. The rest called `setTheme` alone, which `AppearanceSync`
 * immediately undid: it compares the stored preference against the live theme
 * and puts the stored one back. So every quick toggle either did nothing or
 * flickered, and the app looked like it had two selectors disagreeing.
 *
 * Writing the preference *and* setting the theme keeps that reconciliation a
 * no-op, which is what makes the shortcuts and the screen agree.
 */
export function useThemeControl() {
  const { preferences, update } = usePreferences()
  const { setTheme, resolvedTheme } = useTheme()

  const setPreferredTheme = useCallback(
    (next: Preferences["theme"]) => {
      update({ theme: next })
      setTheme(next)
    },
    [setTheme, update]
  )

  const toggleTheme = useCallback(() => {
    setPreferredTheme(resolvedTheme === "dark" ? "light" : "dark")
  }, [resolvedTheme, setPreferredTheme])

  return {
    theme: preferences.theme,
    resolvedTheme,
    setPreferredTheme,
    toggleTheme,
  }
}

/** Push preferences into the DOM and the first-paint cookie. */
export function applyPreferences(preferences: Preferences): void {
  if (typeof document === "undefined") return

  const appearance = appearanceOf(preferences)
  const root = document.documentElement

  root.dataset.palette = appearance.palette
  root.dataset.season = appearance.season
  root.dataset.motion = appearance.reduceMotion ? "reduced" : "full"
  root.style.setProperty("--radius", `${appearance.radius}rem`)
  root.style.setProperty("--app-font-sans", fontStack(appearance.font))
  root.style.setProperty(
    "--app-font-heading",
    appearance.headingFont === "inherit"
      ? "var(--app-font-sans)"
      : fontStack(appearance.headingFont)
  )

  let style = document.getElementById("avermate-custom-theme")
  if (!style) {
    style = document.createElement("style")
    style.id = "avermate-custom-theme"
    document.head.appendChild(style)
  }
  style.textContent = appearance.customCss

  setHapticsEnabled(preferences.hapticsEnabled)
  writeAppearanceCookie(appearance)
}
