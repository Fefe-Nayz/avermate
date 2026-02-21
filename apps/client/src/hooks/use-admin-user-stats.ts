import { queryKeys } from "@/lib/query-keys";
import { apiClient } from "@/lib/api";
import type { AdminTimelineRange, AdminUserStatsResponse } from "@/types/admin";
import { useQuery } from "@tanstack/react-query";

export const useAdminUserStats = (
  userId: string | null,
  days: AdminTimelineRange,
  enabled = true
) =>
  useQuery({
    queryKey: queryKeys.admin.userStats(userId ?? "none", days),
    queryFn: async () => {
      const searchParams = new URLSearchParams({
        days: String(days),
      });

      const response = await apiClient.get(
        `admin/users/${userId}/stats?${searchParams.toString()}`
      );
      return response.json<AdminUserStatsResponse>();
    },
    enabled: Boolean(userId) && enabled,
  });
