"use client";

import { useEffect, useEffectEvent, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";

import { useUpdateUserSettings, useUserSettings } from "@/hooks/use-user-settings";
import { authClient } from "@/lib/auth";
import {
  readLocalUserSettings,
  resolveUpdatedAt,
  updateLocalUserSettings,
  writeLocalUserSettings,
} from "@/lib/user-settings-storage";
import { type AppTheme, type UserSettings } from "@/types/user-settings";
import type { UpdateUserSettingsInput } from "@/hooks/use-user-settings";

function normalizeTheme(value?: string | null): AppTheme | null {
  if (value === "light" || value === "dark" || value === "system") {
    return value;
  }

  return null;
}

function toEditableSettingsPayload(settings: UserSettings): UpdateUserSettingsInput {
  return {
    theme: settings.theme,
    language: settings.language,
    chartSettings: settings.chartSettings,
    seasonalThemesEnabled: settings.seasonalThemesEnabled,
    seasonalTheme: settings.seasonalTheme,
    mokattamThemeEnabled: settings.mokattamThemeEnabled,
    hapticsEnabled: settings.hapticsEnabled,
  };
}

export default function UserSettingsSync() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { data: session } = authClient.useSession();
  const userId = session?.user?.id ?? null;
  const { data: remoteSettings } = useUserSettings(Boolean(userId));
  const updateUserSettings = useUpdateUserSettings();
  const lastThemeRef = useRef<AppTheme | null>(normalizeTheme(theme));
  const skipThemePersistenceRef = useRef(false);
  const currentUserIdRef = useRef<string | null>(null);
  const lastUploadedLocalTimestampRef = useRef(0);
  const lastAppliedRemoteTimestampRef = useRef(0);

  const pushSettingsToServer = useEffectEvent(
    (updates: UpdateUserSettingsInput) => {
      updateUserSettings.mutate(updates);
    }
  );

  useEffect(() => {
    if (currentUserIdRef.current === userId) {
      return;
    }

    currentUserIdRef.current = userId;
    lastThemeRef.current = normalizeTheme(theme);
    skipThemePersistenceRef.current = false;
    lastUploadedLocalTimestampRef.current = 0;
    lastAppliedRemoteTimestampRef.current = 0;
  }, [theme, userId]);

  useEffect(() => {
    const normalizedTheme = normalizeTheme(theme);

    if (!normalizedTheme) {
      return;
    }

    if (lastThemeRef.current === null) {
      lastThemeRef.current = normalizedTheme;
      return;
    }

    if (skipThemePersistenceRef.current) {
      skipThemePersistenceRef.current = false;
      lastThemeRef.current = normalizedTheme;
      return;
    }

    if (normalizedTheme === lastThemeRef.current) {
      return;
    }

    updateLocalUserSettings({
      theme: normalizedTheme,
    });

    if (userId) {
      lastUploadedLocalTimestampRef.current = readLocalUserSettings().updatedAt;
      pushSettingsToServer({
        theme: normalizedTheme,
      });
    }

    lastThemeRef.current = normalizedTheme;
  }, [pushSettingsToServer, theme, userId]);

  useEffect(() => {
    if (!userId || !remoteSettings) {
      return;
    }

    const localSnapshot = readLocalUserSettings();
    const localUpdatedAt = localSnapshot.updatedAt;
    const remoteUpdatedAt = resolveUpdatedAt(remoteSettings.updatedAt);
    const nextSettings = {
      theme: remoteSettings.theme,
      language: remoteSettings.language,
      chartSettings: remoteSettings.chartSettings,
      seasonalThemesEnabled: remoteSettings.seasonalThemesEnabled,
      seasonalTheme: remoteSettings.seasonalTheme,
      mokattamThemeAvailable: remoteSettings.mokattamThemeAvailable,
      mokattamThemeEnabled: remoteSettings.mokattamThemeEnabled,
      mokattamThemeCelebrationSeenAt:
        remoteSettings.mokattamThemeCelebrationSeenAt,
      hapticsEnabled: remoteSettings.hapticsEnabled,
    };

    if (!remoteSettings.persisted) {
      if (
        !updateUserSettings.isPending &&
        localSnapshot.hasLocalData &&
        localUpdatedAt > lastUploadedLocalTimestampRef.current
      ) {
        lastUploadedLocalTimestampRef.current = localUpdatedAt;
        pushSettingsToServer(toEditableSettingsPayload(localSnapshot.settings));
      }

      return;
    }

    if (
      remoteUpdatedAt > localUpdatedAt &&
      remoteUpdatedAt > lastAppliedRemoteTimestampRef.current
    ) {
      lastAppliedRemoteTimestampRef.current = remoteUpdatedAt;
      const languageChanged =
        nextSettings.language !== localSnapshot.settings.language;
      const themeChanged = nextSettings.theme !== localSnapshot.settings.theme;

      writeLocalUserSettings(nextSettings, remoteUpdatedAt);

      if (themeChanged) {
        skipThemePersistenceRef.current = true;
        lastThemeRef.current = nextSettings.theme;
        setTheme(nextSettings.theme);
      }

      if (languageChanged) {
        setTimeout(() => router.refresh(), 50);
      }

      return;
    }

    if (
      !updateUserSettings.isPending &&
      localSnapshot.hasLocalData &&
      localUpdatedAt > remoteUpdatedAt &&
      localUpdatedAt > lastUploadedLocalTimestampRef.current
    ) {
      lastUploadedLocalTimestampRef.current = localUpdatedAt;
      pushSettingsToServer(toEditableSettingsPayload(localSnapshot.settings));
    }
  }, [
    pushSettingsToServer,
    remoteSettings,
    router,
    setTheme,
    updateUserSettings.isPending,
    userId,
  ]);

  return null;
}
