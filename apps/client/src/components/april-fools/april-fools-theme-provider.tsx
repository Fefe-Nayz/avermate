"use client";

import { useEffect, useState } from "react";

// Define seasonal theme types
export type SeasonalTheme = "april-fools" | "halloween" | "christmas" | "none";

// Seasonal theme configurations
export const SEASONAL_THEMES = {
  "april-fools": {
    name: "April Fools",
    checkDate: () => {
      const today = new Date();
      return today.getMonth() === 3 && today.getDate() === 1;
    },
    css: `
        :root {
          --background: oklch(0.85 0.15 320) !important;
          --foreground: oklch(0.8 0.3 130) !important;
          --card: oklch(0.75 0.2 80) !important;
          --card-foreground: oklch(0.3 0.2 320) !important;
          --popover: oklch(0.8 0.15 350) !important;
          --popover-foreground: oklch(0.7 0.25 260) !important;
          --primary: oklch(0.6 0.3 40) !important;
          --primary-foreground: oklch(0.9 0.1 290) !important;
          --secondary: oklch(0.75 0.2 200) !important;
          --secondary-foreground: oklch(0.8 0.3 20) !important;
          --muted: oklch(0.8 0.15 140) !important;
          --muted-foreground: oklch(0.4 0.2 340) !important;
          --accent: oklch(0.8 0.2 30) !important;
          --accent-foreground: oklch(0.3 0.2 210) !important;
          --destructive: oklch(0.5 0.3 150) !important;
          --destructive-foreground: oklch(0.8 0.3 80) !important;
          --border: oklch(0.6 0.2 330) !important;
          --input: oklch(0.8 0.15 220) !important;
          --ring: oklch(0.7 0.3 50) !important;
          --chart-1: oklch(0.6 0.2 330) !important;
          --chart-2: oklch(0.6 0.3 50) !important;
          --chart-3: oklch(0.75 0.2 200) !important;
          --chart-4: oklch(0.7 0.3 140) !important;
          --chart-5: oklch(0.75 0.2 80) !important;
        }
        
        .dark {
          --background: oklch(0.2 0.1 50) !important;
          --foreground: oklch(0.9 0.2 140) !important;
          --card: oklch(0.25 0.15 290) !important;
          --card-foreground: oklch(0.8 0.2 50) !important;
          --popover: oklch(0.3 0.15 350) !important;
          --popover-foreground: oklch(0.7 0.2 170) !important;
          --primary: oklch(0.7 0.3 20) !important;
          --primary-foreground: oklch(0.2 0.1 200) !important;
          --secondary: oklch(0.25 0.15 230) !important;
          --secondary-foreground: oklch(0.8 0.3 80) !important;
          --muted: oklch(0.3 0.1 170) !important;
          --muted-foreground: oklch(0.9 0.3 20) !important;
          --accent: oklch(0.4 0.2 350) !important;
          --accent-foreground: oklch(0.8 0.2 170) !important;
          --destructive: oklch(0.3 0.2 140) !important;
          --destructive-foreground: oklch(0.8 0.3 50) !important;
          --border: oklch(0.7 0.3 20) !important;
          --input: oklch(0.3 0.15 260) !important;
          --ring: oklch(0.8 0.3 80) !important;
          --chart-1: oklch(0.7 0.3 20) !important;
          --chart-2: oklch(0.8 0.3 80) !important;
          --chart-3: oklch(0.25 0.15 230) !important;
          --chart-4: oklch(0.7 0.3 140) !important;
          --chart-5: oklch(0.3 0.2 50) !important;
        }
        
        /* Add some comic sans for extra ugliness */
        * {
          font-family: "Comic Sans MS", cursive, sans-serif !important;
        }
        
        /* Make some buttons wiggle */
        button, a {
          animation: wiggle 2s infinite;
        }
        
        @keyframes wiggle {
          0%, 100% { transform: rotate(0deg); }
          25% { transform: rotate(5deg); }
          75% { transform: rotate(-5deg); }
        }
    `,
  },
  halloween: {
    name: "Halloween",
    checkDate: () => {
      const today = new Date();
      return today.getMonth() === 9 && today.getDate() === 31; // October 31st
    },
    css: `
      :root {
        --background: oklch(0.05 0.02 0) !important;
        --foreground: oklch(0.5 0.25 60) !important;
        --card: oklch(0.08 0.05 0) !important;
        --card-foreground: oklch(0.5 0.25 60) !important;
        --popover: oklch(0.08 0.05 0) !important;
        --popover-foreground: oklch(0.5 0.25 60) !important;
        --primary: oklch(0.6 0.3 25) !important;
        --primary-foreground: oklch(1 0 0) !important;
        --secondary: oklch(0.15 0.05 0) !important;
        --secondary-foreground: oklch(0.5 0.25 60) !important;
        --muted: oklch(0.15 0.05 0) !important;
        --muted-foreground: oklch(0.45 0.15 60) !important;
        --accent: oklch(0.6 0.3 25) !important;
        --accent-foreground: oklch(1 0 0) !important;
        --destructive: oklch(0.65 0.25 0) !important;
        --destructive-foreground: oklch(1 0 0) !important;
        --border: oklch(0.6 0.3 25) !important;
        --input: oklch(0.15 0.05 0) !important;
        --ring: oklch(0.6 0.3 25) !important;
        --chart-1: oklch(0.6 0.3 25) !important;
        --chart-2: oklch(0.6 0.3 300) !important;
        --chart-3: oklch(0.6 0.3 220) !important;
        --chart-4: oklch(0.5 0.25 60) !important;
        --chart-5: oklch(0.65 0.25 0) !important;
      }

      .dark {
        --background: oklch(0.02 0.01 0) !important;
        --foreground: oklch(0.5 0.25 60) !important;
        --card: oklch(0.05 0.02 0) !important;
        --card-foreground: oklch(0.5 0.25 60) !important;
        --popover: oklch(0.05 0.02 0) !important;
        --popover-foreground: oklch(0.5 0.25 60) !important;
        --primary: oklch(0.6 0.3 25) !important;
        --primary-foreground: oklch(1 0 0) !important;
        --secondary: oklch(0.1 0.03 0) !important;
        --secondary-foreground: oklch(0.5 0.25 60) !important;
        --muted: oklch(0.1 0.03 0) !important;
        --muted-foreground: oklch(0.45 0.15 60) !important;
        --accent: oklch(0.6 0.3 25) !important;
        --accent-foreground: oklch(1 0 0) !important;
        --destructive: oklch(0.65 0.25 0) !important;
        --destructive-foreground: oklch(1 0 0) !important;
        --border: oklch(0.6 0.3 25) !important;
        --input: oklch(0.1 0.03 0) !important;
        --ring: oklch(0.6 0.3 25) !important;
        --chart-1: oklch(0.6 0.3 25) !important;
        --chart-2: oklch(0.6 0.3 300) !important;
        --chart-3: oklch(0.6 0.3 220) !important;
        --chart-4: oklch(0.5 0.25 60) !important;
        --chart-5: oklch(0.65 0.25 0) !important;
      }

      /* Spooky font */
      * {
        font-family: "Creepster", "Nosifer", cursive, serif !important;
      }

      /* Add subtle glow to primary elements */
      button, a {
        text-shadow: 0 0 10px hsl(15 100% 50%);
        transition: text-shadow 0.3s ease;
      }

      button:hover, a:hover {
        text-shadow: 0 0 20px hsl(15 100% 50%);
      }
    `,
  },
  christmas: {
    name: "Christmas",
    checkDate: () => {
      const today = new Date();
      return (
        today.getMonth() === 11 &&
        today.getDate() >= 24 &&
        today.getDate() <= 26
      ); // Dec 24-26
    },
    css: `
      :root {
        --background: oklch(0.95 0.1 160) !important;
        --foreground: oklch(0.2 0.05 0) !important;
        --card: oklch(1 0 0) !important;
        --card-foreground: oklch(0.2 0.05 0) !important;
        --popover: oklch(1 0 0) !important;
        --popover-foreground: oklch(0.2 0.05 0) !important;
        --primary: oklch(0.65 0.25 0) !important;
        --primary-foreground: oklch(1 0 0) !important;
        --secondary: oklch(0.9 0.08 160) !important;
        --secondary-foreground: oklch(0.2 0.05 0) !important;
        --muted: oklch(0.9 0.05 160) !important;
        --muted-foreground: oklch(0.4 0.1 0) !important;
        --accent: oklch(0.65 0.3 40) !important;
        --accent-foreground: oklch(1 0 0) !important;
        --destructive: oklch(0.65 0.25 0) !important;
        --destructive-foreground: oklch(1 0 0) !important;
        --border: oklch(0.65 0.3 40) !important;
        --input: oklch(0.95 0.05 160) !important;
        --ring: oklch(0.65 0.25 0) !important;
        --chart-1: oklch(0.65 0.25 0) !important;
        --chart-2: oklch(0.65 0.3 40) !important;
        --chart-3: oklch(0.8 0.08 160) !important;
        --chart-4: oklch(0.65 0.3 60) !important;
        --chart-5: oklch(0.7 0.3 140) !important;
      }

      .dark {
        --background: oklch(0.1 0.05 160) !important;
        --foreground: oklch(0.85 0.1 160) !important;
        --card: oklch(0.15 0.05 160) !important;
        --card-foreground: oklch(0.85 0.1 160) !important;
        --popover: oklch(0.15 0.05 160) !important;
        --popover-foreground: oklch(0.85 0.1 160) !important;
        --primary: oklch(0.65 0.25 0) !important;
        --primary-foreground: oklch(1 0 0) !important;
        --secondary: oklch(0.2 0.05 160) !important;
        --secondary-foreground: oklch(0.85 0.1 160) !important;
        --muted: oklch(0.2 0.05 160) !important;
        --muted-foreground: oklch(0.6 0.1 160) !important;
        --accent: oklch(0.65 0.3 40) !important;
        --accent-foreground: oklch(1 0 0) !important;
        --destructive: oklch(0.65 0.25 0) !important;
        --destructive-foreground: oklch(1 0 0) !important;
        --border: oklch(0.65 0.3 40) !important;
        --input: oklch(0.2 0.05 160) !important;
        --ring: oklch(0.65 0.25 0) !important;
        --chart-1: oklch(0.65 0.25 0) !important;
        --chart-2: oklch(0.65 0.3 40) !important;
        --chart-3: oklch(0.8 0.08 160) !important;
        --chart-4: oklch(0.65 0.3 60) !important;
        --chart-5: oklch(0.7 0.3 140) !important;
      }

      /* Festive font */
      * {
        font-family: "Mountains of Christmas", "Festive", cursive, serif !important;
      }

      /* Add snow-like sparkle animation */
      button, a {
        position: relative;
        overflow: hidden;
      }

      button::before, a::before {
        content: '';
        position: absolute;
        top: -50%;
        left: -50%;
        width: 200%;
        height: 200%;
        background: linear-gradient(45deg, transparent, rgba(255,255,255,0.3), transparent);
        transform: rotate(45deg);
        animation: sparkle 3s infinite;
      }

      @keyframes sparkle {
        0% { transform: translateX(-100%) translateY(-100%) rotate(45deg); }
        50% { transform: translateX(100%) translateY(100%) rotate(45deg); }
        100% { transform: translateX(-100%) translateY(-100%) rotate(45deg); }
      }
    `,
  },
} as const;

// Get forced theme from environment variable (for development)
function getForcedTheme(): SeasonalTheme | null {
  if (typeof window === "undefined") return null;

  // Check for Next.js public environment variable (highest priority)
  const envForcedTheme = process.env.NEXT_PUBLIC_FORCE_SEASONAL_THEME;
  if (envForcedTheme && envForcedTheme in SEASONAL_THEMES) {
    return envForcedTheme as SeasonalTheme;
  }

  // Check for settings-based forced theme (for dev tools)
  const settingsForcedTheme = localStorage.getItem(
    "seasonal-theme-settings-force"
  );
  if (settingsForcedTheme && settingsForcedTheme in SEASONAL_THEMES) {
    return settingsForcedTheme as SeasonalTheme;
  }

  // Check for dev override in localStorage or URL params
  const forcedTheme =
    localStorage.getItem("seasonal-theme-force") ||
    new URLSearchParams(window.location.search).get("seasonal-theme");

  if (forcedTheme && forcedTheme in SEASONAL_THEMES) {
    return forcedTheme as SeasonalTheme;
  }

  return null;
}

// Determine which seasonal theme should be active
function getActiveSeasonalTheme(): SeasonalTheme {
  // Check if seasonal themes are enabled (default to true if not set)
  if (typeof window !== "undefined") {
    const enabled = localStorage.getItem("seasonal-themes-enabled");
    if (enabled === "false") {
      return "none";
    }
  }

  const forcedTheme = getForcedTheme();

  if (forcedTheme) {
    return forcedTheme;
  }

  // Check each seasonal theme in order (except April Fools which is always enabled)
  for (const [themeKey, themeConfig] of Object.entries(SEASONAL_THEMES)) {
    if (
      themeKey !== "none" &&
      themeKey !== "april-fools" &&
      themeConfig.checkDate()
    ) {
      return themeKey as SeasonalTheme;
    }
  }

  // April Fools is always checked last and cannot be disabled
  const aprilFoolsConfig = SEASONAL_THEMES["april-fools"];
  if (aprilFoolsConfig?.checkDate()) {
    return "april-fools";
  }

  return "none";
}

export function SeasonalThemeProvider() {
  const [activeTheme, setActiveTheme] = useState<SeasonalTheme>("none");

  useEffect(() => {
    const theme = getActiveSeasonalTheme();
    setActiveTheme(theme);

    if (theme !== "none") {
      const themeConfig = SEASONAL_THEMES[theme];

      // Add the seasonal theme CSS to the document
      const styleElement = document.createElement("style");
      styleElement.setAttribute("id", `seasonal-theme-${theme}`);
      styleElement.textContent = themeConfig.css;

      document.head.appendChild(styleElement);

      // Cleanup function to remove the styles when component unmounts or theme changes
      return () => {
        const styleToRemove = document.getElementById(
          `seasonal-theme-${theme}`
        );
        if (styleToRemove) {
          styleToRemove.remove();
        }
      };
    }
  }, [activeTheme]);

  return null;
}

// Legacy component for backward compatibility
export function AprilFoolsThemeProvider() {
  return <SeasonalThemeProvider />;
}
