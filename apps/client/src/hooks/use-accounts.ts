import { authClient } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";


export const useAccounts = () => useQuery({
    queryKey: ["accounts"],
    queryFn: async () => {
        const accounts = await authClient.listAccounts();
        return accounts;
    },
});