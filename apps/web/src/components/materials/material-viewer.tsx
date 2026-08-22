"use client"

import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ExternalLinkIcon,
  EyeIcon,
  PencilIcon,
  RefreshCwIcon,
  ScanTextIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
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
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"
import { DocumentMarkdown } from "@/components/documents/document-markdown"
import {
  canRetryWithDynamicRendering,
  ingestionReasonMessage,
  safeWebSourceHref,
} from "./link-ingestion-model"
import { OnlyOfficeEditor } from "./onlyoffice-editor"
import { isOfficeEditable, officeEditorKind } from "./onlyoffice-model"
import { useOfficeSession } from "./use-office-session"
import { LinkIngestionBadge, LinkProvenance } from "./link-ingestion-status"
import type { MaterialDocumentView } from "./materials-types"
import { isTranscribableMimeType, mediaKind } from "./renderers/file-formats"

type MaterialViewTab = "source" | "transcript"

function isActiveJob(status: string | undefined): boolean {
  return status === "queued" || status === "running"
}

export function MaterialViewer({
  row,
  initialTab,
  onClose,
}: {
  row: MaterialDocumentView
  initialTab: MaterialViewTab
  onClose: () => void
}) {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<MaterialViewTab>(initialTab)
  const [jobId, setJobId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const documentId = row.document.id

  /**
   * Whether this is something the Document Server can render.
   *
   * Asked of the name and the MIME type rather than of the server, so the pane
   * knows before it fetches anything — a `.mp3` never asks for a session it
   * cannot use.
   */
  const storedFile =
    row.document.sourceType === "file" &&
    (row.file?.status === "stored" || row.file?.status === "ready")
      ? row.file
      : null
  const officeKind = storedFile
    ? officeEditorKind(row.document.title, storedFile.mimeType)
    : null
  // A PDF keeps the browser's own viewer: it is already there, it needs no
  // Document Server, and it opens instantly. The editor earns its keep on the
  // formats that had nothing at all — .docx, .xlsx, .pptx and the ODF ones.
  const usesOffice = officeKind !== null && officeKind !== "pdf"
  const officeEditable =
    usesOffice && isOfficeEditable(row.document.title, storedFile?.mimeType)
  const officeSession = useOfficeSession(
    documentId,
    editing ? "edit" : "view",
    usesOffice && tab === "source"
  )
  // No Document Server in this deployment: the pane keeps the behaviour it had
  // before there was one, rather than showing an editor that cannot load.
  const officeReady =
    officeSession.data?.available === true &&
    officeSession.data.session !== null

  const detail = useQuery({
    ...orpc.materials.documents.get.queryOptions({ input: { documentId } }),
    // The list intentionally excludes inline bodies. Fetch the owned detail
    // only while an inline note is actually open.
    enabled: row.document.sourceType === "text",
  })
  const job = useQuery({
    ...orpc.jobs.get.queryOptions({ input: { jobId: jobId ?? "" } }),
    enabled: Boolean(jobId),
    refetchInterval: (query) =>
      isActiveJob(query.state.data?.status) ? 1_500 : false,
  })
  const transcript = useQuery({
    ...orpc.materials.documents.transcript.queryOptions({
      input: { documentId },
    }),
    refetchInterval: (query) =>
      query.state.data?.status === "pending" ? 1_500 : false,
  })
  const ingestionRevisions = useQuery({
    ...orpc.mediaStudio.ingestionRevisions.queryOptions({
      input: { documentId },
    }),
    enabled: row.document.sourceType === "link",
  })
  const transcribe = useMutation({
    ...orpc.materials.documents.transcribe.mutationOptions(),
    onSuccess: async (result) => {
      haptic("success")
      setJobId(result.jobId)
      toast.success(t("Transcription queued."))
      await queryClient.invalidateQueries({
        queryKey: orpc.materials.documents.transcript.queryKey({
          input: { documentId },
        }),
      })
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("Transcription could not be started."))
    },
  })
  const reingest = useMutation({
    ...orpc.materials.documents.reingest.mutationOptions(),
    onSuccess: (result) => {
      haptic("success")
      setJobId(result.jobId)
      queryClient.setQueryData(
        orpc.materials.documents.transcript.queryKey({
          input: { documentId },
        }),
        { status: result.status, content: null, meta: null, error: null }
      )
      toast.success(t("Link import queued."))
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("The link could not be imported."))
    },
  })
  const retryDynamic = useMutation({
    ...orpc.mediaStudio.retryDynamic.mutationOptions(),
    onSuccess: async (result) => {
      haptic(result.status === "failed" ? "error" : "success")
      await ingestionRevisions.refetch()
      const message = ingestionReasonMessage(result.reasonCode)
      if (result.status === "failed") {
        toast.error(message ?? result.message)
      }
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("Dynamic ingestion could not be started."))
    },
  })
  const download = useMutation({
    ...orpc.materials.documents.download.mutationOptions(),
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("The original source is unavailable."))
    },
  })

  const jobStatus = job.data?.status
  useEffect(() => {
    if (
      jobStatus === "succeeded" ||
      jobStatus === "failed" ||
      jobStatus === "cancelled"
    ) {
      void queryClient.invalidateQueries({
        queryKey: orpc.materials.documents.transcript.queryKey({
          input: { documentId },
        }),
      })
      void queryClient.invalidateQueries({
        queryKey: orpc.materials.documents.list.key(),
      })
    }
  }, [documentId, jobStatus, queryClient])

  const sourceUrl =
    row.document.sourceType === "link"
      ? safeWebSourceHref(row.document.sourceUrl)
      : null
  const latestIngestionRevision = ingestionRevisions.data?.[0] ?? null
  const advancedReason = latestIngestionRevision?.reasonCode ?? null
  const advancedReasonText = ingestionReasonMessage(advancedReason)
  const canOpenUploadedFile =
    row.document.sourceType === "file" &&
    (row.file?.status === "stored" || row.file?.status === "ready")
  const canPreviewPdf =
    canOpenUploadedFile && row.file?.mimeType === "application/pdf"
  const previewMediaKind = canOpenUploadedFile
    ? mediaKind(row.document.title, row.file?.mimeType)
    : null
  const canPreviewUploadedFile = canPreviewPdf || previewMediaKind !== null
  const pdfPreviewUrl =
    canPreviewPdf && download.data?.url
      ? `${download.data.url}#view=FitH`
      : null

  useEffect(() => {
    if (
      tab !== "source" ||
      !canPreviewUploadedFile ||
      download.status !== "idle"
    ) {
      return
    }
    download.mutate({ documentId })
  }, [canPreviewUploadedFile, documentId, download, tab])

  const openUploadedFile = async () => {
    // Open synchronously from the click so popup blockers keep the tab. The
    // private URL is minted only now, never cached in the Materials list.
    const target = window.open("about:blank", "_blank")
    if (target) target.opener = null
    try {
      const result = await download.mutateAsync({ documentId })
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
  const canTranscribe =
    row.document.sourceType === "file" &&
    Boolean(row.file && isTranscribableMimeType(row.file.mimeType))
  const transcriptStatus = transcript.data?.status ?? "idle"
  const transcriptMeta = transcript.data?.meta
  const transcriptPageCount =
    transcriptMeta &&
    "pageCount" in transcriptMeta &&
    typeof transcriptMeta.pageCount === "number"
      ? transcriptMeta.pageCount
      : null
  const active =
    transcriptStatus === "pending" ||
    isActiveJob(jobStatus) ||
    transcribe.isPending ||
    reingest.isPending ||
    transcript.isFetching
  const statusLabel = active
    ? t("In progress")
    : transcriptStatus === "ready"
      ? t("Ready")
      : transcriptStatus === "failed"
        ? t("Failed")
        : t("Not transcribed")

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={
          canPreviewPdf || previewMediaKind === "video" || usesOffice
            ? "h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-h-[56rem] sm:max-w-6xl"
            : "sm:max-w-3xl"
        }
      >
        <DialogHeader>
          <DialogTitle>{row.document.title}</DialogTitle>
          <DialogDescription>
            {t(
              "Open the original source or use its machine-readable transcript."
            )}
          </DialogDescription>
        </DialogHeader>
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as MaterialViewTab)}
          className={
            canPreviewPdf || previewMediaKind === "video" || usesOffice
              ? "min-h-0 overflow-hidden"
              : "min-h-72"
          }
        >
          <TabsList>
            <TabsTrigger value="source">{t("Source")}</TabsTrigger>
            <TabsTrigger value="transcript">{t("Transcription")}</TabsTrigger>
          </TabsList>
          <TabsContent
            value="source"
            className={
              canPreviewPdf || previewMediaKind === "video" || usesOffice
                ? "min-h-0 overflow-hidden pt-3"
                : "pt-3"
            }
          >
            {row.document.sourceType === "text" && detail.isLoading ? (
              <div className="grid min-h-48 place-items-center">
                <Spinner />
              </div>
            ) : row.document.sourceType === "text" && detail.isError ? (
              <p
                role="alert"
                className="rounded-lg border p-4 text-sm text-destructive"
              >
                {detail.error.message || t("This note could not be loaded.")}
              </p>
            ) : row.document.sourceType === "text" ? (
              <pre className="max-h-[55vh] overflow-auto rounded-lg border bg-muted/30 p-4 font-sans whitespace-pre-wrap">
                {detail.data?.document.textContent || t("This note is empty.")}
              </pre>
            ) : usesOffice ? (
              <div className="flex h-full min-h-80 flex-col overflow-hidden rounded-lg border bg-muted/20">
                <div className="flex shrink-0 items-center justify-between gap-3 border-b bg-background px-3 py-2">
                  <span className="truncate text-sm font-medium">
                    {editing ? t("Editing") : t("Preview")}
                  </span>
                  <div className="flex items-center gap-1">
                    {/* Offered only where the format survives a save. A .doc
                        opens fine and cannot be written back as a .doc, and a
                        Save button that silently changes what your file is is
                        worse than no Save button. */}
                    {officeEditable && officeReady ? (
                      <Button
                        size="sm"
                        variant={editing ? "outline" : "default"}
                        onClick={() => setEditing((current) => !current)}
                      >
                        {editing ? <EyeIcon /> : <PencilIcon />}
                        {editing ? t("Read") : t("Edit")}
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={download.isPending}
                      onClick={() => void openUploadedFile()}
                    >
                      <ExternalLinkIcon /> {t("Open source")}
                    </Button>
                  </div>
                </div>
                {officeSession.isPending ? (
                  <div className="grid min-h-0 flex-1 place-items-center">
                    <Spinner className="size-5" />
                  </div>
                ) : officeReady && officeSession.data?.session ? (
                  <OnlyOfficeEditor
                    session={officeSession.data.session}
                    documentId={documentId}
                  />
                ) : (
                  <div className="grid min-h-0 flex-1 place-items-center p-6 text-center">
                    <div className="max-w-sm space-y-3">
                      <p className="text-sm text-muted-foreground">
                        {officeSession.isError
                          ? t("The document editor is unavailable right now.")
                          : t(
                              "This file opens in a new browser tab. Editing in place needs a document server, which this installation does not have."
                            )}
                      </p>
                      {officeSession.isError ? (
                        <Button
                          size="sm"
                          onClick={() => void officeSession.refetch()}
                        >
                          <RefreshCwIcon /> {t("Retry")}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>
            ) : previewMediaKind ? (
              <div className="flex h-full min-h-56 flex-col overflow-hidden rounded-lg border bg-muted/20">
                <div className="flex shrink-0 items-center justify-between gap-3 border-b bg-background px-3 py-2">
                  <span className="truncate text-sm font-medium">
                    {t("Preview")}
                  </span>
                  {download.data?.url ? (
                    <Button
                      size="sm"
                      variant="outline"
                      render={
                        <a
                          href={download.data.url}
                          target="_blank"
                          rel="noreferrer"
                        />
                      }
                    >
                      <ExternalLinkIcon /> {t("Open source")}
                    </Button>
                  ) : null}
                </div>
                {download.isPending ? (
                  <div className="grid min-h-0 flex-1 place-items-center">
                    <Spinner className="size-5" />
                  </div>
                ) : download.isError ? (
                  <div className="grid min-h-0 flex-1 place-items-center p-6 text-center">
                    <div className="space-y-3">
                      <p role="alert" className="text-sm text-destructive">
                        {download.error.message ||
                          t("The original source is unavailable.")}
                      </p>
                      <Button
                        size="sm"
                        onClick={() => download.mutate({ documentId })}
                      >
                        <RefreshCwIcon /> {t("Retry")}
                      </Button>
                    </div>
                  </div>
                ) : download.data?.url ? (
                  <div className="grid min-h-0 flex-1 place-items-center p-4">
                    {previewMediaKind === "audio" ? (
                      <audio
                        className="w-full max-w-2xl"
                        src={download.data.url}
                        controls
                        preload="metadata"
                      >
                        {t("Your browser cannot play this audio file.")}
                      </audio>
                    ) : (
                      <video
                        className="max-h-full max-w-full rounded-md bg-black"
                        src={download.data.url}
                        controls
                        playsInline
                        preload="metadata"
                      >
                        {t("Your browser cannot play this video file.")}
                      </video>
                    )}
                  </div>
                ) : (
                  <div className="grid min-h-0 flex-1 place-items-center">
                    <Spinner className="size-5" />
                  </div>
                )}
              </div>
            ) : canPreviewPdf ? (
              <div className="flex h-full min-h-80 flex-col overflow-hidden rounded-lg border bg-muted/20">
                <div className="flex shrink-0 items-center justify-between gap-3 border-b bg-background px-3 py-2">
                  <span className="truncate text-sm font-medium">
                    {t("Preview")}
                  </span>
                  {download.data?.url ? (
                    <Button
                      size="sm"
                      variant="outline"
                      render={
                        <a
                          href={download.data.url}
                          target="_blank"
                          rel="noreferrer"
                        />
                      }
                    >
                      <ExternalLinkIcon /> {t("Open source")}
                    </Button>
                  ) : null}
                </div>
                {download.isPending ? (
                  <div className="grid min-h-0 flex-1 place-items-center">
                    <Spinner className="size-5" />
                  </div>
                ) : download.isError ? (
                  <div className="grid min-h-0 flex-1 place-items-center p-6 text-center">
                    <div className="space-y-3">
                      <p role="alert" className="text-sm text-destructive">
                        {download.error.message ||
                          t("The original source is unavailable.")}
                      </p>
                      <Button
                        size="sm"
                        onClick={() => download.mutate({ documentId })}
                      >
                        <RefreshCwIcon /> {t("Retry")}
                      </Button>
                    </div>
                  </div>
                ) : pdfPreviewUrl ? (
                  <iframe
                    src={pdfPreviewUrl}
                    title={`${t("Preview")}: ${row.document.title}`}
                    className="min-h-0 flex-1 bg-background"
                  />
                ) : (
                  <div className="grid min-h-0 flex-1 place-items-center">
                    <Spinner className="size-5" />
                  </div>
                )}
              </div>
            ) : sourceUrl || canOpenUploadedFile ? (
              <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-6 text-center">
                <p className="max-w-sm text-sm text-muted-foreground">
                  {row.document.sourceType === "link"
                    ? t("This link opens on its original website.")
                    : t("This file opens in a new browser tab.")}
                </p>
                {row.document.sourceType === "link" ? (
                  <LinkProvenance
                    meta={transcript.data?.meta}
                    sourceUrl={row.document.sourceUrl}
                    className="max-w-full text-xs text-muted-foreground"
                  />
                ) : null}
                {sourceUrl ? (
                  <Button
                    render={
                      <a href={sourceUrl} target="_blank" rel="noreferrer" />
                    }
                  >
                    <ExternalLinkIcon /> {t("Open source")}
                  </Button>
                ) : (
                  <Button
                    disabled={download.isPending}
                    onClick={() => void openUploadedFile()}
                  >
                    {download.isPending ? <Spinner /> : <ExternalLinkIcon />}
                    {t("Open source")}
                  </Button>
                )}
              </div>
            ) : (
              <p
                role="alert"
                className="rounded-lg border p-4 text-destructive"
              >
                {t("The original source is unavailable.")}
              </p>
            )}
          </TabsContent>
          <TabsContent value="transcript" className="pt-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {row.document.sourceType === "link" ? (
                  <LinkIngestionBadge
                    status={
                      reingest.isPending ? "pending" : transcript.data?.status
                    }
                    loading={transcript.isLoading}
                    error={transcript.isError}
                  />
                ) : (
                  <Badge
                    variant={
                      transcriptStatus === "failed"
                        ? "destructive"
                        : transcriptStatus === "ready"
                          ? "secondary"
                          : "outline"
                    }
                  >
                    {active ? <Spinner className="size-3" /> : null}
                    {statusLabel}
                  </Badge>
                )}
                {transcriptPageCount ? (
                  <span className="text-xs text-muted-foreground">
                    {t("{count} pages", {
                      count: String(transcriptPageCount),
                    })}
                  </span>
                ) : null}
              </div>
              {row.document.sourceType === "link" && transcript.isError ? (
                <Button
                  size="sm"
                  disabled={transcript.isFetching}
                  onClick={() => void transcript.refetch()}
                >
                  {transcript.isFetching ? <Spinner /> : <RefreshCwIcon />}
                  {t("Retry")}
                </Button>
              ) : row.document.sourceType === "link" &&
                transcriptStatus !== "pending" ? (
                <Button
                  size="sm"
                  variant={transcriptStatus === "ready" ? "outline" : "default"}
                  disabled={active}
                  onClick={() => reingest.mutate({ documentId })}
                >
                  {active ? <Spinner /> : <RefreshCwIcon />}
                  {transcriptStatus === "ready"
                    ? t("Import again")
                    : t("Retry import")}
                </Button>
              ) : canTranscribe && transcriptStatus !== "ready" ? (
                <Button
                  size="sm"
                  disabled={active}
                  onClick={() => transcribe.mutate({ documentId })}
                >
                  {active ? <Spinner /> : <ScanTextIcon />}
                  {transcriptStatus === "failed"
                    ? t("Retry transcription")
                    : t("Transcribe")}
                </Button>
              ) : null}
            </div>

            {transcript.isLoading ? (
              <div className="grid min-h-48 place-items-center">
                <Spinner />
              </div>
            ) : transcript.isError ? (
              <p
                role="alert"
                className="rounded-lg border p-4 text-sm text-destructive"
              >
                {transcript.error.message ||
                  t("The transcript could not be loaded.")}
              </p>
            ) : transcriptStatus === "ready" ? (
              <div className="space-y-3">
                {row.document.sourceType === "link" ? (
                  <p className="text-xs text-muted-foreground">
                    <LinkProvenance
                      meta={transcript.data?.meta}
                      sourceUrl={row.document.sourceUrl}
                    />
                  </p>
                ) : null}
                <div className="max-h-[55vh] overflow-auto rounded-lg border bg-muted/30 p-4">
                  <DocumentMarkdown
                    markdown={transcript.data?.content ?? ""}
                    ariaLabel={t("Material transcript")}
                    empty={
                      <p className="py-12 text-center text-sm text-muted-foreground">
                        {t("The transcript is empty.")}
                      </p>
                    }
                  />
                </div>
              </div>
            ) : transcriptStatus === "failed" ? (
              <div
                role="alert"
                className="space-y-3 rounded-lg border p-4 text-sm text-destructive"
              >
                <p>
                  {advancedReasonText ||
                    transcript.data?.error ||
                    t("Transcription failed. Try again.")}
                </p>
                {canRetryWithDynamicRendering(advancedReason) ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={retryDynamic.isPending}
                    onClick={() => retryDynamic.mutate({ documentId })}
                  >
                    {retryDynamic.isPending ? <Spinner /> : <RefreshCwIcon />}
                    {t("Try sandboxed browser rendering")}
                  </Button>
                ) : null}
              </div>
            ) : active ? (
              <div className="grid min-h-48 place-items-center rounded-lg border border-dashed text-center text-sm text-muted-foreground">
                {t("The transcript will appear here when processing finishes.")}
              </div>
            ) : row.document.sourceType === "link" ? (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                {t(
                  "Import this public page to create a machine-readable markdown transcript."
                )}
              </p>
            ) : canTranscribe ? (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                {t(
                  "Create a machine-readable transcript from this document or media file."
                )}
              </p>
            ) : (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                {t("This file type cannot be transcribed.")}
              </p>
            )}
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("Close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
