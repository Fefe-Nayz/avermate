"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  InboxIcon,
  InfoIcon,
  OctagonAlertIcon,
} from "lucide-react"
import { useFormatter, useExtracted } from "next-intl"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { PageMeta } from "@/components/shell/page-chrome"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"
import { cn } from "@/lib/utils"
import { useYear } from "@/components/year/year-provider"

const TONE = {
  info: { icon: InfoIcon, className: "bg-primary/8" },
  success: { icon: CheckCircle2Icon, className: "bg-band-good/12" },
  warning: { icon: AlertTriangleIcon, className: "bg-band-fair/16" },
  danger: { icon: OctagonAlertIcon, className: "bg-destructive/10" },
} as const

export function AnnouncementsClient() {
  const t = useExtracted()
  const format = useFormatter()
  const { yearId } = useYear()
  const queryClient = useQueryClient()
  const history = useQuery({
    ...orpc.announcements.history.queryOptions({
      input: { yearId: yearId ?? "" },
    }),
    enabled: Boolean(yearId),
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  const dismiss = useMutation({
    ...orpc.announcements.dismiss.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.announcements.history.key(),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.announcements.active.key(),
        }),
      ])
    },
  })

  return (
    <>
      <PageMeta title={t("Announcements")} backHref="/more" />
      <div className="flex flex-col gap-4">
        <h1 className="hidden text-2xl font-semibold tracking-tight md:block">
          {t("Announcements")}
        </h1>

        {history.data?.length ? (
          <div className="overflow-hidden rounded-xl border bg-card">
            {history.data.map((announcement, index) => {
              const tone =
                TONE[announcement.tone as keyof typeof TONE] ?? TONE.info
              const Icon = tone.icon
              return (
                <article
                  key={announcement.id}
                  className={cn(
                    "flex gap-3 p-4",
                    index > 0 && "border-t",
                    !announcement.dismissed && "bg-primary/[0.025]"
                  )}
                >
                  <span
                    className={cn(
                      "grid size-9 shrink-0 place-items-center rounded-lg",
                      tone.className
                    )}
                  >
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-medium">{announcement.title}</h2>
                      {!announcement.dismissed ? (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary uppercase">
                          {t("New")}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {announcement.message}
                    </p>
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <time className="text-xs text-muted-foreground">
                        {format.dateTime(new Date(announcement.createdAt), {
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                        })}
                      </time>
                      {!announcement.dismissed &&
                      announcement.currentlyActive ? (
                        <Button
                          variant="ghost"
                          size="xs"
                          disabled={dismiss.isPending}
                          onClick={() =>
                            dismiss.mutate({
                              announcementId: announcement.id,
                              yearId: yearId ?? undefined,
                            })
                          }
                        >
                          {t("Mark as read")}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        ) : (
          <Empty className="rounded-xl border bg-card">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <InboxIcon />
              </EmptyMedia>
              <EmptyTitle>{t("No announcements")}</EmptyTitle>
              <EmptyDescription>
                {t("Product updates and important notices will appear here.")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </>
  )
}
