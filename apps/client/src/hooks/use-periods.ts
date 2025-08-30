import { apiClient } from "@/lib/api";
import { GetPeriodsResponse } from "@/types/get-periods-response";
import { useQuery } from "@tanstack/react-query";

export const usePeriods = (yearId: string) =>
  useQuery({
    queryKey: ["periods"],
    queryFn: async () => {
      const res = await apiClient.get(`years/${yearId}/periods`);
      const data = await res.json<GetPeriodsResponse>();
      return data.periods;
    },
  });
