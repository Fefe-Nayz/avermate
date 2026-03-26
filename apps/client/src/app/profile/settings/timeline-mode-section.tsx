"use client";

import ProfileSection from "../profile-section";
import { Button } from "@/components/ui/button";
import { useTimelineMode } from "@/hooks/use-timeline-mode";
import { ArrowRightIcon, HistoryIcon } from "lucide-react";
import { useTranslations } from "next-intl";

export const TimelineModeSection = () => {
  const t = useTranslations("Settings.Settings.TimelineMode");
  const { enterTimelineMode } = useTimelineMode();

  return (
    <ProfileSection title={t("title")} description={t("description")}>
      <div className="px-6 py-5">
        <Button onClick={() => enterTimelineMode()}>
          <HistoryIcon className="size-4" />
          {t("open")}
          <ArrowRightIcon className="size-4" />
        </Button>
      </div>
    </ProfileSection>
  );
};
