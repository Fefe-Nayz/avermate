"use client";

import { useEffect, useState } from "react";

import {
  getUserSettingsStorageEventName,
  isMokattamThemeActive,
  readLocalUserSettings,
} from "@/lib/user-settings-storage";

const MOKATTAM_THEME_CSS = `
  :root {
    --background: oklch(0.992 0.012 78) !important;
    --foreground: oklch(0.29 0.04 50) !important;
    --card: oklch(0.985 0.02 74) !important;
    --card-foreground: oklch(0.29 0.04 50) !important;
    --popover: oklch(0.99 0.018 74) !important;
    --popover-foreground: oklch(0.29 0.04 50) !important;
    --primary: oklch(0.68 0.2 48) !important;
    --primary-foreground: oklch(0.99 0.01 95) !important;
    --secondary: oklch(0.94 0.05 76) !important;
    --secondary-foreground: oklch(0.33 0.05 48) !important;
    --muted: oklch(0.955 0.03 76) !important;
    --muted-foreground: oklch(0.51 0.05 48) !important;
    --accent: oklch(0.88 0.09 68) !important;
    --accent-foreground: oklch(0.33 0.05 48) !important;
    --destructive: oklch(0.61 0.19 29) !important;
    --border: oklch(0.9 0.045 72) !important;
    --input: oklch(0.915 0.04 72) !important;
    --ring: oklch(0.74 0.16 54) !important;
    --chart-1: oklch(0.71 0.18 50) !important;
    --chart-2: oklch(0.77 0.15 70) !important;
    --chart-3: oklch(0.63 0.16 35) !important;
    --chart-4: oklch(0.82 0.12 85) !important;
    --chart-5: oklch(0.58 0.14 22) !important;
    --sidebar: oklch(0.975 0.025 74) !important;
    --sidebar-foreground: oklch(0.29 0.04 50) !important;
    --sidebar-primary: oklch(0.68 0.2 48) !important;
    --sidebar-primary-foreground: oklch(0.99 0.01 95) !important;
    --sidebar-accent: oklch(0.93 0.05 74) !important;
    --sidebar-accent-foreground: oklch(0.33 0.05 48) !important;
    --sidebar-border: oklch(0.9 0.045 72) !important;
    --sidebar-ring: oklch(0.74 0.16 54) !important;
  }

  .dark {
    --background: oklch(0.24 0.035 45) !important;
    --foreground: oklch(0.96 0.03 82) !important;
    --card: oklch(0.285 0.045 46) !important;
    --card-foreground: oklch(0.96 0.03 82) !important;
    --popover: oklch(0.29 0.045 46) !important;
    --popover-foreground: oklch(0.96 0.03 82) !important;
    --primary: oklch(0.75 0.18 55) !important;
    --primary-foreground: oklch(0.24 0.035 45) !important;
    --secondary: oklch(0.34 0.05 46) !important;
    --secondary-foreground: oklch(0.95 0.03 82) !important;
    --muted: oklch(0.34 0.05 46) !important;
    --muted-foreground: oklch(0.78 0.04 72) !important;
    --accent: oklch(0.42 0.07 55) !important;
    --accent-foreground: oklch(0.97 0.02 82) !important;
    --destructive: oklch(0.66 0.18 32) !important;
    --border: oklch(0.43 0.055 48 / 90%) !important;
    --input: oklch(0.38 0.05 48 / 85%) !important;
    --ring: oklch(0.75 0.18 55) !important;
    --chart-1: oklch(0.75 0.18 55) !important;
    --chart-2: oklch(0.69 0.16 35) !important;
    --chart-3: oklch(0.82 0.13 78) !important;
    --chart-4: oklch(0.64 0.15 22) !important;
    --chart-5: oklch(0.86 0.11 92) !important;
    --sidebar: oklch(0.27 0.04 46) !important;
    --sidebar-foreground: oklch(0.96 0.03 82) !important;
    --sidebar-primary: oklch(0.75 0.18 55) !important;
    --sidebar-primary-foreground: oklch(0.24 0.035 45) !important;
    --sidebar-accent: oklch(0.34 0.05 46) !important;
    --sidebar-accent-foreground: oklch(0.95 0.03 82) !important;
    --sidebar-border: oklch(0.43 0.055 48 / 90%) !important;
    --sidebar-ring: oklch(0.75 0.18 55) !important;
  }

  body {
    background-image:
      radial-gradient(circle at top right, color-mix(in oklch, var(--primary) 18%, transparent) 0, transparent 34%),
      radial-gradient(circle at bottom left, color-mix(in oklch, var(--accent) 20%, transparent) 0, transparent 36%);
    background-attachment: fixed;
  }

  [data-vaul-drawer-wrapper=""] {
    background-image:
      linear-gradient(180deg, color-mix(in oklch, var(--background) 94%, white) 0%, var(--background) 100%);
  }
`;

export function MokattamThemeProvider() {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const syncTheme = () => {
      setActive(isMokattamThemeActive(readLocalUserSettings().settings));
    };

    syncTheme();
    window.addEventListener(getUserSettingsStorageEventName(), syncTheme);

    return () => {
      window.removeEventListener(getUserSettingsStorageEventName(), syncTheme);
    };
  }, []);

  useEffect(() => {
    const existingStyles = document.querySelectorAll("[id='mokattam-theme']");
    existingStyles.forEach((node) => node.remove());

    if (!active) {
      return;
    }

    const styleElement = document.createElement("style");
    styleElement.setAttribute("id", "mokattam-theme");
    styleElement.textContent = MOKATTAM_THEME_CSS;
    document.head.appendChild(styleElement);

    return () => {
      styleElement.remove();
    };
  }, [active]);

  return null;
}
