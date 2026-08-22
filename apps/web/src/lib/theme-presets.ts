import { THEME_PRESETS, themePreset, type ThemePreset } from "@avermate/core"

/** Web naming retained for compatibility; Core owns every preset value. */
export type ThemeStudioPreset = ThemePreset

export const THEME_STUDIO_PRESETS: readonly ThemeStudioPreset[] = THEME_PRESETS

export function themeStudioPreset(id: string): ThemeStudioPreset | undefined {
  return themePreset(id)
}
