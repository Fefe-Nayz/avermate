"use client";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useHapticsSettings } from "@/hooks/use-haptics-settings";
import { useTranslations } from "next-intl";

import ProfileSection from "../profile-section";

export const HapticsSection = () => {
  const t = useTranslations("Settings.Settings.Haptics");
  const { enabled, isLoaded, updateEnabled } = useHapticsSettings();

  return (
    <ProfileSection title={t("title")} description={t("description")}>
      <div className="flex flex-col gap-4">
        <div className="px-6 grid gap-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">{t("enableHaptics")}</Label>
              <p className="text-sm text-muted-foreground">
                {t("enableHapticsDescription")}
              </p>
            </div>
            <Switch
              checked={enabled}
              disabled={!isLoaded}
              onCheckedChange={updateEnabled}
            />
          </div>
        </div>
      </div>
    </ProfileSection>
  );
};
