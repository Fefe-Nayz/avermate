import { apiClient } from "@/lib/api";
import { Grade } from "@/types/grade";
import { useQuery } from "@tanstack/react-query";

export const useRecentGrades = (yearId: string) =>
  useQuery({
    queryKey: ["recent-grades", yearId],
    queryFn: async () => {
      const res = await apiClient.get(
        `years/${yearId}/grades?from=${new Date(
          Date.now() - 1000 * 60 * 60 * 24 * 14
        )}&limit=100`
      );

      const data = await res.json<{ grades: Grade[] }>();

      return data.grades;
    },
  });
