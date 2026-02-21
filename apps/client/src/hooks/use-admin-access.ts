import { apiClient } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { useQuery } from "@tanstack/react-query";

export const useAdminAccess = (enabled = true) =>
  useQuery({
    queryKey: queryKeys.admin.access,
    queryFn: async () => {
      const response = await apiClient.get("admin/access");
      const data = await response.json<{ isAdmin: boolean }>();
      return data.isAdmin;
    },
    enabled,
    staleTime: 60 * 1000,
  });
