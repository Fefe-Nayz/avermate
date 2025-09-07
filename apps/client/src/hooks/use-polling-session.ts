import { authClient } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";

export const usePollingSession = () => useQuery({
    queryKey: ["session"],
    queryFn: async () => {
        const data = authClient.getSession();

        if (!data) throw new Error("No session found");

        return data;
    },

    // Poll every 30 seconds
    staleTime: 5 * 1000,
    refetchInterval: 5 * 1000,
    refetchOnWindowFocus: true,
});