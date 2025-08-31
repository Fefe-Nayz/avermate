"use client";

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
import { useCustomAverages } from "@/hooks/use-custom-averages";
import { apiClient } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Average } from "@/types/average";
import { Period } from "@/types/period";
import { Subject } from "@/types/subject";
import { average } from "@/utils/average";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import React from "react";
import { SubjectEmptyState } from "../empty-states/subject-empty-state";
import ErrorStateCard from "../skeleton/error-card";
import { Skeleton } from "../ui/skeleton";
import GradeBadge from "./grade-badge";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import {
  addGeneralAverageToSubjects,
  buildGeneralAverageSubject,
} from "@/utils/average";

export default function GradesTable({
  subjects,
  periodId,
  yearId,
}: {
  subjects: Subject[];
  periodId: string;
  yearId: string;
}) {
  const pathname = usePathname();
  const t = useTranslations("Dashboard.Tables.GradesTable");

  const {
    data: period,
    isError: isPeriodError,
    isPending: isPeriodPending,
  } = useQuery({
    queryKey: ["periods", periodId],
    queryFn: async () => {
      if (periodId === "full-year") {
        return null;
      }
      const res = await apiClient.get(`periods/${periodId}`);
      const data = await res.json<Period>();
      return data;
    },
  });

  useEffect(() => {
    if (window.location.hash) {
      const id = window.location.hash.slice(1);
      const el = document.getElementById(id);
      el?.scrollIntoView({ behavior: "smooth" });
    }
  }, []);

  // Fetch all custom averages
  const {
    data: customAverages,
    isError: isCustomAveragesError,
    isPending: isCustomAveragesPending,
  } = useCustomAverages(yearId);

  // Loading State
  if (isPeriodPending || isCustomAveragesPending) {
    return <LoadingTable />;
  }

  // Error State
  if (isPeriodError || isCustomAveragesError) {
    return <div>{ErrorStateCard()}</div>;
  }

  // Empty State
  if (subjects.length === 0) {
    return <SubjectEmptyState />;
  }

  const periodName = periodId !== "full-year" ? period?.name : t("fullYear");
  const overallAverageVal = average(undefined, subjects);
  const overallAverage =
    overallAverageVal !== null ? overallAverageVal.toFixed(2) : "—";

  return (
    <Table>
      <TableCaption>{periodName}</TableCaption>
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
        {renderSubjects(subjects, periodId, null, pathname, customAverages, t)}
      </TableBody>

      <TableFooter>
        {/* Main Average */}
        <TableRow className="hidden md:table-row" id="general-average">
          <TableCell className="font-semibold" colSpan={2}>
            <Link
              href={`/dashboard/subjects/general-average/${periodId}`}
              className="border-b border-dotted border-foreground hover:opacity-80 text-primary transition-opacity"
              onClick={() => {
                const currentPath =
                  pathname + window.location.search || "/dashboard";
                localStorage.setItem(
                  "backFromGradeOrSubject",
                  `${currentPath}#general-average`
                );
              }}
            >
              {t("overallAverage")}
            </Link>
          </TableCell>
          <TableCell className="text-right font-semibold">
            {overallAverage}
          </TableCell>
        </TableRow>
        <TableRow className="md:hidden" id="general-average-mobile">
          <TableCell className="font-semibold text-center" colSpan={3}>
            <Link
              href={`/dashboard/subjects/general-average/${periodId}`}
              className="border-b border-dotted border-foreground hover:opacity-80 text-primary transition-opacity"
              onClick={() => {
                const currentPath =
                  pathname + window.location.search || "/dashboard";
                localStorage.setItem(
                  "backFromGradeOrSubject",
                  `${currentPath}#general-average-mobile`
                );
              }}
            >
              {t("overallAverage")}</Link>: {overallAverage}
            
          </TableCell>
        </TableRow>

        {/* Custom Averages */}
        {customAverages && customAverages.length > 0 && (
          <>
            {customAverages.map((ca) => {
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
              const customAvgVal = (average(subjectVirtual()?.id, subjectsToGive()));
              const customAvg =
                customAvgVal !== null ? customAvgVal.toFixed(2) : "—";

              return (
                <React.Fragment key={ca.id}>
                  <TableRow className="hidden md:table-row" id={ca.id}>
                    <TableCell className="font-semibold" colSpan={2}>
                      <Link
                        href={`/dashboard/subjects/${ca.id}/${periodId}`}
                        onClick={() => {
                          const currentPath =
                            pathname + window.location.search || "/dashboard";
                          localStorage.setItem(
                            "backFromGradeOrSubject",
                            `${currentPath}#${ca.id}`
                          );
                        }}
                        className="border-b border-dotted border-foreground hover:opacity-80 text-primary transition-opacity"
                      >
                        {ca.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      {customAvg}
                    </TableCell>
                  </TableRow>
                  <TableRow className="md:hidden" id={`${ca.id}-mobile`}>
                    <TableCell
                      className="font-semibold text-center"
                      colSpan={3}
                    >
                      <Link
                        href={`/dashboard/subjects/${ca.id}/${periodId}`}
                        onClick={() => {
                          const currentPath =
                            pathname + window.location.search || "/dashboard";
                          localStorage.setItem(
                            "backFromGradeOrSubject",
                            `${currentPath}#${ca.id}-mobile`
                          );
                        }}
                        className="border-b border-dotted border-foreground hover:opacity-80 text-primary transition-opacity"
                      >
                        {ca.name}
                      </Link>
                      : {customAvg}
                    </TableCell>
                  </TableRow>
                </React.Fragment>
              );
            })}
          </>
        )}
      </TableFooter>
    </Table>
  );
}

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
  parentId: string | null,
  pathname: string,
  customAverages?: Average[],
  t?: any
) {
  return subjects
    .filter((subject) => subject.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((subject) => {
      const subjAverageVal = average(subject.id, subjects, undefined);
      const subjAverage =
        subjAverageVal !== null ? subjAverageVal.toFixed(2) : "—";

      return (
        <React.Fragment key={subject.id}>
          <TableRow className="border-b" id={subject.id}>
            <TableCell
              style={getIndentationLinesStyle(subject.depth)}
              className={cn(
                "font-medium relative",
                getPaddingClass(subject.depth)
              )}
            >
              <Link
                href={`/dashboard/subjects/${subject.id}/${periodId}`}
                onClick={() => {
                  const currentPath =
                    pathname + window.location.search || "/dashboard";
                  localStorage.setItem("backFromGradeOrSubject", `${currentPath}#${subject.id}`);
                }}
                className="border-b border-dotted border-foreground hover:opacity-80 text-primary transition-opacity"
              >
                {subject.name +
                  (!subject.isDisplaySubject
                    ? ` (${subject.coefficient / 100})`
                    : "")}
              </Link>

              {/* Mobile-only average display */}
              <div className="md:hidden mt-1 text-sm text-muted-foreground">
                {t("average")}: {" "}
                <span className="font-bold text-foreground">{subjAverage}</span>
              </div>
            </TableCell>

            <TableCell className="text-center font-semibold hidden md:table-cell">
              {subjAverage}
            </TableCell>

            <TableCell className="hidden md:table-cell">
              <div className="flex gap-4 flex-wrap">
                {subject.grades.map((grade) => (
                  <GradeBadge
                    key={grade.id}
                    value={grade.value}
                    outOf={grade.outOf}
                    coefficient={grade.coefficient}
                    id={grade.id}
                    periodId={periodId}
                    subjectId={grade.subjectId}
                  />
                ))}
              </div>
            </TableCell>
          </TableRow>

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
                      periodId={periodId}
                      subjectId={grade.subjectId}
                    />
                  ))}
                </div>
              </TableCell>
            </TableRow>
          )}

          {renderSubjects(
            subjects,
            periodId,
            subject.id,
            pathname,
            customAverages,
            t
          )}
        </React.Fragment>
      );
    });
}

function LoadingTable() {
  const items = Array.from({ length: 5 }, (_, i) => i);

  return (
    <>
      {/* Desktop layout */}
      <Table className="w-full table-auto hidden md:table">
        <TableCaption>
          <div className="flex w-full justify-center">
            <Skeleton className="w-64 h-[14px]" />
          </div>
        </TableCaption>

        <TableHeader>
          <TableRow>
            <TableHead className="w-[50px] md:w-[200px]">
              <Skeleton className="w-full h-[18px]" />
            </TableHead>
            <TableHead className="w-[50px] md:w-[100px] text-center">
              <Skeleton className="w-full h-[18px]" />
            </TableHead>
            <TableHead>
              <Skeleton className="w-full h-[18px]" />
            </TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {Array.from({ length: 10 }, (_, i) => (
            <TableRow key={i}>
              <TableCell>
                <Skeleton className="w-full h-[20px]" />
              </TableCell>
              <TableCell className="text-center font-semibold">
                <Skeleton className="w-full h-[20px]" />
              </TableCell>
              <TableCell>
                <Skeleton className="w-full h-[20px]" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Mobile layout */}
      <Table className="w-full table-auto md:hidden">
        <TableCaption>
          <div className="flex w-full justify-center">
            <Skeleton className="w-64 h-[14px]" />
          </div>
        </TableCaption>

        <TableBody>
          {items.map((item) => (
            <React.Fragment key={item}>
              <TableRow className="border-b">
                <TableCell className="w-full">
                  <Skeleton className="w-3/4 h-[20px] mb-1" />
                  <Skeleton className="w-1/2 h-[14px]" />
                </TableCell>
              </TableRow>

              <TableRow className="border-b">
                <TableCell className="w-full">
                  <div className="flex gap-2 flex-wrap pt-1 pb-2">
                    <Skeleton className="w-10 h-[20px]" />
                    <Skeleton className="w-10 h-[20px]" />
                    <Skeleton className="w-10 h-[20px]" />
                  </div>
                </TableCell>
              </TableRow>
            </React.Fragment>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
