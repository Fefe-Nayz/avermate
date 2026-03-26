import { queryKeys } from "@/lib/query-keys";
import { apiClient } from "@/lib/api";
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
      const response = await apiClient.get("admin/users", {
        searchParams: {
          search: searchValue || undefined,
          limit,
          offset,
        },
      });

      return response.json<AdminListUsersResponse>();
    },
    enabled,
    placeholderData: (previousData) => previousData,
  });
