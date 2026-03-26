"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  SelectDrawer,
  SelectDrawerContent,
  SelectDrawerGroup,
  SelectDrawerItem,
  SelectDrawerTrigger,
} from "@/components/ui/selectdrawer";
import ProfileSection from "../profile-section";
import { useTranslations } from "next-intl";
import { useUpdateUserSettings } from "@/hooks/use-user-settings";
import { readLocalUserSettings, updateLocalUserSettings } from "@/lib/user-settings-storage";
import { type AppLanguage } from "@/types/user-settings";

export const LanguageSection = () => {
  const t = useTranslations("Settings.Settings.Language");

  const router = useRouter();
  const updateUserSettings = useUpdateUserSettings();

  const [language, setLanguage] = useState<AppLanguage>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setLanguage(readLocalUserSettings().settings.language);
    setMounted(true);
  }, []);

  const changeLanguage = (lang: string) => {
    const nextLanguage = lang as AppLanguage;
    setLanguage(nextLanguage);
    updateLocalUserSettings({
      language: nextLanguage,
    });
    updateUserSettings.mutate({
      language: nextLanguage,
    });

    setTimeout(() => router.refresh(), 50);
  };

  if (!mounted) {
    // SSR or no hydration yet, avoid rendering mismatched UI
    return (
      <ProfileSection title={t("title")} description={t("description")}>
        <div className="flex flex-col gap-4">
          <div className="px-6 grid gap-4">
            <SelectDrawer disabled>
              <SelectDrawerTrigger className="capitalize w-full" placeholder={t("selectPlaceholder")}>
                {/* Loading state - show placeholder */}
              </SelectDrawerTrigger>
              <SelectDrawerContent>
                <SelectDrawerGroup>
                  <SelectDrawerItem value="system">{t("system")}</SelectDrawerItem>
                  <SelectDrawerItem value="en">{t("english")}</SelectDrawerItem>
                  <SelectDrawerItem value="fr">{t("french")}</SelectDrawerItem>
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
        <div className="px-6 grid gap-4">
          <SelectDrawer onValueChange={changeLanguage} value={language}>
            <SelectDrawerTrigger className="capitalize w-full" placeholder={t("selectPlaceholder")}>
              {language === "system" ? t("system") : language === "en" ? t("english") : t("french")}
            </SelectDrawerTrigger>

            <SelectDrawerContent title={t("title")}>
              <SelectDrawerGroup>
                <SelectDrawerItem value="system">{t("system")}</SelectDrawerItem>
                <SelectDrawerItem value="en">{t("english")}</SelectDrawerItem>
                <SelectDrawerItem value="fr">{t("french")}</SelectDrawerItem>
              </SelectDrawerGroup>
            </SelectDrawerContent>
          </SelectDrawer>
        </div>
      </div>
    </ProfileSection>
  );
};
