import { apiClient } from "@/lib/api";
import { Year } from "@/types/year";
import { useQuery } from "@tanstack/react-query";

export const useYears = () =>
    useQuery({
        queryKey: ["years"],
        queryFn: async () => {
            const res = await apiClient.get(`years`);
            const data = await res.json<{ years: Year[] }>();
            return data.years;
        },
    });
