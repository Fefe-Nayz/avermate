"use client";

import ErrorStateCard from "@/components/skeleton/error-card";
import subjectLoader from "@/components/skeleton/subject-loader";
import { useCustomAverages } from "@/hooks/use-custom-averages";
import { usePeriods } from "@/hooks/use-periods";
import { useSubjects } from "@/hooks/use-subjects";
import { apiClient } from "@/lib/api";
import { GetOrganizedSubjectsResponse } from "@/types/get-organized-subjects-response";
import { Subject } from "@/types/subject";
import {
  addGeneralAverageToSubjects,
  fullYearPeriod,
  buildGeneralAverageSubject,
  subjectImpact,
  getParents,
} from "@/utils/average";
import { useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import SubjectWrapper from "./subject-wrapper";
import { useTranslations } from "next-intl";
import { useOrganizedSubjects } from "@/hooks/use-organized-subjects";
import { useYears } from "@/hooks/use-years";
import { useActiveYearStore } from "@/stores/active-year-store";

export default function SubjectPage() {
  const t = useTranslations("Dashboard.Loader.SubjectLoader");
  const { periodId, subjectId } = useParams() as {
    periodId: string;
    subjectId: string;
  };

  const isVirtualSubject =
    subjectId.startsWith("ca") || subjectId === "general-average";

  const router = useRouter();

  const [returnUrl, setReturnUrl] = useState("/dashboard");

  useEffect(() => {
    const storedFrom = localStorage.getItem("backFromGradeOrSubject");
    if (storedFrom) {
      setReturnUrl(storedFrom);
    } else {
      setReturnUrl("/dashboard");
    }
  }, []);

  const handleBack = () => {
    router.replace(returnUrl);
    localStorage.removeItem("backFromGradeOrSubject");
  };

  const { activeId } = useActiveYearStore();
  const { data: years } = useYears();
  const active = years?.find((year) => year.id === activeId);

  const {
    data: subject,
    isError: isSubjectError,
    isPending: isSubjectPending,
  } = useQuery({
    queryKey: ["subjects", subjectId],
    queryFn: async () => {
      const res = await apiClient.get(`subjects/${subjectId}`);
      const data = await res.json<{ subject: Subject }>();
      return data.subject;
    },
    enabled: !isVirtualSubject,
  });

  const yearId = isVirtualSubject ? activeId : subject?.yearId || "none";
  const year = isVirtualSubject ? active : years.find((y) => y.id === subject?.yearId);

  const {
    data: organizedSubjects,
    isError: organizedSubjectsIsError,
    isPending: organizedSubjectsIsPending,
  } = useOrganizedSubjects(yearId);

  const {
    data: organizedSubject,
    isError: organizedSubjectIsError,
    isPending: organizedSubjectIsPending,
  } = useQuery({
    queryKey: ["subject", "organized-by-periods", subjectId],
    queryFn: async () => {
      const res = await apiClient.get(
        `subjects/organized-by-periods/${subjectId}`
      );
      const data = await res.json<{ subject: Subject }>();
      return data.subject;
    },
    enabled: !isVirtualSubject,
  });

  // Fetch period data
  const {
    data: period,
    isError: isPeriodError,
    isPending: isPeriodPending,
  } = usePeriods(yearId);

  const {
    data: subjects,
    isError: isSubjectsError,
    isPending: isSubjectsPending,
  } = useSubjects(yearId);

  const {
    data: customAverages,
    isError: isCustomAveragesError,
    isPending: isCustomAveragesPending,
  } = useCustomAverages(yearId);

  if (
    isPeriodError ||
    organizedSubjectsIsError ||
    isSubjectsError ||
    isCustomAveragesError ||
    (!isVirtualSubject && (organizedSubjectIsError || isSubjectError))
  ) {
    return <div>{ErrorStateCard()}</div>;
  }

  if (
    organizedSubjectsIsPending ||
    isPeriodPending ||
    isSubjectsPending ||
    isCustomAveragesPending ||
    (!isVirtualSubject && (organizedSubjectIsPending || isSubjectPending))
  ) {
    return <div>{subjectLoader(t)}</div>;
  }

  const sortedPeriods = period
    ?.slice()
    .sort(
      (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()
    );

  const periods =
    periodId === "full-year"
      ? fullYearPeriod(subjects, year)
      : organizedSubjects?.find((p) => p.period.id === periodId)?.period ||
      fullYearPeriod(subjects, year);

  // function to choose what to give to the wrapper depending on the periodId and if it's a virtual subject
  const subjectsToGive = () => {
    // Get the custom average if this is a custom average page
    const customAverageId = subjectId;
    const customAverage = customAverageId
      ? customAverages?.find((ca) => ca.id === customAverageId)
      : undefined;

    if (isVirtualSubject) {
      if (periodId === "full-year") {
        return addGeneralAverageToSubjects(subjects, customAverage);
      } else {
        return addGeneralAverageToSubjects(
          organizedSubjects?.find((p) => p.period.id === periodId)?.subjects ||
          [],
          customAverage
        );
      }
    } else {
      if (periodId === "full-year") {
        return subjects;
      }

      // Attempt to fix period grades leaks.
      return organizedSubjects.find((p) => p.period.id === periodId)?.subjects || [];
      // return subjects;
    }
  };

  const subjectVirtual = () => {
    return (
      subjectsToGive().find((s) => s.id === subjectId) ||
      buildGeneralAverageSubject()
    );
  };

  const calculateCustomAverageImpact = () => {
    if (!isVirtualSubject || !subjectId.startsWith("ca")) return null;

    const customAverageId = subjectId;
    const customAverage = customAverages?.find(
      (ca) => ca.id === customAverageId
    );
    if (!customAverage) return null;

    // Get all subjects in the custom average
    const includedSubjects = (
      periodId === "full-year"
        ? subjects
        : organizedSubjects?.find((p) => p.period.id === periodId)?.subjects ||
        []
    ).filter((subject) =>
      customAverage.subjects.some((avgSubj) => {
        if (avgSubj.id === subject.id) return true;
        if (avgSubj.includeChildren) {
          const parents = getParents(subjects, subject.id);
          return parents.includes(avgSubj.id);
        }
        return false;
      })
    );

    // Calculate combined impact of all included subjects
    const impact = subjectImpact(
      includedSubjects.map((s) => s.id),
      undefined,
      periodId === "full-year"
        ? subjects
        : organizedSubjects?.find((p) => p.period.id === periodId)?.subjects ||
        []
    );

    return impact?.difference || null;
  };

  console.log(subjectsToGive());

  return (
    <SubjectWrapper
      subjects={subjectsToGive()}
      subject={
        isVirtualSubject
          ? subjectVirtual()
          : organizedSubject || buildGeneralAverageSubject()
      }
      period={periods}
      customAverages={customAverages}
      customAverageImpact={calculateCustomAverageImpact()}
      onBack={handleBack}
      periods={sortedPeriods}
    />
  );
}
