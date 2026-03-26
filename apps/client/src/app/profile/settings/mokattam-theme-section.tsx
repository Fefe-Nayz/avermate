"use client";

import { useEffect, useState } from "react";
import { Flame } from "lucide-react";
import { useTranslations } from "next-intl";

import MokattamBadge from "@/components/buttons/account/mokattam-badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useUpdateUserSettings } from "@/hooks/use-user-settings";
import {
  getUserSettingsStorageEventName,
  updateLocalUserSettings,
  readLocalUserSettings,
} from "@/lib/user-settings-storage";

import ProfileSection from "../profile-section";

export const MokattamThemeSection = () => {
  const t = useTranslations("Settings.Settings.MokattamTheme");
  const [mounted, setMounted] = useState(false);
  const [available, setAvailable] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const updateUserSettings = useUpdateUserSettings();

  useEffect(() => {
    const syncSettings = (nextSettings = readLocalUserSettings().settings) => {
      setAvailable(nextSettings.mokattamThemeAvailable);
      setEnabled(
        nextSettings.mokattamThemeAvailable && nextSettings.mokattamThemeEnabled
      );
    };
    const handleSettingsChange = (event: Event) => {
      const nextSettings = (event as CustomEvent<{
        settings: {
          mokattamThemeAvailable: boolean;
          mokattamThemeEnabled: boolean;
        };
      }>).detail?.settings;

      if (!nextSettings) {
        syncSettings();
        return;
      }

      syncSettings({
        ...readLocalUserSettings().settings,
        mokattamThemeAvailable: nextSettings.mokattamThemeAvailable,
        mokattamThemeEnabled: nextSettings.mokattamThemeEnabled,
      });
    };

    syncSettings();
    setMounted(true);
    window.addEventListener(getUserSettingsStorageEventName(), handleSettingsChange);

    return () => {
      window.removeEventListener(
        getUserSettingsStorageEventName(),
        handleSettingsChange
      );
    };
  }, []);

  const handleToggle = (checked: boolean) => {
    setEnabled(checked);
    updateLocalUserSettings({
      mokattamThemeEnabled: checked,
    });
    updateUserSettings.mutate({
      mokattamThemeEnabled: checked,
    });
  };

  if (!mounted || !available) {
    return null;
  }

  return (
    <ProfileSection title={t("title")} description={t("description")}>
      <div className="flex flex-col gap-4 px-6 ">
        <div className="rounded-2xl border border-orange-200/70 bg-gradient-to-br from-orange-100 via-amber-50 to-white p-4 shadow-sm dark:border-orange-500/20 dark:from-orange-500/15 dark:via-orange-400/10 dark:to-card">
          <div className="flex flex-wrap items-center gap-2">
            <MokattamBadge />
            <span className="inline-flex items-center gap-1 rounded-full border border-orange-200/80 bg-white/80 px-2.5 py-1 text-xs font-medium text-orange-700 dark:border-orange-500/25 dark:bg-background/60 dark:text-orange-200">
              <Flame className="size-3.5" />
              {t("badgeLabel")}
            </span>
          </div>
          <p className="mt-3 text-sm leading-6 text-orange-950/80 dark:text-orange-100/85">
            {t("preview")}
          </p>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">{t("enable")}</Label>
            <p className="text-sm text-muted-foreground">
              {t("enableDescription")}
            </p>
          </div>
          <Switch checked={enabled} onCheckedChange={handleToggle} />
        </div>
      </div>
    </ProfileSection>
  );
};
