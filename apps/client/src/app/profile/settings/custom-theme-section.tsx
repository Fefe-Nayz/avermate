"use client";

import { useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { Dices, Moon, Palette, RotateCcw, Sun } from "lucide-react";

import ProfileSection from "../profile-section";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  SelectDrawer,
  SelectDrawerContent,
  SelectDrawerGroup,
  SelectDrawerItem,
  SelectDrawerTrigger,
} from "@/components/ui/selectdrawer";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUpdateUserSettings, useUserSettings } from "@/hooks/use-user-settings";
import { authClient } from "@/lib/auth";
import { toast } from "@/lib/toast";
import {
  getThemeFontLabel,
  normalizeThemeFontStack,
  themeFontOptions,
} from "@/lib/theme-fonts";
import { cn } from "@/lib/utils";
import {
  getUserSettingsStorageEventName,
  readLocalUserSettings,
  updateLocalUserSettings,
} from "@/lib/user-settings-storage";
import {
  defaultUserSettings,
  type CustomThemeMode,
  type CustomThemePalette,
  type CustomThemeSettings,
} from "@/types/user-settings";

type PresetBadgeKey =
  | "badgeSoft"
  | "badgePunchy"
  | "badgeBold"
  | "badgeClean"
  | "badgeDark";

type ThemePreset = {
  id: string;
  label: string;
  badgeKey?: PresetBadgeKey;
  theme: CustomThemeSettings;
};

type StudioPalette = Partial<{
  background: string;
  foreground: string;
  card: string;
  "card-foreground": string;
  popover: string;
  "popover-foreground": string;
  primary: string;
  "primary-foreground": string;
  secondary: string;
  "secondary-foreground": string;
  destructive: string;
  muted: string;
  "muted-foreground": string;
  accent: string;
  "accent-foreground": string;
  border: string;
  input: string;
  ring: string;
  "chart-1": string;
  "chart-2": string;
  "chart-3": string;
  "chart-4": string;
  "chart-5": string;
  sidebar: string;
  "sidebar-foreground": string;
  "sidebar-primary": string;
  "sidebar-primary-foreground": string;
  "sidebar-accent": string;
  "sidebar-accent-foreground": string;
  "sidebar-border": string;
  "sidebar-ring": string;
  "font-sans": string;
  radius: string;
}>;

const paletteKeyMap = {
  background: "background",
  foreground: "foreground",
  primary: "primary",
  primaryForeground: "primary-foreground",
  secondary: "secondary",
  secondaryForeground: "secondary-foreground",
  destructive: "destructive",
  card: "card",
  cardForeground: "card-foreground",
  popover: "popover",
  popoverForeground: "popover-foreground",
  accent: "accent",
  accentForeground: "accent-foreground",
  muted: "muted",
  mutedForeground: "muted-foreground",
  border: "border",
  input: "input",
  ring: "ring",
  chart1: "chart-1",
  chart2: "chart-2",
  chart3: "chart-3",
  chart4: "chart-4",
  chart5: "chart-5",
  sidebar: "sidebar",
  sidebarForeground: "sidebar-foreground",
  sidebarPrimary: "sidebar-primary",
  sidebarPrimaryForeground: "sidebar-primary-foreground",
  sidebarAccent: "sidebar-accent",
  sidebarAccentForeground: "sidebar-accent-foreground",
  sidebarBorder: "sidebar-border",
  sidebarRing: "sidebar-ring",
} satisfies Record<keyof CustomThemePalette, keyof StudioPalette>;

type ColorGroupLabelKey =
  | "groupBrand"
  | "groupBase"
  | "groupInterface"
  | "groupChart"
  | "groupNavigation";

type ColorLabelKey =
  | "color_primary"
  | "color_primaryForeground"
  | "color_secondary"
  | "color_secondaryForeground"
  | "color_destructive"
  | "color_background"
  | "color_foreground"
  | "color_card"
  | "color_cardForeground"
  | "color_popover"
  | "color_popoverForeground"
  | "color_muted"
  | "color_mutedForeground"
  | "color_accent"
  | "color_accentForeground"
  | "color_border"
  | "color_input"
  | "color_ring"
  | "color_chart1"
  | "color_chart2"
  | "color_chart3"
  | "color_chart4"
  | "color_chart5"
  | "color_sidebar"
  | "color_sidebarForeground"
  | "color_sidebarPrimary"
  | "color_sidebarAccent"
  | "color_sidebarBorder"
  | "color_sidebarRing";

const colorGroups: Array<{
  id: string;
  labelKey: ColorGroupLabelKey;
  keys: Array<{ key: keyof CustomThemePalette; labelKey: ColorLabelKey }>;
}> = [
  {
    id: "brand",
    labelKey: "groupBrand",
    keys: [
      { key: "primary", labelKey: "color_primary" },
      { key: "primaryForeground", labelKey: "color_primaryForeground" },
      { key: "secondary", labelKey: "color_secondary" },
      { key: "secondaryForeground", labelKey: "color_secondaryForeground" },
      { key: "destructive", labelKey: "color_destructive" },
    ],
  },
  {
    id: "base",
    labelKey: "groupBase",
    keys: [
      { key: "background", labelKey: "color_background" },
      { key: "foreground", labelKey: "color_foreground" },
      { key: "card", labelKey: "color_card" },
      { key: "cardForeground", labelKey: "color_cardForeground" },
      { key: "popover", labelKey: "color_popover" },
      { key: "popoverForeground", labelKey: "color_popoverForeground" },
    ],
  },
  {
    id: "other",
    labelKey: "groupInterface",
    keys: [
      { key: "muted", labelKey: "color_muted" },
      { key: "mutedForeground", labelKey: "color_mutedForeground" },
      { key: "accent", labelKey: "color_accent" },
      { key: "accentForeground", labelKey: "color_accentForeground" },
      { key: "border", labelKey: "color_border" },
      { key: "input", labelKey: "color_input" },
      { key: "ring", labelKey: "color_ring" },
    ],
  },
  {
    id: "chart",
    labelKey: "groupChart",
    keys: [
      { key: "chart1", labelKey: "color_chart1" },
      { key: "chart2", labelKey: "color_chart2" },
      { key: "chart3", labelKey: "color_chart3" },
      { key: "chart4", labelKey: "color_chart4" },
      { key: "chart5", labelKey: "color_chart5" },
    ],
  },
  {
    id: "sidebar",
    labelKey: "groupNavigation",
    keys: [
      { key: "sidebar", labelKey: "color_sidebar" },
      { key: "sidebarForeground", labelKey: "color_sidebarForeground" },
      { key: "sidebarPrimary", labelKey: "color_sidebarPrimary" },
      { key: "sidebarAccent", labelKey: "color_sidebarAccent" },
      { key: "sidebarBorder", labelKey: "color_sidebarBorder" },
      { key: "sidebarRing", labelKey: "color_sidebarRing" },
    ],
  },
];

function makePalette(
  input: StudioPalette,
  mode: CustomThemeMode
): CustomThemePalette {
  const fallback = defaultUserSettings.customTheme[mode];
  const palette: CustomThemePalette = { ...fallback };

  for (const [appKey, studioKey] of Object.entries(paletteKeyMap)) {
    const key = appKey as keyof CustomThemePalette;
    palette[key] = input[studioKey] ?? fallback[key];
  }

  // Smart fallbacks so presets that omit some keys still feel cohesive
  // instead of leaking the Avermate default white/dark popover, sidebar, etc.
  if (input.popover == null) {
    palette.popover = input.card ?? palette.background;
  }
  if (input["popover-foreground"] == null) {
    palette.popoverForeground =
      input["card-foreground"] ?? palette.foreground;
  }
  if (input.card == null) {
    palette.card = palette.background;
  }
  if (input["card-foreground"] == null) {
    palette.cardForeground = palette.foreground;
  }
  if (input.sidebar == null) {
    palette.sidebar = palette.background;
  }
  if (input["sidebar-foreground"] == null) {
    palette.sidebarForeground = palette.foreground;
  }
  if (input["sidebar-primary"] == null) {
    palette.sidebarPrimary = palette.primary;
  }
  if (input["sidebar-primary-foreground"] == null) {
    palette.sidebarPrimaryForeground = palette.primaryForeground;
  }
  if (input["sidebar-accent"] == null) {
    palette.sidebarAccent = palette.accent;
  }
  if (input["sidebar-accent-foreground"] == null) {
    palette.sidebarAccentForeground = palette.accentForeground;
  }
  if (input["sidebar-border"] == null) {
    palette.sidebarBorder = palette.border;
  }
  if (input["sidebar-ring"] == null) {
    palette.sidebarRing = palette.ring;
  }
  if (input["accent-foreground"] == null) {
    palette.accentForeground = palette.foreground;
  }
  if (input["secondary-foreground"] == null) {
    palette.secondaryForeground = palette.foreground;
  }
  if (input["muted-foreground"] == null) {
    palette.mutedForeground = palette.foreground;
  }

  return palette;
}

function makePreset({
  id,
  label,
  badgeKey,
  light,
  dark,
}: {
  id: string;
  label: string;
  badgeKey?: PresetBadgeKey;
  light: StudioPalette;
  dark: StudioPalette;
}): ThemePreset {
  const radius = Number.parseFloat(light.radius?.replace("rem", "") ?? "");
  const fontSans = normalizeThemeFontStack(
    light["font-sans"] ?? defaultUserSettings.customTheme.fontSans
  );

  return {
    id,
    label,
    badgeKey,
    theme: {
      enabled: true,
      preset: id,
      radius: Number.isFinite(radius)
        ? radius
        : defaultUserSettings.customTheme.radius,
      fontSans,
      light: makePalette(light, "light"),
      dark: makePalette(dark, "dark"),
    },
  };
}

const presets: ThemePreset[] = [
  {
    id: "default",
    label: "Avermate",
    theme: defaultUserSettings.customTheme,
  },
  makePreset({
    id: "marshmallow",
    label: "Marshmallow",
    badgeKey: "badgeSoft",
    light: {
      background: "oklch(0.97 0.01 264.53)",
      foreground: "oklch(0.22 0 0)",
      card: "oklch(1.00 0 0)",
      "card-foreground": "oklch(0.22 0 0)",
      primary: "oklch(0.80 0.14 349.25)",
      "primary-foreground": "oklch(0 0 0)",
      secondary: "oklch(0.94 0.07 98.08)",
      "secondary-foreground": "oklch(0 0 0)",
      muted: "oklch(0.92 0.01 268.52)",
      "muted-foreground": "oklch(0.34 0 0)",
      accent: "oklch(0.83 0.09 248.95)",
      "accent-foreground": "oklch(0 0 0)",
      destructive: "oklch(0.70 0.19 23.19)",
      border: "oklch(0.85 0 0)",
      input: "oklch(0.85 0 0)",
      ring: "oklch(0.83 0.09 248.95)",
      "chart-1": "oklch(0.80 0.14 349.25)",
      "chart-2": "oklch(0.77 0.15 306.21)",
      "chart-3": "oklch(0.83 0.09 248.95)",
      "chart-4": "oklch(0.88 0.09 66.27)",
      "chart-5": "oklch(0.94 0.14 130.35)",
      radius: "0rem",
    },
    dark: {
      background: "oklch(0.22 0 0)",
      foreground: "oklch(0.97 0.01 264.53)",
      card: "oklch(0.29 0 0)",
      "card-foreground": "oklch(0.97 0.01 264.53)",
      primary: "oklch(0.80 0.14 349.25)",
      "primary-foreground": "oklch(0.22 0 0)",
      secondary: "oklch(0.77 0.15 306.21)",
      muted: "oklch(0.32 0 0)",
      "muted-foreground": "oklch(0.85 0 0)",
      accent: "oklch(0.83 0.09 248.95)",
      destructive: "oklch(0.70 0.19 23.19)",
      border: "oklch(0.39 0 0)",
      input: "oklch(0.39 0 0)",
      ring: "oklch(0.83 0.09 248.95)",
    },
  }),
  makePreset({
    id: "vs-code",
    label: "VS Code",
    light: {
      background: "oklch(0.97 0.02 225.66)",
      foreground: "oklch(0.15 0.02 269.18)",
      card: "oklch(0.98 0.01 228.79)",
      primary: "oklch(0.71 0.15 239.07)",
      "primary-foreground": "oklch(0.94 0.03 232.39)",
      secondary: "oklch(0.91 0.03 229.20)",
      muted: "oklch(0.89 0.02 225.69)",
      "muted-foreground": "oklch(0.36 0.03 230.30)",
      accent: "oklch(0.88 0.02 235.72)",
      destructive: "oklch(0.61 0.24 20.96)",
      border: "oklch(0.82 0.02 240.77)",
      input: "oklch(0.82 0.02 240.77)",
      ring: "oklch(0.55 0.10 235.72)",
      "chart-1": "oklch(0.57 0.11 228.97)",
      "chart-2": "oklch(0.45 0.10 270.08)",
      "chart-3": "oklch(0.65 0.15 159.03)",
      "chart-4": "oklch(0.75 0.10 100.01)",
      "chart-5": "oklch(0.55 0.15 299.88)",
      "font-sans":
        "'Source Code Pro', Geist, ui-sans-serif, system-ui, sans-serif",
      radius: "0rem",
    },
    dark: {
      background: "oklch(0.18 0.02 271.27)",
      foreground: "oklch(0.90 0.01 238.47)",
      card: "oklch(0.22 0.02 271.67)",
      primary: "oklch(0.57 0.11 228.97)",
      secondary: "oklch(0.25 0.03 270.83)",
      muted: "oklch(0.25 0.03 270.83)",
      "muted-foreground": "oklch(0.68 0.04 237.89)",
      accent: "oklch(0.28 0.04 269.18)",
      destructive: "oklch(0.70 0.19 22.23)",
      border: "oklch(0.32 0.03 267.94)",
      input: "oklch(0.32 0.03 267.94)",
      ring: "oklch(0.57 0.11 228.97)",
    },
  }),
  makePreset({
    id: "spotify",
    label: "Spotify",
    badgeKey: "badgePunchy",
    light: {
      background: "oklch(0.98 0 0)",
      foreground: "oklch(0.13 0 0)",
      card: "oklch(0.95 0 0)",
      primary: "oklch(0.68 0.18 145.76)",
      "primary-foreground": "oklch(0.13 0 0)",
      secondary: "oklch(0.90 0 0)",
      muted: "oklch(0.90 0 0)",
      "muted-foreground": "oklch(0.38 0 0)",
      accent: "oklch(0.68 0.18 145.76)",
      destructive: "oklch(0.58 0.22 27.33)",
      border: "oklch(0.82 0 0)",
      input: "oklch(0.82 0 0)",
      ring: "oklch(0.68 0.18 145.76)",
      radius: "0.5rem",
    },
    dark: {
      background: "oklch(0.13 0 0)",
      foreground: "oklch(0.98 0 0)",
      card: "oklch(0.18 0 0)",
      primary: "oklch(0.72 0.19 145.76)",
      secondary: "oklch(0.25 0 0)",
      muted: "oklch(0.25 0 0)",
      "muted-foreground": "oklch(0.71 0 0)",
      accent: "oklch(0.72 0.19 145.76)",
      destructive: "oklch(0.70 0.19 22.23)",
      border: "oklch(0.30 0 0)",
      input: "oklch(0.30 0 0)",
      ring: "oklch(0.72 0.19 145.76)",
    },
  }),
  makePreset({
    id: "neo-brutalism",
    label: "Neo Brutalism",
    badgeKey: "badgeBold",
    light: {
      background: "oklch(1 0 0)",
      foreground: "oklch(0 0 0)",
      card: "oklch(1 0 0)",
      primary: "oklch(0.70 0.20 47.60)",
      "primary-foreground": "oklch(0 0 0)",
      secondary: "oklch(0.85 0.19 85.87)",
      "secondary-foreground": "oklch(0 0 0)",
      accent: "oklch(0.66 0.20 320.30)",
      muted: "oklch(0.92 0 0)",
      "muted-foreground": "oklch(0.30 0 0)",
      destructive: "oklch(0.62 0.25 29.23)",
      border: "oklch(0 0 0)",
      input: "oklch(0 0 0)",
      ring: "oklch(0 0 0)",
      radius: "0rem",
    },
    dark: {
      background: "oklch(0 0 0)",
      foreground: "oklch(1 0 0)",
      card: "oklch(0.20 0 0)",
      primary: "oklch(0.76 0.20 47.60)",
      secondary: "oklch(0.72 0.18 85.87)",
      accent: "oklch(0.72 0.20 320.30)",
      muted: "oklch(0.25 0 0)",
      "muted-foreground": "oklch(0.72 0 0)",
      destructive: "oklch(0.70 0.22 29.23)",
      border: "oklch(1 0 0)",
      input: "oklch(1 0 0)",
      ring: "oklch(1 0 0)",
    },
  }),
  makePreset({
    id: "caffeine",
    label: "Caffeine",
    light: {
      background: "oklch(0.96 0.02 83.06)",
      foreground: "oklch(0.26 0.04 39.36)",
      card: "oklch(0.98 0.02 83.06)",
      primary: "oklch(0.47 0.08 39.36)",
      "primary-foreground": "oklch(0.98 0.02 83.06)",
      secondary: "oklch(0.90 0.04 83.06)",
      muted: "oklch(0.88 0.03 83.06)",
      "muted-foreground": "oklch(0.43 0.06 39.36)",
      accent: "oklch(0.79 0.08 71.20)",
      destructive: "oklch(0.58 0.22 27.33)",
      border: "oklch(0.78 0.05 83.06)",
      input: "oklch(0.78 0.05 83.06)",
      ring: "oklch(0.47 0.08 39.36)",
      radius: "0.375rem",
    },
    dark: {
      background: "oklch(0.22 0.04 39.36)",
      foreground: "oklch(0.94 0.03 83.06)",
      card: "oklch(0.28 0.05 39.36)",
      primary: "oklch(0.79 0.08 71.20)",
      secondary: "oklch(0.36 0.06 39.36)",
      muted: "oklch(0.32 0.05 39.36)",
      "muted-foreground": "oklch(0.78 0.04 83.06)",
      accent: "oklch(0.47 0.08 39.36)",
      destructive: "oklch(0.70 0.19 22.23)",
      border: "oklch(0.39 0.06 39.36)",
      input: "oklch(0.39 0.06 39.36)",
      ring: "oklch(0.79 0.08 71.20)",
    },
  }),
  makePreset({
    id: "material-design",
    label: "Material",
    light: {
      background: "oklch(0.99 0.01 255)",
      foreground: "oklch(0.18 0.02 260)",
      card: "oklch(1 0 0)",
      primary: "oklch(0.55 0.20 260)",
      "primary-foreground": "oklch(0.99 0 0)",
      secondary: "oklch(0.92 0.04 255)",
      muted: "oklch(0.95 0.02 255)",
      "muted-foreground": "oklch(0.45 0.03 260)",
      accent: "oklch(0.70 0.17 190)",
      destructive: "oklch(0.58 0.22 27.33)",
      border: "oklch(0.88 0.02 255)",
      input: "oklch(0.88 0.02 255)",
      ring: "oklch(0.55 0.20 260)",
      "chart-1": "oklch(0.55 0.20 260)",
      "chart-2": "oklch(0.70 0.17 190)",
      "chart-3": "oklch(0.69 0.18 145)",
      radius: "0.625rem",
    },
    dark: {
      background: "oklch(0.18 0.02 260)",
      foreground: "oklch(0.95 0.01 255)",
      card: "oklch(0.23 0.03 260)",
      primary: "oklch(0.70 0.18 260)",
      secondary: "oklch(0.30 0.04 260)",
      muted: "oklch(0.28 0.03 260)",
      "muted-foreground": "oklch(0.72 0.03 255)",
      accent: "oklch(0.70 0.17 190)",
      border: "oklch(0.34 0.04 260)",
      input: "oklch(0.34 0.04 260)",
      ring: "oklch(0.70 0.18 260)",
    },
  }),
  makePreset({
    id: "modern-minimal",
    label: "Modern Minimal",
    badgeKey: "badgeClean",
    light: {
      background: "oklch(0.99 0 0)",
      foreground: "oklch(0.16 0 0)",
      card: "oklch(1 0 0)",
      primary: "oklch(0.27 0.01 260)",
      secondary: "oklch(0.94 0 0)",
      muted: "oklch(0.96 0 0)",
      "muted-foreground": "oklch(0.48 0 0)",
      accent: "oklch(0.93 0.02 250)",
      destructive: "oklch(0.58 0.22 27.33)",
      border: "oklch(0.90 0 0)",
      input: "oklch(0.90 0 0)",
      ring: "oklch(0.45 0.03 260)",
      radius: "0.5rem",
    },
    dark: {
      background: "oklch(0.14 0 0)",
      foreground: "oklch(0.96 0 0)",
      card: "oklch(0.20 0 0)",
      primary: "oklch(0.90 0 0)",
      secondary: "oklch(0.28 0 0)",
      muted: "oklch(0.25 0 0)",
      "muted-foreground": "oklch(0.70 0 0)",
      accent: "oklch(0.28 0.02 250)",
      border: "oklch(0.32 0 0)",
      input: "oklch(0.32 0 0)",
      ring: "oklch(0.70 0 0)",
    },
  }),
  makePreset({
    id: "nature",
    label: "Nature",
    light: {
      background: "oklch(0.98 0.02 125)",
      foreground: "oklch(0.22 0.04 145)",
      card: "oklch(0.99 0.01 125)",
      primary: "oklch(0.49 0.12 145)",
      "primary-foreground": "oklch(0.99 0 0)",
      secondary: "oklch(0.88 0.07 112)",
      muted: "oklch(0.91 0.04 120)",
      "muted-foreground": "oklch(0.43 0.06 145)",
      accent: "oklch(0.75 0.13 85)",
      destructive: "oklch(0.58 0.22 27.33)",
      border: "oklch(0.82 0.04 120)",
      input: "oklch(0.82 0.04 120)",
      ring: "oklch(0.49 0.12 145)",
      radius: "0.75rem",
    },
    dark: {
      background: "oklch(0.18 0.04 145)",
      foreground: "oklch(0.94 0.03 125)",
      card: "oklch(0.24 0.05 145)",
      primary: "oklch(0.72 0.14 125)",
      secondary: "oklch(0.32 0.06 145)",
      muted: "oklch(0.29 0.05 145)",
      "muted-foreground": "oklch(0.74 0.05 125)",
      accent: "oklch(0.66 0.13 85)",
      border: "oklch(0.36 0.06 145)",
      input: "oklch(0.36 0.06 145)",
      ring: "oklch(0.72 0.14 125)",
    },
  }),
  makePreset({
    id: "pastel-dreams",
    label: "Pastel Dreams",
    badgeKey: "badgeSoft",
    light: {
      background: "oklch(0.98 0.02 310)",
      foreground: "oklch(0.24 0.03 290)",
      card: "oklch(1 0 0)",
      primary: "oklch(0.75 0.12 320)",
      secondary: "oklch(0.91 0.06 210)",
      muted: "oklch(0.93 0.03 290)",
      "muted-foreground": "oklch(0.45 0.04 290)",
      accent: "oklch(0.86 0.11 90)",
      destructive: "oklch(0.65 0.18 20)",
      border: "oklch(0.86 0.03 290)",
      input: "oklch(0.86 0.03 290)",
      ring: "oklch(0.75 0.12 320)",
      radius: "1rem",
    },
    dark: {
      background: "oklch(0.20 0.03 290)",
      foreground: "oklch(0.96 0.02 310)",
      card: "oklch(0.27 0.04 290)",
      primary: "oklch(0.78 0.12 320)",
      secondary: "oklch(0.34 0.06 210)",
      muted: "oklch(0.31 0.04 290)",
      "muted-foreground": "oklch(0.76 0.04 300)",
      accent: "oklch(0.80 0.11 90)",
      border: "oklch(0.38 0.04 290)",
      input: "oklch(0.38 0.04 290)",
      ring: "oklch(0.78 0.12 320)",
    },
  }),
  makePreset({
    id: "midnight-bloom",
    label: "Midnight Bloom",
    badgeKey: "badgeDark",
    light: {
      background: "oklch(0.98 0.01 270)",
      foreground: "oklch(0.18 0.03 285)",
      card: "oklch(1 0 0)",
      primary: "oklch(0.50 0.18 285)",
      secondary: "oklch(0.91 0.04 270)",
      muted: "oklch(0.93 0.02 270)",
      "muted-foreground": "oklch(0.42 0.04 285)",
      accent: "oklch(0.67 0.18 330)",
      border: "oklch(0.85 0.03 270)",
      input: "oklch(0.85 0.03 270)",
      ring: "oklch(0.50 0.18 285)",
      radius: "0.625rem",
    },
    dark: {
      background: "oklch(0.14 0.04 285)",
      foreground: "oklch(0.94 0.02 270)",
      card: "oklch(0.20 0.05 285)",
      primary: "oklch(0.72 0.18 285)",
      secondary: "oklch(0.28 0.06 285)",
      muted: "oklch(0.25 0.05 285)",
      "muted-foreground": "oklch(0.72 0.04 270)",
      accent: "oklch(0.72 0.18 330)",
      border: "oklch(0.33 0.06 285)",
      input: "oklch(0.33 0.06 285)",
      ring: "oklch(0.72 0.18 285)",
    },
  }),
  makePreset({
    id: "claude",
    label: "Claude",
    light: {
      background: "oklch(0.98 0.02 75)",
      foreground: "oklch(0.25 0.03 45)",
      card: "oklch(1 0 0)",
      primary: "oklch(0.58 0.13 45)",
      "primary-foreground": "oklch(0.99 0 0)",
      secondary: "oklch(0.91 0.04 75)",
      muted: "oklch(0.93 0.03 75)",
      "muted-foreground": "oklch(0.45 0.04 45)",
      accent: "oklch(0.78 0.11 70)",
      border: "oklch(0.84 0.04 75)",
      input: "oklch(0.84 0.04 75)",
      ring: "oklch(0.58 0.13 45)",
      radius: "0.5rem",
    },
    dark: {
      background: "oklch(0.19 0.03 45)",
      foreground: "oklch(0.95 0.03 75)",
      card: "oklch(0.25 0.04 45)",
      primary: "oklch(0.76 0.11 70)",
      secondary: "oklch(0.34 0.04 45)",
      muted: "oklch(0.30 0.04 45)",
      "muted-foreground": "oklch(0.76 0.04 75)",
      accent: "oklch(0.58 0.13 45)",
      border: "oklch(0.38 0.04 45)",
      input: "oklch(0.38 0.04 45)",
      ring: "oklch(0.76 0.11 70)",
    },
  }),
  makePreset({
    id: "perplexity",
    label: "Perplexity",
    light: {
      background: "oklch(0.99 0.01 190)",
      foreground: "oklch(0.18 0.02 210)",
      card: "oklch(1 0 0)",
      primary: "oklch(0.55 0.12 190)",
      "primary-foreground": "oklch(0.99 0 0)",
      secondary: "oklch(0.91 0.04 190)",
      muted: "oklch(0.94 0.02 190)",
      "muted-foreground": "oklch(0.44 0.03 210)",
      accent: "oklch(0.68 0.14 220)",
      border: "oklch(0.84 0.03 190)",
      input: "oklch(0.84 0.03 190)",
      ring: "oklch(0.55 0.12 190)",
      radius: "0.375rem",
    },
    dark: {
      background: "oklch(0.16 0.03 210)",
      foreground: "oklch(0.95 0.01 190)",
      card: "oklch(0.22 0.04 210)",
      primary: "oklch(0.70 0.13 190)",
      secondary: "oklch(0.30 0.04 210)",
      muted: "oklch(0.27 0.04 210)",
      "muted-foreground": "oklch(0.73 0.03 190)",
      accent: "oklch(0.70 0.14 220)",
      border: "oklch(0.34 0.04 210)",
      input: "oklch(0.34 0.04 210)",
      ring: "oklch(0.70 0.13 190)",
    },
  }),
];

function ColorSwatch({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const colorInputValue = value.startsWith("#") ? value.slice(0, 7) : "#000000";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label className="text-sm font-medium">{label}</Label>
        <span className="truncate font-mono text-xs text-muted-foreground">
          {value}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div
          className="relative size-10 shrink-0 overflow-hidden rounded-md border"
          style={{ backgroundColor: value }}
        >
          <input
            aria-label={label}
            type="color"
            value={colorInputValue}
            onChange={(event) => onChange(event.target.value)}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </div>
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="font-mono text-xs"
        />
      </div>
    </div>
  );
}

function SliderWithInput({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label className="text-sm font-medium">{label}</Label>
        <div className="flex items-center gap-1">
          <Input
            type="number"
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={(event) => onChange(Number(event.target.value))}
            className="h-8 w-20 px-2 text-xs"
          />
          <span className="text-xs text-muted-foreground">{unit}</span>
        </div>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={([nextValue]) => onChange(nextValue)}
      />
    </div>
  );
}

function PresetPreview({ preset }: { preset: ThemePreset }) {
  const palette = preset.theme.light;

  return (
    <div className="grid size-7 grid-cols-2 grid-rows-2 gap-0.5 rounded border bg-background p-1">
      <span className="rounded-[2px]" style={{ backgroundColor: palette.primary }} />
      <span
        className="rounded-[2px]"
        style={{ backgroundColor: palette.destructive }}
      />
      <span
        className="rounded-[2px]"
        style={{ backgroundColor: palette.secondary }}
      />
      <span className="rounded-full" style={{ backgroundColor: palette.accent }} />
    </div>
  );
}

function resolveThemeMode(
  resolvedTheme: string | undefined,
  theme: string | undefined
): CustomThemeMode {
  const value = resolvedTheme ?? theme;
  if (value === "dark") {
    return "dark";
  }

  if (
    value === "system" &&
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }

  return "light";
}

export function CustomThemeSection() {
  const t = useTranslations("Settings.Profile.CustomTheme");
  const { setTheme, resolvedTheme, theme } = useTheme();
  const { data: session } = authClient.useSession();
  const { data: remoteSettings } = useUserSettings(Boolean(session));
  const updateSettings = useUpdateUserSettings();
  const [localCustomTheme, setLocalCustomTheme] = useState(
    () => readLocalUserSettings().settings.customTheme
  );
  const currentSettings =
    remoteSettings?.customTheme ?? localCustomTheme;
  const [draft, setDraft] = useState<CustomThemeSettings>(currentSettings);
  const [mode, setMode] = useState<CustomThemeMode>(() =>
    resolveThemeMode(resolvedTheme, theme)
  );

  useEffect(() => {
    setMode(resolveThemeMode(resolvedTheme, theme));
  }, [resolvedTheme, theme]);

  useEffect(() => {
    const normalizedTheme = {
      ...currentSettings,
      fontSans: normalizeThemeFontStack(currentSettings.fontSans),
    };
    setDraft(normalizedTheme);
  }, [currentSettings]);

  useEffect(() => {
    const syncLocalTheme = () => {
      setLocalCustomTheme(readLocalUserSettings().settings.customTheme);
    };

    window.addEventListener(getUserSettingsStorageEventName(), syncLocalTheme);
    return () => {
      window.removeEventListener(
        getUserSettingsStorageEventName(),
        syncLocalTheme
      );
    };
  }, []);

  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.id === draft.preset),
    [draft.preset]
  );
  const previewPreset = selectedPreset ?? {
    id: "custom",
    label: t("customLabel"),
    theme: draft,
  };

  const persistTheme = (nextTheme: CustomThemeSettings) => {
    const normalizedTheme = {
      ...nextTheme,
      fontSans: normalizeThemeFontStack(nextTheme.fontSans),
    };

    setDraft(normalizedTheme);
    setLocalCustomTheme(normalizedTheme);
    updateLocalUserSettings({ customTheme: normalizedTheme });

    if (session) {
      updateSettings.mutate({ customTheme: normalizedTheme });
    }
  };

  const patchTheme = (patch: Partial<CustomThemeSettings>) => {
    persistTheme({
      ...draft,
      ...patch,
      light: {
        ...draft.light,
        ...patch.light,
      },
      dark: {
        ...draft.dark,
        ...patch.dark,
      },
    });
  };

  const patchPalette = (
    targetMode: CustomThemeMode,
    key: keyof CustomThemePalette,
    value: string
  ) => {
    patchTheme({
      preset: "custom",
      [targetMode]: {
        ...draft[targetMode],
        [key]: value,
      },
    } as Partial<CustomThemeSettings>);
  };

  const applyPreset = (presetId: string) => {
    const preset = presets.find((entry) => entry.id === presetId);
    if (!preset) {
      return;
    }

    persistTheme({
      ...preset.theme,
      enabled: presetId === "default" ? draft.enabled : true,
      preset: presetId,
    });
    toast.success(t("appliedToast"));
  };

  const randomizePreset = () => {
    const selectablePresets = presets.filter((preset) => preset.id !== draft.preset);
    const nextPreset =
      selectablePresets[Math.floor(Math.random() * selectablePresets.length)];

    if (nextPreset) {
      applyPreset(nextPreset.id);
    }
  };

  const handleModeChange = (nextMode: CustomThemeMode) => {
    setMode(nextMode);
    setTheme(nextMode);
  };

  return (
    <ProfileSection
      title={t("title")}
      description={t("description")}
    >
      <div className="space-y-6 px-6 pb-6">
        <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
          <div className="flex items-start gap-3">
            <div className="rounded-md border bg-muted p-2 text-muted-foreground">
              <Palette className="size-4" />
            </div>
            <div>
              <Label className="text-sm font-medium">{t("enable")}</Label>
              <p className="text-sm text-muted-foreground">
                {t("enableDescription")}
              </p>
            </div>
          </div>
          <Switch
            checked={draft.enabled}
            onCheckedChange={(enabled) => patchTheme({ enabled })}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Button
            type="button"
            variant={mode === "light" ? "default" : "outline"}
            onClick={() => handleModeChange("light")}
          >
            <Sun className="size-4" />
            {t("modeLight")}
          </Button>
          <Button
            type="button"
            variant={mode === "dark" ? "default" : "outline"}
            onClick={() => handleModeChange("dark")}
          >
            <Moon className="size-4" />
            {t("modeDark")}
          </Button>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-medium">{t("themesHeading")}</h3>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={randomizePreset}>
                <Dices className="size-4" />
                {t("random")}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => persistTheme(defaultUserSettings.customTheme)}
              >
                <RotateCcw className="size-4" />
                {t("reset")}
              </Button>
            </div>
          </div>

          <SelectDrawer value={draft.preset} onValueChange={applyPreset}>
            <SelectDrawerTrigger>
              <span className="flex items-center gap-3">
                <PresetPreview preset={previewPreset} />
                {previewPreset.label}
              </span>
            </SelectDrawerTrigger>
            <SelectDrawerContent title={t("presetTitle")}>
              <SelectDrawerGroup>
                {presets.map((preset) => (
                  <SelectDrawerItem key={preset.id} value={preset.id}>
                    <span className="flex items-center gap-3">
                      <PresetPreview preset={preset} />
                      <span>{preset.label}</span>
                      {preset.badgeKey ? (
                        <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                          {t(preset.badgeKey)}
                        </span>
                      ) : null}
                    </span>
                  </SelectDrawerItem>
                ))}
              </SelectDrawerGroup>
            </SelectDrawerContent>
          </SelectDrawer>
        </div>

        <Tabs defaultValue="colors" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="colors">{t("tabColors")}</TabsTrigger>
            <TabsTrigger value="typography">{t("tabTypography")}</TabsTrigger>
            <TabsTrigger value="other">{t("tabOther")}</TabsTrigger>
          </TabsList>

          <TabsContent value="colors" className="pt-2">
            <Accordion
              type="multiple"
              defaultValue={["brand", "base"]}
              className="space-y-4"
            >
              {colorGroups.map((group) => (
                <AccordionItem
                  key={group.id}
                  value={group.id}
                  className="rounded-lg border px-4"
                >
                  <AccordionTrigger className="py-3 text-base">
                    {t(group.labelKey)}
                  </AccordionTrigger>
                  <AccordionContent className="space-y-4 pt-2">
                    {group.keys.map((entry) => (
                      <ColorSwatch
                        key={entry.key}
                        label={t(entry.labelKey)}
                        value={draft[mode][entry.key]}
                        onChange={(value) => patchPalette(mode, entry.key, value)}
                      />
                    ))}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </TabsContent>

          <TabsContent value="typography" className="space-y-5 pt-4">
            <div className="space-y-2">
              <Label>{t("fontLabel")}</Label>
              <SelectDrawer
                value={draft.fontSans}
                onValueChange={(fontSans) =>
                  patchTheme({ fontSans, preset: "custom" })
                }
              >
                <SelectDrawerTrigger>
                  {getThemeFontLabel(draft.fontSans)}
                </SelectDrawerTrigger>
                <SelectDrawerContent title={t("fontDrawerTitle")}>
                  <SelectDrawerGroup>
                    {themeFontOptions.map((font) => (
                      <SelectDrawerItem key={font.value} value={font.value}>
                        {font.label}
                      </SelectDrawerItem>
                    ))}
                  </SelectDrawerGroup>
                </SelectDrawerContent>
              </SelectDrawer>
            </div>
            <p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
              {t("fontFallbackNote")}
            </p>
          </TabsContent>

          <TabsContent value="other" className="space-y-5 pt-4">
            <SliderWithInput
              label={t("radius")}
              value={draft.radius}
              min={0}
              max={2.5}
              step={0.025}
              unit="rem"
              onChange={(radius) => patchTheme({ radius, preset: "custom" })}
            />
            <div
              className={cn(
                "grid gap-3 rounded-lg border p-4",
                mode === "dark" && "dark"
              )}
              style={{
                backgroundColor: draft[mode].background,
                color: draft[mode].foreground,
                borderColor: draft[mode].border,
                borderRadius: `${draft.radius}rem`,
                fontFamily: normalizeThemeFontStack(draft.fontSans),
              }}
            >
              <div
                className="rounded-md border p-3"
                style={{
                  backgroundColor: draft[mode].card,
                  borderColor: draft[mode].border,
                }}
              >
                <div className="mb-3 flex gap-2">
                  <span
                    className="size-4 rounded-full"
                    style={{ backgroundColor: draft[mode].primary }}
                  />
                  <span
                    className="size-4 rounded-full"
                    style={{ backgroundColor: draft[mode].secondary }}
                  />
                  <span
                    className="size-4 rounded-full"
                    style={{ backgroundColor: draft[mode].accent }}
                  />
                </div>
                <p className="font-medium">{t("previewTitle")}</p>
                <p className="text-sm opacity-75">
                  {t("previewDescription")}
                </p>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </ProfileSection>
  );
}
