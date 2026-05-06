"use client";

import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Credenza,
  CredenzaDescription,
  CredenzaHeader,
  CredenzaTitle,
  CredenzaTrigger,
} from "@/components/ui/credenza";
import CredenzaBodyWrapper from "@/components/credenza/credenza-body-wrapper";
import CredenzaContentWrapper from "@/components/credenza/credenza-content-wrapper";
import {
  useAnnouncementHistory,
  useAnnouncements,
  useDismissAnnouncement,
} from "@/hooks/use-announcements";
import { authClient } from "@/lib/auth";
import type { Announcement, AnnouncementTone } from "@/types/announcement";
import { useState } from "react";
import { useTranslations } from "next-intl";

const toneIcons: Record<AnnouncementTone, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertCircle,
};

const toneLabelKeys: Record<AnnouncementTone, "toneInfo" | "toneSuccess" | "toneWarning"> = {
  info: "toneInfo",
  success: "toneSuccess",
  warning: "toneWarning",
};

function formatViewedAt(value: Announcement["viewedAt"], hiddenLabel: string) {
  if (!value) {
    return hiddenLabel;
  }

  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function useAnnouncementsCount() {
  const { data: session, isPending: isSessionPending } = authClient.useSession();
  const enabled = Boolean(session) && !isSessionPending;
  const { data: activeAnnouncements } = useAnnouncements(enabled);
  const { data: dismissedAnnouncements } = useAnnouncementHistory(enabled);

  return {
    enabled,
    unreadCount: activeAnnouncements?.length ?? 0,
    totalCount:
      (activeAnnouncements?.length ?? 0) +
      (dismissedAnnouncements?.length ?? 0),
  };
}

export function AnnouncementMenu({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = useTranslations("Dashboard.Notifications");
  const { data: session, isPending: isSessionPending } = authClient.useSession();
  const enabled = Boolean(session) && !isSessionPending;
  const [open, setOpen] = useState(false);
  const { data: activeAnnouncements } = useAnnouncements(enabled);
  const { data: dismissedAnnouncements } = useAnnouncementHistory(enabled);
  const dismissAnnouncement = useDismissAnnouncement();

  if (!enabled) {
    return null;
  }

  const renderAnnouncement = (
    announcement: Announcement,
    options?: { dismissed?: boolean }
  ) => {
    const Icon = toneIcons[announcement.tone] ?? Info;
    const toneKey = toneLabelKeys[announcement.tone] ?? "toneInfo";

    return (
      <div
        key={announcement.id}
        className="rounded-md border bg-card p-3 text-card-foreground"
      >
        <div className="flex items-start gap-3">
          <div className="rounded-md border bg-muted p-2 text-muted-foreground">
            <Icon className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium leading-tight">{announcement.title}</p>
              <Badge variant="outline">{t(toneKey)}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {announcement.message}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {options?.dismissed
                ? formatViewedAt(announcement.viewedAt, t("hidden"))
                : t("shown")}
            </p>
          </div>
          {!options?.dismissed ? (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              onClick={() => dismissAnnouncement.mutate(announcement.id)}
              disabled={dismissAnnouncement.isPending}
            >
              <X className="size-4" />
              <span className="sr-only">{t("dismiss")}</span>
            </Button>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <Credenza open={open} onOpenChange={setOpen}>
      <CredenzaTrigger asChild>{children}</CredenzaTrigger>
      <CredenzaContentWrapper>
        <CredenzaHeader>
          <CredenzaTitle>{t("title")}</CredenzaTitle>
          <CredenzaDescription>{t("description")}</CredenzaDescription>
        </CredenzaHeader>
        <CredenzaBodyWrapper>
          <div className="space-y-3">
            {activeAnnouncements?.length ? (
              <section className="space-y-2">
                <p className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("sectionUnread")}
                </p>
                {activeAnnouncements.map((announcement) =>
                  renderAnnouncement(announcement)
                )}
              </section>
            ) : null}

            {dismissedAnnouncements?.length ? (
              <section className="space-y-2">
                <p className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("sectionDismissed")}
                </p>
                {dismissedAnnouncements.map((announcement) =>
                  renderAnnouncement(announcement, { dismissed: true })
                )}
              </section>
            ) : null}

            {!activeAnnouncements?.length && !dismissedAnnouncements?.length ? (
              <div className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
                {t("empty")}
              </div>
            ) : null}
          </div>
        </CredenzaBodyWrapper>
      </CredenzaContentWrapper>
    </Credenza>
  );
}
