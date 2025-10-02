"use client";

import ProfileSection from "../profile-section";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useTranslations } from "next-intl";
import { useChartSettings } from "@/hooks/use-chart-settings";

export const ChartSettingsSection = () => {
  const t = useTranslations("Settings.Settings.ChartSettings");
  const { settings, updateSettings } = useChartSettings();

  return (
    <ProfileSection title={t("title")} description={t("description")}>
      <div className="flex flex-col gap-4">
        <div className="px-6 grid gap-4 pb-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">
                {t("autoZoomYAxis")}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t("autoZoomYAxisDescription")}
              </p>
            </div>
            <Switch
              checked={settings.autoZoomYAxis}
              onCheckedChange={(checked) =>
                updateSettings({ autoZoomYAxis: checked })
              }
            />
          </div>
        </div>
      </div>
    </ProfileSection>
  );
};
