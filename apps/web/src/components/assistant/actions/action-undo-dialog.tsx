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
  actionTitle,
  reasonCodeLabel,
  summarizeCompensationResult,
  summarizeUndoPreview,
} from "./action-model"

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
              ? actionTitle(actions.get(actionId)!)
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
  const summary = summarizeUndoPreview(preview, requestedActionIds)
  return (
    <div className="flex flex-col gap-4">
      {summary.expandedDependencyCount > 0 ? (
        <Alert>
          <GitBranchIcon />
          <AlertTitle>Dependent actions were added to this preview</AlertTitle>
          <AlertDescription>
            {summary.expandedDependencyCount} connected action(s) share a
            persisted branch or domain dependency. They are evaluated in reverse
            dependency order; unrelated actions remain untouched.
          </AlertDescription>
        </Alert>
      ) : null}
      {summary.partialExpected ? (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>This undo cannot complete as one clean batch</AlertTitle>
          <AlertDescription>
            Safe independent actions can still be undone. Conflicted,
            non-undoable, or dependency-blocked actions will remain and be
            reported individually.
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <PreviewActionList
          title="Ready to undo"
          actionIds={preview.eligible}
          actions={actions}
          variant="secondary"
        />
        <PreviewActionList
          title="Conflicted by later changes"
          actionIds={preview.conflicted}
          actions={actions}
          variant="destructive"
        />
        <PreviewActionList
          title="Blocked by dependencies"
          actionIds={preview.blocked}
          actions={actions}
          variant="destructive"
        />
        <PreviewActionList
          title="Not undoable"
          actionIds={preview.nonUndoable}
          actions={actions}
          variant="outline"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Preview bound to dependency fence {preview.dependencyFenceVersion}. A
        revision or dependency change before confirmation will make it stale
        instead of overwriting newer work.
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
            ? "Undo completed"
            : summary.kind === "partial"
              ? "Undo completed only partially"
              : "Undo could not be completed"}
        </AlertTitle>
        <AlertDescription>
          {summary.kind === "complete"
            ? `${summary.compensatedCount} action(s) were compensated in safe dependency order.`
            : `${summary.compensatedCount} compensation(s) remain completed. ${summary.unresolvedActionIds.length} action(s) need conflict resolution or repair; nothing was rolled back silently.`}
        </AlertDescription>
      </Alert>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Source action</TableHead>
            <TableHead>Outcome</TableHead>
            <TableHead>Reason</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.outcomes.map((outcome) => (
            <TableRow key={outcome.sourceActionId}>
              <TableCell>
                <span className="font-medium">
                  {actions.has(outcome.sourceActionId)
                    ? actionTitle(actions.get(outcome.sourceActionId)!)
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
                  {outcome.state}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {reasonCodeLabel(outcome.reasonCode)}
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
  const previewSummary = preview
    ? summarizeUndoPreview(preview, requestedActionIds)
    : null
  const resultSummary = result ? summarizeCompensationResult(result) : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Review selective undo</DialogTitle>
          <DialogDescription>
            Undo creates new compensating actions. It never erases the original
            audit history or broadly rewinds your data.
          </DialogDescription>
        </DialogHeader>

        {previewPending ? (
          <div
            className="flex flex-col gap-3"
            aria-label="Building undo preview"
          >
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertTriangleIcon />
            <AlertTitle>Undo preview is unavailable</AlertTitle>
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
              Recompute unresolved preview
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
              Confirm undo of {previewSummary?.eligibleCount ?? 0} action(s)
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            disabled={executePending}
            onClick={() => onOpenChange(false)}
          >
            {result ? "Close" : "Cancel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
