"use client";

import ProfileSection from "../profile-section";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { useTranslations } from "next-intl";
import { useChartSettings } from "@/hooks/use-chart-settings";

export const ChartSettingsSection = () => {
  const t = useTranslations("Settings.Settings.ChartSettings");
  const { settings, updateSettings } = useChartSettings();

  return (
    <ProfileSection title={t("title")} description={t("description")}>
      <div className="flex flex-col gap-4">
        <div className="px-6 grid gap-4">
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

          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">
                {t("showTrendLine")}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t("showTrendLineDescription")}
              </p>
            </div>
            <Switch
              checked={settings.showTrendLine}
              onCheckedChange={(checked) =>
                updateSettings({ showTrendLine: checked })
              }
            />
          </div>

          {settings.showTrendLine && (
            <div className="space-y-3">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">
                  {t("trendLineSubdivisions")}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t("trendLineSubdivisionsDescription")}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-xs text-muted-foreground w-16 shrink-0">
                  {t("trendLineSubdivisionsMin")}
                </span>
                <Slider
                  min={1}
                  max={10}
                  step={1}
                  value={[settings.trendLineSubdivisions]}
                  onValueChange={([value]) =>
                    updateSettings(
                      { trendLineSubdivisions: value },
                      { persist: false }
                    )
                  }
                  onValueCommit={([value]) =>
                    updateSettings({ trendLineSubdivisions: value })
                  }
                  className="flex-1"
                />
                <span className="text-xs text-muted-foreground w-16 shrink-0 text-right">
                  {t("trendLineSubdivisionsMax")}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </ProfileSection>
  );
};
