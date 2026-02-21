import { queryKeys } from "@/lib/query-keys";
import { authClient } from "@/lib/auth";
import { AdminListUsersResponse } from "@/types/admin";
import { useQuery } from "@tanstack/react-query";

interface UseAdminUsersOptions {
  searchValue: string;
  limit: number;
  offset: number;
  enabled?: boolean;
}

export const useAdminUsers = ({
  searchValue,
  limit,
  offset,
  enabled = true,
}: UseAdminUsersOptions) =>
  useQuery({
    queryKey: queryKeys.admin.users(searchValue, limit, offset),
    queryFn: async () => {
      const response = await authClient.admin.listUsers({
        query: {
          searchValue: searchValue || undefined,
          searchField: "email",
          searchOperator: "contains",
          limit,
          offset,
          sortBy: "createdAt",
          sortDirection: "desc",
        },
      });

      return response as AdminListUsersResponse;
    },
    enabled,
    placeholderData: (previousData) => previousData,
  });
