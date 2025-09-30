"use client";

import { useState, useEffect } from "react";

export interface ChartSettings {
  autoZoomYAxis: boolean;
}

const defaultSettings: ChartSettings = {
  autoZoomYAxis: true,
};

const SETTINGS_STORAGE_KEY = "chart-settings";

function getStoredSettings(): ChartSettings {
  if (typeof window === "undefined") {
    return defaultSettings;
  }

  try {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (stored) {
      return { ...defaultSettings, ...JSON.parse(stored) };
    }
  } catch (error) {
    console.warn("Failed to parse chart settings from localStorage:", error);
  }

  return defaultSettings;
}

function saveSettings(settings: ChartSettings): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    console.warn("Failed to save chart settings to localStorage:", error);
  }
}

export function useChartSettings() {
  const [settings, setSettings] = useState<ChartSettings>(defaultSettings);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const storedSettings = getStoredSettings();
    setSettings(storedSettings);
    setIsLoaded(true);
  }, []);

  const updateSettings = (updates: Partial<ChartSettings>) => {
    const newSettings = { ...settings, ...updates };
    setSettings(newSettings);
    saveSettings(newSettings);
  };

  return {
    settings,
    updateSettings,
    isLoaded,
  };
}

export function getChartSettings(): ChartSettings {
  return getStoredSettings();
}
