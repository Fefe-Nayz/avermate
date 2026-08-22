"use client"

import type {
  AgentActionDto,
  AgentActionEvent,
} from "@avermate/agent-contracts"
import { ActivityIcon, AlertTriangleIcon, ShieldCheckIcon } from "lucide-react"
import { useExtracted, useFormatter } from "next-intl"
import { useState } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { trimActionJson } from "./action-model"
import { ActionStateBadges } from "./action-state-badges"
import { useActionCopy } from "./use-action-copy"

export function ActionInspectDialog({
  action,
  open,
  events,
  loading,
  error,
  resolvingConflict,
  onKeepCurrent,
  onOpenChange,
}: {
  action: AgentActionDto | null
  open: boolean
  events: readonly AgentActionEvent[]
  loading: boolean
  error: string | null
  resolvingConflict: boolean
  onKeepCurrent: (action: AgentActionDto) => void
  onOpenChange: (open: boolean) => void
}) {
  const t = useExtracted()
  const format = useFormatter()
  const actionCopy = useActionCopy()
  const [keepCurrentOpen, setKeepCurrentOpen] = useState(false)
  if (!action) return null
  const reason = actionCopy.reason(action)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{actionCopy.title(action)}</DialogTitle>
          <DialogDescription>
            {t("Immutable action #{sequence} and its durable event history.", {
              sequence: String(action.actionSequence),
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <ActionStateBadges action={action} />
          {reason ? (
            <Alert variant="destructive">
              <AlertTriangleIcon />
              <AlertTitle>{t("Needs attention")}</AlertTitle>
              <AlertDescription>{reason}</AlertDescription>
            </Alert>
          ) : null}
          {action.undoState === "conflicted" ? (
            <Alert>
              <ShieldCheckIcon />
              <AlertTitle>
                {t("Resolve without overwriting newer work")}
              </AlertTitle>
              <AlertDescription>
                {t(
                  "Keep the current user or provider revision and close this conflict explicitly. This does not retry the old write."
                )}
              </AlertDescription>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={resolvingConflict}
                onClick={() => setKeepCurrentOpen(true)}
              >
                {t("Keep current version")}
              </Button>
            </Alert>
          ) : null}
          {action.compensationActionIds.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">
                {t("Compensation actions")}
              </h3>
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
              <ActivityIcon className="size-4" /> {t("Durable events")}
            </h3>
            {loading ? (
              <div
                className="flex flex-col gap-2"
                role="status"
                aria-label={t("Loading action events")}
                aria-busy="true"
              >
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : error ? (
              <Alert variant="destructive">
                <AlertTitle>{t("Events cannot be loaded")}</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : events.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("No durable events were returned for this action.")}
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
                          {format.dateTime(new Date(event.createdAt), {
                            dateStyle: "medium",
                            timeStyle: "medium",
                          })}
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
        <AlertDialog open={keepCurrentOpen} onOpenChange={setKeepCurrentOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("Keep the current version?")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t(
                  "The conflict is journaled as resolved and the current value is preserved. The historical action will not overwrite it."
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
              <AlertDialogAction
                disabled={resolvingConflict}
                onClick={() => onKeepCurrent(action)}
              >
                {t("Keep current version")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  )
}
