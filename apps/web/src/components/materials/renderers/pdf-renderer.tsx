"use client"

import { useExtracted } from "next-intl"
import { materialFileOf } from "./row-file"
import { RendererError, RendererLoading } from "./renderer-chrome"
import { useMaterialFileUrl } from "./use-material-file"
import type { MaterialRenderProps, MaterialRenderer } from "./registry"

/**
 * A PDF, in the browser's own viewer.
 *
 * Not a JavaScript PDF engine: the browser already ships one, it handles
 * selection, search, printing and accessibility, and it costs no bundle. The
 * only thing added is `#view=FitH`, so a document opens fitted to the width of
 * the pane rather than at whatever zoom the reader last used on some other
 * site.
 */
function PdfReader({ row }: MaterialRenderProps) {
  const t = useExtracted()
  const file = materialFileOf(row)
  const source = useMaterialFileUrl(row.id, Boolean(file))

  if (source.isPending) return <RendererLoading />
  if (source.isError || !source.data?.url) {
    return (
      <RendererError
        message={
          source.error?.message ?? t("The original source is unavailable.")
        }
        onRetry={() => void source.refetch()}
      />
    )
  }

  return (
    <iframe
      src={`${source.data.url}#view=FitH`}
      title={row.title}
      className="min-h-0 flex-1 bg-background"
    />
  )
}

export const pdfRenderer: MaterialRenderer = {
  id: "pdf",
  priority: 70,
  accepts: (row) => materialFileOf(row)?.mimeType === "application/pdf",
  Reader: PdfReader,
}
