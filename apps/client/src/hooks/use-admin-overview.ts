import { queryKeys } from "@/lib/query-keys";
import { apiClient } from "@/lib/api";
import type { AdminOverviewResponse, AdminTimelineRange } from "@/types/admin";
import { useQuery } from "@tanstack/react-query";

export const useAdminOverview = (days: AdminTimelineRange, enabled = true) =>
  useQuery({
    queryKey: queryKeys.admin.overview(days),
    queryFn: async () => {
      const searchParams = new URLSearchParams({
        days: String(days),
      });

      const response = await apiClient.get(`admin/overview?${searchParams.toString()}`);
      return response.json<AdminOverviewResponse>();
    },
    enabled,
  });
