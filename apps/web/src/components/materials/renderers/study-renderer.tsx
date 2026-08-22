"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { ExternalLinkIcon, MicIcon, PencilIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { Button } from "@/components/ui/button"
import { DocumentArtifactsStrip } from "@/components/documents/document-artifacts-strip"
import { DocumentMarkdown } from "@/components/documents/document-markdown"
import { MindmapDocumentView } from "@/components/documents/mindmap-document-view"
import { QuizDocumentView } from "@/components/documents/quiz-document-view"
import { SlideDeckView } from "@/components/documents/slide-deck-view"
import {
  isMindmapContent,
  isQuizPromptContent,
} from "@/components/documents/document-types"
import { orpc } from "@/lib/orpc"
import { studyDocumentInput } from "@/lib/route-query-inputs"
import {
  RendererBar,
  RendererError,
  RendererLoading,
  RendererNotice,
} from "./renderer-chrome"
import type { MaterialRenderProps, MaterialRenderer } from "./registry"

/**
 * A revision sheet, a mind map or a deck — read where it lives.
 *
 * These had a page of their own at `/materials/fiches/<id>`, which meant
 * opening one threw away the rail, the folder you were in and your selection,
 * to show a document that belongs to that folder. Reading it in the pane keeps
 * all three, and the trail still names it because the document is in the
 * address.
 *
 * Editing stays on its own route: a Markdown editor with a toolbar, an export
 * and a delete is a screen, not a pane, and cramming it beside a folder tree
 * would make both worse.
 */
function StudyReader({ row }: MaterialRenderProps) {
  const t = useExtracted()
  const document = row.source.kind === "study" ? row.source.document : null
  const documentId = document?.id ?? ""

  const detail = useQuery({
    ...orpc.documents.get.queryOptions({
      input: studyDocumentInput(documentId),
    }),
    enabled: documentId.length > 0,
  })

  if (!document) return <RendererNotice>{t("Nothing to show.")}</RendererNotice>
  if (detail.isPending) return <RendererLoading />
  if (detail.isError) {
    return (
      <RendererError
        message={
          detail.error.message || t("This document could not be loaded.")
        }
        onRetry={() => void detail.refetch()}
      />
    )
  }

  const loaded = detail.data?.document
  const kind = loaded?.kind ?? document.kind
  const body =
    detail.data?.renderedMarkdown ??
    loaded?.bodyMarkdown ??
    document.bodyMarkdown

  return (
    <>
      <RendererBar>
        <Button
          size="sm"
          variant="outline"
          className="ms-auto"
          render={<Link href={`/materials/fiches/${document.id}/edit`} />}
        >
          <PencilIcon /> {t("Edit")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          render={<Link href={`/materials/fiches/${document.id}`} />}
        >
          <ExternalLinkIcon /> {t("Open on its own page")}
        </Button>
      </RendererBar>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="px-3 pt-3">
          <DocumentArtifactsStrip
            documentId={document.id}
            revision={loaded?.revision ?? document.revision}
            allowAnki={kind !== "mindmap"}
            allowPodcast={kind === "fiche" || kind === "note"}
          />
        </div>
        {kind === "mindmap" ? (
          isMindmapContent(loaded?.metaJson) ? (
            <MindmapDocumentView content={loaded.metaJson} />
          ) : (
            <RendererNotice>
              {t("This mind map cannot be displayed.")}
            </RendererNotice>
          )
        ) : kind === "slides" ? (
          <SlideDeckView markdown={body} />
        ) : kind === "quiz" ? (
          isQuizPromptContent(loaded?.metaJson) ? (
            <div className="p-6 pt-2">
              <QuizDocumentView
                documentId={document.id}
                content={loaded.metaJson}
              />
            </div>
          ) : (
            <RendererNotice>
              {t("This quiz cannot be displayed.")}
            </RendererNotice>
          )
        ) : (
          <div className="p-6 pt-2">
            <DocumentMarkdown
              markdown={body}
              empty={
                <p className="text-sm text-muted-foreground">
                  {t("This document is empty.")}
                </p>
              }
            />
          </div>
        )}
      </div>
    </>
  )
}

/**
 * A recording, as the page that already plays it.
 *
 * The player, the segment list and the transcript are a screen's worth of
 * controls, and a recording is the one thing in the browser you genuinely do
 * leave the list for — you sit with it for fifty minutes.
 */
function RecordingReader({ row }: MaterialRenderProps) {
  const t = useExtracted()
  return (
    <RendererNotice
      action={
        <Button
          size="sm"
          render={<Link href={`/materials/recordings/${row.id}`} />}
        >
          <MicIcon /> {t("Open recording")}
        </Button>
      }
    >
      {t("A recording opens with its player and its transcript.")}
    </RendererNotice>
  )
}

export const studyRenderer: MaterialRenderer = {
  id: "study",
  // Below LaTeX, which is also a study document and needs its own screen.
  priority: 90,
  accepts: (row) =>
    row.source.kind === "study" && row.source.document.kind !== "latex",
  Reader: StudyReader,
}

export const recordingRenderer: MaterialRenderer = {
  id: "recording",
  priority: 90,
  accepts: (row) => row.source.kind === "recording",
  Reader: RecordingReader,
}
