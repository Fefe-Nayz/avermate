"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";

import {
  getUserSettingsStorageEventName,
  readLocalUserSettings,
} from "@/lib/user-settings-storage";
import { normalizeThemeFontStack } from "@/lib/theme-fonts";
import type {
  CustomThemeMode,
  CustomThemePalette,
  CustomThemeSettings,
} from "@/types/user-settings";

const cssVariableMap: Record<keyof CustomThemePalette, string> = {
  background: "--background",
  foreground: "--foreground",
  primary: "--primary",
  primaryForeground: "--primary-foreground",
  secondary: "--secondary",
  secondaryForeground: "--secondary-foreground",
  destructive: "--destructive",
  card: "--card",
  cardForeground: "--card-foreground",
  popover: "--popover",
  popoverForeground: "--popover-foreground",
  accent: "--accent",
  accentForeground: "--accent-foreground",
  muted: "--muted",
  mutedForeground: "--muted-foreground",
  border: "--border",
  input: "--input",
  ring: "--ring",
  chart1: "--chart-1",
  chart2: "--chart-2",
  chart3: "--chart-3",
  chart4: "--chart-4",
  chart5: "--chart-5",
  sidebar: "--sidebar",
  sidebarForeground: "--sidebar-foreground",
  sidebarPrimary: "--sidebar-primary",
  sidebarPrimaryForeground: "--sidebar-primary-foreground",
  sidebarAccent: "--sidebar-accent",
  sidebarAccentForeground: "--sidebar-accent-foreground",
  sidebarBorder: "--sidebar-border",
  sidebarRing: "--sidebar-ring",
};

function getResolvedMode(theme: string | undefined): CustomThemeMode {
  if (theme === "dark") {
    return "dark";
  }

  if (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }

  return "light";
}

function clearPaletteVariables(root: HTMLElement) {
  for (const cssVariable of Object.values(cssVariableMap)) {
    root.style.removeProperty(cssVariable);
  }

  root.style.removeProperty("--radius");
}

function applyThemeVariables(theme: CustomThemeSettings, mode: CustomThemeMode) {
  const root = document.documentElement;
  const body = document.body;

  const fontStack = normalizeThemeFontStack(theme.fontSans);
  root.style.setProperty("--font-sans", fontStack);
  if (body) {
    body.style.setProperty("--font-sans", fontStack);
    body.style.fontFamily = `var(--font-sans)`;
  }

  if (!theme.enabled) {
    clearPaletteVariables(root);
    return;
  }

  const palette = theme[mode];
  for (const [key, cssVariable] of Object.entries(cssVariableMap)) {
    root.style.setProperty(cssVariable, palette[key as keyof CustomThemePalette]);
  }

  root.style.setProperty("--radius", `${theme.radius}rem`);
}

export default function CustomThemeSync() {
  const { resolvedTheme, theme } = useTheme();

  useEffect(() => {
    const syncTheme = () => {
      const customTheme = readLocalUserSettings().settings.customTheme;
      applyThemeVariables(customTheme, getResolvedMode(resolvedTheme ?? theme));
    };

    syncTheme();
    window.addEventListener(getUserSettingsStorageEventName(), syncTheme);

    return () => {
      window.removeEventListener(getUserSettingsStorageEventName(), syncTheme);
    };
  }, [resolvedTheme, theme]);

  return null;
}
