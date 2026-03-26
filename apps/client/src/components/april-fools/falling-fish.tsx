"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { SeasonalTheme } from "./april-fools-theme-provider";
import {
  getUserSettingsStorageEventName,
  isMokattamThemeActive,
  readLocalUserSettings,
} from "@/lib/user-settings-storage";

// Define seasonal elements for different themes
const SEASONAL_ELEMENTS = {
  "april-fools": {
    emoji: "🐟",
    count: 15,
  },
  halloween: {
    emoji: "🎃",
    count: 8,
  },
  christmas: {
    emoji: "❄️",
    count: 20,
  },
} as const;

interface SeasonalElement {
  id: number;
  x: number;
  size: number;
  delay: number;
  duration: number;
  rotation: number;
  emoji: string;
}

export function SeasonalElements() {
  const [elements, setElements] = useState<SeasonalElement[]>([]);
  const [activeTheme, setActiveTheme] = useState<SeasonalTheme>("none");

  useEffect(() => {
    const getActiveTheme = (): SeasonalTheme => {
      const envForcedTheme = process.env.NEXT_PUBLIC_FORCE_SEASONAL_THEME;
      if (envForcedTheme && envForcedTheme in SEASONAL_ELEMENTS) {
        return envForcedTheme as SeasonalTheme;
      }

      const localSettings = readLocalUserSettings().settings;
      if (isMokattamThemeActive(localSettings)) {
        return "none";
      }

      if (!localSettings.seasonalThemesEnabled) {
        return "none";
      }

      if (
        localSettings.seasonalTheme !== "none" &&
        localSettings.seasonalTheme in SEASONAL_ELEMENTS
      ) {
        return localSettings.seasonalTheme as SeasonalTheme;
      }

      if (typeof window !== "undefined") {
        const forcedTheme =
          localStorage.getItem("seasonal-theme-force") ||
          new URLSearchParams(window.location.search).get("seasonal-theme");

        if (forcedTheme && forcedTheme in SEASONAL_ELEMENTS) {
          return forcedTheme as SeasonalTheme;
        }
      }

      // Check each seasonal theme in order
      const today = new Date();
      if (today.getMonth() === 3 && today.getDate() === 1) return "april-fools"; // April 1st
      if (today.getMonth() === 9 && today.getDate() === 31) return "halloween"; // October 31st
      if (
        today.getMonth() === 11 &&
        today.getDate() >= 24 &&
        today.getDate() <= 26
      )
        return "christmas"; // Dec 24-26

      return "none";
    };

    const syncTheme = () => {
      const theme = getActiveTheme();
      setActiveTheme(theme);

      if (theme === "none") {
        setElements([]);
        return;
      }

      const themeConfig = SEASONAL_ELEMENTS[theme];
      const newElements = Array.from({ length: themeConfig.count }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        size: Math.random() * 30 + 20,
        delay: Math.random() * 5,
        duration: Math.random() * 10 + 8,
        rotation: (Math.random() - 0.5) * 40,
        emoji: themeConfig.emoji,
      }));

      setElements(newElements);
    };

    syncTheme();
    window.addEventListener(getUserSettingsStorageEventName(), syncTheme);

    return () => {
      window.removeEventListener(getUserSettingsStorageEventName(), syncTheme);
    };
  }, []);

  if (activeTheme === "none") return null;

  return (
    <div className="fixed inset-0 w-full h-full pointer-events-none z-50 overflow-hidden">
      {elements.map((element) => (
        <motion.div
          key={element.id}
          className="absolute"
          style={{ left: `${element.x}%` }}
          initial={{ y: -100, rotate: element.rotation }}
          animate={{
            y: "100vh",
            rotate: [element.rotation, element.rotation * -1, element.rotation],
          }}
          transition={{
            y: {
              duration: element.duration,
              delay: element.delay,
              repeat: Infinity,
              ease: "linear",
            },
            rotate: {
              duration: element.duration / 3,
              repeat: Infinity,
              repeatType: "reverse",
            },
          }}
        >
          <div style={{ width: element.size, height: element.size }}>
            {/* Element emoji with random size */}
            <span style={{ fontSize: `${element.size}px` }}>
              {element.emoji}
            </span>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

// Legacy component for backward compatibility
export function FallingFish() {
  return <SeasonalElements />;
}
