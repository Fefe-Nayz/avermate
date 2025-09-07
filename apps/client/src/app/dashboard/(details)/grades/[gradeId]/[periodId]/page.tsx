"use client";

import ErrorStateCard from "@/components/skeleton/error-card";
import gradeLoader from "@/components/skeleton/grade-loader";
import { useCustomAverages } from "@/hooks/use-custom-averages";
import { useGrade } from "@/hooks/use-grade";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import GradeWrapper from "./grade-wrapper";
import { useTranslations } from "next-intl";
import { usePeriods } from "@/hooks/use-periods";
import { fullYearPeriod } from "@/utils/average";
import { useSubjects } from "@/hooks/use-subjects";
import { useOrganizedSubjects } from "@/hooks/use-organized-subjects";
import { useYears } from "@/hooks/use-years";

export default function GradePage() {
  const { periodId, gradeId } = useParams() as {
    periodId: string;
    gradeId: string;
  };

  const t = useTranslations("Dashboard.Loader.GradeLoader");
  const tr = useTranslations("Dashboard.Pages.GradeWrapper"); // Initialize t

  let periodIdCorrected = periodId;

  if (periodIdCorrected == "null") {
    periodIdCorrected = "full-year";
  }

  const router = useRouter();

  const [returnUrl, setReturnUrl] = useState("/dashboard");

  useEffect(() => {
    // Try to get from localStorage
    const storedFrom = localStorage.getItem("backFromGradeOrSubject");
    if (storedFrom) {
      setReturnUrl(storedFrom);
    } else {
      setReturnUrl("/dashboard");
    }
  }, []);

  const handleBack = () => {
    router.push(returnUrl);
    localStorage.removeItem("backFromGradeOrSubject");
  };

  const { data: grade, isPending, isError } = useGrade(gradeId);

  const {
    data: organizedSubjects,
    isError: organizedSubjectsIsError,
    isPending: organizedSubjectsIsPending,
  } = useOrganizedSubjects(grade?.yearId || "none");

  const {
    data: customAverages,
    isError: isCustomAveragesError,
    isPending: isCustomAveragesPending,
  } = useCustomAverages(grade?.yearId || "none");

  const {
    data: subjects,
    isPending: isSubjectsPending,
    isError: isSubjectsError,
  } = useSubjects(grade?.yearId || "none");

  const { data: years } = useYears();

  const year = years?.find((y) => y.id === grade?.yearId);

  const {
    data: periods,
    isPending: isPeriodPending,
    isError: isPeriodError,
  } = usePeriods(grade?.yearId || "none");

  if (
    isError ||
    organizedSubjectsIsError ||
    isCustomAveragesError ||
    isSubjectsError ||
    isPeriodError
  ) {
    return <div>{ErrorStateCard()}</div>;
  }

  if (
    isPending ||
    organizedSubjectsIsPending ||
    isCustomAveragesPending ||
    isSubjectsPending ||
    isPeriodPending
    // || true
  ) {
    return <div>{gradeLoader(t)}</div>;
  }

  const period =
    periodId == "full-year"
      ? { ...fullYearPeriod(subjects, year), name: tr("fullYear") }
      : periods?.find((p) => p.id === periodId) || fullYearPeriod(subjects, year);

  return (
    <GradeWrapper
      onBack={handleBack}
      subjects={
        organizedSubjects?.find((p) => p.period.id === periodIdCorrected)
          ?.subjects || []
      }
      grade={grade}
      periodId={periodIdCorrected}
      customAverages={customAverages}
      period={period}
    />
  );
}
