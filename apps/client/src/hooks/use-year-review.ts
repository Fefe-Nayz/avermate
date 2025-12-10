import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import { YearReviewResponse } from "@/types/year-review";

export function useYearReview(yearId: string | null) {
  return useQuery({
    queryKey: ["year-review", yearId],
    queryFn: async () => {
      if (!yearId) return null;
      return await apiClient.get(`year-review/${yearId}`).json<YearReviewResponse>();
    },
    enabled: !!yearId,
    staleTime: 1000 * 60 * 60 * 24, // 24 hours
  });
}

