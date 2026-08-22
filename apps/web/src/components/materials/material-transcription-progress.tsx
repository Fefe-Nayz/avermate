"use client"

import {
  CheckCircle2Icon,
  RefreshCwIcon,
  ScanTextIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress, ProgressLabel } from "@/components/ui/progress"
import { Spinner } from "@/components/ui/spinner"

export interface MaterialTranscriptionBatchProgress {
  id: string
  status: "running" | "completed" | "completed_with_errors"
  candidates: number
  skipped: number
  total: number
  processed: number
  queued: number
  running: number
  succeeded: number
  failed: number
  cancelled: number
  currentFile: string | null
  failures: Array<{
    documentId: string
    title: string
    error: string | null
  }>
  createdAt: string
}

export function MaterialTranscriptionProgress({
  progress,
  streamState,
  retrying,
  onRetry,
}: {
  progress: MaterialTranscriptionBatchProgress
  streamState: "connecting" | "live" | "fallback" | "idle"
  retrying: boolean
  onRetry: () => void
}) {
  const t = useExtracted()
  const active = progress.status === "running"
  const unsuccessful = progress.failed + progress.cancelled
  const percentage = progress.total
    ? Math.round((progress.processed / progress.total) * 100)
    : active
      ? 0
      : 100

  return (
    <section className="space-y-3 rounded-xl border bg-muted/30 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-background text-muted-foreground ring-1 ring-foreground/10">
            {active ? (
              <ScanTextIcon className="size-4" />
            ) : unsuccessful > 0 ? (
              <TriangleAlertIcon className="size-4 text-destructive" />
            ) : (
              <CheckCircle2Icon className="size-4 text-emerald-600" />
            )}
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-medium">
              {active
                ? t("Transcribing all materials")
                : unsuccessful > 0
                  ? t("Transcription completed with errors")
                  : t("All materials transcribed")}
            </h2>
            <p
              role="status"
              aria-live="polite"
              className="truncate text-xs text-muted-foreground"
            >
              {active && progress.currentFile
                ? t("Current file: {name}", { name: progress.currentFile })
                : t("{succeeded} succeeded, {failed} failed", {
                    succeeded: String(progress.succeeded),
                    failed: String(unsuccessful),
                  })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {active ? (
            <Badge variant="outline">
              {streamState === "live" ? (
                <span className="size-1.5 rounded-full bg-emerald-500" />
              ) : (
                <Spinner className="size-3" />
              )}
              {streamState === "live" ? t("Live") : t("Reconnecting")}
            </Badge>
          ) : unsuccessful > 0 ? (
            <Button size="sm" disabled={retrying} onClick={onRetry}>
              {retrying ? <Spinner /> : <RefreshCwIcon />}
              {t("Retry failed files")}
            </Button>
          ) : null}
        </div>
      </div>

      <Progress value={percentage}>
        <ProgressLabel>{t("Overall progress")}</ProgressLabel>
        <span className="ml-auto text-sm text-muted-foreground tabular-nums">
          {progress.processed}/{progress.total} · {percentage}%
        </span>
      </Progress>

      {active ? (
        <p className="text-xs text-muted-foreground">
          {t("{queued} queued, {running} running, {done} finished", {
            queued: String(progress.queued),
            running: String(progress.running),
            done: String(progress.processed),
          })}
        </p>
      ) : progress.failures.length > 0 ? (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer font-medium text-foreground">
            {t("Show failed files")}
          </summary>
          <ul className="mt-2 space-y-1.5">
            {progress.failures.map((failure) => (
              <li
                key={failure.documentId}
                className="rounded-md bg-background p-2"
              >
                <span className="font-medium text-foreground">
                  {failure.title}
                </span>
                {failure.error ? ` — ${failure.error}` : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  )
}
