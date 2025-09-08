"use client";

import { Label } from "@/components/ui/label";
import {
  SelectDrawer,
  SelectDrawerContent,
  SelectDrawerGroup,
  SelectDrawerItem,
  SelectDrawerTrigger,
} from "@/components/ui/selectdrawer";
import { useTheme } from "next-themes";
import ProfileSection from "../profile-section";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

export const ThemeSection = () => {
  const t = useTranslations("Settings.Settings.Theme");
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // This ensures we only render the UI after the client is hydrated
    setMounted(true);
  }, []);

  if (!mounted) {
    // SSR or no hydration yet, avoid rendering mismatched UI
    return (
      <ProfileSection title={t("title")} description={t("description")}>
        <div className="flex flex-col gap-4">
          <div className="px-6 grid gap-4 pb-4">
            <SelectDrawer disabled>
              <SelectDrawerTrigger className="capitalize w-full" placeholder={t("selectPlaceholder")}>
                {/* Loading state - show placeholder */}
              </SelectDrawerTrigger>
              <SelectDrawerContent>
                <SelectDrawerGroup>
                  <SelectDrawerItem value="system">{t("system")}</SelectDrawerItem>
                  <SelectDrawerItem value="light">{t("light")}</SelectDrawerItem>
                  <SelectDrawerItem value="dark">{t("dark")}</SelectDrawerItem>
                </SelectDrawerGroup>
              </SelectDrawerContent>
            </SelectDrawer>
          </div>
        </div>
      </ProfileSection>
    );
  }

  return (
    <ProfileSection title={t("title")} description={t("description")}>
      <div className="flex flex-col gap-4">
        <div className="px-6 grid gap-4 pb-4">
          <SelectDrawer onValueChange={setTheme} value={theme} defaultValue={theme}>
            <SelectDrawerTrigger className="capitalize w-full" placeholder={t("selectPlaceholder")}>
              {theme === "system" ? t("system") : theme === "light" ? t("light") : t("dark")}
            </SelectDrawerTrigger>

            <SelectDrawerContent title={t("title")}>
              <SelectDrawerGroup>
                <SelectDrawerItem value="system">{t("system")}</SelectDrawerItem>
                <SelectDrawerItem value="light">{t("light")}</SelectDrawerItem>
                <SelectDrawerItem value="dark">{t("dark")}</SelectDrawerItem>
              </SelectDrawerGroup>
            </SelectDrawerContent>
          </SelectDrawer>
        </div>
      </div>
    </ProfileSection>
  );
};
