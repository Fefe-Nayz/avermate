import { authClient } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";

export const useSessions = () => useQuery({
    queryKey: ["sessions"],
    queryFn: async () => {
      const sessions = (await authClient.listSessions());
      return sessions;
    },
  });