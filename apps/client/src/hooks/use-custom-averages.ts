import { apiClient } from "@/lib/api";
import { Average } from "@/types/average";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

export const useCustomAverages = (yearId: string) =>
  useQuery({
    queryKey: queryKeys.averages.custom(yearId),
    queryFn: async () => {
      const res = await apiClient.get(`years/${yearId}/averages`);
      const data = await res.json<{ customAverages: Average[] }>();
      return data.customAverages;
    },
    enabled: !!yearId && yearId !== "none",
  });
