import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { AnnouncementsResponse } from "@/types/announcement";

export function useAnnouncements(enabled = true) {
  return useQuery({
    queryKey: queryKeys.announcements.active,
    queryFn: async () => {
      const response = await apiClient.get("announcements");
      const data = await response.json<AnnouncementsResponse>();
      return data.announcements;
    },
    enabled,
    retry: false,
    staleTime: 60 * 1000,
  });
}

export function useAnnouncementHistory(enabled = true) {
  return useQuery({
    queryKey: queryKeys.announcements.history,
    queryFn: async () => {
      const response = await apiClient.get("announcements/history");
      const data = await response.json<AnnouncementsResponse>();
      return data.announcements;
    },
    enabled,
    retry: false,
    staleTime: 60 * 1000,
  });
}

export function useDismissAnnouncement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ["announcements", "dismiss"],
    mutationFn: async (announcementId: string) => {
      const response = await apiClient.post(
        `announcements/${announcementId}/view`
      );
      return response.json<{ viewed: boolean }>();
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.announcements.active,
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.announcements.history,
        }),
      ]);
    },
  });
}
