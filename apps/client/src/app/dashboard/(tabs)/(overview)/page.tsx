"use client";

import GlobalAverageChart from "@/components/charts/global-average-chart";
import RecentGradesCard from "@/components/dashboard/recent-grades/recent-grades";
import DashboardLoader from "@/components/skeleton/dashboard-loader";
import ErrorStateCard from "@/components/skeleton/error-card";
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
import { useCustomAverages } from "@/hooks/use-custom-averages";
import { usePeriods } from "@/hooks/use-periods";
import { useRecentGrades } from "@/hooks/use-recent-grades";
import { useSubjects } from "@/hooks/use-subjects";
import { authClient } from "@/lib/auth";
import { fullYearPeriod } from "@/utils/average";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import DataCards from "./data-cards";
import { useTranslations } from "next-intl"; // Import useTranslations
import { useOrganizedSubjects } from "@/hooks/use-organized-subjects";
import { useActiveYearStore } from "@/stores/active-year-store";
import { useYears } from "@/hooks/use-years";
import { useAccounts } from "@/hooks/use-accounts";

/**
 * Vue d'ensemble des notes
 */
export default function OverviewPage() {
  const t = useTranslations("Dashboard.Pages.OverviewPage"); // Initialize t
  const { data: session } = authClient.useSession();

  const router = useRouter();

  const { activeId } = useActiveYearStore();
  const { data: years } = useYears();
  const active = years?.find((year) => year.id === activeId);
  const yearDefaultOutOf = active?.defaultOutOf || 2000;

  // Fetch subjects lists with grades from API
  const {
    data: subjects,
    isError: isSubjectsError,
    isPending: isSubjectsPending,
  } = useSubjects(activeId);

  // Fetch periods from API
  const {
    data: periods,
    isError: isPeriodsError,
    isPending: isPeriodsPending,
  } = usePeriods(activeId);

  // fetch subjects but organized by period
  const {
    data: organizedSubjects,
    isError: isOrganizedSubjectsError,
    isPending: isOrganizedSubjectsPending,
  } = useOrganizedSubjects(activeId);

  const {
    data: recentGrades,
    isError: isRecentGradesError,
    isPending: isRecentGradesPending,
  } = useRecentGrades(activeId);

  const {
    data: accounts,
    isPending: isAccountsPending,
    isError: isAccountsError,
  } = useAccounts();

  const {
    data: customAverages,
    isError: isCustomAveragesError,
    isPending: isCustomAveragesPending,
  } = useCustomAverages(activeId);

  // Track user's manual tab selection
  const [userSelectedTab, setUserSelectedTab] = useState<string | null>(null);

  // Derive the selected tab value
  const getDefaultTab = () => {
    if (!periods) return "full-year";
    const savedTab = localStorage.getItem("selectedTab");
    if (savedTab && periods.some((p) => p.id === savedTab)) return savedTab;

    const currentPeriod = periods.find((p) => {
      const now = new Date();
      return new Date(p.startAt) <= now && new Date(p.endAt) >= now;
    });
    return currentPeriod?.id || "full-year";
  };

  const selectedTab = userSelectedTab ?? getDefaultTab();

  //todo implement a custom field
  useEffect(() => {
    const linkedProviders = new Set(accounts?.map((acc) => acc.providerId));

    if (
      session?.user?.createdAt &&
      new Date(session.user.createdAt).getTime() >
        Date.now() - 1000 * 60 * 10 &&
      (!subjects || subjects.length === 0) &&
      (linkedProviders.has("google") || linkedProviders.has("microsoft")) &&
      localStorage.getItem("isOnboardingCompleted") !== "true"
    ) {
      router.push("/onboarding");
    }
  }, [session?.user?.createdAt, subjects, accounts, router]);

  // Error State
  const isError =
    isSubjectsError ||
    isPeriodsError ||
    isOrganizedSubjectsError ||
    isRecentGradesError ||
    isAccountsError ||
    isCustomAveragesError;

  if (isError) {
    return (
      <div>
        <ErrorStateCard />
      </div>
    );
  }

  // Loading State
  const isLoading =
    isSubjectsPending ||
    isPeriodsPending ||
    isOrganizedSubjectsPending ||
    isRecentGradesPending ||
    isAccountsPending ||
    isCustomAveragesPending;

  if (isLoading) {
    return (
      <div>
        <DashboardLoader />
      </div>
    );
  }

  const sortedPeriods = periods
    ?.slice()
    .sort(
      (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()
    );

  return (
    <main className="flex flex-col gap-4 md:gap-8 mx-auto max-w-[2000px]">
      <div className="flex flex-wrap items-center justify-between min-h-9">
        <h1 className="md:text-3xl font-bold text-xl">{t("overviewTitle")}</h1>
        <h1 className="md:text-3xl font-normal text-lg">
          {t("greeting", {
            name: session?.user?.name ? session?.user?.name.split(" ")[0] : "",
          })}{" "}
          👋
        </h1>
      </div>

      <Separator />

      {/* Statistiques */}
      <Tabs
        defaultValue={
          // choose the period where we are currently in if it exists
          periods?.find(
            (period) =>
              new Date(period.startAt).getTime() <= new Date().getTime() &&
              new Date(period.endAt).getTime() >= new Date().getTime()
          )?.id || "full-year"
        }
        value={selectedTab}
        onValueChange={(value) => {
          setUserSelectedTab(value);
          localStorage.setItem("selectedTab", value);
        }}
      >
        <div className="flex flex-col gap-2 md:gap-4">
          <div className="hidden md:block">
            <ScrollArea>
              <div className="w-full relative h-12">
                <TabsList className="flex">
                  {periods?.map((period) => (
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
                setUserSelectedTab(value);
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
                      {t("periodName", { name: period.name })}
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
                  <DataCards
                    yearDefaultOutOf={yearDefaultOutOf}
                    period={period}
                    subjects={
                      organizedSubjects?.find((p) => p.period.id === period.id)
                        ?.subjects || []
                    }
                    customAverages={customAverages}
                    periods={periods}
                  />

                  <div className="grid grid-cols-1 lg:grid-cols-7 gap-4">
                    {/* Evolution de la moyenne générale */}
                    <GlobalAverageChart
                      yearId={activeId}
                      subjects={
                        organizedSubjects?.find(
                          (p) => p.period.id === period.id
                        )?.subjects || []
                      }
                      period={
                        organizedSubjects?.find(
                          (p) => p.period.id === period.id
                        )?.period || fullYearPeriod(subjects, active)
                      }
                      periods={periods}
                    />

                    {/* Dernières notes */}
                    {subjects.length > 0 &&
                      (() => {
                        const periodSubjects =
                          organizedSubjects?.find(
                            (p) => p.period.id === period.id
                          )?.subjects || [];
                        const hasGradesInPeriod = periodSubjects.some(
                          (subject) => subject.grades.length > 0
                        );
                        return hasGradesInPeriod;
                      })() && (
                        <RecentGradesCard
                          yearId={activeId}
                          recentGrades={recentGrades}
                          period={period}
                        />
                      )}
                  </div>
                </TabsContent>
              ))}
          <TabsContent value="full-year">
            <DataCards
              yearDefaultOutOf={yearDefaultOutOf}
              subjects={subjects || []}
              period={fullYearPeriod(subjects, active)}
              customAverages={customAverages}
              periods={periods}
            />

            <div className="grid grid-cols-1 lg:grid-cols-7 gap-4">
              <GlobalAverageChart
                yearId={activeId}
                subjects={subjects || []}
                period={fullYearPeriod(subjects, active)}
                periods={periods}
              />

              {subjects.length > 0 &&
                (() => {
                  const fullYearSubjects =
                    organizedSubjects?.find((p) => p.period.id === "full-year")
                      ?.subjects || [];
                  const hasGradesInFullYear = fullYearSubjects.some(
                    (subject) => subject.grades.length > 0
                  );
                  return hasGradesInFullYear;
                })() && (
                  <RecentGradesCard
                    yearId={activeId}
                    recentGrades={recentGrades}
                    period={fullYearPeriod(subjects, active)}
                  />
                )}
            </div>
          </TabsContent>
        </div>
      </Tabs>
    </main>
  );
}
