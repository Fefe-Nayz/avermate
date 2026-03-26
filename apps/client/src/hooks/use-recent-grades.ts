import { apiClient } from "@/lib/api";
import { Grade } from "@/types/grade";
import { filterGradesBySnapshotDate } from "@/utils/grades-timeline";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useTimelineModeState } from "./use-timeline-mode";

export const useRecentGrades = (yearId: string) => {
  const { isActive, snapshotDate } = useTimelineModeState();

  return useQuery({
    queryKey: [...queryKeys.grades.recent(yearId), isActive ? "timeline" : "live"],
    queryFn: async () => {
      const fromDate = isActive
        ? new Date(0)
        : new Date(Date.now() - 1000 * 60 * 60 * 24 * 14);

      const res = await apiClient.get(
        `years/${yearId}/grades?from=${fromDate.toISOString()}&limit=${
          isActive ? 1000 : 100
        }`
      );

      const data = await res.json<{ grades: Grade[] }>();

      return data.grades;
    },
    select: (grades) =>
      isActive && snapshotDate
        ? filterGradesBySnapshotDate(grades, snapshotDate)
        : grades,
    enabled: !!yearId && yearId !== "none",
  });
};
