import { apiClient } from "@/lib/api";
import { Average } from "@/types/average";
import { useQuery } from "@tanstack/react-query";

export const useAverage = (averageId: string) => useQuery({
    queryKey: ["custom-averages", averageId],
    queryFn: async () => {
        const res = await apiClient.get(`averages/${averageId}`);
        const data = await res.json<{ customAverage: Average }>();
        return data.customAverage;
    },
});