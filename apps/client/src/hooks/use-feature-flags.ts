import { apiClient } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";

export const useFeatureFlags = () => useQuery({
    queryKey: ["feature-flags"],
    queryFn: async () => {
        const res = await apiClient.get("feature-flags");
        const data = await res.json<{ flags: Record<string, string> }>();
        return data.flags;
    }
})