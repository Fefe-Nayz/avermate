"use client"

import { useExtracted } from "next-intl"
import { LazyShikiFence } from "@/components/documents/markdown-fences/lazy-fences"
import { MAX_HIGHLIGHT_SOURCE_BYTES } from "@/components/documents/markdown-fences/model"
import { codeLanguage } from "./file-formats"
import { materialFileOf } from "./row-file"
import {
  RendererBar,
  RendererError,
  RendererLoading,
  RendererNotice,
} from "./renderer-chrome"
import { useMaterialFileText } from "./use-material-file"
import type { MaterialRenderProps, MaterialRenderer } from "./registry"

function CodeReader({ row }: MaterialRenderProps) {
  const t = useExtracted()
  const file = materialFileOf(row)
  const language = codeLanguage(row.title, file?.mimeType) ?? "text"
  const tooLargeToHighlight =
    file?.byteSize !== undefined &&
    file.byteSize !== null &&
    file.byteSize > MAX_HIGHLIGHT_SOURCE_BYTES
  const source = useMaterialFileText(
    row.id,
    file?.byteSize ?? null,
    !tooLargeToHighlight
  )

  if (tooLargeToHighlight || source.tooLarge) {
    return (
      <RendererNotice>
        {t(
          "This source file is too large to highlight safely. Download it instead."
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

  return (
    <>
      <RendererBar>
        <span className="font-mono text-xs text-muted-foreground">
          {language}
        </span>
      </RendererBar>
      <div className="min-h-0 flex-1 overflow-auto">
        <LazyShikiFence source={source.text} language={language} />
      </div>
    </>
  )
}

export const codeRenderer: MaterialRenderer = {
  id: "code",
  priority: 68,
  accepts: (row) => {
    const file = materialFileOf(row)
    return Boolean(file && codeLanguage(row.title, file.mimeType))
  },
  Reader: CodeReader,
}
