export type AnnouncementTone = "info" | "success" | "warning";

export type Announcement = {
  id: string;
  title: string;
  message: string;
  tone: AnnouncementTone;
  active?: boolean;
  startsAt?: string | Date | null;
  endsAt?: string | Date | null;
  createdAt?: string | Date;
  updatedAt?: string | Date;
  createdByUserId?: string;
  viewedAt?: string | Date | null;
};

export type AnnouncementsResponse = {
  announcements: Announcement[];
};
