"use client"

import { useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { DownloadIcon, FileOutputIcon, RefreshCwIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"
import { exportedPptxFileId, isActiveExportJob } from "./document-export-model"

interface RequestedExport {
  jobId: string
  revision: number
}

export function DocumentPptxExport({
  documentId,
  revision,
  disabled = false,
}: {
  documentId: string
  revision: number
  disabled?: boolean
}) {
  const t = useExtracted()
  const [requested, setRequested] = useState<RequestedExport | null>(null)
  const stale = Boolean(requested && requested.revision !== revision)
  const job = useQuery({
    ...orpc.jobs.get.queryOptions({
      input: { jobId: requested?.jobId ?? "" },
    }),
    enabled: Boolean(requested && !stale),
    refetchInterval: (query) =>
      isActiveExportJob(query.state.data?.status) ? 1_500 : false,
  })
  const start = useMutation({
    ...orpc.documents.exportPptx.mutationOptions(),
    onSuccess: (result) => {
      haptic("success")
      setRequested({ jobId: result.jobId, revision: result.revision })
      toast.success(t("PowerPoint export queued."))
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("The PowerPoint export could not start."))
    },
  })
  const download = useMutation({
    ...orpc.documents.downloadPptx.mutationOptions(),
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("The PowerPoint export is unavailable."))
    },
  })

  const status = stale ? undefined : job.data?.status
  const active = start.isPending || isActiveExportJob(status)
  const fileId =
    status === "succeeded" ? exportedPptxFileId(job.data?.result) : null
  const failed =
    !stale &&
    (job.isError ||
      status === "failed" ||
      status === "cancelled" ||
      (status === "succeeded" && !fileId))

  const openDownload = async () => {
    if (!requested) return
    const target = window.open("about:blank", "_blank")
    if (target) target.opener = null
    try {
      const result = await download.mutateAsync({
        documentId,
        revision: requested.revision,
      })
      if (target) target.location.replace(result.url)
      else {
        const anchor = window.document.createElement("a")
        anchor.href = result.url
        anchor.target = "_blank"
        anchor.rel = "noreferrer"
        anchor.click()
      }
    } catch {
      target?.close()
    }
  }

  if (fileId) {
    return (
      <div className="flex items-center gap-1" aria-live="polite">
        <Button
          size="sm"
          disabled={download.isPending}
          onClick={() => void openDownload()}
        >
          {download.isPending ? <Spinner /> : <DownloadIcon />}
          {t("Download PowerPoint")}
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t("Export this revision again")}
          disabled={disabled || start.isPending}
          onClick={() => start.mutate({ documentId })}
        >
          <RefreshCwIcon />
        </Button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2" aria-live="polite">
      <Button
        size="sm"
        variant={failed ? "outline" : "default"}
        disabled={disabled || active}
        onClick={() => start.mutate({ documentId })}
      >
        {active ? <Spinner /> : failed ? <RefreshCwIcon /> : <FileOutputIcon />}
        {active
          ? t("Exporting PowerPoint…")
          : failed
            ? t("Retry PowerPoint export")
            : t("Export PowerPoint")}
      </Button>
      {failed ? (
        <span className="max-w-56 truncate text-xs text-destructive">
          {job.error?.message ||
            (typeof job.data?.error === "string"
              ? job.data.error
              : t("PowerPoint export failed."))}
        </span>
      ) : null}
    </div>
  )
}
