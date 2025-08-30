import GradeBadge from "@/components/tables/grade-badge";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useLocalizedSubjects } from "@/data/mock";
import { cn } from "@/lib/utils";
import { Subject } from "@/types/subject";
import { average } from "@/utils/average";
import Link from "next/link";
import React from "react";
import { useTranslations } from "next-intl";

const MockGradesTable = () => {
  const t = useTranslations("Landing.Product.Mocks.Grades");
  const periodName = t("fullYear");
  const overallAverage = "12.34";
  const localizedSubjects = useLocalizedSubjects();

  return (
    <Table>
      <TableCaption>{periodName}</TableCaption>

      {/* Desktop Table Header */}
      <TableHeader className="hidden md:table-header-group">
        <TableRow>
          <TableHead className="w-[50px] md:w-[200px]">
            {t("subjects")}
          </TableHead>
          <TableHead className="w-[50px] md:w-[100px] text-center">
            {t("averages")}
          </TableHead>
          <TableHead>{t("grades")}</TableHead>
        </TableRow>
      </TableHeader>

      <TableBody>
        {renderSubjects(localizedSubjects, "full-year", null, t)}
      </TableBody>

      <TableFooter>
        {/* Desktop Footer */}
        <TableRow className="hidden md:table-row">
          <TableCell className="font-semibold" colSpan={2}>
            {t("overallAverage")}
          </TableCell>
          <TableCell className="text-right font-semibold">
            {overallAverage}
          </TableCell>
        </TableRow>
        {/* Mobile Footer */}
        <TableRow className="md:hidden">
          <TableCell className="font-semibold text-center" colSpan={3}>
            {t("overallAverage")}: {overallAverage}
          </TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
};

function getPaddingClass(depth: number) {
  switch (depth) {
    case 1:
      return "pl-8";
    case 2:
      return "pl-12";
    case 3:
      return "pl-16";
    case 4:
      return "pl-20";
    default:
      return "";
  }
}

function getLinePosition(depth: number) {
  switch (depth) {
    case 1:
      return "2rem";
    case 2:
      return "3rem";
    case 3:
      return "4rem";
    case 4:
      return "5rem";
    default:
      return "0";
  }
}

function getIndentationLinesStyle(depth: number): React.CSSProperties {
  if (depth <= 0) return {};

  const linePositions = Array.from(
    { length: depth },
    (_, i) => `calc(${getLinePosition(i + 1)} - 10px)`
  );

  return {
    backgroundImage: linePositions
      .map(() => "linear-gradient(to bottom, #58585d 0%, #58585d 100%)")
      .join(", "),
    backgroundPosition: linePositions.join(", "),
    backgroundSize: "1px 100%",
    backgroundRepeat: "no-repeat",
  };
}

function renderSubjects(
  subjects: Subject[],
  periodId: string,
  parentId: string | null = null,
  t: any
) {
  return subjects
    .filter((subject) => subject.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((subject) => {
      const subjAverage =
        average(subject.id, subjects) !== null
          ? average(subject.id, subjects)?.toFixed(2)
          : "—";

      return (
        <React.Fragment key={subject.id}>
          <TableRow className="border-b">
            <TableCell
              style={getIndentationLinesStyle(subject.depth)}
              className={cn(
                "font-medium relative",
                getPaddingClass(subject.depth)
              )}
            >
              <Link
                href={`#features`}
                className="border-b border-dotted border-white hover:opacity-80 text-primary transition-opacity"
              >
                {subject.name +
                  (!subject.isDisplaySubject
                    ? ` (${subject.coefficient / 100})`
                    : "")}
              </Link>

              {/* Mobile-only average display (hidden on md+) */}
              <div className="md:hidden mt-1 text-sm text-gray-600">
                {t("average")}:{" "}
                <span className="font-semibold">{subjAverage}</span>
              </div>
            </TableCell>

            {/* Desktop-only average column (hidden on mobile) */}
            <TableCell className="text-center font-semibold hidden md:table-cell">
              {subjAverage}
            </TableCell>

            {/* Desktop-only notes column (hidden on mobile) */}
            <TableCell className="hidden md:table-cell">
              <div className="flex gap-4 flex-wrap">
                {subject.grades.map((grade) => (
                  <GradeBadge
                    key={grade.id}
                    value={grade.value}
                    outOf={grade.outOf}
                    coefficient={grade.coefficient}
                    id={grade.id}
                    periodId={grade.periodId}
                    subjectId={grade.subjectId}
                  />
                ))}
              </div>
            </TableCell>
          </TableRow>

          {/* Mobile-only second row for notes */}
          {!subject.isDisplaySubject && subject.grades.length !== 0 && (
            <TableRow className="border-b md:hidden">
              <TableCell
                colSpan={1}
                style={getIndentationLinesStyle(subject.depth)}
                className={cn(getPaddingClass(subject.depth))}
              >
                <div className="flex gap-2 flex-wrap pt-1 pb-2">
                  {subject.grades.map((grade) => (
                    <GradeBadge
                      key={grade.id}
                      value={grade.value}
                      outOf={grade.outOf}
                      coefficient={grade.coefficient}
                      id={grade.id}
                      periodId={grade.periodId}
                      subjectId={grade.subjectId}
                    />
                  ))}
                </div>
              </TableCell>
            </TableRow>
          )}

          {renderSubjects(subjects, periodId, subject.id, t)}
        </React.Fragment>
      );
    });
}

export default MockGradesTable;
