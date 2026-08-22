"use client"

import Image from "next/image"
import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { DownloadIcon, ExternalLinkIcon, FileQuestionIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { env } from "@/lib/env"
import { orpc } from "@/lib/orpc"
import { outputPreviewKind } from "./media-studio-model"

type OutputRevision = {
  id: string
  revision: number
  outputFileId: string | null
  outputMime: string
}

type PreviewPayload =
  { kind: "blob"; blob: Blob } | { kind: "text"; text: string }

async function exchangeFileHandle(
  handle: string,
  operation: "preview" | "download",
  unavailableMessage: string
): Promise<Blob> {
  const response = await fetch(
    `${env.apiUrl.replace(/\/$/, "")}/api/file-handles/exchange`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handle, operation }),
    }
  )
  if (!response.ok) {
    let message = unavailableMessage
    try {
      const payload = (await response.json()) as { error?: string }
      if (payload.error) message = payload.error
    } catch {
      // The status remains the source of truth when a proxy returns no JSON.
    }
    throw new Error(message)
  }
  return response.blob()
}

function fileExtension(mime: string): string {
  const extensions: Record<string, string> = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      "pptx",
    "application/zip": "zip",
    "text/html": "html",
    "text/markdown": "md",
    "audio/mpeg": "mp3",
    "video/mp4": "mp4",
    "image/png": "png",
    "image/jpeg": "jpg",
  }
  return extensions[mime] ?? "bin"
}

export function ArtifactOutputDialog({
  open,
  onOpenChange,
  artifactTitle,
  revision,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  artifactTitle: string
  revision: OutputRevision | null
}) {
  const t = useExtracted()
  const [downloading, setDownloading] = useState(false)
  const previewKind = outputPreviewKind(revision?.outputMime ?? "")

  const handlesQuery = useQuery({
    ...orpc.mediaStudio.getOutputHandles.queryOptions({
      input: { artifactRevisionId: revision?.id ?? "_" },
    }),
    enabled: open && Boolean(revision?.outputFileId),
    staleTime: 8 * 60_000,
    retry: false,
  })

  const unavailableMessage = t("This output is no longer available.")
  const previewQuery = useQuery<PreviewPayload>({
    queryKey: [
      "media-studio",
      "artifact-output-preview",
      revision?.id,
      handlesQuery.data?.preview.handle,
      previewKind,
      unavailableMessage,
    ],
    queryFn: async () => {
      const handle = handlesQuery.data?.preview.handle
      if (!handle) throw new Error(unavailableMessage)
      const blob = await exchangeFileHandle(
        handle,
        "preview",
        unavailableMessage
      )
      return previewKind === "text"
        ? { kind: "text", text: await blob.text() }
        : { kind: "blob", blob }
    },
    enabled: open && Boolean(revision?.outputFileId && handlesQuery.data),
    staleTime: 8 * 60_000,
    retry: false,
  })

  const previewUrl = useMemo(
    () =>
      previewQuery.data?.kind === "blob"
        ? URL.createObjectURL(previewQuery.data.blob)
        : null,
    [previewQuery.data]
  )
  const previewText =
    previewQuery.data?.kind === "text" ? previewQuery.data.text : null

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    },
    [previewUrl]
  )

  async function download() {
    if (!revision?.outputFileId) return
    setDownloading(true)
    try {
      const refreshed = await handlesQuery.refetch()
      if (!refreshed.data)
        throw new Error(t("The download link is unavailable."))
      const blob = await exchangeFileHandle(
        refreshed.data.download.handle,
        "download",
        t("This output is no longer available.")
      )
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = `${artifactTitle.replace(/[^\p{L}\p{N}._-]+/gu, "-") || "artefact"}-r${revision.revision}.${fileExtension(revision.outputMime)}`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("Download unavailable.")
      )
    } finally {
      setDownloading(false)
    }
  }

  const previewLoading =
    handlesQuery.isPending ||
    (Boolean(handlesQuery.data) && previewQuery.isPending)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>
            {artifactTitle}
            {revision
              ? t(" — revision {revision}", {
                  revision: String(revision.revision),
                })
              : ""}
          </DialogTitle>
          <DialogDescription>
            {t(
              "Preview uses short-lived opaque access limited to this file. It never reveals the storage location."
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-80 overflow-hidden rounded-xl border bg-muted/30">
          {!revision?.outputFileId ? (
            <Empty className="min-h-80">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileQuestionIcon />
                </EmptyMedia>
                <EmptyTitle>{t("No published file")}</EmptyTitle>
                <EmptyDescription>
                  {t(
                    "This revision has a manifest but no previewable binary output."
                  )}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : previewLoading ? (
            <div
              className="flex flex-col gap-3 p-4"
              role="status"
              aria-label={t("Loading preview")}
              aria-busy="true"
            >
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-96 w-full" />
            </div>
          ) : handlesQuery.error || previewQuery.error ? (
            <div className="p-4">
              <Alert variant="destructive">
                <AlertTitle>{t("Preview unavailable")}</AlertTitle>
                <AlertDescription>
                  {previewQuery.error?.message ?? handlesQuery.error?.message}
                </AlertDescription>
              </Alert>
            </div>
          ) : previewKind === "pdf" && previewUrl ? (
            <iframe
              src={previewUrl}
              title={t("Preview of {title}", { title: artifactTitle })}
              className="h-[70vh] w-full bg-background"
            />
          ) : previewKind === "image" && previewUrl ? (
            <div className="flex min-h-96 items-center justify-center p-4">
              <Image
                src={previewUrl}
                alt={t("Output {title}", { title: artifactTitle })}
                width={1600}
                height={900}
                unoptimized
                className="max-h-[70vh] w-auto rounded-lg object-contain"
              />
            </div>
          ) : previewKind === "audio" && previewUrl ? (
            <div className="flex min-h-80 items-center justify-center p-6">
              <audio controls src={previewUrl} className="w-full max-w-2xl">
                {t("Your browser cannot play this audio output.")}
              </audio>
            </div>
          ) : previewKind === "video" && previewUrl ? (
            <video
              controls
              src={previewUrl}
              className="max-h-[70vh] w-full bg-black object-contain"
            >
              {t("Your browser cannot play this video output.")}
            </video>
          ) : previewKind === "html" && previewUrl ? (
            <iframe
              src={previewUrl}
              title={t("Sandboxed preview of {title}", {
                title: artifactTitle,
              })}
              sandbox=""
              referrerPolicy="no-referrer"
              className="h-[70vh] w-full bg-background"
            />
          ) : previewKind === "text" && previewText !== null ? (
            <pre className="max-h-[70vh] overflow-auto p-4 text-xs whitespace-pre-wrap">
              {previewText}
            </pre>
          ) : (
            <Empty className="min-h-80">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ExternalLinkIcon />
                </EmptyMedia>
                <EmptyTitle>{t("Embedded preview unavailable")}</EmptyTitle>
                <EmptyDescription>
                  {t(
                    "This format remains downloadable without being executed in the application."
                  )}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("Close")}
          </Button>
          <Button
            onClick={() => void download()}
            disabled={!revision?.outputFileId || downloading}
          >
            {downloading ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <DownloadIcon data-icon="inline-start" />
            )}
            {downloading ? t("Downloading") : t("Download")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
