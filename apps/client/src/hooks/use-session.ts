import { authClient } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";

export const useSession = () => useQuery({
    queryKey: ["session"],
    queryFn: async () => {
        const session = await authClient.getSession();
        return session;
    },
});