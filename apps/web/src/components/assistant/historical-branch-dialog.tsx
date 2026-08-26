"use client"

import type {
  AgentActionDto,
  HistoricalDataChangesReview,
  HistoricalBranchChoice,
  HistoricalBranchOperation,
  HistoricalBranchPreview,
} from "@avermate/agent-contracts"
import {
  AlertTriangleIcon,
  DatabaseZapIcon,
  GitBranchIcon,
  LoaderCircleIcon,
  PackageOpenIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { useState } from "react"
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
import { rpc } from "@/lib/orpc"

function formatBytes(value: number): string {
  if (value < 1_024) return `${value} B`
  if (value < 1_024 ** 2) return `${(value / 1_024).toFixed(1)} KB`
  return `${(value / 1_024 ** 2).toFixed(1)} MB`
}

export function HistoricalBranchDialog({
  open,
  operation,
  sourceBranchId,
  preview,
  loading,
  error,
  onCancel,
  onChoose,
}: {
  open: boolean
  operation: HistoricalBranchOperation | null
  sourceBranchId: string | null
  preview: HistoricalBranchPreview | null
  loading: boolean
  error: string | null
  onCancel: () => void
  onChoose: (choice: HistoricalBranchChoice) => void
}) {
  const t = useExtracted()
  const [dataReview, setDataReview] =
    useState<HistoricalDataChangesReview | null>(null)
  const [reviewPending, setReviewPending] = useState(false)
  const [undoPending, setUndoPending] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [undoStatus, setUndoStatus] = useState<string | null>(null)
  const workspaceCopy = preview?.workspaceCopy ?? null
  const snapshot = workspaceCopy?.snapshot ?? null

  function resetReviewState() {
    setDataReview(null)
    setReviewError(null)
    setUndoStatus(null)
  }

  async function loadDataReview() {
    if (!preview?.dataChanges.available) return
    setReviewPending(true)
    setReviewError(null)
    try {
      setDataReview(
        await rpc.assistant.messages.dataChangesReview({
          messageId: preview.messageId,
          sourceBranchId: preview.sourceBranchId,
          operation: preview.operation,
        })
      )
    } catch (failure) {
      setReviewError(
        failure instanceof Error
          ? failure.message
          : t("Data changes could not be reviewed.")
      )
    } finally {
      setReviewPending(false)
    }
  }

  async function undoSafeDataChanges() {
    if (!dataReview?.undoPreview) return
    setUndoPending(true)
    setReviewError(null)
    try {
      const result = await rpc.actions.undo.execute({
        preview: dataReview.undoPreview,
      })
      setUndoStatus(
        result.complete
          ? t("Safe data changes were undone.")
          : result.partial
            ? t("Undo completed partially; remaining conflicts need review.")
            : t("No data change could be safely undone.")
      )
      await loadDataReview()
    } catch (failure) {
      setReviewError(
        failure instanceof Error
          ? failure.message
          : t("The selected changes could not be undone.")
      )
    } finally {
      setUndoPending(false)
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onCancel()}
      onOpenChangeComplete={(next) => !next && resetReviewState()}
    >
      <DialogContent
        className="max-h-[90svh] overflow-y-auto sm:max-w-2xl"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>
            {t("Choose what this historical branch copies")}
          </DialogTitle>
          <DialogDescription>
            {operation === "edit"
              ? t(
                  "Editing creates a new conversation branch. Your current branch is never rewound."
                )
              : t(
                  "Retrying creates a new conversation branch. Your current branch is never rewound."
                )}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <button
            type="button"
            className="rounded-xl border bg-card p-4 text-left transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!sourceBranchId}
            onClick={() =>
              sourceBranchId &&
              onChoose({
                mode: "conversation-only",
                sourceBranchId,
              })
            }
          >
            <span className="flex items-center gap-2 font-medium">
              <GitBranchIcon className="size-4" />
              {t("Branch conversation only")}
              <Badge variant="secondary">{t("Default")}</Badge>
            </span>
            <span className="mt-1 block text-sm text-muted-foreground">
              {t("No workspace, snapshot or study data is changed or copied.")}
            </span>
          </button>

          <button
            type="button"
            className="rounded-xl border bg-card p-4 text-left transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={
              loading || reviewPending || !preview?.dataChanges.available
            }
            onClick={() => void loadDataReview()}
          >
            <span className="flex items-center gap-2 font-medium">
              <DatabaseZapIcon className="size-4" />
              {t("Review study-data changes")}
              <Badge variant="outline">{t("Safe review")}</Badge>
            </span>
            <span className="mt-1 block text-sm text-muted-foreground">
              {t(
                "Review only the study-data changes recorded after this message. Branching a conversation never rewinds grades, documents or anything else."
              )}
            </span>
            {preview?.dataChanges && !preview.dataChanges.available ? (
              <span className="mt-2 block text-xs text-muted-foreground">
                {preview.dataChanges.message}
              </span>
            ) : null}
          </button>

          {dataReview ? (
            <section className="flex flex-col gap-3 rounded-xl border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-medium">{t("Study-data review")}</h3>
                  <p className="text-xs text-muted-foreground">
                    {t("Boundary {cursor}", {
                      cursor: dataReview.domainCursorRef,
                    })}
                  </p>
                </div>
                {dataReview.truncated ? (
                  <Badge variant="destructive">{t("Truncated")}</Badge>
                ) : null}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <DataChangeGroup
                  title={t("Safe to undo")}
                  actions={dataReview.safeToCompensate}
                  variant="secondary"
                />
                <DataChangeGroup
                  title={t("Conflicted")}
                  actions={dataReview.conflicted}
                  variant="destructive"
                />
                <DataChangeGroup
                  title={t("Already undone")}
                  actions={dataReview.alreadyCompensated}
                  variant="outline"
                />
                <DataChangeGroup
                  title={t("Not undoable")}
                  actions={dataReview.nonUndoable}
                  variant="outline"
                />
              </div>
              {dataReview.unrelatedActionCount > 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t(
                    "{count, plural, one {# unrelated action was excluded.} other {# unrelated actions were excluded.}}",
                    { count: dataReview.unrelatedActionCount }
                  )}
                </p>
              ) : null}
              {undoStatus ? (
                <p role="status" className="text-sm">
                  {undoStatus}
                </p>
              ) : null}
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={!dataReview.undoPreview || undoPending}
                  onClick={() => void undoSafeDataChanges()}
                >
                  {undoPending ? (
                    <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
                  ) : (
                    <DatabaseZapIcon />
                  )}
                  {t("Undo safe data changes")}
                </Button>
              </div>
            </section>
          ) : null}

          {reviewError ? (
            <div role="alert" className="text-sm text-destructive">
              {reviewError}
            </div>
          ) : null}

          <button
            type="button"
            className="rounded-xl border bg-card p-4 text-left transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={
              !workspaceCopy?.available ||
              loading ||
              preview?.sourceBranchId !== sourceBranchId
            }
            onClick={() => {
              if (
                !sourceBranchId ||
                !workspaceCopy?.available ||
                preview?.sourceBranchId !== sourceBranchId
              ) {
                return
              }
              onChoose({
                mode: "workspace-copy",
                sourceBranchId,
                snapshotId: workspaceCopy.snapshot.id,
                expectedPortableManifestDigest:
                  workspaceCopy.snapshot.portableManifestDigest,
              })
            }}
          >
            <span className="flex items-center gap-2 font-medium">
              <PackageOpenIcon className="size-4" />
              {t("Branch with workspace copy")}
            </span>
            {workspaceCopy?.available ? (
              <span className="mt-2 flex flex-col gap-2 text-sm text-muted-foreground">
                <span className="block">
                  {t(
                    "Copy the confirmed committed snapshot into a new isolated workspace."
                  )}
                </span>
                <span className="flex flex-wrap gap-1.5">
                  <Badge variant="outline">
                    {t("{count, plural, one {# file} other {# files}}", {
                      count: workspaceCopy.snapshot.fileCount,
                    })}
                  </Badge>
                  <Badge variant="outline">
                    {formatBytes(workspaceCopy.snapshot.byteSize)}
                  </Badge>
                  <Badge variant="outline">
                    {workspaceCopy.snapshot.executionProfileId} ·{" "}
                    {workspaceCopy.snapshot.executionProfileVersion}
                  </Badge>
                </span>
                <span className="block truncate font-mono text-xs">
                  {workspaceCopy.snapshot.portableManifestDigest}
                </span>
              </span>
            ) : snapshot ? (
              <span className="mt-2 block text-sm text-muted-foreground">
                {t(
                  "A committed snapshot exists, but it is not compatible with the active workspace provider. No older snapshot will be selected automatically."
                )}
              </span>
            ) : (
              <span className="mt-1 block text-sm text-muted-foreground">
                {t(
                  "No committed workspace snapshot is available at this point."
                )}
              </span>
            )}
          </button>

          {loading ? (
            <div
              className="flex items-center gap-2 text-sm text-muted-foreground"
              role="status"
              aria-live="polite"
            >
              <LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" />
              {t("Checking the exact committed snapshot…")}
            </div>
          ) : error || (workspaceCopy && !workspaceCopy.available) ? (
            <div
              role="status"
              className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm"
            >
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <span>
                {error ||
                  (workspaceCopy && !workspaceCopy.available
                    ? workspaceCopy.message
                    : null)}
              </span>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            {t("Cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DataChangeGroup({
  title,
  actions,
  variant,
}: {
  title: string
  actions: readonly AgentActionDto[]
  variant: "outline" | "secondary" | "destructive"
}) {
  return (
    <div className="rounded-lg bg-muted/30 p-3">
      <p className="text-sm font-medium">
        {title} · {actions.length}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {actions.slice(0, 8).map((action) => (
          <Badge key={action.id} variant={variant} title={action.id}>
            {action.toolId}
          </Badge>
        ))}
      </div>
    </div>
  )
}
