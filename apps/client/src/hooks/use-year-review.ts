import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import { YearReviewResponse, YearReviewServerResponse } from "@/types/year-review";
import { calculateYearReviewStats } from "@/utils/average";
import { useSubjects } from "./use-subjects";
import { useYears } from "./use-years";
import { useMemo } from "react";

export function useYearReview(yearId: string | null) {
  // Fetch subjects data (already available on client)
  const { data: subjects, isLoading: subjectsLoading } = useSubjects(yearId ?? "");
  const { data: years } = useYears();

  // Fetch only the percentile from server
  const { data: serverData, isLoading: serverLoading, error } = useQuery({
    queryKey: ["year-review-percentile", yearId],
    queryFn: async () => {
      if (!yearId) return null;
      return await apiClient.get(`year-review/${yearId}`).json<YearReviewServerResponse>();
    },
    enabled: !!yearId,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  // Calculate stats client-side
  const data = useMemo((): YearReviewResponse | null => {
    if (!yearId || !subjects || subjects.length === 0) {
      return { hasData: false };
    }

    // Get year dates for the calculation
    const year = years?.find(y => y.id === yearId);
    const yearStartDate = year ? new Date(year.startDate) : new Date(new Date().getFullYear(), 0, 1);
    const yearEndDate = year ? new Date(year.endDate) : new Date(new Date().getFullYear(), 11, 31);

    // Get percentile from server (default to 1 if not available yet)
    const topPercentile = serverData?.topPercentile ?? 1;

    // Check if there are any grades
    const hasGrades = subjects.some(s => s.grades && s.grades.length > 0);
    if (!hasGrades) {
      return { hasData: false };
    }

    // Calculate all stats client-side
    const stats = calculateYearReviewStats(
      subjects,
      topPercentile,
      yearStartDate,
      yearEndDate
    );

    return {
      hasData: true,
      stats,
    };
  }, [yearId, subjects, years, serverData]);

  return {
    data,
    isLoading: subjectsLoading || serverLoading,
    error,
  };
}

