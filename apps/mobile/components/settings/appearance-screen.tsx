import { useEffect, useState } from "react";
import { getLocales } from "expo-localization";
import { Stack } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChoiceField, SwitchField } from "@/components/field";
import {
  Confirmation,
  Loading,
  Problem,
  Screen,
  Section,
} from "@/components/ui";
import { haptic, setHapticsEnabled } from "@/lib/haptics";
import { setLocale, t, type Locale } from "@/lib/i18n";
import { client, orpc, queryClient } from "@/lib/orpc";
import { setInteractionPreferences } from "@/lib/interaction-preferences";
import {
  setThemePreference,
  setThemePalette,
  setSeasonalTheme,
  themePreference,
  type ThemePreference,
} from "@/lib/theme";
import {
  NATIVE_STUDIO_IDS,
  NATIVE_SEASON_IDS,
  NATIVE_THEME_IDS,
  themeShapeOf,
} from "@/lib/theme-presets";
import { setChartSettings } from "@/lib/chart-settings";

type Preferences = Awaited<ReturnType<typeof client.preferences.get>>;

function deviceLocale(): Locale {
  return getLocales()[0]?.languageCode === "en" ? "en" : "fr";
}

/** Preferences shared with web while retaining an immediate native mirror. */
export function AppearanceScreen() {
  const query = useQuery(orpc.preferences.get.queryOptions());
  const [draft, setDraft] = useState<Preferences | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.data && !draft) setDraft(query.data);
  }, [draft, query.data]);

  const update = useMutation({
    ...orpc.preferences.update.mutationOptions(),
    onSuccess: (next) => {
      setDraft(next);
      setChartSettings(next.chartSettings);
      setError(null);
      setSaved(true);
      haptic("success");
      void queryClient.setQueryData(orpc.preferences.get.queryKey(), next);
    },
    onError: () => {
      setSaved(false);
      setError(t("That preference could not be saved."));
      haptic("error");
    },
  });

  if (!draft) return <Loading />;

  const patch = (value: Parameters<typeof update.mutate>[0]) => {
    setSaved(false);
    setDraft((current) =>
      current ? ({ ...current, ...value } as Preferences) : current,
    );
    if (value.chartSettings) {
      setChartSettings({ ...draft.chartSettings, ...value.chartSettings });
    }
    update.mutate(value);
  };

  const pickTheme = (value: string) => {
    const next = value as ThemePreference;
    setThemePreference(next);
    patch({ theme: next });
  };

  const pickLanguage = (value: string) => {
    const choice = value as "system" | Locale;
    const effective = choice === "system" ? deviceLocale() : choice;
    setLocale(effective);
    patch({ language: choice });
  };

  const pickHaptics = (value: boolean) => {
    setHapticsEnabled(value);
    if (value) haptic("light");
    patch({ hapticsEnabled: value });
  };

  const pickPalette = (value: string) => {
    setThemePalette(value, draft.customTheme);
    const shape = themeShapeOf(value);
    patch({
      themePreset: value,
      ...(shape ? { themeShape: shape } : {}),
    });
  };

  const pickSeason = (value: string) => {
    setSeasonalTheme(draft.seasonalThemesEnabled, value);
    patch({ seasonalTheme: value });
  };

  return (
    <>
      <Stack.Screen options={{ title: t("Appearance") }} />
      <Screen>
        <Section title={t("Theme")}>
          <ChoiceField
            value={draft.theme ?? themePreference()}
            onChange={pickTheme}
            choices={[
              { value: "system", label: t("Match my device") },
              { value: "light", label: t("Light") },
              { value: "dark", label: t("Dark") },
            ]}
          />
          <SwitchField
            label={t("Seasonal themes")}
            hint={t("Small visual touches at special times of year")}
            value={draft.seasonalThemesEnabled}
            onValueChange={(value) => {
              setSeasonalTheme(value, draft.seasonalTheme);
              patch({ seasonalThemesEnabled: value });
            }}
          />
          {draft.seasonalThemesEnabled ? (
            <ChoiceField
              label={t("Season")}
              value={draft.seasonalTheme}
              onChange={pickSeason}
              columns={2}
              choices={NATIVE_SEASON_IDS.map((value) => ({
                value,
                label:
                  value === "auto"
                    ? t("Automatic")
                    : value === "none"
                      ? t("None")
                      : value === "newYear"
                        ? t("New Year")
                        : value === "aprilFools"
                          ? t("April Fools")
                          : `${value[0]?.toUpperCase()}${value.slice(1)}`,
              }))}
            />
          ) : null}
        </Section>

        <Section title={t("Colour")}>
          <ChoiceField
            value={draft.themePreset}
            onChange={pickPalette}
            columns={2}
            choices={[
              ...NATIVE_THEME_IDS.map((value) => ({
                value,
                label: value === "default" ? t("Default") : value,
              })),
              ...(draft.unlockedThemes.includes("mokattam")
                ? [{ value: "mokattam", label: "Mokattam" }]
                : []),
              ...(draft.themePreset === "custom"
                ? [{ value: "custom", label: t("Custom") }]
                : []),
            ]}
          />
        </Section>

        <Section title={t("Theme studio")}>
          <ChoiceField
            value={draft.themePreset}
            onChange={pickPalette}
            columns={2}
            choices={NATIVE_STUDIO_IDS.map((value) => ({
              value,
              label: value
                .split("-")
                .map((part) => `${part[0]?.toUpperCase()}${part.slice(1)}`)
                .join(" "),
            }))}
          />
        </Section>

        <Section title={t("Language")}>
          <ChoiceField
            value={draft.language}
            onChange={pickLanguage}
            choices={[
              { value: "system", label: t("Match my device") },
              { value: "fr", label: "Français" },
              { value: "en", label: "English" },
            ]}
          />
        </Section>

        <Section title={t("Interaction")}>
          <SwitchField
            label={t("Haptic feedback")}
            hint={t("Small taps as you move through the app")}
            value={draft.hapticsEnabled}
            onValueChange={pickHaptics}
          />
          <SwitchField
            label={t("Reduce motion")}
            hint={t("Use fewer animated transitions")}
            value={draft.reduceMotion}
            onValueChange={(value) => {
              setInteractionPreferences({
                compactMode: draft.compactMode,
                reduceMotion: value,
              });
              patch({ reduceMotion: value });
            }}
          />
          <SwitchField
            label={t("Compact layout")}
            hint={t("Fit more information on each screen")}
            value={draft.compactMode}
            onValueChange={(value) => {
              setInteractionPreferences({
                compactMode: value,
                reduceMotion: draft.reduceMotion,
              });
              patch({ compactMode: value });
            }}
          />
        </Section>

        <Section title={t("Charts")}>
          <SwitchField
            label={t("Automatic zoom")}
            value={draft.chartSettings.autoZoom}
            onValueChange={(value) =>
              patch({
                chartSettings: { ...draft.chartSettings, autoZoom: value },
              })
            }
          />
          <SwitchField
            label={t("Show trend")}
            value={draft.chartSettings.showTrend}
            onValueChange={(value) =>
              patch({
                chartSettings: { ...draft.chartSettings, showTrend: value },
              })
            }
          />
          <SwitchField
            label={t("Show data points")}
            value={draft.chartSettings.showPoints}
            onValueChange={(value) =>
              patch({
                chartSettings: { ...draft.chartSettings, showPoints: value },
              })
            }
          />
          <SwitchField
            label={t("Connect the grade dots")}
            hint={t("A faint line between results")}
            value={draft.chartSettings.connectGrades ?? false}
            onValueChange={(value) =>
              patch({
                chartSettings: { ...draft.chartSettings, connectGrades: value },
              })
            }
          />
          <SwitchField
            label={t("Show sub-subjects")}
            value={draft.chartSettings.showSubSubjects}
            onValueChange={(value) =>
              patch({
                chartSettings: {
                  ...draft.chartSettings,
                  showSubSubjects: value,
                },
              })
            }
          />
          <ChoiceField
            label={t("Line style")}
            value={draft.chartSettings.lineStyle ?? "smooth"}
            onChange={(value) =>
              patch({
                chartSettings: {
                  ...draft.chartSettings,
                  lineStyle: value as "smooth" | "straight" | "step",
                },
              })
            }
            columns={2}
            choices={[
              { value: "smooth", label: t("Smooth") },
              { value: "straight", label: t("Linear") },
              { value: "step", label: t("Stepped") },
            ]}
          />
          <ChoiceField
            label={t("Trend detail")}
            value={String(draft.chartSettings.trendSubdivisions)}
            onChange={(value) =>
              patch({
                chartSettings: {
                  ...draft.chartSettings,
                  trendSubdivisions: Number(value),
                },
              })
            }
            columns={2}
            choices={[1, 2, 4, 6, 12].map((value) => ({
              value: String(value),
              label: String(value),
            }))}
          />
        </Section>

        {saved ? (
          <Section>
            <Confirmation>{t("Preferences saved.")}</Confirmation>
          </Section>
        ) : null}
        {error ? (
          <Section>
            <Problem>{error}</Problem>
          </Section>
        ) : null}
      </Screen>
    </>
  );
}
