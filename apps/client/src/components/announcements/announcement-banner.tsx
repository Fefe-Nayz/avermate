"use client";

import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

import { BodyPortal } from "@/components/portal/body-portal";
import { Button } from "@/components/ui/button";
import { useAnnouncements, useDismissAnnouncement } from "@/hooks/use-announcements";
import { authClient } from "@/lib/auth";
import { cn } from "@/lib/utils";
import type { AnnouncementTone } from "@/types/announcement";

const toneStyles: Record<AnnouncementTone, string> = {
  info: "border-blue-500/30 bg-blue-500/10 text-blue-950 dark:text-blue-100",
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-950 dark:text-emerald-100",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-950 dark:text-amber-100",
};

const toneIcons = {
  info: Info,
  success: CheckCircle2,
  warning: AlertCircle,
};

export function AnnouncementBanner() {
  const { data: session, isPending: isSessionPending } = authClient.useSession();
  const { data: announcements } = useAnnouncements(Boolean(session) && !isSessionPending);
  const dismissAnnouncement = useDismissAnnouncement();
  const announcement = announcements?.[0];

  if (!announcement) {
    return null;
  }

  const Icon = toneIcons[announcement.tone] ?? Info;

  return (
    <BodyPortal>
      <div className="pointer-events-none fixed top-3 left-3 right-3 z-[60] flex justify-center sm:top-4">
        <div
          className={cn(
            "pointer-events-auto flex w-full max-w-2xl items-start gap-3 rounded-lg border p-3 shadow-lg backdrop-blur",
            toneStyles[announcement.tone]
          )}
        >
          <Icon className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{announcement.title}</p>
            <p className="mt-1 text-sm leading-5 opacity-90">
              {announcement.message}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            onClick={() => dismissAnnouncement.mutate(announcement.id)}
            disabled={dismissAnnouncement.isPending}
          >
            <X className="size-4" />
            <span className="sr-only">Fermer</span>
          </Button>
        </div>
      </div>
    </BodyPortal>
  );
}
