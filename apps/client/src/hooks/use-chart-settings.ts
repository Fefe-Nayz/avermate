"use client";

import { useState, useEffect } from "react";
import { useUpdateUserSettings } from "./use-user-settings";
import {
  getUserSettingsStorageEventName,
  readLocalUserSettings,
  updateLocalUserSettings,
} from "@/lib/user-settings-storage";
import {
  defaultChartSettings,
  type ChartSettings,
} from "@/types/user-settings";

type UpdateChartSettingsOptions = {
  persist?: boolean;
};

export function useChartSettings() {
  const [settings, setSettings] = useState<ChartSettings>(defaultChartSettings);
  const [isLoaded, setIsLoaded] = useState(false);
  const updateUserSettings = useUpdateUserSettings();

  useEffect(() => {
    const storedSettings = readLocalUserSettings().settings.chartSettings;
    const handleSettingsChange = (event: Event) => {
      const nextSettings = (event as CustomEvent<{
        settings: {
          chartSettings: ChartSettings;
        };
      }>).detail?.settings?.chartSettings;

      if (nextSettings) {
        setSettings(nextSettings);
      }
    };

    setSettings(storedSettings);
    setIsLoaded(true);

    window.addEventListener(getUserSettingsStorageEventName(), handleSettingsChange);

    return () => {
      window.removeEventListener(
        getUserSettingsStorageEventName(),
        handleSettingsChange
      );
    };
  }, []);

  const updateSettings = (
    updates: Partial<ChartSettings>,
    options?: UpdateChartSettingsOptions
  ) => {
    const nextSettings: ChartSettings = {
      autoZoomYAxis: updates.autoZoomYAxis ?? settings.autoZoomYAxis,
      showTrendLine: updates.showTrendLine ?? settings.showTrendLine,
      trendLineSubdivisions:
        updates.trendLineSubdivisions ?? settings.trendLineSubdivisions,
    };

    const newSettings = updateLocalUserSettings({
      chartSettings: nextSettings,
    }).chartSettings;

    setSettings(newSettings);

    if (options?.persist !== false) {
      updateUserSettings.mutate({
        chartSettings: updates,
      });
    }
  };

  return {
    settings,
    updateSettings,
    isLoaded,
  };
}

export function getChartSettings(): ChartSettings {
  return readLocalUserSettings().settings.chartSettings;
}
