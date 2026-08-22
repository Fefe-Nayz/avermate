export const TERMINAL_WORKFLOW_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "superseded",
])

export function workflowStatusVariant(
  status: string
): "default" | "secondary" | "outline" | "destructive" {
  if (status === "failed") return "destructive"
  if (status === "completed") return "default"
  if (status === "running" || status === "awaiting_approval") return "secondary"
  return "outline"
}

export function stageProgress(processed: number, total: number): number {
  if (!Number.isFinite(processed) || !Number.isFinite(total) || total <= 0)
    return 0
  return Math.min(100, Math.max(0, Math.round((processed / total) * 100)))
}

export function stageCanApprove(status: string): boolean {
  return status === "awaiting_approval"
}

export function stageCanRetry(status: string): boolean {
  return ["failed", "cancelled"].includes(status)
}

export function selectedProjectSourceVersions(
  items: readonly {
    contextMode: string
    missing: boolean
    selectorReviewRequired: boolean
    trackingMode: string
    sourceVersionId: string | null
    currentVersionId: string | null
  }[]
): { versionIds: string[]; pendingCount: number } {
  const eligible = items.filter(
    (item) =>
      item.contextMode !== "exclude" &&
      !item.missing &&
      !item.selectorReviewRequired
  )
  const selected = eligible.map((item) =>
    item.trackingMode === "pinned"
      ? item.sourceVersionId
      : item.currentVersionId
  )
  return {
    versionIds: [
      ...new Set(selected.filter((value): value is string => Boolean(value))),
    ],
    pendingCount: selected.filter((value) => !value).length,
  }
}

export function outputPreviewKind(
  mimeType: string
): "pdf" | "image" | "audio" | "video" | "html" | "text" | "unknown" {
  if (mimeType === "application/pdf") return "pdf"
  if (mimeType.startsWith("image/")) return "image"
  if (mimeType.startsWith("audio/")) return "audio"
  if (mimeType.startsWith("video/")) return "video"
  if (mimeType === "text/html") return "html"
  if (mimeType.startsWith("text/") || mimeType.includes("json")) return "text"
  return "unknown"
}
