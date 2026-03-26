"use client";

import GradePageActions from "@/components/buttons/dashboard/grade-page-actions";
import { GradesTimeline } from "@/components/dashboard/grades-timeline";
import ErrorStateCard from "@/components/skeleton/error-card";
import GradesLoader from "@/components/skeleton/grades-loader";
import GradesTable from "@/components/tables/grades-table";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  SelectDrawer,
  SelectDrawerContent,
  SelectDrawerGroup,
  SelectDrawerItem,
  SelectDrawerTrigger,
} from "@/components/ui/selectdrawer";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useOrganizedSubjects } from "@/hooks/use-organized-subjects";
import { usePeriods } from "@/hooks/use-periods";
import { useSubjects } from "@/hooks/use-subjects";
import { useTimelineMode } from "@/hooks/use-timeline-mode";
import { useYears } from "@/hooks/use-years";
import { useActiveYearStore } from "@/stores/active-year-store";
import { useFormatDates } from "@/utils/format";
import {
  clampDateToRange,
  countSubjectGrades,
  getGradesTimelineBounds,
} from "@/utils/grades-timeline";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

export default function GradesPage() {
  const t = useTranslations("Dashboard.Pages.GradesPage");
  const formatter = useFormatter();
  const formatDates = useFormatDates(formatter);

  const [selectedTab, setSelectedTab] = useState<string | null>(null);
  const { isActive: timelineEnabled, snapshotDate, updateTimelineDate } =
    useTimelineMode();

  const { activeId } = useActiveYearStore();
  const { data: years } = useYears();
  const activeYear = years?.find((year) => year.id === activeId);

  const {
    data: periods,
    isError: periodsIsError,
    isPending: periodsIsPending,
  } = usePeriods(activeId);

  const {
    data: organizedSubjects,
    isError: organizedSubjectsIsError,
    isPending: organizedSubjectsIsPending,
  } = useOrganizedSubjects(activeId);

  const {
    data: subjects,
    isError: subjectsIsError,
    isPending: subjectsIsPending,
  } = useSubjects(activeId);

  const sortedPeriods = useMemo(
    () =>
      [...(periods ?? [])].sort(
        (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()
      ),
    [periods]
  );

  const selectedPeriod = useMemo(
    () => sortedPeriods.find((period) => period.id === selectedTab),
    [selectedTab, sortedPeriods]
  );

  const selectedSubjects = useMemo(() => {
    if (!selectedTab) {
      return [];
    }

    if (selectedTab === "full-year") {
      return subjects ?? [];
    }

    return (
      organizedSubjects?.find((entry) => entry.period.id === selectedTab)
        ?.subjects ?? []
    );
  }, [organizedSubjects, selectedTab, subjects]);

  const timelineBounds = useMemo(() => {
    if (!activeYear || !selectedTab) {
      return null;
    }

    return getGradesTimelineBounds({
      year: activeYear,
      selectedTab,
      periods: sortedPeriods,
    });
  }, [activeYear, selectedTab, sortedPeriods]);

  const effectiveTimelineDate = useMemo(() => {
    if (!timelineEnabled || !timelineBounds || !snapshotDate) {
      return null;
    }

    return clampDateToRange(
      snapshotDate,
      timelineBounds.minDate,
      timelineBounds.maxDate
    );
  }, [snapshotDate, timelineBounds, timelineEnabled]);

  const totalGradesCount = useMemo(
    () => countSubjectGrades(selectedSubjects),
    [selectedSubjects]
  );

  const tableCaption = useMemo(() => {
    const baseLabel =
      selectedTab === "full-year"
        ? t("fullYear")
        : selectedPeriod?.name ?? t("fullYear");

    if (!timelineEnabled || !effectiveTimelineDate) {
      return baseLabel;
    }

    return `${baseLabel} · ${formatDates.formatIntermediate(
      effectiveTimelineDate
    )}`;
  }, [
    effectiveTimelineDate,
    formatDates,
    selectedPeriod?.name,
    selectedTab,
    t,
    timelineEnabled,
  ]);

  useEffect(() => {
    if (sortedPeriods.length === 0) {
      setSelectedTab("full-year");
      return;
    }

    const savedTab = localStorage.getItem("selectedTab");
    const savedTabExists = sortedPeriods.some((period) => period.id === savedTab);

    if (savedTabExists) {
      setSelectedTab(savedTab);
      return;
    }

    const defaultTab =
      sortedPeriods.find(
        (period) =>
          new Date(period.startAt) <= new Date() &&
          new Date(period.endAt) >= new Date()
      )?.id ?? "full-year";

    setSelectedTab(defaultTab);
  }, [sortedPeriods]);

  useEffect(() => {
    if (!timelineEnabled || !timelineBounds || !snapshotDate || !effectiveTimelineDate) {
      return;
    }

    if (effectiveTimelineDate.getTime() !== snapshotDate.getTime()) {
      updateTimelineDate(effectiveTimelineDate);
    }
  }, [
    effectiveTimelineDate,
    snapshotDate,
    timelineBounds,
    timelineEnabled,
    updateTimelineDate,
  ]);

  if (periodsIsError || organizedSubjectsIsError || subjectsIsError) {
    return <div>{ErrorStateCard()}</div>;
  }

  if (
    periodsIsPending ||
    organizedSubjectsIsPending ||
    subjectsIsPending ||
    selectedTab === null
  ) {
    return <div>{GradesLoader(t)}</div>;
  }

  return (
    <main className="mx-auto flex max-w-[2000px] flex-col gap-4 md:gap-8">
      <div className="flex min-h-9 items-center justify-between gap-2 md:gap-16">
        <h1 className="text-xl font-bold md:text-3xl">{t("gradesTitle")}</h1>

        <GradePageActions activeId={activeId} />
      </div>

      <Separator />

      <Tabs
        value={selectedTab}
        onValueChange={(value) => {
          setSelectedTab(value);
          localStorage.setItem("selectedTab", value);
        }}
      >
        <div className="hidden md:block">
          <ScrollArea>
            <div className="relative h-12 w-full">
              <TabsList className="flex">
                {sortedPeriods.map((period) => (
                  <TabsTrigger key={period.id} value={period.id}>
                    {t("periodName", { name: period.name })}
                  </TabsTrigger>
                ))}
                <TabsTrigger value="full-year">{t("fullYear")}</TabsTrigger>
              </TabsList>
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </div>

        <div className="flex md:hidden">
          <SelectDrawer
            value={selectedTab}
            onValueChange={(value) => {
              setSelectedTab(value);
              localStorage.setItem("selectedTab", value);
            }}
          >
            <SelectDrawerTrigger className="w-full">
              {selectedPeriod?.name ?? t("fullYear")}
            </SelectDrawerTrigger>
            <SelectDrawerContent title={t("selectPeriod")}>
              <SelectDrawerGroup>
                {sortedPeriods.map((period) => (
                  <SelectDrawerItem key={period.id} value={period.id}>
                    {period.name}
                  </SelectDrawerItem>
                ))}
                <SelectDrawerItem value="full-year">
                  {t("fullYear")}
                </SelectDrawerItem>
              </SelectDrawerGroup>
            </SelectDrawerContent>
          </SelectDrawer>
        </div>
      </Tabs>

      {timelineEnabled && timelineBounds && effectiveTimelineDate && (
        <GradesTimeline
          minDate={timelineBounds.minDate}
          maxDate={timelineBounds.maxDate}
          selectedDate={effectiveTimelineDate}
          visibleGradesCount={totalGradesCount}
          onSelectedDateChange={updateTimelineDate}
        />
      )}

      <GradesTable
        yearId={activeId}
        subjects={selectedSubjects}
        periodId={selectedTab ?? "full-year"}
        caption={tableCaption}
      />
    </main>
  );
}
