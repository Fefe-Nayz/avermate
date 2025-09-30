"use client";

import { useState, useEffect } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useTranslations } from "next-intl";
import ProfileSection from "../profile-section";
import {
  SelectDrawer,
  SelectDrawerContent,
  SelectDrawerGroup,
  SelectDrawerItem,
  SelectDrawerTrigger,
} from "@/components/ui/selectdrawer";
import {
  SeasonalTheme,
  SEASONAL_THEMES,
} from "@/components/april-fools/april-fools-theme-provider";

// Define the theme configuration type
type ThemeConfig = {
  name: string;
  checkDate: () => boolean;
  css: string;
};

// Check if dev tools should be shown
// Set NEXT_PUBLIC_ENABLE_DEV_TOOLS=true in your .env.local to enable theme selector
const showDevTools = process.env.NEXT_PUBLIC_ENABLE_DEV_TOOLS === "true";

export const SeasonalThemesSection = () => {
  const t = useTranslations("Settings.Settings.SeasonalThemes");
  const [mounted, setMounted] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [selectedTheme, setSelectedTheme] = useState<SeasonalTheme>("none");

  useEffect(() => {
    setMounted(true);

    // Load the current setting from localStorage
    const stored = localStorage.getItem("seasonal-themes-enabled");
    if (stored !== null) {
      setEnabled(stored === "true");
    }

    // Load the current forced theme from localStorage
    const forcedTheme = localStorage.getItem(
      "seasonal-theme-settings-force"
    ) as SeasonalTheme;
    if (forcedTheme && forcedTheme in SEASONAL_THEMES) {
      setSelectedTheme(forcedTheme);
    } else {
      setSelectedTheme("none");
    }
  }, []);

  const handleToggle = (checked: boolean) => {
    setEnabled(checked);
    localStorage.setItem("seasonal-themes-enabled", checked.toString());

    // Force a page reload to apply the change
    window.location.reload();
  };

  const handleThemeChange = (theme: SeasonalTheme) => {
    setSelectedTheme(theme);
    if (theme === "none") {
      localStorage.removeItem("seasonal-theme-settings-force");
    } else {
      localStorage.setItem("seasonal-theme-settings-force", theme);
    }
    // Force a page reload to apply the change
    window.location.reload();
  };

  if (!mounted) {
    return (
      <ProfileSection title={t("title")} description={t("description")}>
        <div className="flex flex-col gap-4">
          <div className="px-6 grid gap-4 pb-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">
                  {t("enableSeasonalThemes")}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t("enableSeasonalThemesDescription")}
                </p>
              </div>
              <Switch disabled />
            </div>
          </div>
        </div>
      </ProfileSection>
    );
  }

  return (
    <ProfileSection title={t("title")} description={t("description")}>
      <div className="flex flex-col gap-4">
        <div className="px-6 grid gap-4 pb-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">
                {t("enableSeasonalThemes")}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t("enableSeasonalThemesDescription")}
              </p>
            </div>
            <Switch checked={enabled} onCheckedChange={handleToggle} />
          </div>

          {enabled && showDevTools && (
            <div className="mt-4 p-4 bg-muted rounded-lg">
              <h4 className="text-sm font-medium mb-2">
                Dev Tools - Force Theme
              </h4>
              <div className="space-y-2">
                <SelectDrawer
                  onValueChange={handleThemeChange}
                  value={selectedTheme}
                >
                  <SelectDrawerTrigger className="w-full">
                    {selectedTheme === "none"
                      ? "No forced theme"
                      : SEASONAL_THEMES[selectedTheme]?.name || "Select theme"}
                  </SelectDrawerTrigger>
                  <SelectDrawerContent title="Select Theme">
                    <SelectDrawerGroup>
                      <SelectDrawerItem value="none">
                        No forced theme
                      </SelectDrawerItem>
                      {(
                        Object.entries(SEASONAL_THEMES) as [
                          SeasonalTheme,
                          ThemeConfig,
                        ][]
                      ).map(([themeKey, theme]) => {
                        if (themeKey === "none") return null;

                        return (
                          <SelectDrawerItem key={themeKey} value={themeKey}>
                            {theme.name}
                          </SelectDrawerItem>
                        );
                      })}
                    </SelectDrawerGroup>
                  </SelectDrawerContent>
                </SelectDrawer>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                This will force a specific seasonal theme for testing purposes.
              </p>
            </div>
          )}
        </div>
      </div>
    </ProfileSection>
  );
};
