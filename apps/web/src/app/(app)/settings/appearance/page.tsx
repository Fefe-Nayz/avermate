"use client";

import { useState } from "react";
import { MonitorIcon, MoonIcon, RotateCcwIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useExtracted } from "next-intl";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { PageMeta } from "@/components/shell/page-chrome";
import {
  SettingsRow,
  SettingsSection,
} from "@/components/settings/settings-section";
import { ChoiceField } from "@/components/forms/controls";
import { usePreferences } from "@/hooks/use-preferences";
import {
  PALETTES,
  SEASONS,
  THEME_TOKENS,
  UNLOCKABLE_PALETTES,
  type Palette,
} from "@/lib/theme";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";

/**
 * Appearance.
 *
 * Palettes are shown as what they are — a row of swatches — because a colour
 * choice made from a dropdown of names is a guess. The custom editor is one
 * step further in, for the people who want it.
 */
export default function AppearanceSettingsPage() {
  const t = useExtracted();
  const { preferences, update } = usePreferences();
  const { setTheme } = useTheme();
  const [showCustom, setShowCustom] = useState(
    preferences.themePreset === "custom",
  );

  // Earned themes sit alongside the standard ones rather than in a section of
  // their own: once unlocked, it is just another colour you can pick.
  const unlocked = UNLOCKABLE_PALETTES.filter((palette) =>
    preferences.unlockedThemes.includes(palette),
  );

  const paletteLabels: Record<string, string> = {
    mokattam: t("Mokattam"),
    default: t("Neutral"),
    ocean: t("Ocean"),
    forest: t("Forest"),
    sunset: t("Sunset"),
    grape: t("Grape"),
    rose: t("Rose"),
    amber: t("Amber"),
  };

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
  };

  return (
    <>
      <PageMeta title={t("Appearance")} backHref="/more" />

      <div className="flex flex-col gap-4">
        <h1 className="hidden text-2xl font-semibold tracking-tight md:block">
          {t("Appearance")}
        </h1>

        <SettingsSection title={t("Theme")}>
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
              update({ theme: value as typeof preferences.theme });
              setTheme(value);
            }}
            columns={3}
          />
        </SettingsSection>

        <SettingsSection
          title={t("Colour")}
          description={t("Sets the accent, the charts and the sidebar.")}
        >
          <div className="grid grid-cols-4 gap-2 @sm/main:grid-cols-7">
            {[...PALETTES, ...unlocked].map((palette) => {
              const active =
                preferences.themePreset === palette && !showCustom;
              return (
                <button
                  key={palette}
                  type="button"
                  onClick={() => {
                    haptic("selection");
                    setShowCustom(false);
                    update({ themePreset: palette });
                  }}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-xl border p-2 transition-colors",
                    active
                      ? "border-primary ring-1 ring-primary/40"
                      : "border-border hover:bg-accent/50",
                  )}
                >
                  <span
                    data-palette={palette}
                    className="size-7 rounded-full border"
                    style={{ background: "var(--primary)" }}
                  />
                  <span className="text-[11px] leading-tight text-muted-foreground">
                    {paletteLabels[palette]}
                  </span>
                </button>
              );
            })}
          </div>

          <SettingsRow
            label={t("Build my own")}
            description={t("Set every colour token by hand.")}
          >
            <Switch
              checked={showCustom}
              onCheckedChange={(checked) => {
                haptic("selection");
                setShowCustom(checked);
                update({ themePreset: checked ? "custom" : "default" });
              }}
            />
          </SettingsRow>

          {showCustom ? (
            <div className="grid grid-cols-2 gap-2 @sm/main:grid-cols-3">
              {THEME_TOKENS.map((token) => (
                <label
                  key={token}
                  className="flex items-center gap-2 rounded-lg border p-2"
                >
                  <input
                    type="color"
                    value={hexOf(preferences.customTheme[token])}
                    onChange={(event) =>
                      update({
                        customTheme: {
                          ...preferences.customTheme,
                          [token]: event.target.value,
                        },
                      })
                    }
                    className="size-6 cursor-pointer rounded border-0 bg-transparent p-0"
                  />
                  <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                    {token}
                  </span>
                </label>
              ))}
              <Button
                variant="ghost"
                size="sm"
                className="col-span-2 @sm/main:col-span-3"
                onClick={() => update({ customTheme: {} })}
              >
                <RotateCcwIcon className="size-4" />
                {t("Clear my colours")}
              </Button>
            </div>
          ) : null}
        </SettingsSection>

        <SettingsSection title={t("Shape")}>
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
                const next = Array.isArray(value) ? value[0] : value;
                if (typeof next === "number") {
                  update({
                    themeShape: { ...preferences.themeShape, radius: next },
                  });
                }
              }}
              className="mt-3"
            />
          </div>
        </SettingsSection>

        <SettingsSection
          title={t("Seasonal touches")}
          description={t("A quiet accent around the holidays. Nothing that moves.")}
        >
          <SettingsRow label={t("Enable seasonal themes")}>
            <Switch
              checked={preferences.seasonalThemesEnabled}
              onCheckedChange={(checked) => {
                haptic("selection");
                update({ seasonalThemesEnabled: checked });
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

        <SettingsSection title={t("Charts")}>
          <SettingsRow
            label={t("Zoom to the data")}
            description={t(
              "Fits the axis to your range. Off shows the full scale, which flattens everything.",
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
        </SettingsSection>

        <SettingsSection title={t("Feel")}>
          <SettingsRow
            label={t("Haptic feedback")}
            description={t("Small taps on phones that support it.")}
          >
            <Switch
              checked={preferences.hapticsEnabled}
              onCheckedChange={(checked) => {
                update({ hapticsEnabled: checked });
                if (checked) haptic("success");
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
  );
}

/** Colour inputs need `#rrggbb`; the stored value may be any CSS colour. */
function hexOf(value: string | undefined): string {
  if (!value) return "#888888";
  return /^#[0-9a-f]{6}$/i.test(value) ? value : "#888888";
}
