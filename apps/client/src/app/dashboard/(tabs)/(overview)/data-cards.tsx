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
} from "@/utils/average";
import {
  AcademicCapIcon,
  ArrowTrendingDownIcon,
  ArrowTrendingUpIcon,
  MinusIcon,
  PlusIcon,
} from "@heroicons/react/24/outline";
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

export default function DataCards({
  period,
  subjects,
  customAverages,
  periods,
}: {
  period: Period;
  subjects: Subject[];
  customAverages?: Average[];
  periods: Period[];
}) {
  const t = useTranslations("Dashboard.Components.DataCards");

  const averages = useMemo(() => {
    console.time("Calculating averages overtime");
    const averages = averageOverTime(subjects, undefined, period, periods);
    console.timeEnd("Calculating averages overtime");
    return averages;
  }, [subjects, period, periods]);

  const growth = useMemo(() => {
    if (!averages || averages.length === 0) return 0;
    const lastValue = averages[averages.length - 1];
    const firstValue = averages.find((value) => value !== null);
    if (!firstValue || !lastValue) return 0;
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

  const columns = 5 + (mainCustomAverages?.length ?? 0) >= 6 ? 6 : 5;

  return (
    <div
      className={cn(
        "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 md:gap-4 pb-4",
        get4xlColsClass(columns)
      )}
    >
      {/* 1) Overall Average */}
      <DataCard
        title={t("generalAverage")}
        icon={AcademicCapIcon}
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
            outOf={2000}
            size="xl"
          />
        ) : null}
      </DataCard>

      {/* 2) Main Custom Averages */}
      {mainCustomAverages?.map((ca) => {
        const subjectsToGive = () => {
          const customAverageId = ca.id;
          const customAverage = customAverageId
            ? customAverages?.find((ca) => ca.id === customAverageId)
            : undefined;


          return addGeneralAverageToSubjects(subjects, customAverage);
        }
        const subjectVirtual = () => {
          return (
            subjectsToGive().find((s) => s.id === ca.id) ||
            buildGeneralAverageSubject()
          );
        };
        const customVal = (average(subjectVirtual()?.id, subjectsToGive()));
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
            key={ca.id}
            title={ca.name}
            icon={AcademicCapIcon}
            description={descriptionText}
          >
            <GradeValue value={customVal * 100} outOf={2000} size="xl" />
          </DataCard>
        );
      })}

      {/* 3) Best Grade */}
      <DataCard
        title={t("bestGrade")}
        icon={PlusIcon}
        description={
          bestGrade !== null
            ? // Use interpolation tokens for subject & grade name
            t("bestGradeWithSubject", {
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
          />
        )}
      </DataCard>

      {/* 4) Best Subject */}
      <DataCard
        title={t("bestSubject")}
        icon={ArrowTrendingUpIcon}
        description={
          bestSubjectAverage !== null &&
            bestSubjectAverageComparaison?.percentageChange
            ? // Use interpolation for subject and percentage
            t("bestSubjectWithComparison", {
              subjectName: bestSubject?.name,
              percentage:
                bestSubjectAverageComparaison.percentageChange.toFixed(2),
            })
            : t("noBestSubject")
        }
      >
        {bestSubjectAverage !== null && (
          <GradeValue value={bestSubjectAverage * 100} outOf={2000} size="xl" />
        )}
      </DataCard>

      {/* 5) Worst Grade */}
      <DataCard
        title={t("worstGrade")}
        icon={MinusIcon}
        description={
          worstGrade !== null
            ? t("worstGradeWithSubject", {
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
          />
        )}
      </DataCard>

      {/* 6) Worst Subject */}
      <DataCard
        title={t("worstSubject")}
        icon={ArrowTrendingDownIcon}
        description={
          worstSubjectAverage !== null &&
            worstSubjectAverageComparaison?.percentageChange
            ? t("worstSubjectWithComparison", {
              subjectName: worstSubject?.name,
              percentage:
                worstSubjectAverageComparaison.percentageChange.toFixed(2),
            })
            : t("noWorstSubject")
        }
      >
        {worstSubjectAverage !== null && (
          <GradeValue
            value={worstSubjectAverage * 100}
            outOf={2000}
            size="xl"
          />
        )}
      </DataCard>
    </div>
  );
}
