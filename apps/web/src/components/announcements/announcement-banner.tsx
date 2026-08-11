"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  InfoIcon,
  OctagonAlertIcon,
  XIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { useYear } from "@/components/year/year-provider"
import { orpc } from "@/lib/orpc"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"
import { cn } from "@/lib/utils"
import { haptic } from "@/lib/haptics"

const TONE = {
  info: { icon: InfoIcon, className: "bg-primary/8 text-foreground" },
  success: {
    icon: CheckCircle2Icon,
    className: "bg-band-good/12 text-foreground",
  },
  warning: {
    icon: AlertTriangleIcon,
    className: "bg-band-fair/16 text-foreground",
  },
  danger: {
    icon: OctagonAlertIcon,
    className: "bg-destructive/10 text-foreground",
  },
} as const

/** Product notices. One at a time, dismissible, and never over the content. */
export function AnnouncementBanner() {
  const t = useExtracted()
  const { yearId } = useYear()
  const queryClient = useQueryClient()
  const { data } = useQuery({
    ...orpc.announcements.active.queryOptions({
      input: { yearId: yearId ?? "" },
    }),
    enabled: Boolean(yearId),
    staleTime: COMMON_QUERY_STALE_TIME,
  })

  const dismiss = useMutation({
    ...orpc.announcements.dismiss.mutationOptions(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.announcements.active.key(),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.announcements.history.key(),
        }),
      ])
    },
  })

  const announcement = data?.[0]
  if (!announcement) return null

  const tone = TONE[announcement.tone as keyof typeof TONE] ?? TONE.info
  const Icon = tone.icon

  return (
    <div
      role="status"
      className={cn(
        "flex shrink-0 items-start gap-2.5 border-b px-4 py-2.5 text-sm md:px-6",
        tone.className
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0 opacity-80" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{announcement.title}</p>
        <p className="text-muted-foreground">{announcement.message}</p>
      </div>
      <button
        type="button"
        aria-label={t("Dismiss")}
        onClick={() => {
          haptic("light")
          dismiss.mutate({
            announcementId: announcement.id,
            yearId: yearId ?? undefined,
          })
        }}
        className="-mr-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
      >
        <XIcon className="size-4" />
      </button>
    </div>
  )
}
