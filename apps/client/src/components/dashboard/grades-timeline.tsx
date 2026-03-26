"use client";

import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useFormatDates } from "@/utils/format";
import { addDays, differenceInCalendarDays, endOfDay } from "date-fns";
import { HistoryIcon, RotateCcwIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo } from "react";

type GradesTimelineProps = {
  minDate: Date;
  maxDate: Date;
  selectedDate: Date;
  visibleGradesCount: number;
  onSelectedDateChange: (date: Date) => void;
};

export function GradesTimeline({
  minDate,
  maxDate,
  selectedDate,
  visibleGradesCount,
  onSelectedDateChange,
}: GradesTimelineProps) {
  const t = useTranslations("Dashboard.Pages.GradesPage");
  const formatter = useFormatter();
  const formatDates = useFormatDates(formatter);

  const totalDays = Math.max(differenceInCalendarDays(maxDate, minDate), 0);
  const sliderValue = Math.max(
    Math.min(differenceInCalendarDays(selectedDate, minDate), totalDays),
    0
  );
  const isLatest = sliderValue === totalDays;
  const isDisabled = totalDays === 0;

  const marks = useMemo(() => {
    if (totalDays === 0) {
      return [{ label: formatDates.formatShort(minDate), left: "0%" }];
    }

    const uniqueOffsets = Array.from(
      new Set([0, Math.round(totalDays / 2), totalDays])
    );

    return uniqueOffsets.map((offset) => ({
      label: formatDates.formatShort(addDays(minDate, offset)),
      left: `${(offset / totalDays) * 100}%`,
    }));
  }, [formatDates, maxDate, minDate, totalDays]);

  return (
    <div className="rounded-xl border border-border/60 bg-muted/25 p-4 md:p-5">
      <div className="grid gap-4 md:grid-cols-[minmax(220px,280px)_minmax(0,1fr)_auto] md:items-center md:gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
            <HistoryIcon className="size-4" />
            {t("timelineLabel")}
          </div>
          <div className="space-y-1">
            <p className="text-lg font-semibold md:text-xl">
              {formatDates.formatIntermediate(selectedDate)}
            </p>
            <p className="text-sm text-muted-foreground">
              {visibleGradesCount === 0
                ? t("timelineNoGradesYet")
                : t("timelineVisibleCount", {
                    count: visibleGradesCount,
                  })}
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="relative px-1">
            {marks.length > 1 && (
              <div className="pointer-events-none absolute inset-x-1 top-2 hidden h-3 md:block">
                {marks.map((mark) => (
                  <span
                    key={`${mark.left}-${mark.label}`}
                    className="absolute h-3 w-px -translate-x-1/2 bg-border"
                    style={{ left: mark.left }}
                  />
                ))}
              </div>
            )}

            <Slider
              min={0}
              max={totalDays}
              step={1}
              disabled={isDisabled}
              value={[sliderValue]}
              onValueChange={(values) => {
                const nextValue = values[0] ?? 0;
                onSelectedDateChange(endOfDay(addDays(minDate, nextValue)));
              }}
              className="py-4"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
            {marks.map((mark) => (
              <span key={`${mark.left}-${mark.label}`}>{mark.label}</span>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end">
          <Button
            variant="ghost"
            size="sm"
            disabled={isDisabled || isLatest}
            onClick={() => onSelectedDateChange(maxDate)}
          >
            <RotateCcwIcon className="size-4" />
            {t("timelineReset")}
          </Button>
        </div>
      </div>
    </div>
  );
}
