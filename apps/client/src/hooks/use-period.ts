import { apiClient } from "@/lib/api";
import { Period } from "@/types/period";
import { useQuery } from "@tanstack/react-query";

export const usePeriod = (periodId: string) => useQuery({
    queryKey: ["periods", periodId],
    queryFn: async () => {
        if (periodId === "full-year") {
            return null;
        }
        const res = await apiClient.get(`periods/${periodId}`);
        return await res.json<Period>();
    },
});
