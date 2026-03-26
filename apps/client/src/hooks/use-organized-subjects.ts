import { apiClient } from "@/lib/api";
import { GetOrganizedSubjectsResponse } from "@/types/get-organized-subjects-response";
import { filterSubjectsBySnapshotDate } from "@/utils/grades-timeline";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useTimelineModeState } from "./use-timeline-mode";

export const useOrganizedSubjects = (yearId: string) => {
  const { isActive, snapshotDate } = useTimelineModeState();

  return useQuery({
    queryKey: queryKeys.subjects.organized(yearId),
    queryFn: async () => {
      const res = await apiClient.get(
        `years/${yearId}/subjects/organized-by-periods`
      );
      const data = await res.json<GetOrganizedSubjectsResponse>();
      return data.periods;
    },
    select: (periods) =>
      isActive && snapshotDate
        ? periods.map((entry) => ({
            ...entry,
            subjects: filterSubjectsBySnapshotDate(entry.subjects, snapshotDate),
          }))
        : periods,
    enabled: !!yearId && yearId !== "none",
  });
};
