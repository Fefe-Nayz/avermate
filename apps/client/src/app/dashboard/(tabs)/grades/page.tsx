"use client";

import { AddGradeButton } from "@/components/buttons/dashboard/grade/add-grade-button";
import MobileAddButtons from "@/components/buttons/dashboard/mobile-add-buttons";
import AddPeriodDialog from "@/components/dialogs/add-period-dialog";
import AddSubjectDialog from "@/components/dialogs/add-subject-dialog";
import ErrorStateCard from "@/components/skeleton/error-card";
import GradesLoader from "@/components/skeleton/grades-loader";
import GradesTable from "@/components/tables/grades-table";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useOrganizedSubjects } from "@/hooks/use-organized-subjects";
import { usePeriods } from "@/hooks/use-periods";
import { useSubjects } from "@/hooks/use-subjects";
import { useYears } from "@/hooks/use-years";
import { useActiveYearStore } from "@/stores/active-year-store";
import { PlusCircleIcon } from "@heroicons/react/24/outline";
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

        <div className=" gap-4 hidden lg:flex">
          <AddGradeButton yearId={activeId} />

          <AddSubjectDialog yearId={activeId}>
            <Button variant="outline">
              <PlusCircleIcon className="size-4 mr-2" />
              {t("addSubject")}
            </Button>
          </AddSubjectDialog>

          <AddPeriodDialog yearId={activeId}>
            <Button variant="outline">
              <PlusCircleIcon className="size-4 mr-2" />
              {t("addPeriod")}
            </Button>
          </AddPeriodDialog>
        </div>

        <div className="flex gap-2 lg:hidden">
          <AddGradeButton yearId={activeId} />
          <MobileAddButtons yearId={activeId} />
        </div>
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
        <div className="hidden md:flex gap-4">
          <ScrollArea>
            <div className="w-full relative h-10">
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
          <Select
            value={selectedTab}
            onValueChange={(value) => {
              //delete url anchor
              window.history.replaceState(null, "", window.location.pathname);
              setSelectedTab(value);
              localStorage.setItem("selectedTab", value);
            }}
          >
            <SelectTrigger>
              <SelectValue>
                {periods?.find((period) => period.id === selectedTab)?.name ||
                  t("fullYear")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {periods?.map((period) => (
                <SelectItem key={period.id} value={period.id}>
                  {period.name}
                </SelectItem>
              ))}
              <SelectItem value="full-year">{t("fullYear")}</SelectItem>
            </SelectContent>
          </Select>
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
          <GradesTable yearId={activeId} subjects={subjects} periodId="full-year" />
        </TabsContent>
      </Tabs>
    </main>
  );
}
