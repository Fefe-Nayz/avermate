"use client"

import type {
  HistoricalBranchChoice,
  HistoricalBranchOperation,
  HistoricalBranchPreview,
} from "@avermate/agent-contracts"
import {
  AlertTriangleIcon,
  GitBranchIcon,
  LoaderCircleIcon,
  PackageOpenIcon,
} from "lucide-react"
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
  const workspaceCopy = preview?.workspaceCopy ?? null
  const snapshot = workspaceCopy?.snapshot ?? null
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Choose what this historical branch copies</DialogTitle>
          <DialogDescription>
            {operation === "edit" ? "Editing" : "Retrying"} creates a new
            conversation branch. Your current branch is never rewound.
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
              <GitBranchIcon className="size-4" /> Branch conversation only
              <Badge variant="secondary">Default</Badge>
            </span>
            <span className="mt-1 block text-sm text-muted-foreground">
              No workspace, snapshot, or study data is changed or copied.
            </span>
          </button>

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
              <PackageOpenIcon className="size-4" /> Branch with workspace copy
            </span>
            {workspaceCopy?.available ? (
              <span className="mt-2 block space-y-2 text-sm text-muted-foreground">
                <span className="block">
                  Copy the confirmed committed snapshot into a new isolated
                  workspace.
                </span>
                <span className="flex flex-wrap gap-1.5">
                  <Badge variant="outline">
                    {workspaceCopy.snapshot.fileCount} files
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
                A committed snapshot exists, but it is not compatible with the
                active workspace provider. No older snapshot will be selected
                automatically.
              </span>
            ) : (
              <span className="mt-1 block text-sm text-muted-foreground">
                No committed workspace snapshot is available at this point.
              </span>
            )}
          </button>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircleIcon className="size-4 animate-spin" /> Checking the
              exact committed snapshot…
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
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
