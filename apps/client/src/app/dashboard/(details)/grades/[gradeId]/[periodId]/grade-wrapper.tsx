"use client";

import GradeMoreButton from "@/components/buttons/dashboard/grade/grade-more-button";
import DataCard from "@/components/dashboard/data-card";
import GradeValue from "@/components/dashboard/grade-value";
import AddGradeDialog from "@/components/dialogs/add-grade-dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Grade } from "@/types/grade";
import { Subject } from "@/types/subject";
import { Average } from "@/types/average";
import {
  getParents,
  gradeImpact,
  isGradeIncludedInCustomAverage,
} from "@/utils/average";
import { formatDate } from "@/utils/format";
import {
  AcademicCapIcon,
  ArrowDownCircleIcon,
  ArrowLeftIcon,
  ArrowUpCircleIcon,
  CalendarIcon,
  SparklesIcon,
  VariableIcon,
} from "@heroicons/react/24/outline";
import { DifferenceBadge } from "../difference-badge";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { useFormatDates } from "@/utils/format";
import { useFormatter } from "next-intl";
import { Period } from "@/types/period";

export default function GradeWrapper({
  subjects,
  grade,
  periodId,
  customAverages,
  period,
  onBack,
}: {
  subjects: Subject[];
  grade: Grade;
  periodId: string;
  customAverages: Average[];
  period: Period;
  onBack: () => void; // Receive the onBack prop from the parent
  }) {
  const formatter = useFormatter();
  const t = useTranslations("Dashboard.Pages.GradeWrapper"); // Initialize t

  const gradeParents = () => {
    if (!grade || !subjects) {
      return [];
    }

    const gradeParentsId = getParents(subjects, grade.subject.id);
    return subjects.filter((subject) => gradeParentsId.includes(subject.id));
  };

  function get4xlColsClass(cardCount: number) {
    switch (cardCount) {
      case 7:
        return "4xl:grid-cols-4";
      case 8:
        return "4xl:grid-cols-4";
      case 9:
        return "4xl:grid-cols-5";
      case 10:
        return "4xl:grid-cols-5";
      case 11:
        return "4xl:grid-cols-4";
      case 12:
        return "4xl:grid-cols-4";
      case 13:
        return "4xl:grid-cols-5";
      case 14:
        return "4xl:grid-cols-5";
      case 15:
        return "4xl:grid-cols-5";
      default:
        return "4xl:grid-cols-5";
    }
  }

  return (
    <div className="flex flex-col gap-4 md:gap-8 mx-auto max-w-[2000px]">
      <div>
        <Button
          className="text-blue-600"
          variant="link"
          onClick={onBack} // Use onBack instead of router.back()
        >
          <ArrowLeftIcon className="size-4 mr-2" />
          {t("back")}
        </Button>
      </div>

      <div className="flex justify-between items-center">
        <p className="text-2xl font-semibold">{grade.name}</p>
        <GradeMoreButton grade={grade} />
      </div>

      <Separator />

      <div
        className={cn(
          `grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 md:gap-4`,
          get4xlColsClass(
            gradeParents().length +
              customAverages.filter((ca) =>
                isGradeIncludedInCustomAverage(grade, subjects, ca)
              ).length +
              7
          )
        )}
      >
        <DataCard
          title={t("scoreObtainedTitle")}
          description={t("scoreObtainedDescription", {
            outOf: grade.outOf / 100,
          })}
          icon={SparklesIcon}
        >
          <GradeValue value={grade.value} outOf={grade.outOf} />
        </DataCard>

        <DataCard
          title={t("subjectTitle")}
          description={t("subjectDescription")}
          icon={AcademicCapIcon}
        >
          <p className="texl-xl md:text-3xl font-bold">{grade.subject.name}</p>
        </DataCard>

        <DataCard
          title={t("coefficientTitle")}
          description={t("coefficientDescription")}
          icon={VariableIcon}
        >
          <p className="texl-xl md:text-3xl font-bold">
            {grade.coefficient / 100}
          </p>
        </DataCard>

        <DataCard
          title={t("impactOverallAverageTitle")}
          description={t("impactOverallAverageDescription", {
            periodName: period?.name
          })}
          icon={
            subjects
              ? (gradeImpact(grade.id, undefined, subjects)?.difference ?? 0) >= 0
                ? ArrowUpCircleIcon
                : ArrowDownCircleIcon
              : ArrowUpCircleIcon
          }
        >
          <DifferenceBadge
            diff={
              subjects
                ? gradeImpact(grade.id, undefined, subjects)?.difference || 0
                : 0
            }
          />
        </DataCard>

        {/* For each custom average, display a card if the grade is included */}
        {customAverages.map((ca) => {
          // Check if this grade is part of the custom average
          if (!isGradeIncludedInCustomAverage(grade, subjects, ca)) {
            return null; // skip if not included
          }

          // If included, compute the impact of this single grade on that custom average
          const withGrade = ca
            ? gradeImpact(grade.id, undefined, subjects, ca)
            : null;
          // withGrade might be { difference, percentageChange } or null

          return (
            <DataCard
              key={ca.id}
              title={t("impactCustomAverageTitle", { name: ca.name })}
              description={t("impactCustomAverageDescription", {
                name: ca.name,
                periodName: period?.name,
              })}
              icon={
                withGrade?.difference && withGrade.difference >= 0
                  ? ArrowUpCircleIcon
                  : ArrowDownCircleIcon
              }
            >
              <DifferenceBadge diff={withGrade?.difference || 0} />
            </DataCard>
          );
        })}

        {gradeParents().map((parent: Subject) => (
          <DataCard
            key={parent.id}
            title={t("impactParentAverageTitle", { name: parent.name })}
            description={t("impactParentAverageDescription", {
              parentName: parent.name,
              periodName: period?.name,
            })}
            icon={
              subjects
                ? (gradeImpact(grade.id, parent.id, subjects)?.difference ?? 0) >= 0
                  ? ArrowUpCircleIcon
                  : ArrowDownCircleIcon
                : ArrowUpCircleIcon
            }
          >
            <DifferenceBadge
              diff={
                subjects
                  ? gradeImpact(grade.id, parent.id, subjects)?.difference || 0
                  : 0
              }
            />
          </DataCard>
        ))}

        <DataCard
          title={t("impactSubjectAverageTitle", { name: grade.subject.name })}
          description={t("impactSubjectAverageDescription", {
            name: grade.subject.name,
            periodName: period?.name,
          })}
          icon={
            subjects
              ? (gradeImpact(grade.id, grade.subjectId, subjects)?.difference ?? 0) >= 0
                ? ArrowUpCircleIcon
                : ArrowDownCircleIcon
              : ArrowUpCircleIcon
          }
        >
          <DifferenceBadge
            diff={
              subjects
                ? gradeImpact(grade.id, grade.subjectId, subjects)
                    ?.difference || 0
                : 0
            }
          />
        </DataCard>

        <DataCard
          title={t("passDateTitle")}
          description={t("passDateDescription")}
          icon={CalendarIcon}
        >
          <p className="texl-xl md:text-3xl font-bold">
            {useFormatDates(formatter).formatIntermediate(
              new Date(grade.passedAt)
            )}
          </p>
        </DataCard>

        <DataCard
          title={t("addedDateTitle")}
          description={t("addedDateDescription")}
          icon={CalendarIcon}
        >
          <p className="texl-xl md:text-3xl font-bold">
            {useFormatDates(formatter).formatIntermediate(
              new Date(grade.createdAt)
            )}
          </p>
        </DataCard>
      </div>
    </div>
  );
}
