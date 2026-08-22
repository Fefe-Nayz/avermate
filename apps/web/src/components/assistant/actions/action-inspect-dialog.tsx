"use client"

import type {
  AgentActionDto,
  AgentActionEvent,
} from "@avermate/agent-contracts"
import { ActivityIcon, AlertTriangleIcon } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { actionReason, actionTitle, trimActionJson } from "./action-model"
import { ActionStateBadges } from "./action-state-badges"

function eventTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value))
}

export function ActionInspectDialog({
  action,
  open,
  events,
  loading,
  error,
  onOpenChange,
}: {
  action: AgentActionDto | null
  open: boolean
  events: readonly AgentActionEvent[]
  loading: boolean
  error: string | null
  onOpenChange: (open: boolean) => void
}) {
  if (!action) return null
  const reason = actionReason(action)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{actionTitle(action)}</DialogTitle>
          <DialogDescription>
            Immutable action #{action.actionSequence} and its durable event
            history.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <ActionStateBadges action={action} />
          {reason ? (
            <Alert variant="destructive">
              <AlertTriangleIcon />
              <AlertTitle>Needs attention</AlertTitle>
              <AlertDescription>{reason}</AlertDescription>
            </Alert>
          ) : null}
          {action.compensationActionIds.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">Compensation actions</h3>
              <div className="flex flex-wrap gap-1.5">
                {action.compensationActionIds.map((actionId) => (
                  <Badge key={actionId} variant="outline" title={actionId}>
                    {actionId}
                  </Badge>
                ))}
              </div>
            </section>
          ) : null}
          <section className="flex min-h-0 flex-col gap-2">
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <ActivityIcon className="size-4" /> Durable events
            </h3>
            {loading ? (
              <div
                className="flex flex-col gap-2"
                aria-label="Loading action events"
              >
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : error ? (
              <Alert variant="destructive">
                <AlertTitle>Events cannot be loaded</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : events.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No durable events were returned for this action.
              </p>
            ) : (
              <ScrollArea className="max-h-80">
                <ol className="flex flex-col gap-2 pr-3">
                  {events.map((event) => (
                    <li key={event.id} className="rounded-lg border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono text-xs">{event.type}</span>
                        <time
                          dateTime={event.createdAt}
                          className="text-xs text-muted-foreground"
                        >
                          {eventTimestamp(event.createdAt)}
                        </time>
                      </div>
                      <pre className="mt-2 overflow-auto text-xs whitespace-pre-wrap text-muted-foreground">
                        {trimActionJson(event.payload, 4_000)}
                      </pre>
                    </li>
                  ))}
                </ol>
              </ScrollArea>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
