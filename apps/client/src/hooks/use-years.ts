import { apiClient } from "@/lib/api";
import { Year } from "@/types/year";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

export const useYears = () =>
    useQuery({
        queryKey: queryKeys.years.all,
        queryFn: async () => {
            const res = await apiClient.get(`years`);
            const data = await res.json<{ years: Year[] }>();
            return data.years;
        },
    });
