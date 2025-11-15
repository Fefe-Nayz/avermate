"use client";

import GradePageActions from "@/components/buttons/dashboard/grade-page-actions";
import { AddGradeButton } from "@/components/buttons/dashboard/grade/add-grade-button";
import MoreButton from "@/components/buttons/dashboard/more-button";
import AddPeriodDialog from "@/components/dialogs/add-period-dialog";
import AddSubjectDialog from "@/components/dialogs/add-subject-dialog";
import ErrorStateCard from "@/components/skeleton/error-card";
import GradesLoader from "@/components/skeleton/grades-loader";
import GradesTable from "@/components/tables/grades-table";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  SelectDrawer,
  SelectDrawerContent,
  SelectDrawerGroup,
  SelectDrawerItem,
  SelectDrawerTrigger,
} from "@/components/ui/selectdrawer";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useOrganizedSubjects } from "@/hooks/use-organized-subjects";
import { usePeriods } from "@/hooks/use-periods";
import { useSubjects } from "@/hooks/use-subjects";
import { useYears } from "@/hooks/use-years";
import { useActiveYearStore } from "@/stores/active-year-store";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

export default function GradesPage() {
  const t = useTranslations("Dashboard.Pages.GradesPage"); // Initialize t
  const [selectedTab, setSelectedTab] = useState<string | null>(null);

  const { activeId } = useActiveYearStore();
  const { data: years } = useYears();
  const active = years?.find((year) => year.id === activeId);

  const {
    data: periods,
    isError: periodsIsError,
    isPending: periodsIsPending,
  } = usePeriods(activeId);

  // Fetch subjects organized by period
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

  useEffect(() => {
    if (!periods) return;

    const savedTab = localStorage.getItem("selectedTab");

    const savedTabExists = periods.find((period) => period.id === savedTab);

    if (savedTabExists) {
      setSelectedTab(savedTab);
    } else {
      const defaultTab =
        periods.find(
          (period) =>
            new Date(period.startAt) <= new Date() &&
            new Date(period.endAt) >= new Date()
        )?.id || "full-year";
      setSelectedTab(defaultTab);
    }
  }, [periods]);

  // Error State
  if (periodsIsError || organizedSubjectsIsError || subjectsIsError) {
    return <div>{ErrorStateCard()}</div>;
  }

  // Loading State
  if (
    periodsIsPending ||
    organizedSubjectsIsPending ||
    subjectsIsPending ||
    selectedTab === null
  ) {
    return <div>{GradesLoader(t)}</div>;
  }

  return (
    <main className="flex flex-col gap-4 md:gap-8 mx-auto max-w-[2000px]">
      <div className="flex gap-2 md:gap-16 justify-between items-center min-h-9">
        <h1 className="text-xl md:text-3xl font-bold">{t("gradesTitle")}</h1>

        <GradePageActions activeId={activeId} />
      </div>

      <Separator />

      {/* Statistiques */}
      <Tabs
        value={selectedTab}
        onValueChange={(value) => {
          //delete url anchor
          window.history.replaceState(null, "", window.location.pathname);
          setSelectedTab(value);
          localStorage.setItem("selectedTab", value);
        }}
      >
        <div className="hidden md:block">
          <ScrollArea>
            <div className="w-full relative h-12">
              <TabsList className="flex">
                {periods &&
                  periods.length > 0 &&
                  // Sort the periods by start date
                  periods
                    .sort(
                      (a, b) =>
                        new Date(a.startAt).getTime() -
                        new Date(b.startAt).getTime()
                    )
                    .map((period) => (
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
              //delete url anchor
              window.history.replaceState(null, "", window.location.pathname);
              setSelectedTab(value);
              localStorage.setItem("selectedTab", value);
            }}
          >
            <SelectDrawerTrigger className="w-full">
              {periods?.find((period) => period.id === selectedTab)?.name ||
                t("fullYear")}
            </SelectDrawerTrigger>
            <SelectDrawerContent title={t("selectPeriod")}>
              <SelectDrawerGroup>
                {periods?.map((period) => (
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

        {periods &&
          periods.length > 0 &&
          periods
            .sort(
              (a, b) =>
                new Date(a.startAt).getTime() - new Date(b.startAt).getTime()
            )
            .map((period) => (
              <TabsContent key={period.id} value={period.id}>
                <GradesTable
                  yearId={activeId}
                  subjects={
                    organizedSubjects?.find((p) => p.period.id === period.id)
                      ?.subjects || []
                  }
                  periodId={period.id}
                />
              </TabsContent>
            ))}
        <TabsContent value="full-year">
          <GradesTable
            yearId={activeId}
            subjects={subjects}
            periodId="full-year"
          />
        </TabsContent>
      </Tabs>
    </main>
  );
}
