"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { RefreshCwIcon, ScanTextIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { DocumentMarkdown } from "@/components/documents/document-markdown"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"
import type { MaterialRow } from "../materials-rows"
import { isTranscribableMimeType, mediaKind } from "./file-formats"
import { materialFileOf } from "./row-file"
import { RendererBar, RendererLoading, RendererNotice } from "./renderer-chrome"

function isActiveJob(status: string | undefined): boolean {
  return status === "queued" || status === "running"
}

/**
 * Whether this row has a machine-readable side worth a tab.
 *
 * A scanned handout and an imported web page both do; a note you typed here is
 * already text, and a spreadsheet's text is the spreadsheet.
 */
export function hasTranscript(row: MaterialRow): boolean {
  if (row.source.kind !== "material") return false
  const { sourceType } = row.source.row.document
  if (sourceType === "link") return true
  const file = materialFileOf(row)
  return Boolean(file && isTranscribableMimeType(file.mimeType))
}

/**
 * The text behind a scan.
 *
 * A photographed page is unsearchable, unquotable and invisible to the
 * assistant until something has read it, which is what this pipeline is for.
 * It lives beside the document rather than in a dialog of its own, because
 * "what does this say" is a question about the thing you are looking at.
 */
export function TranscriptPanel({ row }: { row: MaterialRow }) {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const [jobId, setJobId] = useState<string | null>(null)
  const documentId = row.id
  const isLink =
    row.source.kind === "material" &&
    row.source.row.document.sourceType === "link"
  const file = materialFileOf(row)
  const media = mediaKind(row.title, file?.mimeType)

  const transcript = useQuery({
    ...orpc.materials.documents.transcript.queryOptions({
      input: { documentId },
    }),
    refetchInterval: (query) =>
      query.state.data?.status === "pending" ? 1_500 : false,
  })
  const job = useQuery({
    ...orpc.jobs.get.queryOptions({ input: { jobId: jobId ?? "" } }),
    enabled: Boolean(jobId),
    refetchInterval: (query) =>
      isActiveJob(query.state.data?.status) ? 1_500 : false,
  })

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: orpc.materials.documents.transcript.queryKey({
        input: { documentId },
      }),
    })

  const transcribe = useMutation({
    ...orpc.materials.documents.transcribe.mutationOptions(),
    onSuccess: async (result) => {
      haptic("success")
      setJobId(result.jobId)
      toast.success(t("Transcription queued."))
      await refresh()
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("Transcription could not be started."))
    },
  })
  const reingest = useMutation({
    ...orpc.materials.documents.reingest.mutationOptions(),
    onSuccess: async (result) => {
      haptic("success")
      setJobId(result.jobId)
      toast.success(t("Link import queued."))
      await refresh()
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("The link could not be imported."))
    },
  })

  const status = transcript.data?.status ?? "idle"
  const busy =
    status === "pending" ||
    isActiveJob(job.data?.status) ||
    transcribe.isPending ||
    reingest.isPending

  const start = () => {
    if (isLink) reingest.mutate({ documentId })
    else transcribe.mutate({ documentId })
  }

  return (
    <>
      <RendererBar>
        <Badge variant={status === "failed" ? "destructive" : "outline"}>
          {busy
            ? t("In progress")
            : status === "ready"
              ? t("Ready")
              : status === "failed"
                ? t("Failed")
                : t("Not transcribed")}
        </Badge>
        <Button
          size="sm"
          variant="outline"
          className="ms-auto"
          disabled={busy}
          onClick={start}
        >
          {busy ? (
            <Spinner />
          ) : status === "ready" ? (
            <RefreshCwIcon />
          ) : (
            <ScanTextIcon />
          )}
          {status === "ready"
            ? isLink
              ? t("Import again")
              : t("Transcribe again")
            : isLink
              ? t("Import the page")
              : t("Transcribe")}
        </Button>
      </RendererBar>

      {transcript.isPending ? (
        <RendererLoading />
      ) : status === "ready" && transcript.data?.content ? (
        <div className="min-h-0 flex-1 overflow-auto p-6">
          <DocumentMarkdown markdown={transcript.data.content} />
        </div>
      ) : (
        <RendererNotice>
          {busy
            ? media
              ? t("Transcribing the media…")
              : t("Reading the document…")
            : status === "failed"
              ? (transcript.data?.error ?? t("The transcription failed."))
              : isLink
                ? t("Import this page to read it here.")
                : media
                  ? t(
                      "Transcribe this media file to read and search its content."
                    )
                  : t("Transcribe this document to read and search its text.")}
        </RendererNotice>
      )}
    </>
  )
}
