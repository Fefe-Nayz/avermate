"use client"

import { useMemo } from "react"
import { useExtracted } from "next-intl"
import { DocumentMarkdown } from "@/components/documents/document-markdown"
import { LazyShikiFence } from "@/components/documents/markdown-fences/lazy-fences"
import { isNotebookFile } from "./file-formats"
import { parseSafeNotebook, type SafeNotebookCell } from "./notebook-model"
import { materialFileOf } from "./row-file"
import {
  RendererBar,
  RendererError,
  RendererLoading,
  RendererNotice,
} from "./renderer-chrome"
import { useMaterialFileText } from "./use-material-file"
import type { MaterialRenderProps, MaterialRenderer } from "./registry"

function NotebookCell({
  cell,
  index,
}: {
  cell: SafeNotebookCell
  index: number
}) {
  return (
    <section className="border-b" aria-label={`Cell ${index + 1}`}>
      <div className="flex min-w-0">
        <span className="w-16 shrink-0 px-2 py-3 text-right font-mono text-xs text-muted-foreground select-none">
          {cell.kind === "code" ? `[${cell.executionCount ?? " "}]:` : ""}
        </span>
        <div className="min-w-0 flex-1 py-3 pr-4">
          {cell.kind === "markdown" ? (
            <DocumentMarkdown markdown={cell.source} />
          ) : cell.kind === "code" ? (
            <LazyShikiFence source={cell.source} language={cell.language} />
          ) : (
            <pre className="overflow-auto font-mono text-xs whitespace-pre-wrap">
              {cell.source}
            </pre>
          )}
        </div>
      </div>
      {cell.outputs.length > 0 ? (
        <div className="space-y-3 border-t bg-muted/20 py-3 pr-4 pl-16">
          {cell.outputs.map((output, outputIndex) =>
            output.kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={outputIndex}
                src={output.dataUrl}
                alt={output.alt}
                className="max-h-[32rem] max-w-full object-contain"
              />
            ) : (
              <pre
                key={outputIndex}
                className="overflow-auto font-mono text-xs whitespace-pre-wrap"
              >
                {output.text}
              </pre>
            )
          )}
        </div>
      ) : null}
    </section>
  )
}

function NotebookReader({ row }: MaterialRenderProps) {
  const t = useExtracted()
  const file = materialFileOf(row)
  const source = useMaterialFileText(row.id, file?.byteSize ?? null)
  const notebook = useMemo(
    () => (source.text === null ? null : parseSafeNotebook(source.text)),
    [source.text]
  )

  if (source.tooLarge) {
    return (
      <RendererNotice>
        {t("This notebook is too large to open safely. Download it instead.")}
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
  if (!notebook?.ok) {
    return (
      <RendererError
        message={notebook?.issue ?? t("This notebook could not be read.")}
      />
    )
  }
  if (notebook.cells.length === 0) {
    return (
      <RendererNotice>
        {t("This notebook has no readable cells.")}
      </RendererNotice>
    )
  }

  return (
    <>
      <RendererBar>
        <span className="text-xs text-muted-foreground">
          {t("Read-only notebook")}
          {notebook.truncated ? ` · ${t("preview truncated")}` : ""}
        </span>
      </RendererBar>
      <div className="min-h-0 flex-1 overflow-auto">
        {notebook.cells.map((cell, index) => (
          <NotebookCell key={index} cell={cell} index={index} />
        ))}
      </div>
    </>
  )
}

export const notebookRenderer: MaterialRenderer = {
  id: "notebook",
  priority: 82,
  accepts: (row) => {
    const file = materialFileOf(row)
    return Boolean(file && isNotebookFile(row.title, file.mimeType))
  },
  Reader: NotebookReader,
}
