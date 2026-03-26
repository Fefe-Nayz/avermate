"use client";

import { DifferenceBadge } from "@/app/dashboard/(details)/grades/[gradeId]/difference-badge";
import DataCards from "@/app/dashboard/(tabs)/(overview)/data-cards";
import Logo, { LogoSmall } from "@/components/logo";
import RecentGradesCard from "@/components/dashboard/recent-grades/recent-grades";
import { MockAverageChart } from "@/components/landing/bento/mock-average-chart";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Average } from "@/types/average";
import type { Grade } from "@/types/grade";
import type { Period } from "@/types/period";
import type { Subject } from "@/types/subject";
import { average } from "@/utils/average";
import { formatGradeValue } from "@/utils/format";
import {
  ArrowUpRight,
  CalendarRange,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { motion, useReducedMotion, type Variants } from "motion/react";
import { useMemo } from "react";
import { useTranslations } from "next-intl";

type PreviewDataset = {
  periods: Period[];
  activePeriod: Period;
  customAverages: Average[];
  recentGrades: Grade[];
  standoutAverages: Array<{ id: string; name: string; average: number }>;
  subjects: Subject[];
  yearLabel: string;
};

const SPRING_EASE = [0.16, 1, 0.3, 1] as const;
const HERO_SHELL_DELAY = 3.05;
const HERO_SHELL_DURATION = 0.82;
const HERO_SECTION_START_DELAY = HERO_SHELL_DELAY + 0.1;
const HERO_WAVE_STEP = 0.14;
const HERO_DROP_DURATION = 0.76;
const HERO_DATA_CARDS_DELAY = HERO_SECTION_START_DELAY + HERO_WAVE_STEP * 2;
const HERO_RECENT_GRADES_DELAY = HERO_SECTION_START_DELAY + HERO_WAVE_STEP * 4;
const HERO_OVERLAY_DELAY = HERO_SECTION_START_DELAY + HERO_WAVE_STEP * 5;
const HERO_FLOAT_START_DELAY = HERO_OVERLAY_DELAY + 0.18;

function addDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function addMonths(date: Date, months: number) {
  const nextDate = new Date(date);
  nextDate.setMonth(nextDate.getMonth() + months);
  return nextDate;
}

function toIso(date: Date) {
  return date.toISOString();
}

function schoolYearBase(referenceDate: Date) {
  const startYear =
    referenceDate.getMonth() >= 7
      ? referenceDate.getFullYear()
      : referenceDate.getFullYear() - 1;

  return {
    startYear,
    endYear: startYear + 1,
    startDate: new Date(startYear, 8, 1, 0, 0, 0, 0),
  };
}

export function LandingDashboardPreview() {
  const reduceMotion = useReducedMotion();
  const overviewT = useTranslations("Dashboard.Pages.OverviewPage");
  const dataT = useTranslations("Landing.Product.Mocks.Data");
  const gradesT = useTranslations("Landing.Product.Mocks.Grades");

  const previewData = useMemo<PreviewDataset>(() => {
    const now = new Date();
    const { startYear, endYear, startDate } = schoolYearBase(now);
    const yearId = "landing-preview-year";
    const userId = "landing-preview-user";
    const yearLabel = `${startYear}-${endYear}`;

    const periods: Period[] = [
      {
        id: "term-1",
        name: overviewT("periodName", { name: "1" }),
        startAt: toIso(startDate),
        endAt: toIso(new Date(startYear, 10, 30, 0, 0, 0, 0)),
        createdAt: toIso(addDays(startDate, 1)),
        userId,
        isCumulative: false,
        yearId,
      },
      {
        id: "term-2",
        name: overviewT("periodName", { name: "2" }),
        startAt: toIso(new Date(startYear, 11, 1, 0, 0, 0, 0)),
        endAt: toIso(new Date(endYear, 1, 28, 0, 0, 0, 0)),
        createdAt: toIso(addMonths(startDate, 3)),
        userId,
        isCumulative: true,
        yearId,
      },
      {
        id: "term-3",
        name: overviewT("periodName", { name: "3" }),
        startAt: toIso(new Date(endYear, 2, 1, 0, 0, 0, 0)),
        endAt: toIso(new Date(endYear, 5, 30, 0, 0, 0, 0)),
        createdAt: toIso(addMonths(startDate, 6)),
        userId,
        isCumulative: true,
        yearId,
      },
    ];

    const activePeriod =
      periods.find((period) => {
        const periodStart = new Date(period.startAt).getTime();
        const periodEnd = new Date(period.endAt).getTime();
        const currentTime = now.getTime();
        return currentTime >= periodStart && currentTime <= periodEnd;
      }) || periods[periods.length - 1];

    const subjectDefinitions = [
      { id: "mathematics", name: dataT("mathematics") },
      { id: "physics-chemistry", name: dataT("physicsChemistry") },
      { id: "computer-science", name: dataT("computerScience") },
      { id: "french", name: dataT("french") },
      { id: "english", name: dataT("english") },
    ];

    const subjectLookup = new Map(
      subjectDefinitions.map((subject) => [subject.id, subject])
    );

    const createRecentDate = (daysAgo: number) =>
      new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, 0, 0, 0, 0);

    const rawGrades = [
      {
        id: "grade-math-1",
        subjectId: "mathematics",
        name: "Weekly quiz",
        value: 1380,
        coefficient: 100,
        periodId: "term-1",
        passedAt: addDays(startDate, 18),
      },
      {
        id: "grade-math-2",
        subjectId: "mathematics",
        name: "Challenge set",
        value: 1490,
        coefficient: 150,
        periodId: "term-2",
        passedAt: addDays(startDate, 104),
      },
      {
        id: "grade-math-3",
        subjectId: "mathematics",
        name: "Problem-solving exam",
        value: 1710,
        coefficient: 200,
        periodId: "term-3",
        passedAt: createRecentDate(10),
      },
      {
        id: "grade-math-4",
        subjectId: "mathematics",
        name: "Oral defense",
        value: 1840,
        coefficient: 150,
        periodId: "term-3",
        passedAt: createRecentDate(2),
      },
      {
        id: "grade-physics-1",
        subjectId: "physics-chemistry",
        name: "Lab report",
        value: 1440,
        coefficient: 100,
        periodId: "term-1",
        passedAt: addDays(startDate, 33),
      },
      {
        id: "grade-physics-2",
        subjectId: "physics-chemistry",
        name: "Mechanics assessment",
        value: 1560,
        coefficient: 150,
        periodId: "term-2",
        passedAt: addDays(startDate, 118),
      },
      {
        id: "grade-physics-3",
        subjectId: "physics-chemistry",
        name: "Chemistry project",
        value: 1630,
        coefficient: 150,
        periodId: "term-3",
        passedAt: createRecentDate(14),
      },
      {
        id: "grade-physics-4",
        subjectId: "physics-chemistry",
        name: "Simulation test",
        value: 1720,
        coefficient: 100,
        periodId: "term-3",
        passedAt: createRecentDate(5),
      },
      {
        id: "grade-cs-1",
        subjectId: "computer-science",
        name: "Prototype review",
        value: 1520,
        coefficient: 100,
        periodId: "term-1",
        passedAt: addDays(startDate, 28),
      },
      {
        id: "grade-cs-2",
        subjectId: "computer-science",
        name: "Logic sprint",
        value: 1660,
        coefficient: 150,
        periodId: "term-2",
        passedAt: addDays(startDate, 112),
      },
      {
        id: "grade-cs-3",
        subjectId: "computer-science",
        name: "Build milestone",
        value: 1780,
        coefficient: 150,
        periodId: "term-3",
        passedAt: createRecentDate(8),
      },
      {
        id: "grade-cs-4",
        subjectId: "computer-science",
        name: "Launch review",
        value: 1910,
        coefficient: 200,
        periodId: "term-3",
        passedAt: createRecentDate(1),
      },
      {
        id: "grade-french-1",
        subjectId: "french",
        name: "Essay draft",
        value: 1290,
        coefficient: 100,
        periodId: "term-1",
        passedAt: addDays(startDate, 24),
      },
      {
        id: "grade-french-2",
        subjectId: "french",
        name: "Presentation",
        value: 1420,
        coefficient: 100,
        periodId: "term-2",
        passedAt: addDays(startDate, 95),
      },
      {
        id: "grade-french-3",
        subjectId: "french",
        name: "Analysis paper",
        value: 1510,
        coefficient: 150,
        periodId: "term-3",
        passedAt: createRecentDate(11),
      },
      {
        id: "grade-french-4",
        subjectId: "french",
        name: "Final commentary",
        value: 1580,
        coefficient: 100,
        periodId: "term-3",
        passedAt: createRecentDate(4),
      },
      {
        id: "grade-english-1",
        subjectId: "english",
        name: "Listening test",
        value: 1410,
        coefficient: 100,
        periodId: "term-1",
        passedAt: addDays(startDate, 21),
      },
      {
        id: "grade-english-2",
        subjectId: "english",
        name: "Workshop",
        value: 1480,
        coefficient: 100,
        periodId: "term-2",
        passedAt: addDays(startDate, 88),
      },
      {
        id: "grade-english-3",
        subjectId: "english",
        name: "Speaking exam",
        value: 1620,
        coefficient: 150,
        periodId: "term-3",
        passedAt: createRecentDate(7),
      },
      {
        id: "grade-english-4",
        subjectId: "english",
        name: "Project pitch",
        value: 1690,
        coefficient: 100,
        periodId: "term-3",
        passedAt: createRecentDate(3),
      },
    ];

    const subjects: Subject[] = subjectDefinitions.map((subject, index) => ({
      id: subject.id,
      name: subject.name,
      coefficient: 100,
      parentId: null,
      createdAt: addDays(startDate, index),
      userId,
      depth: 0,
      yearId,
      isMainSubject: true,
        isDisplaySubject: false,
      grades: rawGrades
        .filter((grade) => grade.subjectId === subject.id)
        .map((grade) => ({
          id: grade.id,
          name: grade.name,
          value: grade.value,
          outOf: 2000,
          coefficient: grade.coefficient,
          periodId: grade.periodId,
          passedAt: toIso(grade.passedAt),
          createdAt: toIso(grade.passedAt),
          subjectId: grade.subjectId,
          userId,
          yearId,
        })),
    }));

    const recentGrades: Grade[] = rawGrades
      .map((grade) => {
        const subject = subjectLookup.get(grade.subjectId);

        if (!subject) {
          throw new Error(`Unknown preview subject: ${grade.subjectId}`);
        }

        return {
          id: grade.id,
          name: grade.name,
          value: grade.value,
          outOf: 2000,
          coefficient: grade.coefficient,
          passedAt: toIso(grade.passedAt),
          createdAt: toIso(grade.passedAt),
          subjectId: grade.subjectId,
          userId,
          periodId: grade.periodId,
          yearId,
          subject: {
            id: subject.id,
            name: subject.name,
            isDisplaySubject: false,
            isMainSubject: true,
            yearId,
          },
        };
      })
      .sort(
        (left, right) =>
          new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
      );

    const customAverages: Average[] = [
      {
        id: "stem-preview",
        name: "STEM",
        subjects: [
          {
            id: "mathematics",
            customCoefficient: 200,
            includeChildren: false,
          },
          {
            id: "physics-chemistry",
            customCoefficient: 150,
            includeChildren: false,
          },
          {
            id: "computer-science",
            customCoefficient: 200,
            includeChildren: false,
          },
        ],
        isMainAverage: true,
        createdAt: startDate.getTime(),
        userId,
        yearId,
      },
    ];

    const standoutAverages = subjects
      .map((subject) => ({
        id: subject.id,
        name: subject.name,
        average: average(subject.id, subjects) ?? 0,
      }))
      .sort((left, right) => right.average - left.average)
      .slice(0, 3);

    return {
      periods,
      activePeriod,
      customAverages,
      recentGrades,
      standoutAverages,
      subjects,
      yearLabel,
    };
  }, [dataT, gradesT, overviewT]);

  const cascadeVariants: Variants = {
    hidden: {},
    visible: {},
  };

  const dropVariants: Variants = {
    hidden: reduceMotion
      ? { opacity: 0 }
      : {
          opacity: 0,
          y: -56,
          scale: 0.97,
          rotateX: -10,
          filter: "blur(8px)",
        },
    visible: (delay = HERO_SHELL_DELAY) => ({
      opacity: 1,
      y: 0,
      scale: 1,
      rotateX: 0,
      filter: "blur(0px)",
      transition: reduceMotion
        ? { duration: 0.25 }
        : {
            delay,
            duration:
              delay === HERO_SHELL_DELAY
                ? HERO_SHELL_DURATION
                : HERO_DROP_DURATION,
            ease: SPRING_EASE,
          },
    }),
  };

  const overlayVariants: Variants = {
    hidden: reduceMotion
      ? { opacity: 0 }
      : {
          opacity: 0,
          y: -18,
          scale: 0.95,
          rotate: 0.5,
        },
    visible: (delay = HERO_OVERLAY_DELAY) => ({
      opacity: 1,
      y: 0,
      scale: 1,
      rotate: 0,
      transition: reduceMotion
        ? { duration: 0.25 }
        : {
            delay,
            duration: 0.8,
            ease: SPRING_EASE,
          },
    }),
  };

  const floatingTransition = reduceMotion
    ? undefined
    : {
        duration: 6.8,
        ease: "easeInOut" as const,
        repeat: Infinity,
        delay: HERO_FLOAT_START_DELAY,
      };

  return (
    <div className="relative mx-auto w-full" aria-hidden="true">
      <div className="absolute inset-x-[10%] top-[14%] h-[58%] rounded-full bg-primary/10 blur-[120px]" />
      <div className="absolute -left-[6%] bottom-[10%] h-56 w-56 rounded-full bg-primary/8 blur-[110px]" />
      <div className="absolute -right-[5%] top-[8%] h-64 w-64 rounded-full bg-primary/10 blur-[130px]" />

      <motion.div
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.2 }}
        variants={cascadeVariants}
        className="relative overflow-visible"
        style={{ perspective: "2400px" }}
      >
        <div inert={true} className="pointer-events-none select-none overflow-visible">
          <motion.div
            variants={dropVariants}
            custom={HERO_SHELL_DELAY}
            className="overflow-hidden rounded-[22px] border border-border/70 bg-background/88 shadow-[0_40px_120px_-42px_rgba(15,23,42,0.65)] backdrop-blur-2xl"
          >
            <div className="border-b border-border/70 bg-background/80 px-6 py-5">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="rounded-xl border border-border/70 bg-background/90 p-2 shadow-sm">
                    <LogoSmall className="size-7" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">
                      {previewData.yearLabel}
                    </p>
                    <div className="flex items-center gap-3">
                      <p className="text-lg font-semibold tracking-tight text-foreground">
                        Avermate
                      </p>
                      <Badge variant="secondary" className="gap-1.5 rounded-full">
                        <CalendarRange className="size-3.5" />
                        {previewData.activePeriod.name}
                      </Badge>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Badge variant="outline" className="rounded-full px-3 py-1">
                    {previewData.yearLabel}
                  </Badge>
                  <Avatar className="size-9 border border-border/70">
                    <AvatarFallback className="bg-primary/10 text-sm font-semibold text-foreground">
                      AV
                    </AvatarFallback>
                  </Avatar>
                </div>
              </div>
            </div>

            <motion.div
              variants={dropVariants}
              custom={HERO_SECTION_START_DELAY}
              className="px-6 pt-6"
            >
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 className="text-[28px] font-semibold tracking-tight text-foreground">
                    {overviewT("overviewTitle")}
                  </h3>
                  <p className="pt-1 text-sm text-muted-foreground">
                    {overviewT("greeting", { name: "Ava" })} 👋
                  </p>
                </div>

                <div className="hidden items-center gap-2 text-sm text-muted-foreground lg:flex">
                  <TrendingUp className="size-4" />
                  <span>{formatGradeValue(1710)}</span>
                  <ArrowUpRight className="size-4 text-primary" />
                </div>
              </div>
            </motion.div>

            <motion.div
              variants={dropVariants}
              custom={HERO_SECTION_START_DELAY + HERO_WAVE_STEP}
              className="px-6 py-5"
            >
              <Separator />

              <Tabs
                value={previewData.activePeriod.id}
                className="pt-5"
              >
                <TabsList className="h-11 rounded-xl bg-muted/70 p-1">
                  {previewData.periods.map((period) => (
                    <TabsTrigger
                      key={period.id}
                      value={period.id}
                      className="rounded-lg px-4"
                    >
                      {period.name}
                    </TabsTrigger>
                  ))}
                  <TabsTrigger value="full-year" className="rounded-lg px-4">
                    {gradesT("fullYear")}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </motion.div>

            <motion.div
              variants={dropVariants}
              custom={HERO_DATA_CARDS_DELAY}
              className="px-6 pb-6"
            >
              <DataCards
                yearDefaultOutOf={2000}
                period={previewData.activePeriod}
                subjects={previewData.subjects}
                customAverages={previewData.customAverages}
                periods={previewData.periods}
                valueAnimationDelay={HERO_DATA_CARDS_DELAY + 0.25}
              />
            </motion.div>

            <div className="grid grid-cols-1 gap-4 px-6 pb-6 lg:grid-cols-7">
              <motion.div
                variants={dropVariants}
                custom={HERO_SECTION_START_DELAY + HERO_WAVE_STEP * 3}
                className="lg:col-span-5"
              >
                <MockAverageChart />
              </motion.div>

              <motion.div
                variants={dropVariants}
                custom={HERO_RECENT_GRADES_DELAY}
                className="lg:col-span-2"
              >
                <RecentGradesCard
                  yearId="landing-preview-year"
                  recentGrades={previewData.recentGrades}
                  period={previewData.activePeriod}
                  valueAnimationDelay={HERO_RECENT_GRADES_DELAY + 0.25}
                />
              </motion.div>
            </div>
          </motion.div>

          <motion.div
            variants={overlayVariants}
            custom={HERO_OVERLAY_DELAY}
            className="absolute -right-8 top-[15%] z-20 hidden w-[280px] overflow-visible xl:block"
            style={{ willChange: "transform, opacity" }}
          >
            <motion.div
              animate={reduceMotion ? undefined : { y: [0, -10, 0], rotate: [0, 0.6, 0] }}
              transition={floatingTransition}
              className="overflow-visible"
            >
              <Card className="overflow-visible border-border/70 bg-background/92 shadow-2xl backdrop-blur-xl">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-3">
                    <Badge variant="secondary" className="gap-1.5 rounded-full">
                      <Sparkles className="size-3.5" />
                      {previewData.activePeriod.name}
                    </Badge>
                    <Logo />
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <DifferenceBadge diff={0.842} delay={HERO_OVERLAY_DELAY + 0.25} />
                  <div className="flex flex-wrap gap-2">
                    {previewData.standoutAverages.map((subject) => (
                      <Badge
                        key={subject.id}
                        variant="outline"
                        className="rounded-full px-3 py-1"
                      >
                        {subject.name} {subject.average.toFixed(2)}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>

          <motion.div
            variants={overlayVariants}
            custom={HERO_OVERLAY_DELAY + HERO_WAVE_STEP}
            className="absolute -left-12 bottom-[10%] z-20 hidden w-[300px] overflow-visible 2xl:block"
            style={{ willChange: "transform, opacity" }}
          >
            <motion.div
              animate={
                reduceMotion
                  ? undefined
                  : {
                      y: [0, -14, 0],
                      rotate: [0, -0.8, 0],
                    }
              }
              transition={
                reduceMotion
                  ? undefined
                  : {
                      ...floatingTransition,
                      duration: 7.4,
                      delay: HERO_FLOAT_START_DELAY + 0.6,
                    }
              }
              className="overflow-visible"
            >
              <Card className="overflow-visible border-border/70 bg-background/92 shadow-2xl backdrop-blur-xl">
                <CardHeader className="pb-3">
                  <CardDescription className="flex items-center gap-2 text-[11px] uppercase tracking-[0.28em]">
                    <TrendingUp className="size-3.5" />
                    {previewData.yearLabel}
                  </CardDescription>
                  <CardTitle className="text-base">
                    {previewData.recentGrades[0]?.subject.name}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {previewData.recentGrades.slice(0, 3).map((grade) => (
                    <div
                      key={grade.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/70 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {grade.name}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {grade.subject.name}
                        </p>
                      </div>
                      <Badge variant="secondary" className="rounded-full px-2.5 py-1">
                        {formatGradeValue(grade.value)}
                      </Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}
