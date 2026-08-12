"use client"

import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CircleDotIcon,
  MinusCircleIcon,
  SearchCheckIcon,
  SnowflakeIcon,
} from "lucide-react"
import { useSocialLabels } from "@/components/social/social-labels"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

/**
 * Moderation states, drawn as states.
 *
 * A queue is triaged by scanning, and every badge in it used to be either
 * "outline" or "secondary" — so urgent and low read the same from a metre
 * away, and the category arrived as the raw enum (`unsafe_content`). Priority
 * is ordered, so it gets an ordered scale; status is a lifecycle, so it gets
 * the icon for the step it is at.
 */

export function ReportPriorityMark({ priority }: { priority: string }) {
  const labels = useSocialLabels()
  const tone =
    priority === "urgent"
      ? "bg-destructive/12 text-destructive"
      : priority === "high"
        ? "bg-caution/14 text-caution"
        : priority === "low"
          ? "bg-muted text-muted-foreground"
          : "bg-primary/10 text-primary"

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        tone
      )}
    >
      {priority === "urgent" || priority === "high" ? (
        <AlertTriangleIcon className="size-3 shrink-0" aria-hidden />
      ) : null}
      {labels.reportPriority(priority)}
    </span>
  )
}

export function ReportStatusMark({ status }: { status: string }) {
  const labels = useSocialLabels()
  const Icon =
    status === "open"
      ? CircleDotIcon
      : status === "investigating"
        ? SearchCheckIcon
        : status === "resolved"
          ? CheckCircle2Icon
          : MinusCircleIcon

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        status === "resolved"
          ? "bg-positive/12 text-positive"
          : status === "open"
            ? "bg-foreground/8 text-foreground"
            : "bg-muted text-muted-foreground"
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      {labels.reportStatus(status)}
    </span>
  )
}

/** Active, frozen or archived — the only one that needs to shout is frozen. */
export function GroupStateMark({ state }: { state: string }) {
  const labels = useSocialLabels()

  if (state === "frozen") {
    return (
      <Badge variant="destructive">
        <SnowflakeIcon aria-hidden /> {labels.groupState(state)}
      </Badge>
    )
  }
  return (
    <Badge
      variant="outline"
      className={state === "archived" ? "text-muted-foreground" : undefined}
    >
      {labels.groupState(state)}
    </Badge>
  )
}
