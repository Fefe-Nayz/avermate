"use client"

import { useState } from "react"
import {
  FlameIcon,
  MonitorIcon,
  MoonIcon,
  RotateCcwIcon,
  SparklesIcon,
  SunIcon,
} from "lucide-react"
import { useTheme } from "next-themes"
import { useExtracted } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { PageMeta } from "@/components/shell/page-chrome"
import {
  SettingsRow,
  SettingsSection,
} from "@/components/settings/settings-section"
import { ChoiceField, SelectField } from "@/components/forms/controls"
import { ColorPicker } from "@/components/ui/color-picker"
import { usePreferences } from "@/hooks/use-preferences"
import {
  PALETTES,
  FONT_CHOICES,
  fontChoiceOf,
  SEASONS,
  THEME_TOKENS,
  UNLOCKABLE_PALETTES,
} from "@/lib/theme"
import { haptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"
import { THEME_STUDIO_PRESETS } from "@/lib/theme-presets"

/**
 * Appearance.
 *
 * Palettes are shown as what they are — a row of swatches — because a colour
 * choice made from a dropdown of names is a guess. The custom editor is one
 * step further in, for the people who want it.
 */
export default function AppearanceSettingsPage() {
  const t = useExtracted()
  const { preferences, update } = usePreferences()
  const { setTheme } = useTheme()
  const [showCustom, setShowCustom] = useState(
    preferences.themePreset === "custom"
  )
  const [trendSubdivisions, setTrendSubdivisions] = useState(
    preferences.chartSettings.trendSubdivisions
  )

  const [customMode, setCustomMode] = useState<"light" | "dark">("light")

  // Earned themes sit alongside the standard ones rather than in a section of
  // their own: once unlocked, it is just another colour you can pick.
  const unlocked = UNLOCKABLE_PALETTES.filter((palette) =>
    preferences.unlockedThemes.includes(palette)
  )

  const paletteLabels: Record<string, string> = {
    mokattam: t("Mokattam"),
    default: t("Neutral"),
    ocean: t("Ocean"),
    forest: t("Forest"),
    sunset: t("Sunset"),
    grape: t("Grape"),
    rose: t("Rose"),
    amber: t("Amber"),
  }

  const seasonLabels: Record<string, string> = {
    auto: t("Follow the calendar"),
    aprilFools: t("April Fools"),
    none: t("Off"),
    newYear: t("New year"),
    spring: t("Spring"),
    summer: t("Summer"),
    autumn: t("Autumn"),
    halloween: t("Halloween"),
    winter: t("Winter"),
  }
  const presetDescriptions: Record<string, string> = {
    marshmallow: t("Soft pastels and airy surfaces."),
    "vs-code": t("A precise editor-inspired blue palette."),
    spotify: t("High-energy green on deep neutral surfaces."),
    "neo-brutalism": t("Hard edges, ink borders and unapologetic colour."),
    caffeine: t("Warm coffee browns and creamy paper."),
    "material-design": t("Clear hierarchy with familiar indigo accents."),
    "modern-minimal": t("Quiet monochrome surfaces with a cobalt focus."),
    nature: t("Moss, stone and sun-warmed earth."),
    "pastel-dreams": t("Lilac, mint and peach without sacrificing contrast."),
    "midnight-bloom": t("A nocturnal floral palette that shines in dark mode."),
    claude: t("Editorial warmth with terracotta accents."),
    perplexity: t("Technical teal with crisp, information-dense surfaces."),
  }
  const presetBadges = {
    soft: t("Soft"),
    punchy: t("Punchy"),
    bold: t("Bold"),
    clean: t("Clean"),
    dark: t("Dark-first"),
  }

  return (
    <>
      <PageMeta title={t("Appearance")} backHref="/more" />

      <div className="flex flex-col gap-4">
        <h1 className="hidden text-2xl font-semibold tracking-tight md:block">
          {t("Appearance")}
        </h1>

        <SettingsSection id="theme" title={t("Theme")}>
          <ChoiceField
            choices={[
              {
                value: "system",
                label: t("Match my device"),
                icon: <MonitorIcon className="size-4" />,
              },
              {
                value: "light",
                label: t("Light"),
                icon: <SunIcon className="size-4" />,
              },
              {
                value: "dark",
                label: t("Dark"),
                icon: <MoonIcon className="size-4" />,
              },
            ]}
            value={preferences.theme}
            onValueChange={(value) => {
              update({ theme: value as typeof preferences.theme })
              setTheme(value)
            }}
            columns={3}
          />
        </SettingsSection>

        {/*
         * One section, because both halves wrote the same setting. "Colour"
         * offered seven accents and "Theme studio" twelve full designs, and
         * picking from either replaced whatever the other had selected — so
         * the screen looked like two competing pickers with no stated
         * relationship. They are now one choice with two kinds of answer, and
         * the difference is said out loud rather than implied by placement.
         */}
        <SettingsSection
          id="cards"
          title={t("Colour and theme")}
          description={t(
            "One choice. An accent recolours the app; a full design also changes its typography and shape."
          )}
        >
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              {t("Accents")}
            </p>
            {/*
             * A seasonal theme overrides the accent every palette sets, so a
             * palette can look like it did nothing. Saying so beats letting
             * someone click all seven and conclude the picker is broken.
             */}
            {preferences.seasonalThemesEnabled ? (
              <p className="mb-2 text-xs text-muted-foreground">
                {t(
                  "A seasonal theme is on and is currently tinting the accent. Turn it off below to see a palette exactly as it is."
                )}
              </p>
            ) : null}
            <div className="grid grid-cols-4 gap-2 @sm/main:grid-cols-7">
              {[...PALETTES, ...unlocked].map((palette) => {
                const active =
                  preferences.themePreset === palette && !showCustom
                return (
                  <button
                    key={palette}
                    type="button"
                    onClick={() => {
                      haptic("selection")
                      setShowCustom(false)
                      update({ themePreset: palette })
                    }}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-xl border p-2 transition-colors",
                      active
                        ? "border-primary ring-1 ring-primary/40"
                        : "border-border hover:bg-accent/50"
                    )}
                  >
                    {/*
                     * `data-palette-preview`, not `data-palette`: the palette
                     * variables are scoped to `:root`, so the old attribute
                     * matched nothing here and every swatch drew the palette
                     * that was already active — seven identical circles.
                     */}
                    <span
                      data-palette-preview={palette}
                      className="size-7 rounded-full border shadow-xs"
                      style={{ background: "var(--primary)" }}
                    />
                    <span className="text-[11px] leading-tight text-muted-foreground">
                      {paletteLabels[palette]}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="space-y-2 border-t pt-4">
            <div>
              <p className="flex items-center gap-2 text-sm font-medium">
                <SparklesIcon className="size-4 text-primary" />
                {t("Full designs")}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t(
                  "Complete light and dark designs, including charts, navigation, typography and shape."
                )}
              </p>
            </div>
            <div className="grid gap-2 @sm/main:grid-cols-2 @lg/main:grid-cols-3">
              {THEME_STUDIO_PRESETS.map((preset) => {
                const active = preferences.themePreset === preset.id
                const light = preset.palette.light
                const dark = preset.palette.dark
                return (
                  <button
                    key={preset.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      haptic("selection")
                      setShowCustom(false)
                      update({
                        themePreset: preset.id,
                        themeShape: preset.shape,
                      })
                    }}
                    className={cn(
                      "group rounded-xl border p-3 text-left transition-colors",
                      active
                        ? "border-primary ring-1 ring-primary/40"
                        : "hover:bg-accent/50"
                    )}
                  >
                    <span className="mb-2 flex h-9 overflow-hidden rounded-lg border">
                      <span
                        className="flex-1"
                        style={{ background: light.background }}
                      >
                        <span
                          className="m-2 block size-3 rounded-full"
                          style={{ background: light.primary }}
                        />
                      </span>
                      <span
                        className="flex-1"
                        style={{ background: dark.background }}
                      >
                        <span
                          className="m-2 block size-3 rounded-full"
                          style={{ background: dark.primary }}
                        />
                      </span>
                    </span>
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">
                        {preset.label}
                      </span>
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground capitalize">
                        {presetBadges[preset.badge]}
                      </span>
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                      {presetDescriptions[preset.id]}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {preferences.unlockedThemes.includes("mokattam") ? (
            <div className="rounded-xl border border-orange-300/60 bg-gradient-to-br from-orange-100/80 via-amber-50/60 to-card p-3 dark:border-orange-500/30 dark:from-orange-500/15 dark:via-amber-500/5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="flex items-center gap-2 text-sm font-medium text-orange-900 dark:text-orange-100">
                    <FlameIcon className="size-4" />
                    {t("Mokattam supporter theme")}
                  </p>
                  <p className="mt-1 text-xs text-orange-900/70 dark:text-orange-100/70">
                    {t("A permanent thank-you, available on every device.")}
                  </p>
                </div>
                <Button
                  variant={
                    preferences.themePreset === "mokattam"
                      ? "default"
                      : "outline"
                  }
                  size="sm"
                  onClick={() => update({ themePreset: "mokattam" })}
                >
                  <FlameIcon className="size-4" />
                  {preferences.themePreset === "mokattam"
                    ? t("Selected")
                    : t("Use theme")}
                </Button>
              </div>
            </div>
          ) : null}

          <SettingsRow
            label={t("Build my own")}
            description={t("Set every colour token by hand.")}
          >
            <Switch
              checked={showCustom}
              onCheckedChange={(checked) => {
                haptic("selection")
                setShowCustom(checked)
                update({ themePreset: checked ? "custom" : "default" })
              }}
            />
          </SettingsRow>

          {showCustom ? (
            <div className="flex flex-col gap-3">
              <ChoiceField
                choices={[
                  { value: "light", label: t("Light palette") },
                  { value: "dark", label: t("Dark palette") },
                ]}
                value={customMode}
                onValueChange={setCustomMode}
                columns={2}
              />
              {/*
               * Thirty-one tokens, each previously a bordered card in a grid:
               * a wall of boxes the height of several screens. One divided
               * list instead, a row per token — the swatch reads as a column
               * you can scan down, which is how anyone checks a palette.
               */}
              <div className="divide-y overflow-hidden rounded-xl border">
                {THEME_TOKENS.map((token) => {
                  const value = preferences.customTheme[customMode][token] ?? ""
                  const patchToken = (nextValue: string) =>
                    update({
                      customTheme: {
                        ...preferences.customTheme,
                        [customMode]: {
                          ...preferences.customTheme[customMode],
                          [token]: nextValue,
                        },
                      },
                    })
                  return (
                    <div
                      key={token}
                      className="flex items-center gap-3 px-3 py-1.5"
                    >
                      <ColorPicker
                        label={token}
                        value={value}
                        onValueChange={patchToken}
                      />
                      <span className="flex-1 truncate font-mono text-xs text-muted-foreground">
                        {token}
                      </span>
                      <Input
                        key={`${customMode}:${token}:${value}`}
                        defaultValue={value}
                        aria-label={`${token} CSS`}
                        placeholder={t("Unset")}
                        className="h-7 w-40 shrink-0 border-transparent bg-transparent font-mono text-[11px] shadow-none focus-visible:border-input focus-visible:bg-background"
                        onBlur={(event) => {
                          const nextValue = event.target.value.trim()
                          if (nextValue !== value) patchToken(nextValue)
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur()
                        }}
                      />
                    </div>
                  )
                })}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="self-start"
                onClick={() =>
                  update({
                    customTheme: {
                      ...preferences.customTheme,
                      [customMode]: {},
                    },
                  })
                }
              >
                <RotateCcwIcon className="size-4" />
                {t("Clear this palette")}
              </Button>
            </div>
          ) : null}
        </SettingsSection>

        <SettingsSection
          id="typography"
          title={t("Typography and shape")}
          description={t("Choose body and heading styles independently.")}
        >
          {/*
           * Dropdowns rather than card grids. Nineteen fonts laid out as
           * tappable cards is a wall; rendered twice — once for the body and
           * once for headings — it reads as the same picker duplicated and
           * pushes everything below it off the screen. A font is a name you
           * recognise, so a list you open is the right shape for it.
           */}
          <div className="grid gap-4 @sm/main:grid-cols-2">
            <SelectField
              label={t("Body font")}
              options={FONT_CHOICES.map((font) => ({
                value: font.id,
                label: font.label,
              }))}
              value={fontChoiceOf(preferences.themeShape.font)}
              onValueChange={(font) =>
                update({
                  themeShape: { ...preferences.themeShape, font },
                })
              }
            />
            <SelectField
              label={t("Heading font")}
              options={[
                { value: "inherit", label: t("Same as body") },
                ...FONT_CHOICES.map((font) => ({
                  value: font.id,
                  label: font.label,
                })),
              ]}
              value={
                preferences.themeShape.headingFont === "inherit"
                  ? "inherit"
                  : fontChoiceOf(preferences.themeShape.headingFont)
              }
              onValueChange={(headingFont) =>
                update({
                  themeShape: { ...preferences.themeShape, headingFont },
                })
              }
            />
          </div>
          <div>
            <SettingsRow
              label={t("Corner rounding")}
              description={t("From square to very round.")}
            >
              <span className="numeric text-sm text-muted-foreground">
                {preferences.themeShape.radius.toFixed(2)}
              </span>
            </SettingsRow>
            <Slider
              value={[preferences.themeShape.radius]}
              min={0}
              max={1.5}
              step={0.05}
              onValueChange={(value) => {
                const next = Array.isArray(value) ? value[0] : value
                if (typeof next === "number") {
                  update({
                    themeShape: { ...preferences.themeShape, radius: next },
                  })
                }
              }}
              className="mt-3"
            />
          </div>
        </SettingsSection>

        <SettingsSection
          id="seasonal"
          title={t("Seasonal touches")}
          description={t(
            "A quiet accent around the holidays. Nothing that moves."
          )}
        >
          <SettingsRow label={t("Enable seasonal themes")}>
            <Switch
              checked={preferences.seasonalThemesEnabled}
              onCheckedChange={(checked) => {
                haptic("selection")
                update({ seasonalThemesEnabled: checked })
              }}
            />
          </SettingsRow>

          {preferences.seasonalThemesEnabled ? (
            <ChoiceField
              choices={SEASONS.map((season) => ({
                value: season,
                label: seasonLabels[season] ?? season,
              }))}
              value={preferences.seasonalTheme}
              onValueChange={(value) => update({ seasonalTheme: value })}
              columns={2}
            />
          ) : null}
        </SettingsSection>

        <SettingsSection id="charts" title={t("Charts")}>
          <SettingsRow
            label={t("Zoom to the data")}
            description={t(
              "Fits the axis to your range. Off shows the full scale, which flattens everything."
            )}
          >
            <Switch
              checked={preferences.chartSettings.autoZoom}
              onCheckedChange={(checked) =>
                update({
                  chartSettings: {
                    ...preferences.chartSettings,
                    autoZoom: checked,
                  },
                })
              }
            />
          </SettingsRow>
          <SettingsRow label={t("Show the trend line")}>
            <Switch
              checked={preferences.chartSettings.showTrend}
              onCheckedChange={(checked) =>
                update({
                  chartSettings: {
                    ...preferences.chartSettings,
                    showTrend: checked,
                  },
                })
              }
            />
          </SettingsRow>
          {preferences.chartSettings.showTrend ? (
            <div className="space-y-2 px-1 py-2">
              <SettingsRow
                label={t("Trend detail")}
                description={t(
                  "One segment shows the overall direction; more segments reveal local changes."
                )}
              >
                <span className="numeric text-sm text-muted-foreground">
                  {trendSubdivisions}
                </span>
              </SettingsRow>
              <Slider
                min={1}
                max={10}
                step={1}
                value={[trendSubdivisions]}
                aria-label={t("Trend detail")}
                onValueChange={(values) =>
                  setTrendSubdivisions(
                    typeof values === "number" ? values : (values[0] ?? 1)
                  )
                }
                onValueCommitted={(values) =>
                  update({
                    chartSettings: {
                      ...preferences.chartSettings,
                      trendSubdivisions:
                        typeof values === "number" ? values : (values[0] ?? 1),
                    },
                  })
                }
              />
            </div>
          ) : null}
          <SettingsRow
            label={t("Show child subject series")}
            description={t(
              "Compare a subject with its direct children on the same chart."
            )}
          >
            <Switch
              checked={preferences.chartSettings.showSubSubjects}
              onCheckedChange={(checked) =>
                update({
                  chartSettings: {
                    ...preferences.chartSettings,
                    showSubSubjects: checked,
                  },
                })
              }
            />
          </SettingsRow>
          <SettingsRow label={t("Mark each point")}>
            <Switch
              checked={preferences.chartSettings.showPoints}
              onCheckedChange={(checked) =>
                update({
                  chartSettings: {
                    ...preferences.chartSettings,
                    showPoints: checked,
                  },
                })
              }
            />
          </SettingsRow>
          <SettingsRow
            label={t("Join the grade dots")}
            description={t(
              "A thin, quiet line guides the eye through the grade chart without claiming the grades are related."
            )}
          >
            <Switch
              checked={preferences.chartSettings.connectGrades}
              onCheckedChange={(checked) =>
                update({
                  chartSettings: {
                    ...preferences.chartSettings,
                    connectGrades: checked,
                  },
                })
              }
            />
          </SettingsRow>
          <ChoiceField
            label={t("Line style")}
            description={t(
              "How average lines connect their points. Smooth eases between them, linear joins them directly, steps hold each value until the next one."
            )}
            choices={[
              { value: "smooth", label: t("Smooth") },
              { value: "straight", label: t("Linear") },
              { value: "step", label: t("Steps") },
            ]}
            value={preferences.chartSettings.lineStyle}
            onValueChange={(lineStyle) =>
              update({
                chartSettings: {
                  ...preferences.chartSettings,
                  lineStyle,
                },
              })
            }
            columns={3}
          />
        </SettingsSection>

        <SettingsSection id="motion" title={t("Feel")}>
          <SettingsRow
            label={t("Haptic feedback")}
            description={t("Small taps on phones that support it.")}
          >
            <Switch
              checked={preferences.hapticsEnabled}
              onCheckedChange={(checked) => {
                update({ hapticsEnabled: checked })
                if (checked) haptic("success")
              }}
            />
          </SettingsRow>
          <SettingsRow
            label={t("Reduce motion")}
            description={t("Turns off animated numbers and transitions.")}
          >
            <Switch
              checked={preferences.reduceMotion}
              onCheckedChange={(checked) => update({ reduceMotion: checked })}
            />
          </SettingsRow>
        </SettingsSection>
      </div>
    </>
  )
}

/** Colour inputs need `#rrggbb`; the stored value may be any CSS colour. */
