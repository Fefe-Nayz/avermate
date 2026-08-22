"use client"

import { useState } from "react"
import { useExtracted } from "next-intl"
import { mediaKind } from "./file-formats"
import { materialFileOf } from "./row-file"
import { RendererError, RendererLoading } from "./renderer-chrome"
import {
  findAssociatedSubtitle,
  subtitleSourceToWebVtt,
} from "./subtitle-track"
import { useMaterialFileText, useMaterialFileUrl } from "./use-material-file"
import type { MaterialRenderProps, MaterialRenderer } from "./registry"

function MediaReader({ row, relatedRows }: MaterialRenderProps) {
  const t = useExtracted()
  const file = materialFileOf(row)
  const kind = mediaKind(row.title, file?.mimeType)
  const source = useMaterialFileUrl(row.id, Boolean(file && kind))
  const [playbackFailed, setPlaybackFailed] = useState(false)
  const subtitle = findAssociatedSubtitle(row, relatedRows ?? [])
  const subtitleFile = subtitle ? materialFileOf(subtitle) : null
  const subtitleSource = useMaterialFileText(
    subtitle?.id ?? "",
    subtitleFile?.byteSize ?? null,
    Boolean(subtitle)
  )
  const webVtt = subtitleSource.text
    ? subtitleSourceToWebVtt(subtitleSource.text)
    : null
  // A data URL keeps the subtitle private and avoids leaking object URLs
  // across interrupted React renders. Subtitle text is already capped at 2 MiB.
  const subtitleUrl = webVtt
    ? `data:text/vtt;charset=utf-8,${encodeURIComponent(webVtt)}`
    : null

  if (source.isPending) return <RendererLoading />
  if (source.isError || !source.data?.url || playbackFailed || !kind) {
    return (
      <RendererError
        message={
          playbackFailed
            ? t("This media file cannot be played by this browser.")
            : (source.error?.message ??
              t("The original source is unavailable."))
        }
        onRetry={() => {
          setPlaybackFailed(false)
          void source.refetch()
        }}
      />
    )
  }

  return (
    <div className="grid min-h-0 flex-1 place-items-center overflow-auto bg-muted/20 p-6">
      {kind === "audio" ? (
        <audio
          className="w-full max-w-2xl"
          src={source.data.url}
          controls
          preload="metadata"
          onError={() => setPlaybackFailed(true)}
        >
          {subtitleUrl ? (
            <track
              kind="captions"
              src={subtitleUrl}
              srcLang="und"
              label={t("Subtitles")}
              default
            />
          ) : null}
          {t("Your browser cannot play this audio file.")}
        </audio>
      ) : (
        <video
          className="max-h-full max-w-full rounded-md bg-black"
          src={source.data.url}
          controls
          playsInline
          preload="metadata"
          onError={() => setPlaybackFailed(true)}
        >
          {subtitleUrl ? (
            <track
              kind="captions"
              src={subtitleUrl}
              srcLang="und"
              label={t("Subtitles")}
              default
            />
          ) : null}
          {t("Your browser cannot play this video file.")}
        </video>
      )}
    </div>
  )
}

export const mediaRenderer: MaterialRenderer = {
  id: "media",
  priority: 75,
  accepts: (row) => {
    const file = materialFileOf(row)
    return Boolean(file && mediaKind(row.title, file.mimeType))
  },
  Reader: MediaReader,
}
