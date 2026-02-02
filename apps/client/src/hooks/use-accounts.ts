import { authClient } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";


export const useAccounts = () => useQuery({
    queryKey: queryKeys.accounts.all,
    queryFn: async () => {
        const accounts = await authClient.listAccounts();
        return accounts;
    },
});