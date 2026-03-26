"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Viewport } from "next";
import {
  getUserSettingsStorageEventName,
  isMokattamThemeActive,
  readLocalUserSettings,
} from "@/lib/user-settings-storage";

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
};

export function ThemeColorMetaTag() {
  const { theme } = useTheme(); // could be "dark", "light", "system", etc.
  const [mokattamActive, setMokattamActive] = useState(false);

  useEffect(() => {
    const syncMokattamTheme = () => {
      setMokattamActive(
        isMokattamThemeActive(readLocalUserSettings().settings)
      );
    };

    syncMokattamTheme();
    window.addEventListener(getUserSettingsStorageEventName(), syncMokattamTheme);

    return () => {
      window.removeEventListener(
        getUserSettingsStorageEventName(),
        syncMokattamTheme
      );
    };
  }, []);

  useEffect(() => {
    const metaTag = document.querySelector('meta[name="theme-color"]');
    if (!metaTag) return;

    if (mokattamActive) {
      const osPrefersDark = window.matchMedia(
        "(prefers-color-scheme: dark)"
      ).matches;
      const isDarkTheme =
        theme === "dark" || (theme !== "light" && osPrefersDark);

      metaTag.setAttribute("content", isDarkTheme ? "#9a3412" : "#f97316");
      return;
    }

    if (theme === "light") {
      metaTag.setAttribute("content", "#ffffff");
    } else if (theme === "dark") {
      metaTag.setAttribute("content", "#09090b");
    } else {
      // Fallback to OS preference if theme is neither "light" nor "dark"
      const osPrefersDark = window.matchMedia(
        "(prefers-color-scheme: dark)"
      ).matches;
      metaTag.setAttribute("content", osPrefersDark ? "#09090b" : "#ffffff");
    }
  }, [mokattamActive, theme]);

  return null;
}
