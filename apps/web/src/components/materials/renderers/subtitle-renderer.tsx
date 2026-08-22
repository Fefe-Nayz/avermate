"use client"

import { useMemo } from "react"
import { useExtracted } from "next-intl"
import { isSubtitleFile } from "./file-formats"
import { materialFileOf } from "./row-file"
import {
  RendererBar,
  RendererError,
  RendererLoading,
  RendererNotice,
} from "./renderer-chrome"
import { formatSubtitleTime, parseSubtitles } from "./subtitle-model"
import { useMaterialFileText } from "./use-material-file"
import type { MaterialRenderProps, MaterialRenderer } from "./registry"

function SubtitleReader({ row }: MaterialRenderProps) {
  const t = useExtracted()
  const file = materialFileOf(row)
  const source = useMaterialFileText(row.id, file?.byteSize ?? null)
  const subtitles = useMemo(
    () => (source.text === null ? null : parseSubtitles(source.text)),
    [source.text]
  )

  if (source.tooLarge) {
    return (
      <RendererNotice>
        {t(
          "This subtitle file is too large to open here. Download it instead."
        )}
      </RendererNotice>
    )
  }
  if (source.isPending) return <RendererLoading />
  if (source.isError || source.text === null) {
    return (
      <RendererError
        message={
          source.error?.message ?? t("The original source is unavailable.")
        }
        onRetry={source.refetch}
      />
    )
  }
  if (!subtitles || subtitles.cues.length === 0) {
    return (
      <RendererNotice>{t("No valid subtitle cues were found.")}</RendererNotice>
    )
  }

  return (
    <>
      <RendererBar>
        <span className="text-xs text-muted-foreground">
          {t("{count} subtitle cues", {
            count: String(subtitles.cues.length),
          })}
          {subtitles.truncated ? ` · ${t("preview truncated")}` : ""}
        </span>
      </RendererBar>
      <ol
        className="min-h-0 flex-1 divide-y overflow-auto"
        aria-label={t("Subtitles")}
      >
        {subtitles.cues.map((cue) => (
          <li
            key={`${cue.id}-${cue.startMs}`}
            className="grid gap-1 px-4 py-3 sm:grid-cols-[9rem_1fr]"
          >
            <span className="font-mono text-xs text-muted-foreground tabular-nums">
              <time dateTime={`PT${cue.startMs / 1_000}S`}>
                {formatSubtitleTime(cue.startMs)}
              </time>
              {" – "}
              <time dateTime={`PT${cue.endMs / 1_000}S`}>
                {formatSubtitleTime(cue.endMs)}
              </time>
            </span>
            <span className="text-sm whitespace-pre-wrap">{cue.text}</span>
          </li>
        ))}
      </ol>
    </>
  )
}

export const subtitleRenderer: MaterialRenderer = {
  id: "subtitles",
  priority: 69,
  accepts: (row) => {
    const file = materialFileOf(row)
    return Boolean(file && isSubtitleFile(row.title, file.mimeType))
  },
  Reader: SubtitleReader,
}
