import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type {
  Announcement,
  AnnouncementsResponse,
  AnnouncementTone,
} from "@/types/announcement";

export type AdminAnnouncementInput = {
  title: string;
  message: string;
  tone: AnnouncementTone;
  active: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
};

export function useAdminAnnouncements(enabled = true) {
  return useQuery({
    queryKey: queryKeys.announcements.admin,
    queryFn: async () => {
      const response = await apiClient.get("admin/announcements");
      const data = await response.json<AnnouncementsResponse>();
      return data.announcements;
    },
    enabled,
  });
}

export function useCreateAdminAnnouncement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ["admin", "announcements", "create"],
    mutationFn: async (input: AdminAnnouncementInput) => {
      const response = await apiClient.post("admin/announcements", {
        json: input,
      });
      return response.json<{ announcement: Announcement }>();
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.announcements.admin }),
        queryClient.invalidateQueries({ queryKey: queryKeys.announcements.active }),
        queryClient.invalidateQueries({ queryKey: queryKeys.announcements.history }),
      ]);
    },
  });
}

export function useUpdateAdminAnnouncement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ["admin", "announcements", "update"],
    mutationFn: async ({
      id,
      input,
    }: {
      id: string;
      input: Partial<AdminAnnouncementInput>;
    }) => {
      const response = await apiClient.patch(`admin/announcements/${id}`, {
        json: input,
      });
      return response.json<{ announcement: Announcement }>();
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.announcements.admin }),
        queryClient.invalidateQueries({ queryKey: queryKeys.announcements.active }),
        queryClient.invalidateQueries({ queryKey: queryKeys.announcements.history }),
      ]);
    },
  });
}

export function useDeleteAdminAnnouncement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ["admin", "announcements", "delete"],
    mutationFn: async (id: string) => {
      const response = await apiClient.delete(`admin/announcements/${id}`);
      return response.json<{ announcement: Announcement }>();
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.announcements.admin }),
        queryClient.invalidateQueries({ queryKey: queryKeys.announcements.active }),
        queryClient.invalidateQueries({ queryKey: queryKeys.announcements.history }),
      ]);
    },
  });
}
