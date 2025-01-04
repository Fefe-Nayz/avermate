"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
          <Label>{t("themeLabel")}</Label>
          <Select disabled>
            <SelectTrigger>
              <SelectValue placeholder={t("selectPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">{t("system")}</SelectItem>
              <SelectItem value="light">{t("light")}</SelectItem>
              <SelectItem value="dark">{t("dark")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </ProfileSection>
    );
  }

  return (
    <ProfileSection title={t("title")} description={t("description")}>
      <div className="flex flex-col gap-4">
        <Label>{t("themeLabel")}</Label>

        <Select onValueChange={setTheme} value={theme} defaultValue={theme}>
          <SelectTrigger className="capitalize">
            <SelectValue placeholder={t("selectPlaceholder")} />
          </SelectTrigger>

          <SelectContent>
            <SelectItem value="system">{t("system")}</SelectItem>

            <SelectItem value="light">{t("light")}</SelectItem>

            <SelectItem value="dark">{t("dark")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </ProfileSection>
  );
};
