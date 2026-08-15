import { useEffect } from "react";
import { getLocales } from "expo-localization";
import * as SecureStore from "expo-secure-store";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/lib/auth-client";
import { setHapticsEnabled } from "@/lib/haptics";
import { setLocale, type Locale } from "@/lib/i18n";
import { localUserKey } from "@/lib/local-settings";
import { orpc } from "@/lib/orpc";
import { setInteractionPreferences } from "@/lib/interaction-preferences";
import {
  setSeasonalTheme,
  setThemePalette,
  setThemePreference,
} from "@/lib/theme";
import { setChartSettings } from "@/lib/chart-settings";
import { setNavigationSettings } from "@/lib/navigation-settings";

/** Applies the server copy after authentication; SecureStore covers first paint. */
export function PreferencesBootstrap() {
  const session = useSession();
  const preferences = useQuery({
    ...orpc.preferences.get.queryOptions(),
    enabled: Boolean(session.data?.user),
  });

  useEffect(() => {
    const value = preferences.data;
    const userId = session.data?.user.id;
    if (!value || !userId) return;

    const detected: Locale =
      getLocales()[0]?.languageCode === "en" ? "en" : "fr";
    const language = value.language === "system" ? detected : value.language;
    setLocale(language);
    setThemePreference(value.theme);
    setThemePalette(value.themePreset, value.customTheme);
    setSeasonalTheme(value.seasonalThemesEnabled, value.seasonalTheme);
    setHapticsEnabled(value.hapticsEnabled);
    setInteractionPreferences({
      compactMode: value.compactMode,
      reduceMotion: value.reduceMotion,
    });
    setChartSettings(value.chartSettings);
    setNavigationSettings(value.navigation ?? {});
    void Promise.all([
      SecureStore.setItemAsync(localUserKey(userId, "locale"), language),
      SecureStore.setItemAsync(localUserKey(userId, "theme"), value.theme),
      SecureStore.setItemAsync(
        localUserKey(userId, "haptics"),
        String(value.hapticsEnabled),
      ),
    ]);
  }, [preferences.data, session.data?.user.id]);

  return null;
}
