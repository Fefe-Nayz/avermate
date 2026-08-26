"use client"

import { useQuery } from "@tanstack/react-query"
import { ExternalLinkIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { DocumentMarkdown } from "@/components/documents/document-markdown"
import { Button } from "@/components/ui/button"
import { orpc } from "@/lib/orpc"
import { safeWebSourceHref } from "../link-ingestion-model"
import { materialDocumentOf, materialFileOf } from "./row-file"
import {
  RendererError,
  RendererBar,
  RendererLoading,
  RendererNotice,
} from "./renderer-chrome"
import { useMaterialFileText } from "./use-material-file"
import type { MaterialRenderProps, MaterialRenderer } from "./registry"

const TEXT_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "application/json",
  "application/xml",
  "text/xml",
  "text/html",
])
const MARKDOWN = /\.(md|markdown|mdx)$/i
const TEXTISH = /\.(txt|log|json|xml|ya?ml|ini|conf|srt|vtt|bib)$/i

/** Whether the file should be rendered as Markdown rather than as source. */
function isMarkdown(title: string, mimeType: string | null): boolean {
  return MARKDOWN.test(title) || mimeType === "text/markdown"
}

/**
 * A text file, read rather than downloaded.
 *
 * Markdown is rendered — a `.md` shown as source is a document with hashes in
 * front of its headings — and everything else is shown as source in a
 * monospaced block, which is what a `.json` or an `.srt` actually is. Wrapping
 * is on: a subtitle file with 200-character lines should not need horizontal
 * scrolling to read one sentence.
 */
function FileTextReader({ row }: MaterialRenderProps) {
  const t = useExtracted()
  const file = materialFileOf(row)
  const source = useMaterialFileText(row.id, file?.byteSize ?? null)

  if (source.tooLarge) {
    return (
      <RendererNotice>
        {t("This file is too large to open here. Download it instead.")}
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

  if (isMarkdown(row.title, file?.mimeType ?? null)) {
    return (
      <div className="min-h-0 flex-1 overflow-auto p-6">
        <DocumentMarkdown markdown={source.text} />
      </div>
    )
  }
  return (
    <pre className="min-h-0 flex-1 overflow-auto p-6 font-mono text-xs whitespace-pre-wrap">
      {source.text}
    </pre>
  )
}

/**
 * A note pasted straight into the browser.
 *
 * Its body lives on the document rather than in a file — the list projection
 * leaves it out on purpose, because inlining up to 256 KiB per note into a
 * year's worth of rows is how a list becomes slow — so this is the one reader
 * that fetches the document rather than its bytes.
 */
function InlineNoteReader({ row }: MaterialRenderProps) {
  const t = useExtracted()
  const detail = useQuery({
    ...orpc.materials.documents.get.queryOptions({
      input: { documentId: row.id },
    }),
  })

  if (detail.isPending) return <RendererLoading />
  if (detail.isError) {
    return (
      <RendererError
        message={t("This note could not be loaded.")}
        detail={detail.error.message}
        onRetry={() => void detail.refetch()}
      />
    )
  }

  const content = detail.data?.document.textContent ?? ""
  if (!content.trim()) {
    return <RendererNotice>{t("This note is empty.")}</RendererNotice>
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto p-6">
      <DocumentMarkdown markdown={content} />
    </div>
  )
}

export const textFileRenderer: MaterialRenderer = {
  id: "text",
  priority: 50,
  accepts: (row) => {
    const file = materialFileOf(row)
    if (!file) return false
    return (
      TEXT_TYPES.has(file.mimeType) ||
      MARKDOWN.test(row.title) ||
      TEXTISH.test(row.title)
    )
  },
  Reader: FileTextReader,
}

export const inlineNoteRenderer: MaterialRenderer = {
  id: "note",
  priority: 90,
  accepts: (row) =>
    row.source.kind === "material" &&
    row.source.row.document.sourceType === "text",
  Reader: InlineNoteReader,
}

export const linkRenderer: MaterialRenderer = {
  id: "link",
  priority: 90,
  accepts: (row) =>
    row.source.kind === "material" &&
    row.source.row.document.sourceType === "link",
  Reader: LinkReader,
}

/**
 * A link, and what was imported from it.
 *
 * The page itself cannot be framed — most sites refuse it, and the ones that
 * do not would be loading third-party script into this tab — so what is shown
 * is the readable text the import pipeline extracted, which is the part worth
 * having anyway.
 */
function LinkReader({ row }: MaterialRenderProps) {
  const t = useExtracted()
  const document = materialDocumentOf(row)
  const sourceHref = safeWebSourceHref(document?.document.sourceUrl ?? null)
  const isYoutube = document?.document.sourceKind === "youtube"
  const transcript = useQuery({
    ...orpc.materials.documents.transcript.queryOptions({
      input: { documentId: row.id },
    }),
    refetchInterval: (query) =>
      query.state.data?.status === "pending" ? 1_500 : false,
  })

  if (transcript.isPending) return <RendererLoading />
  const status = transcript.data?.status
  if (status === "ready" && transcript.data?.content) {
    return (
      <>
        {sourceHref ? (
          <RendererBar className="justify-end">
            <Button
              size="sm"
              variant="outline"
              render={<a href={sourceHref} target="_blank" rel="noreferrer" />}
            >
              <ExternalLinkIcon />
              {isYoutube ? t("Open on YouTube") : t("Open source")}
            </Button>
          </RendererBar>
        ) : null}
        <div className="min-h-0 flex-1 overflow-auto p-6">
          <DocumentMarkdown markdown={transcript.data.content} />
        </div>
      </>
    )
  }
  return (
    <RendererNotice>
      {status === "pending"
        ? t("Importing this page…")
        : status === "failed"
          ? (transcript.data?.error ?? t("This page could not be imported."))
          : t("This link opens on its original website.")}
      {document?.document.sourceUrl ? (
        <span className="mt-2 block truncate text-xs">
          {document.document.sourceUrl}
        </span>
      ) : null}
    </RendererNotice>
  )
}
