"use client";

import { useTimelineMode } from "@/hooks/use-timeline-mode";
import { useFormatDates } from "@/utils/format";
import { ArrowRightIcon, HistoryIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "../ui/button";

export default function TimelineModeBanner() {
  const t = useTranslations("TimelineMode.Banner");
  const formatter = useFormatter();
  const formatDates = useFormatDates(formatter);
  const { isActive, snapshotDate, exitTimelineMode, getTimelineHref } =
    useTimelineMode();

  if (!isActive || !snapshotDate) {
    return null;
  }

  return (
    <div className="border-t bg-muted/25">
      <div className="mx-auto flex max-w-[2000px] flex-col gap-3 px-4 py-3 sm:px-16 lg:px-32 2xl:px-64 3xl:px-96 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
            <HistoryIcon className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
              {t("label")}
            </p>
            <p className="truncate text-sm font-semibold">
              {t("activeOn", {
                date: formatDates.formatIntermediate(snapshotDate),
              })}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href={getTimelineHref("/dashboard/grades")}>
              {t("adjust")}
              <ArrowRightIcon className="size-4" />
            </Link>
          </Button>
          <Button variant="outline" size="sm" onClick={exitTimelineMode}>
            {t("exit")}
            <XIcon className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
