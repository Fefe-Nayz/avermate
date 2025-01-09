"use client";

import { DifferenceBadge } from "@/app/dashboard/grades/[gradeId]/difference-badge";
import SubjectMoreButton from "@/components/buttons/dashboard/subject/subject-more-button";
import DataCard from "@/components/dashboard/data-card";
import GradeValue from "@/components/dashboard/grade-value";
import AddGradeDialog from "@/components/dialogs/add-grade-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Period } from "@/types/period";
import { Subject } from "@/types/subject";
import { Average } from "@/types/average";
import {
  average,
  getBestGradeInSubject,
  getParents,
  getWorstGradeInSubject,
  subjectImpact,
  isSubjectIncludedInCustomAverage,
  buildCustomConfig,
  fullYearPeriod as buildFullYearPeriod,
} from "@/utils/average";
import { formatGradeValue } from "@/utils/format";
import {
  AcademicCapIcon,
  ArrowLeftIcon,
  ArrowUpCircleIcon,
  BookOpenIcon,
  PlusCircleIcon,
  SparklesIcon,
  VariableIcon,
} from "@heroicons/react/24/outline";
import SubjectAverageChart from "./subject-average-chart";
import { cn } from "@/lib/utils";
import ErrorStateCard from "@/components/skeleton/error-card";
import { useTranslations } from "next-intl";

function getRelevantPeriodIds(period: Period, periods: Period[]): string[] {
  if (period.id === "full-year") {
    return [];
  }

  const sorted = [...periods].sort(
    (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()
  );
  const currentIndex = sorted.findIndex((p) => p.id === period.id);

  if (currentIndex === -1) {
    return [period.id];
  }

  if (period.isCumulative) {
    return sorted.slice(0, currentIndex + 1).map((p) => p.id);
  }

  return [period.id];
}

function SubjectWrapper({
  subjects,
  subject,
  period,
  customAverages,
  customAverageImpact,
  onBack,
  periods,
}: {
  subjects: Subject[];
  subject: Subject;
  period: Period;
  customAverages: Average[];
  customAverageImpact?: number | null;
  onBack: () => void;
  periods: Period[];
}) {
  const t = useTranslations("Dashboard.Pages.SubjectWrapper");

  const isVirtualSubject =
    subject.id.startsWith("ca") || subject.id.startsWith("general-average");

  const parentSubjects = () => {
    if (!subject || !subjects) {
      return [];
    }

    const parentIds = getParents(subjects, subject.id);
    return subjects.filter((subj) => parentIds.includes(subj.id));
  };

  const hasGrades = (subjId: string): boolean => {
    const currentSubj = subjects.find((s) => s.id === subjId);
    if (!currentSubj) {
      return false;
    }

    if (period.id === "full-year") {
      if (currentSubj.grades.length > 0) {
        return true;
      }
    } else {
      const relevantIds = getRelevantPeriodIds(period, periods);
      const currentHasGrades = currentSubj.grades.some((g) =>
        relevantIds.includes(g.periodId ?? "")
      );
      if (currentHasGrades) {
        return true;
      }
    }

    const children = subjects.filter((s) => s.parentId === currentSubj.id);
    return children.some((child) => hasGrades(child.id));
  };

  if (!subject || !period) {
    return <div>{ErrorStateCard()}</div>;
  }

  const isGradePresent = hasGrades(subject.id);

  function get4xlColsClass(cardCount: number) {
    switch (cardCount) {
      case 3:
        return "4xl:grid-cols-3";
      case 4:
        return "4xl:grid-cols-4";
      case 5:
        return "4xl:grid-cols-5";
      case 6:
        return "4xl:grid-cols-6";
      case 7:
        return "4xl:grid-cols-4";
      case 8:
        return "4xl:grid-cols-4";
      default:
        return "4xl:grid-cols-5";
    }
  }

  if (!isGradePresent) {
    return (
      <div className="flex flex-col gap-4 md:gap-8 mx-auto max-w-[2000px]">
        {/* Back Button */}
        <div>
          <Button className="text-blue-600" variant="link" onClick={onBack}>
            <ArrowLeftIcon className="size-4 mr-2" />
            {t("back")}
          </Button>
        </div>

        {/* Subject Title & More Button */}
        <div className="flex justify-between items-center">
          <p className="text-2xl font-semibold">
            {subject?.id === "general-average"
              ? t("generalAverage")
              : subject?.name}
          </p>
          {subject && !isVirtualSubject && (
            <SubjectMoreButton subject={subject} />
          )}
        </div>

        <Separator />

        {/* Coefficient card (optional) */}
        {!isVirtualSubject && (
          <DataCard
            title={t("coefficientTitle")}
            description={t("coefficientDescription", { name: subject?.name })}
            icon={VariableIcon}
          >
            <p className="text-3xl font-bold">
              {formatGradeValue(subject?.coefficient || 0)}
            </p>
          </DataCard>
        )}

        {/* Empty state */}
        <Card className="lg:col-span-5 flex flex-col justify-center items-center p-6 gap-8 w-full h-full">
          <BookOpenIcon className="w-12 h-12" />
          <div className="flex flex-col items-center gap-1">
            <h2 className="text-xl font-semibold text-center">
              {t("noGradesTitle")}
            </h2>
            <p className="text-center">{t("noGradesMessage")}</p>
          </div>
          {!subject.isDisplaySubject ? (
            <AddGradeDialog parentId={subject.id}>
              <Button variant="outline">
                <PlusCircleIcon className="size-4 mr-2" />
                {t("addGradeInSubject", { name: subject.name })}
              </Button>
            </AddGradeDialog>
          ) : (
            <AddGradeDialog>
              <Button variant="outline">
                <PlusCircleIcon className="size-4 mr-2" />
                {t("addGrade")}
              </Button>
            </AddGradeDialog>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 md:gap-8 mx-auto max-w-[2000px]">
      {/* Back Button */}
      <div>
        <Button className="text-blue-600" variant="link" onClick={onBack}>
          <ArrowLeftIcon className="size-4 mr-2" />
          {t("back")}
        </Button>
      </div>

      {/* Header */}

      <div className="flex justify-between items-center">
        <p className="text-2xl font-semibold">
          {subject?.id === "general-average"
            ? t("generalAverage")
            : subject?.name}
        </p>
        {!isVirtualSubject && (
          <div className="flex gap-4">
            {!subject.isDisplaySubject && (
              <AddGradeDialog parentId={subject.id}>
                <Button className="hidden md:flex">
                  <PlusCircleIcon className="size-4 mr-2" />
                  {t("addGrade")}
                </Button>
              </AddGradeDialog>
            )}
            <SubjectMoreButton subject={subject} />
          </div>
        )}
      </div>

      <Separator />

      {/* Main Data Cards */}
      <div
        className={cn(
          `grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 md:gap-4`,
          get4xlColsClass(
            subject.id === "general-average"
              ? 3
              : subject.id.startsWith("ca")
              ? 4
              : 5 +
                customAverages.filter((ca) =>
                  isSubjectIncludedInCustomAverage(
                    subject,
                    subjects,
                    buildCustomConfig(ca)
                  )
                ).length +
                parentSubjects().length
          )
        )}
      >
        {/* Subject Average */}
        <DataCard
          title={t("averageTitle")}
          description={t("averageDescription", {
            name: subject?.name,
            periodName: period?.name,
          })}
          icon={AcademicCapIcon}
        >
          <GradeValue
            value={(average(subject?.id, subjects) || 0) * 100}
            outOf={2000}
          />
        </DataCard>

        {/* Coefficient */}
        {!isVirtualSubject && (
          <DataCard
            title={t("coefficientTitle")}
            description={t("coefficientDescription", { name: subject?.name })}
            icon={VariableIcon}
          >
            <p className="text-3xl font-bold">
              {formatGradeValue(subject?.coefficient || 0)}
            </p>
          </DataCard>
        )}

        {/* Custom Averages if subject is included */}
        {customAverages.map((ca) => {
          const configMap = buildCustomConfig(ca);
          if (!isSubjectIncludedInCustomAverage(subject, subjects, configMap)) {
            return null;
          }

          const impact = subjectImpact(subject.id, undefined, subjects, ca);
          return (
            <DataCard
              key={ca.id}
              title={t("customImpactTitle", { name: ca.name })}
              description={t("customImpactDescription", {
                name: subject.name,
                customName: ca.name,
                periodName: period?.name,
              })}
              icon={ArrowUpCircleIcon}
            >
              <DifferenceBadge diff={impact?.difference || 0} />
            </DataCard>
          );
        })}

        {/* Subject Impact on overall average */}
        {subject.id !== "general-average" && (
          <DataCard
            title={t("impactTitle")}
            description={t("impactDescription", {
              name: subject?.name,
              periodName: period?.name,
            })}
            icon={ArrowUpCircleIcon}
          >
            <DifferenceBadge
              diff={
                subject.id.startsWith("ca")
                  ? customAverageImpact || 0
                  : subjects
                  ? subjectImpact(subject.id, undefined, subjects)
                      ?.difference || 0
                  : 0
              }
            />
          </DataCard>
        )}

        {/* Parent Subjects (impact on them) */}
        {parentSubjects().map((parent) => (
          <DataCard
            key={parent.id}
            title={t("parentImpactTitle", { name: parent.name })}
            description={t("parentImpactDescription", {
              name: subject?.name,
              parentName: parent.name,
              periodName: period?.name,
            })}
            icon={ArrowUpCircleIcon}
          >
            <DifferenceBadge
              diff={
                subjects
                  ? subjectImpact(subject.id, parent.id, subjects)
                      ?.difference || 0
                  : 0
              }
            />
          </DataCard>
        ))}

        {/* Best Grade */}
        <DataCard
          title={t("bestGradeTitle")}
          description={(() => {
            const bestGradeObj = getBestGradeInSubject(subjects, subject.id);
            return t("bestGradeDescription", {
              name: bestGradeObj?.subject?.name ?? t("notAvailable"),
              periodName: period?.name,
            });
          })()}
          icon={SparklesIcon}
        >
          <p className="text-3xl font-bold">
            {(() => {
              const bestGradeObj = getBestGradeInSubject(subjects, subject.id);
              return bestGradeObj?.grade !== undefined
                ? bestGradeObj.grade / 100
                : t("notAvailable");
            })()}
          </p>
        </DataCard>

        {/* Worst Grade */}
        <DataCard
          title={t("worstGradeTitle")}
          description={(() => {
            const worstGradeObj = getWorstGradeInSubject(subjects, subject.id);
            return t("worstGradeDescription", {
              name: worstGradeObj?.subject?.name ?? t("notAvailable"),
              periodName: period?.name,
            });
          })()}
          icon={SparklesIcon}
        >
          <p className="text-3xl font-bold">
            {(() => {
              const worstGradeObj = getWorstGradeInSubject(
                subjects,
                subject.id
              );
              return worstGradeObj?.grade !== undefined
                ? worstGradeObj.grade / 100
                : t("notAvailable");
            })()}
          </p>
        </DataCard>
      </div>

      <Separator />

      {/* Charts */}
      <div className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">{t("averageEvolution")}</h2>
        <SubjectAverageChart
          subjectId={subject.id}
          period={period}
          subjects={subjects}
          periods={periods}
        />
      </div>
    </div>
  );
}

export default SubjectWrapper;
