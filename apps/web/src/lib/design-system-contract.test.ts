import { describe, expect, test } from "bun:test"
import {
  RESULT_BAND_IDS,
  THEME_MODES,
  THEME_PRESETS,
  THEME_RADIUS_SCALE_REM,
  THEME_RESULT_BAND_COLORS,
  THEME_SEASONAL_ACCENTS,
  themePreset,
} from "@avermate/core"
import { THEME_STUDIO_PRESETS, themeStudioPreset } from "./theme-presets"

async function source(relativePath: string): Promise<string> {
  return Bun.file(new URL(relativePath, import.meta.url)).text()
}

function rule(stylesheet: string, selector: string): string {
  const marker = `${selector} {`
  const start = stylesheet.indexOf(marker)
  if (start < 0) throw new Error(`Missing CSS rule: ${selector}`)
  const bodyStart = start + marker.length
  const end = stylesheet.indexOf("\n}", bodyStart)
  if (end < 0) throw new Error(`Unclosed CSS rule: ${selector}`)
  return stylesheet.slice(bodyStart, end)
}

function declarations(block: string): Record<string, string> {
  return Object.fromEntries(
    [...block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((match) => [
      match[1],
      match[2].trim(),
    ])
  )
}

function rem(block: string, token: string): number {
  const value = declarations(block)[token]
  const match = value?.match(/^([0-9.]+)rem$/)
  if (!match) throw new Error(`Missing rem token: ${token}`)
  return Number(match[1])
}

describe("design-system adapters", () => {
  test("keeps the Web preset adapter literal-free and identity-preserving", async () => {
    const adapter = await source("./theme-presets.ts")

    expect(THEME_STUDIO_PRESETS).toBe(THEME_PRESETS)
    for (const preset of THEME_PRESETS) {
      expect(themeStudioPreset(preset.id)).toBe(themePreset(preset.id))
    }
    expect(adapter).toContain('from "@avermate/core"')
    expect(adapter).not.toMatch(/#[0-9a-f]{3,8}/i)
    expect(adapter.split(/\r?\n/).length).toBeLessThanOrEqual(20)
  })

  test("keeps CSS band and seasonal adapters aligned with Core", async () => {
    const css = await source("../app/theme.css")
    const bandCss = css.slice(css.indexOf("Result bands"))
    const bandBlocks = {
      light: declarations(rule(bandCss, ":root")),
      dark: declarations(rule(bandCss, ".dark")),
    }

    for (const mode of THEME_MODES) {
      for (const band of RESULT_BAND_IDS) {
        const colors = THEME_RESULT_BAND_COLORS[mode][band]
        expect(bandBlocks[mode][`band-${band}`]).toBe(colors.background)
        expect(bandBlocks[mode][`band-${band}-foreground`]).toBe(
          colors.foreground
        )
      }
    }

    for (const [season, modes] of Object.entries(THEME_SEASONAL_ACCENTS)) {
      for (const mode of THEME_MODES) {
        const selector =
          season === "aprilFools"
            ? ':root[data-season="aprilFools"]'
            : mode === "light"
              ? `:root:not(.dark)[data-season="${season}"]`
              : `:root.dark[data-season="${season}"]`
        const actual = declarations(rule(css, selector))
        for (const [token, value] of Object.entries(modes[mode])) {
          expect(actual[token], `${season}/${mode}/${token}`).toBe(value)
        }
      }
    }
  })

  test("uses input capability rather than viewport width for density", async () => {
    const appCss = await source("../app/app.css")
    const touch = rule(appCss, ":root")
    const query = "@media (hover: hover) and (pointer: fine)"
    const pointerStart = appCss.indexOf(query)
    expect(pointerStart).toBeGreaterThan(-1)
    const pointer = rule(appCss.slice(pointerStart), ":root")

    for (const token of ["control-h", "control-px", "control-text"]) {
      expect(declarations(touch)[token]).toBeDefined()
      expect(declarations(pointer)[token]).toBeDefined()
    }
    expect(rem(touch, "control-h")).toBeGreaterThan(rem(pointer, "control-h"))
    expect(rem(touch, "control-px")).toBeGreaterThan(rem(pointer, "control-px"))
    expect(rem(touch, "control-text")).toBeGreaterThan(
      rem(pointer, "control-text")
    )
    expect(rem(touch, "control-h-form")).toBe(2.75)
    expect(rem(pointer, "control-h-form")).toBe(2.25)
    expect(rem(touch, "control-h-comfortable")).toBe(3)
    expect(rem(pointer, "control-h-comfortable")).toBe(2.25)
    expect(rem(touch, "control-h-search")).toBe(2.75)
    expect(rem(pointer, "control-h-search")).toBe(2.5)

    const primitivePaths = [
      "../components/ui/button.tsx",
      "../components/ui/input.tsx",
      "../components/ui/select.tsx",
      "../components/ui/textarea.tsx",
      "../components/ui/input-group.tsx",
    ]
    for (const path of primitivePaths) {
      const primitive = await source(path)
      expect(primitive, path).toContain("--control-")
      expect(primitive, path).toContain("focus-visible")
      expect(primitive, path).not.toMatch(/\b(?:sm|md|lg):(h|size|px|text)-/)
    }

    for (const path of [
      "../components/forms/controls.tsx",
      "../components/forms/picker.tsx",
    ]) {
      const wrapper = await source(path)
      expect(wrapper, path).toContain("--control-h-")
      expect(wrapper, path).not.toMatch(/\b(?:sm|md|lg):(h|size|px|text)-/)
    }
  })

  test("keeps the radius contract and concise documentation discoverable", async () => {
    const globals = await source("../app/globals.css")
    const docs = await source("../../../../docs/design-system.md")

    expect(globals).toContain(`--radius: ${THEME_RADIUS_SCALE_REM.lg}rem;`)
    expect(globals).toContain("--radius-sm: calc(var(--radius) * 0.6);")
    expect(globals).toContain("--radius-xl: calc(var(--radius) * 1.4);")
    expect(docs.split(/\r?\n/).length).toBeLessThanOrEqual(80)
    expect(docs).toContain("migration is explicitly deferred")
    expect(docs).toContain("(pointer: fine)")
  })
})
