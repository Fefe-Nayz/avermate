"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { Button } from "@/components/ui/button"
import { isEpubFile } from "./file-formats"
import { epubArchiveIssue, MAX_EPUB_BYTES } from "./epub-archive"
import { materialFileOf } from "./row-file"
import {
  RendererBar,
  RendererError,
  RendererLoading,
  RendererNotice,
} from "./renderer-chrome"
import { sanitizeEpubDocument } from "./epub-sanitize"
import { useMaterialFileUrl } from "./use-material-file"
import type { MaterialRenderProps, MaterialRenderer } from "./registry"
import type { Book, Contents, Rendition } from "epubjs"

function EpubReader({ row }: MaterialRenderProps) {
  const t = useExtracted()
  const file = materialFileOf(row)
  const tooLarge = Boolean(file && file.byteSize > MAX_EPUB_BYTES)
  const source = useMaterialFileUrl(row.id, Boolean(file) && !tooLarge)
  const hostRef = useRef<HTMLDivElement>(null)
  const renditionRef = useRef<Rendition | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [rendering, setRendering] = useState(true)
  /**
   * What failed, not how to say it.
   *
   * Keeping the wording out of state keeps `t` out of the effect's
   * dependencies: pulling it in would re-run the effect — and re-render the
   * whole book — on any change to the formatter's identity.
   */
  const [renderError, setRenderError] = useState<{
    scope: "book" | "page"
    detail?: string
  } | null>(null)

  useEffect(() => {
    const host = hostRef.current
    const url = source.data?.url
    if (!host || !url || tooLarge) return

    const controller = new AbortController()
    let book: Book | null = null
    let disposed = false
    setRendering(true)
    setRenderError(null)
    host.replaceChildren()

    void (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal })
        if (!response.ok) throw new Error(`file ${response.status}`)
        const bytes = await response.arrayBuffer()
        const archiveIssue = epubArchiveIssue(bytes)
        if (archiveIssue) throw new Error(archiveIssue)
        const { default: ePub } = await import("epubjs")
        if (disposed) return
        book = ePub(bytes, { replacements: "blobUrl" })
        await book.opened
        if (disposed) return

        // This hook runs on the parsed chapter before epub.js serializes it
        // into an iframe. The later rendition hook is defence in depth; doing
        // it here is what prevents an external resource from starting first.
        book.spine.hooks.content.register((document: Document) => {
          sanitizeEpubDocument(document)
        })

        const rendition = book.renderTo(host, {
          width: "100%",
          height: "100%",
          spread: "auto",
          allowScriptedContent: false,
        })
        rendition.hooks.content.register((contents: Contents) => {
          sanitizeEpubDocument(contents.document)
        })
        renditionRef.current = rendition
        await rendition.display()
        if (!disposed) setRendering(false)
      } catch (error) {
        if (disposed || controller.signal.aborted) return
        setRendering(false)
        setRenderError({
          scope: "book",
          detail: error instanceof Error ? error.message : undefined,
        })
      }
    })()

    return () => {
      disposed = true
      controller.abort()
      renditionRef.current = null
      try {
        book?.destroy()
      } catch {
        // An EPUB can fail before epub.js finishes constructing its archive.
      }
      host.replaceChildren()
    }
  }, [attempt, source.data?.url, tooLarge])

  if (tooLarge) {
    return (
      <RendererNotice>
        {t("This EPUB is too large to open here. Download it instead.")}
      </RendererNotice>
    )
  }
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

  const move = (direction: "previous" | "next") => {
    const rendition = renditionRef.current
    if (!rendition) return
    void (direction === "previous" ? rendition.prev() : rendition.next()).catch(
      (error: unknown) => {
        setRenderError({
          scope: "page",
          detail: error instanceof Error ? error.message : undefined,
        })
      }
    )
  }

  return (
    <>
      <RendererBar>
        <Button
          variant="outline"
          size="icon-sm"
          disabled={rendering || Boolean(renderError)}
          aria-label={t("Previous page")}
          onClick={() => move("previous")}
        >
          <ChevronLeftIcon />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          disabled={rendering || Boolean(renderError)}
          aria-label={t("Next page")}
          onClick={() => move("next")}
        >
          <ChevronRightIcon />
        </Button>
        <span className="text-xs text-muted-foreground">
          {t("Scripts and external resources are disabled")}
        </span>
      </RendererBar>
      <div className="relative min-h-0 flex-1 bg-background">
        <div ref={hostRef} className="size-full" aria-label={row.title} />
        {rendering ? (
          <div className="absolute inset-0 grid place-items-center bg-background/80">
            <RendererLoading />
          </div>
        ) : null}
        {renderError ? (
          <div className="absolute inset-0 flex bg-background">
            <RendererError
              message={
                renderError.scope === "book"
                  ? t("This EPUB could not be opened.")
                  : t("This page could not be opened.")
              }
              detail={renderError.detail}
              onRetry={() => setAttempt((value) => value + 1)}
            />
          </div>
        ) : null}
      </div>
    </>
  )
}

export const epubRenderer: MaterialRenderer = {
  id: "epub",
  priority: 82,
  accepts: (row) => {
    const file = materialFileOf(row)
    return Boolean(file && isEpubFile(row.title, file.mimeType))
  },
  Reader: EpubReader,
}
