"use client"

import type {
  AgentActionBatchCompensationResult,
  AgentActionDto,
  AgentActionPreview,
} from "@avermate/agent-contracts"
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  GitBranchIcon,
  RotateCcwIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  summarizeCompensationResult,
  summarizeUndoPreview,
} from "./action-model"
import { useActionCopy } from "./use-action-copy"

function PreviewActionList({
  title,
  actionIds,
  actions,
  variant,
}: {
  title: string
  actionIds: readonly string[]
  actions: ReadonlyMap<string, AgentActionDto>
  variant: "outline" | "secondary" | "destructive"
}) {
  const actionCopy = useActionCopy()
  if (actionIds.length === 0) return null
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">
        {title} ({actionIds.length})
      </h3>
      <div className="flex flex-wrap gap-1.5">
        {actionIds.map((actionId) => (
          <Badge key={actionId} variant={variant} title={actionId}>
            {actions.has(actionId)
              ? actionCopy.title(actions.get(actionId)!)
              : actionId}
          </Badge>
        ))}
      </div>
    </section>
  )
}

function UndoPreviewContent({
  requestedActionIds,
  preview,
  actions,
}: {
  requestedActionIds: readonly string[]
  preview: AgentActionPreview
  actions: ReadonlyMap<string, AgentActionDto>
}) {
  const t = useExtracted()
  const summary = summarizeUndoPreview(preview, requestedActionIds)
  return (
    <div className="flex flex-col gap-4">
      {summary.expandedDependencyCount > 0 ? (
        <Alert>
          <GitBranchIcon />
          <AlertTitle>
            {t("Dependent actions were added to this preview")}
          </AlertTitle>
          <AlertDescription>
            {t(
              "{count, plural, one {# connected action shares} other {# connected actions share}} a persisted branch or domain dependency. They are evaluated in reverse dependency order; unrelated actions remain untouched.",
              { count: summary.expandedDependencyCount }
            )}
          </AlertDescription>
        </Alert>
      ) : null}
      {summary.partialExpected ? (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>
            {t("This undo cannot complete as one clean batch")}
          </AlertTitle>
          <AlertDescription>
            {t(
              "Safe independent actions can still be undone. Conflicted, non-undoable or dependency-blocked actions will remain and be reported individually."
            )}
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <PreviewActionList
          title={t("Ready to undo")}
          actionIds={preview.eligible}
          actions={actions}
          variant="secondary"
        />
        <PreviewActionList
          title={t("Conflicted by later changes")}
          actionIds={preview.conflicted}
          actions={actions}
          variant="destructive"
        />
        <PreviewActionList
          title={t("Blocked by dependencies")}
          actionIds={preview.blocked}
          actions={actions}
          variant="destructive"
        />
        <PreviewActionList
          title={t("Not undoable")}
          actionIds={preview.nonUndoable}
          actions={actions}
          variant="outline"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {t(
          "Preview bound to dependency fence {version}. A revision or dependency change before confirmation will make it stale instead of overwriting newer work.",
          { version: String(preview.dependencyFenceVersion) }
        )}
      </p>
    </div>
  )
}

function UndoResultContent({
  result,
  actions,
}: {
  result: AgentActionBatchCompensationResult
  actions: ReadonlyMap<string, AgentActionDto>
}) {
  const t = useExtracted()
  const actionCopy = useActionCopy()
  const summary = summarizeCompensationResult(result)
  return (
    <div className="flex flex-col gap-4">
      <Alert variant={summary.kind === "complete" ? "default" : "destructive"}>
        {summary.kind === "complete" ? (
          <CheckCircle2Icon />
        ) : (
          <AlertTriangleIcon />
        )}
        <AlertTitle>
          {summary.kind === "complete"
            ? t("Undo completed")
            : summary.kind === "partial"
              ? t("Undo completed only partially")
              : t("Undo could not be completed")}
        </AlertTitle>
        <AlertDescription>
          {summary.kind === "complete"
            ? t(
                "{count, plural, one {# action was compensated} other {# actions were compensated}} in safe dependency order.",
                { count: summary.compensatedCount }
              )
            : t(
                "{compensated, plural, one {# compensation remains completed.} other {# compensations remain completed.}} {unresolved, plural, one {# action needs} other {# actions need}} conflict resolution or repair; nothing was rolled back silently.",
                {
                  compensated: summary.compensatedCount,
                  unresolved: summary.unresolvedActionIds.length,
                }
              )}
        </AlertDescription>
      </Alert>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("Source action")}</TableHead>
            <TableHead>{t("Outcome")}</TableHead>
            <TableHead>{t("Reason")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.outcomes.map((outcome) => (
            <TableRow key={outcome.sourceActionId}>
              <TableCell>
                <span className="font-medium">
                  {actions.has(outcome.sourceActionId)
                    ? actionCopy.title(actions.get(outcome.sourceActionId)!)
                    : outcome.sourceActionId}
                </span>
              </TableCell>
              <TableCell>
                <Badge
                  variant={
                    outcome.state === "compensated"
                      ? "secondary"
                      : "destructive"
                  }
                >
                  {outcome.state === "compensated"
                    ? t("Compensated")
                    : outcome.state === "conflicted"
                      ? t("Conflicted")
                      : outcome.state === "failed"
                        ? t("Failed")
                        : outcome.state === "blocked"
                          ? t("Blocked")
                          : t("Not attempted")}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {outcome.reasonCode
                  ? actionCopy.reasonCode(outcome.reasonCode)
                  : t("No additional reason was recorded.")}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export function ActionUndoDialog({
  open,
  requestedActionIds,
  preview,
  result,
  actions,
  previewPending,
  executePending,
  error,
  onOpenChange,
  onExecute,
  onRetryUnresolved,
}: {
  open: boolean
  requestedActionIds: readonly string[]
  preview: AgentActionPreview | null
  result: AgentActionBatchCompensationResult | null
  actions: ReadonlyMap<string, AgentActionDto>
  previewPending: boolean
  executePending: boolean
  error: string | null
  onOpenChange: (open: boolean) => void
  onExecute: () => void
  onRetryUnresolved: (actionIds: readonly string[]) => void
}) {
  const t = useExtracted()
  const previewSummary = preview
    ? summarizeUndoPreview(preview, requestedActionIds)
    : null
  const resultSummary = result ? summarizeCompensationResult(result) : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("Review selective undo")}</DialogTitle>
          <DialogDescription>
            {t(
              "Undo creates new compensating actions. It never erases the original audit history or broadly rewinds your data."
            )}
          </DialogDescription>
        </DialogHeader>

        {previewPending ? (
          <div
            className="flex flex-col gap-3"
            role="status"
            aria-label={t("Building undo preview")}
            aria-busy="true"
          >
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertTriangleIcon />
            <AlertTitle>{t("Undo preview is unavailable")}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : result ? (
          <UndoResultContent result={result} actions={actions} />
        ) : preview ? (
          <UndoPreviewContent
            requestedActionIds={requestedActionIds}
            preview={preview}
            actions={actions}
          />
        ) : null}

        <DialogFooter>
          {resultSummary?.unresolvedActionIds.length ? (
            <Button
              type="button"
              variant="outline"
              disabled={previewPending || executePending}
              onClick={() =>
                onRetryUnresolved(resultSummary.unresolvedActionIds)
              }
            >
              <RotateCcwIcon data-icon="inline-start" />
              {t("Recompute unresolved preview")}
            </Button>
          ) : null}
          {!result && preview ? (
            <Button
              type="button"
              disabled={!previewSummary?.canExecute || executePending}
              onClick={onExecute}
            >
              {executePending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <RotateCcwIcon data-icon="inline-start" />
              )}
              {t(
                "Confirm undo of {count, plural, one {# action} other {# actions}}",
                { count: previewSummary?.eligibleCount ?? 0 }
              )}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            disabled={executePending}
            onClick={() => onOpenChange(false)}
          >
            {result ? t("Close") : t("Cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
