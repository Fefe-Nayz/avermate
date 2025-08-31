import { apiClient } from "@/lib/api";
import { Average } from "@/types/average";
import { useQuery } from "@tanstack/react-query";

export const useCustomAverages = (yearId: string) =>
  useQuery({
    queryKey: ["custom-averages"],
    queryFn: async () => {
      const res = await apiClient.get(`years/${yearId}/averages`);
      const data = await res.json<{ customAverages: Average[] }>();
      return data.customAverages;
    },
  });
