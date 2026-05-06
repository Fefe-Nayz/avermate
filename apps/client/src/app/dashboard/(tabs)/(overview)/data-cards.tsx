import DataCard from "@/components/dashboard/data-card";
import GradeValue from "@/components/dashboard/grade-value";
import { Period } from "@/types/period";
import { Subject } from "@/types/subject";
import { Average } from "@/types/average";
import {
  average,
  averageOverTime,
  getBestGrade,
  getBestSubject,
  getSubjectAverageComparison,
  getWorstGrade,
  getWorstSubject,
  addGeneralAverageToSubjects,
  buildGeneralAverageSubject,
  calculateLongestStreak,
  getChildren,
  getFutureGradeProjections,
} from "@/utils/average";
import {
  AcademicCapIcon,
  ArrowTrendingDownIcon,
  ArrowTrendingUpIcon,
  ChartBarIcon,
  ClockIcon,
  FlagIcon,
  MinusIcon,
  PlusIcon,
  RectangleStackIcon,
} from "@heroicons/react/24/outline";
import { useMemo, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import {
  defaultDashboardCardLayout,
  useDashboardCardLayout,
} from "@/hooks/use-dashboard-card-layout";
import type { DashboardCardId } from "@/types/cards";
import type { DashboardCardTone } from "@/types/cards";
import { DashboardCardsCustomizer } from "@/components/dashboard/dashboard-cards-customizer";

export default function DataCards({
  yearDefaultOutOf,
  period,
  subjects,
  customAverages,
  periods,
  valueAnimationDelay = 0,
}: {
  yearDefaultOutOf: number;
  period: Period;
  subjects: Subject[];
  customAverages?: Average[];
  periods: Period[];
  valueAnimationDelay?: number;
}) {
  const t = useTranslations("Dashboard.Components.DataCards");
  const { data: dashboardCardLayout } = useDashboardCardLayout();

  const averages = useMemo(
    () => averageOverTime(subjects, undefined, period, periods),
    [subjects, period, periods]
  );

  const growth = useMemo(() => {
    if (!averages || averages.length === 0) return 0;
    const lastValue = [...averages]
      .reverse()
      .find((value) => value !== null);
    const firstValue = averages.find((value) => value !== null);
    if (firstValue === undefined || firstValue === null || lastValue === undefined || lastValue === null || firstValue === 0) return 0;
    const growth = ((lastValue - firstValue) / firstValue) * 100;
    return growth;
  }, [averages]);

  const {
    bestSubject,
    bestSubjectAverage,
    bestSubjectAverageComparaison,
    worstSubject,
    worstSubjectAverage,
    worstSubjectAverageComparaison,
    bestGrade,
    worstGrade,
  } = useMemo(() => {
    const bestSubject = getBestSubject(subjects, true);
    const bestSubjectAverage = bestSubject
      ? average(bestSubject.id, subjects)
      : null;
    const bestSubjectAverageComparaison = bestSubject
      ? getSubjectAverageComparison(subjects, bestSubject.id, true)
      : null;

    const worstSubject = getWorstSubject(subjects, true);
    const worstSubjectAverage = worstSubject
      ? average(worstSubject.id, subjects)
      : null;
    const worstSubjectAverageComparaison = worstSubject
      ? getSubjectAverageComparison(subjects, worstSubject.id, true)
      : null;

    const bestGrade = getBestGrade(subjects);
    const worstGrade = getWorstGrade(subjects);

    return {
      bestSubject,
      bestSubjectAverage,
      bestSubjectAverageComparaison,
      worstSubject,
      worstSubjectAverage,
      worstSubjectAverageComparaison,
      bestGrade,
      worstGrade,
    };
  }, [subjects]);

  const mainCustomAverages = customAverages?.filter((ca) => ca.isMainAverage);
  const allGrades = useMemo(
    () =>
      subjects.flatMap((subject) =>
        subject.grades.map((grade) => ({
          ...grade,
          subject,
        }))
      ),
    [subjects]
  );
  const latestGrade = useMemo(
    () =>
      [...allGrades].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )[0] ?? null,
    [allGrades]
  );
  const activeSubjectsCount = useMemo(
    () => subjects.filter((subject) => subject.grades.length > 0).length,
    [subjects]
  );
  const layout = dashboardCardLayout ?? defaultDashboardCardLayout;
  const layoutById = new Map(layout.map((card) => [card.id, card]));
  const getScopedSubjectIds = (subjectId?: string) => {
    if (!subjectId || subjectId === "global") {
      return null;
    }

    return new Set([subjectId, ...getChildren(subjects, subjectId)]);
  };
  const getScopedGrades = (subjectId?: string) => {
    const scopedSubjectIds = getScopedSubjectIds(subjectId);
    return scopedSubjectIds
      ? allGrades.filter((grade) => scopedSubjectIds.has(grade.subjectId))
      : allGrades;
  };
  const getNormalizedGradeValues = (subjectId?: string) =>
    getScopedGrades(subjectId)
      .map((grade) => (grade.outOf > 0 ? (grade.value / grade.outOf) * 20 : null))
      .filter((value): value is number => value !== null);
  const getMedianValue = (subjectId?: string) => {
    const values = getNormalizedGradeValues(subjectId).sort((a, b) => a - b);
    if (values.length === 0) {
      return null;
    }

    const middle = Math.floor(values.length / 2);
    return values.length % 2 === 0
      ? (values[middle - 1] + values[middle]) / 2
      : values[middle];
  };
  const getStandardDeviationValue = (subjectId?: string) => {
    const values = getNormalizedGradeValues(subjectId);
    if (values.length === 0) {
      return null;
    }

    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance =
      values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
      values.length;
    return Math.sqrt(variance);
  };
  const getDecimalPlaces = (id: DashboardCardId) => {
    const value = layoutById.get(id)?.config.decimalPlaces;
    return typeof value === "number" && Number.isFinite(value)
      ? Math.min(Math.max(value, 0), 3)
      : 2;
  };
  const formatMetric = (value: number | null, id: DashboardCardId) =>
    value === null ? "-" : value.toFixed(getDecimalPlaces(id));
  const getScopedSubjectName = (subjectId?: string) =>
    !subjectId || subjectId === "global"
      ? "Toutes les matières"
      : subjects.find((subject) => subject.id === subjectId)?.name ??
        "Matière inconnue";
  const getAverageEvolution = (subjectId?: string) => {
    const subjectIdForAverage =
      !subjectId || subjectId === "global" ? undefined : subjectId;
    const series = averageOverTime(subjects, subjectIdForAverage, period, periods);
    const lastValue = [...series].reverse().find((value) => value !== null);
    const firstValue = series.find((value) => value !== null);

    if (
      firstValue === undefined ||
      firstValue === null ||
      lastValue === undefined ||
      lastValue === null ||
      firstValue === 0
    ) {
      return null;
    }

    return ((lastValue - firstValue) / firstValue) * 100;
  };
  const getProjectionValue = (subjectId?: string, steps = 1) => {
    const projectionSubject: Subject = {
      ...buildGeneralAverageSubject(),
      id: "__dashboard_projection__",
      grades: getScopedGrades(subjectId),
    };
    const projections = getFutureGradeProjections(
      [projectionSubject],
      Math.min(Math.max(steps, 1), 10)
    ).get(projectionSubject.id);

    return projections?.at(-1) ?? null;
  };

  if (
    average(undefined, subjects) === null &&
    bestGrade === null &&
    bestSubjectAverage === null &&
    worstGrade === null &&
    worstSubjectAverage === null
  ) {
    return null;
  }

  function get4xlColsClass(colCount: number) {
    switch (colCount) {
      case 5:
        return "4xl:grid-cols-5";
      case 6:
        return "4xl:grid-cols-6";
      default:
        return "4xl:grid-cols-5";
    }
  }

  const enabledLayout = layout.filter((card) => card.enabled);
  const mainCustomMax = layoutById.get("main-custom-averages")?.config.maxItems;
  const visibleMainCustomAverages = mainCustomMax
    ? mainCustomAverages?.slice(0, mainCustomMax)
    : mainCustomAverages;
  const columns = enabledLayout.length >= 6 ? 6 : 5;

  const getCardTitle = (id: DashboardCardId, fallback: string) => {
    const title = layoutById.get(id)?.config.title?.trim();
    return title || fallback;
  };

  const toneClassNames: Record<DashboardCardTone, string> = {
    default: "",
    blue: "border-blue-200 bg-blue-50/50 dark:border-blue-950 dark:bg-blue-950/20",
    green:
      "border-emerald-200 bg-emerald-50/50 dark:border-emerald-950 dark:bg-emerald-950/20",
    amber:
      "border-amber-200 bg-amber-50/50 dark:border-amber-950 dark:bg-amber-950/20",
    rose: "border-rose-200 bg-rose-50/50 dark:border-rose-950 dark:bg-rose-950/20",
  };

  const getCardClassName = (id: DashboardCardId) => {
    const card = layoutById.get(id);
    return cn(
      card?.config.compact ? "p-4" : undefined,
      toneClassNames[card?.config.tone ?? "default"]
    );
  };

  const renderCustomAverageCard = (
    ca: Average,
    key = ca.id,
    classSource: DashboardCardId = "main-custom-averages"
  ) => {
    const subjectsToGive = () => {
      const customAverageId = ca.id;
      const customAverage = customAverageId
        ? customAverages?.find((ca) => ca.id === customAverageId)
        : undefined;

      return addGeneralAverageToSubjects(subjects, customAverage);
    };
    const subjectVirtual = () => {
      return (
        subjectsToGive().find((s) => s.id === ca.id) ||
        buildGeneralAverageSubject()
      );
    };
    const customVal = average(subjectVirtual()?.id, subjectsToGive());
    if (customVal === null) {
      return null;
    }
    const globalVal = average(undefined, subjects) ?? null;
    let comparisonType: "higher" | "lower" | "same" = "same";
    let comparisonValue = 0;

    if (globalVal !== null && globalVal !== 0) {
      const diff = ((customVal - globalVal) / globalVal) * 100;
      if (diff > 0) {
        comparisonType = "higher";
        comparisonValue = +diff.toFixed(2);
      } else if (diff < 0) {
        comparisonType = "lower";
        comparisonValue = Math.abs(+diff.toFixed(2));
      }
    }

    let descriptionText = t("noComparison");
    if (comparisonType === "higher") {
      descriptionText = `+${comparisonValue}% ${t(
        "comparedToGeneralAverage"
      )}`;
    } else if (comparisonType === "lower") {
      descriptionText = `-${comparisonValue}% ${t(
        "comparedToGeneralAverage"
      )}`;
    }

    return (
      <DataCard
        key={key}
        title={ca.name}
        icon={AcademicCapIcon}
        description={descriptionText}
        className={getCardClassName(classSource)}
      >
        <GradeValue
          value={customVal * 100}
          outOf={yearDefaultOutOf}
          isAverage={true}
          size="xl"
          delay={valueAnimationDelay}
        />
      </DataCard>
    );
  };

  const mainCustomAverageCards = visibleMainCustomAverages?.map((ca) =>
    renderCustomAverageCard(ca)
  );

  const selectedCustomAverage = customAverages?.find(
    (ca) =>
      ca.id === layoutById.get("selected-custom-average")?.config.customAverageId
  );
  const generalAverage = average(undefined, subjects);
  const targetAverage =
    layoutById.get("target-average")?.config.targetAverage ?? 16;
  const targetDifference =
    generalAverage === null ? null : generalAverage - targetAverage;

  const cardsById: Record<DashboardCardId, ReactNode> = {
    "general-average": (
      <DataCard
        title={getCardTitle("general-average", t("generalAverage"))}
        icon={AcademicCapIcon}
        className={getCardClassName("general-average")}
        description={
          growth > 0
            ? `+${growth.toFixed(2)}% ${t("sinceStart")}`
            : growth < 0
              ? `${growth.toFixed(2)}% ${t("sinceStart")}`
              : t("noChangeSinceStart")
        }
      >
        {average(undefined, subjects) !== null ? (
          <GradeValue
            value={(average(undefined, subjects) || 0) * 100}
            outOf={yearDefaultOutOf}
            size="xl"
            delay={valueAnimationDelay}
            isAverage={true}
          />
        ) : null}
      </DataCard>
    ),
    "main-custom-averages": <>{mainCustomAverageCards}</>,
    "selected-custom-average": selectedCustomAverage ? (
      renderCustomAverageCard(
        selectedCustomAverage,
        "selected-custom-average",
        "selected-custom-average"
      )
    ) : (
      <DataCard
        title={getCardTitle("selected-custom-average", "Moyenne personnalisée")}
        icon={AcademicCapIcon}
        className={getCardClassName("selected-custom-average")}
        description="Choisissez une moyenne dans la personnalisation."
      >
        <p className="text-xl font-bold text-muted-foreground">-</p>
      </DataCard>
    ),
    "target-average": (
      <DataCard
        title={getCardTitle("target-average", "Objectif de moyenne")}
        icon={FlagIcon}
        className={getCardClassName("target-average")}
        description={
          targetDifference === null
            ? `Objectif ${targetAverage}/20`
            : targetDifference >= 0
              ? `+${targetDifference.toFixed(2)} point(s) au-dessus de l'objectif`
              : `${targetDifference.toFixed(2)} point(s) sous l'objectif`
        }
      >
        {generalAverage !== null ? (
          <GradeValue
            value={generalAverage * 100}
            outOf={yearDefaultOutOf}
            isAverage={true}
            size="xl"
            delay={valueAnimationDelay}
          />
        ) : (
          <p className="text-xl font-bold text-muted-foreground">-</p>
        )}
      </DataCard>
    ),
    "average-evolution": (
      <DataCard
        title={getCardTitle("average-evolution", "Évolution")}
        icon={ChartBarIcon}
        className={getCardClassName("average-evolution")}
        description={t("sinceStart")}
      >
        <p
          className={cn(
            "text-xl font-bold md:text-3xl",
            growth > 0
              ? "text-emerald-600"
              : growth < 0
                ? "text-destructive"
                : "text-muted-foreground"
          )}
        >
          {growth > 0 ? "+" : ""}
          {growth.toFixed(2)}%
        </p>
      </DataCard>
    ),
    "best-grade": (
      <DataCard
        title={getCardTitle("best-grade", t("bestGrade"))}
        icon={PlusIcon}
        className={getCardClassName("best-grade")}
        description={
          bestGrade !== null
            ? layoutById.get("best-grade")?.config.showSubjectName === false
              ? bestGrade?.name
              : t("bestGradeWithSubject", {
                subjectName: bestGrade?.subject?.name,
                gradeName: bestGrade?.name,
              })
            : t("noBestGrade")
        }
      >
        {bestGrade && (
          <GradeValue
            value={bestGrade.grade}
            outOf={bestGrade.outOf}
            size="xl"
            delay={valueAnimationDelay}
          />
        )}
      </DataCard>
    ),
    "latest-grade": (
      <DataCard
        title={getCardTitle("latest-grade", "Dernière note")}
        icon={ClockIcon}
        className={getCardClassName("latest-grade")}
        description={
          latestGrade
            ? layoutById.get("latest-grade")?.config.showSubjectName === false
              ? latestGrade.name
              : `${latestGrade.name} - ${latestGrade.subject.name}`
            : "Aucune note récente"
        }
      >
        {latestGrade ? (
          <GradeValue
            value={latestGrade.value}
            outOf={latestGrade.outOf}
            size="xl"
            delay={valueAnimationDelay}
          />
        ) : (
          <p className="text-xl font-bold text-muted-foreground">-</p>
        )}
      </DataCard>
    ),
    "grades-count": (
      <DataCard
        title={getCardTitle("grades-count", "Nombre de notes")}
        icon={RectangleStackIcon}
        className={getCardClassName("grades-count")}
        description="Notes prises en compte dans cette vue."
      >
        <p className="text-xl font-bold md:text-3xl">{allGrades.length}</p>
      </DataCard>
    ),
    "subjects-count": (
      <DataCard
        title={getCardTitle("subjects-count", "Matières actives")}
        icon={AcademicCapIcon}
        className={getCardClassName("subjects-count")}
        description="Matières qui contiennent au moins une note."
      >
        <p className="text-xl font-bold md:text-3xl">{activeSubjectsCount}</p>
      </DataCard>
    ),
    "best-subject": (
      <DataCard
        title={getCardTitle("best-subject", t("bestSubject"))}
        icon={ArrowTrendingUpIcon}
        className={getCardClassName("best-subject")}
        description={
          bestSubjectAverage !== null &&
            bestSubjectAverageComparaison?.percentageChange
            ? t("bestSubjectWithComparison", {
              subjectName: bestSubject?.name || "",
              percentage:
                bestSubjectAverageComparaison.percentageChange.toFixed(2),
            })
            : t("noBestSubject")
        }
      >
        {bestSubjectAverage !== null && (
          <GradeValue
            value={bestSubjectAverage * 100}
            outOf={yearDefaultOutOf}
            isAverage={true}
            size="xl"
            delay={valueAnimationDelay}
          />
        )}
      </DataCard>
    ),
    "worst-grade": (
      <DataCard
        title={getCardTitle("worst-grade", t("worstGrade"))}
        icon={MinusIcon}
        className={getCardClassName("worst-grade")}
        description={
          worstGrade !== null
            ? layoutById.get("worst-grade")?.config.showSubjectName === false
              ? worstGrade?.name
              : t("worstGradeWithSubject", {
                subjectName: worstGrade?.subject?.name,
                gradeName: worstGrade?.name,
              })
            : t("noWorstGrade")
        }
      >
        {worstGrade && (
          <GradeValue
            value={worstGrade.grade}
            outOf={worstGrade.outOf}
            size="xl"
            delay={valueAnimationDelay}
          />
        )}
      </DataCard>
    ),
    "worst-subject": (
      <DataCard
        title={getCardTitle("worst-subject", t("worstSubject"))}
        icon={ArrowTrendingDownIcon}
        className={getCardClassName("worst-subject")}
        description={
          worstSubjectAverage !== null &&
            worstSubjectAverageComparaison?.percentageChange
            ? t("worstSubjectWithComparison", {
              subjectName: worstSubject?.name || "",
              percentage:
                worstSubjectAverageComparaison.percentageChange.toFixed(2),
            })
            : t("noWorstSubject")
        }
      >
        {worstSubjectAverage !== null && (
          <GradeValue
            value={worstSubjectAverage * 100}
            outOf={yearDefaultOutOf}
            isAverage={true}
            size="xl"
            delay={valueAnimationDelay}
          />
        )}
      </DataCard>
    ),
    "subject-average": (() => {
      const card = layoutById.get("subject-average");
      const subjectId = card?.config.subjectId;
      const value =
        subjectId && subjectId !== "global" ? average(subjectId, subjects) : null;

      return (
        <DataCard
          title={getCardTitle("subject-average", "Moyenne matière")}
          icon={AcademicCapIcon}
          className={getCardClassName("subject-average")}
          description={
            subjectId && subjectId !== "global"
              ? getScopedSubjectName(subjectId)
              : "Choisissez une matière dans la personnalisation."
          }
        >
          {value !== null ? (
            <GradeValue
              value={value * 100}
              outOf={yearDefaultOutOf}
              isAverage={true}
              size="xl"
              delay={valueAnimationDelay}
            />
          ) : (
            <p className="text-xl font-bold text-muted-foreground">-</p>
          )}
        </DataCard>
      );
    })(),
    "median-grade": (() => {
      const subjectId = layoutById.get("median-grade")?.config.subjectId;
      const value = getMedianValue(subjectId);

      return (
        <DataCard
          title={getCardTitle("median-grade", "Médiane")}
          icon={RectangleStackIcon}
          className={getCardClassName("median-grade")}
          description={getScopedSubjectName(subjectId)}
        >
          <p className="text-xl font-bold md:text-3xl">
            {formatMetric(value, "median-grade")}
            {value !== null ? (
              <span className="text-sm text-muted-foreground align-sub">/20</span>
            ) : null}
          </p>
        </DataCard>
      );
    })(),
    "grade-standard-deviation": (() => {
      const subjectId = layoutById.get("grade-standard-deviation")?.config.subjectId;
      const value = getStandardDeviationValue(subjectId);

      return (
        <DataCard
          title={getCardTitle("grade-standard-deviation", "Écart-type")}
          icon={ChartBarIcon}
          className={getCardClassName("grade-standard-deviation")}
          description={`Dispersion - ${getScopedSubjectName(subjectId)}`}
        >
          <p className="text-xl font-bold md:text-3xl">
            {formatMetric(value, "grade-standard-deviation")}
          </p>
        </DataCard>
      );
    })(),
    "average-trend": (() => {
      const subjectId = layoutById.get("average-trend")?.config.subjectId;
      const value = getAverageEvolution(subjectId);

      return (
        <DataCard
          title={getCardTitle("average-trend", "Tendance")}
          icon={value !== null && value < 0 ? ArrowTrendingDownIcon : ArrowTrendingUpIcon}
          className={getCardClassName("average-trend")}
          description={`${getScopedSubjectName(subjectId)} depuis le début`}
        >
          <p
            className={cn(
              "text-xl font-bold md:text-3xl",
              value !== null && value > 0
                ? "text-emerald-600"
                : value !== null && value < 0
                  ? "text-destructive"
                  : "text-muted-foreground"
            )}
          >
            {value !== null && value > 0 ? "+" : ""}
            {value === null ? "-" : `${formatMetric(value, "average-trend")}%`}
          </p>
        </DataCard>
      );
    })(),
    "progression-streak": (() => {
      const subjectId = layoutById.get("progression-streak")?.config.subjectId;
      const scopedSubjectIds = getScopedSubjectIds(subjectId);
      const scopedSubjects = scopedSubjectIds
        ? subjects.filter((subject) => scopedSubjectIds.has(subject.id))
        : subjects;
      const value = calculateLongestStreak(scopedSubjects);

      return (
        <DataCard
          title={getCardTitle("progression-streak", "Streak de progression")}
          icon={ArrowTrendingUpIcon}
          className={getCardClassName("progression-streak")}
          description={`Plus longue série - ${getScopedSubjectName(subjectId)}`}
        >
          <p className="text-xl font-bold md:text-3xl">{value}</p>
        </DataCard>
      );
    })(),
    "future-projection": (() => {
      const card = layoutById.get("future-projection");
      const subjectId = card?.config.subjectId;
      const steps = card?.config.projectionSteps ?? 1;
      const value = getProjectionValue(subjectId, steps);

      return (
        <DataCard
          title={getCardTitle("future-projection", "Projection")}
          icon={FlagIcon}
          className={getCardClassName("future-projection")}
          description={`${getScopedSubjectName(subjectId)} après ${steps} note(s)`}
        >
          {value !== null ? (
            <GradeValue
              value={value * 100}
              outOf={yearDefaultOutOf}
              isAverage={true}
              size="xl"
              delay={valueAnimationDelay}
            />
          ) : (
            <p className="text-xl font-bold text-muted-foreground">-</p>
          )}
        </DataCard>
      );
    })(),
    "threshold-count": (() => {
      const card = layoutById.get("threshold-count");
      const subjectId = card?.config.subjectId;
      const threshold = card?.config.threshold ?? 15;
      const comparator = card?.config.comparator ?? "above";
      const value = getNormalizedGradeValues(subjectId).filter((grade) =>
        comparator === "below" ? grade < threshold : grade > threshold
      ).length;

      return (
        <DataCard
          title={getCardTitle("threshold-count", "Notes au seuil")}
          icon={FlagIcon}
          className={getCardClassName("threshold-count")}
          description={`${comparator === "below" ? "Sous" : "Au-dessus de"} ${threshold}/20 - ${getScopedSubjectName(subjectId)}`}
        >
          <p className="text-xl font-bold md:text-3xl">{value}</p>
        </DataCard>
      );
    })(),
  };

  return (
    <div className="space-y-3 pb-4">
      <div className="flex justify-end">
        <DashboardCardsCustomizer
          layout={layout}
          customAverages={customAverages}
          subjects={subjects}
        />
      </div>
      <div
        className={cn(
          "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 md:gap-4",
          get4xlColsClass(columns)
        )}
      >
        {enabledLayout.map((card) => (
          <div key={card.id} className="contents">
            {cardsById[card.id]}
          </div>
        ))}
      </div>
    </div>
  );
}
