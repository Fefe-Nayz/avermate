"use client";

import { HistoryIcon, XIcon } from "lucide-react";
import { useFormatter, useExtracted } from "next-intl";
import { Input } from "@/components/ui/input";
import { useYear } from "@/components/year/year-provider";
import { haptic } from "@/lib/haptics";

/**
 * Time travel.
 *
 * While a date is set, every grade recorded after it is hidden — from the
 * dashboard, the charts, the goal plans, everything. It is the honest way to
 * answer "was I doing better in November?", because it re-runs the same
 * calculations against a smaller set of facts rather than reconstructing an
 * average from a stored snapshot.
 */
export function TimelineBanner() {
  const t = useExtracted();
  const format = useFormatter();
  const { timelineDate, setTimelineDate, year } = useYear();

  if (!timelineDate) return null;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-band-fair/40 bg-band-fair/12 px-4 py-2 text-sm md:px-6">
      <HistoryIcon className="size-4 shrink-0 opacity-70" />
      <span className="min-w-0 flex-1">
        {t("Showing the year as it stood on {date}.", {
          date: format.dateTime(new Date(`${timelineDate}T12:00:00`), {
            day: "numeric",
            month: "long",
            year: "numeric",
          }),
        })}
      </span>
      <Input
        type="date"
        value={timelineDate}
        min={
          year ? new Date(year.startsAt).toISOString().slice(0, 10) : undefined
        }
        max={new Date().toISOString().slice(0, 10)}
        onChange={(event) => setTimelineDate(event.target.value || null)}
        className="h-9 w-40"
      />
      <button
        type="button"
        aria-label={t("Back to today")}
        onClick={() => {
          haptic("light");
          setTimelineDate(null);
        }}
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
      >
        <XIcon className="size-4" />
      </button>
    </div>
  );
}
