"use client"

import type { ReactNode } from "react"
import { XIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatBytes, type MaterialRow } from "./materials-rows"
import {
  MATERIAL_RENDERERS,
  pickMaterialRenderer,
  rendererCanEdit,
  type MaterialRenderMode,
} from "./renderers"
import { RendererNotice } from "./renderers/renderer-chrome"
import { TranscriptPanel, hasTranscript } from "./renderers/transcript-panel"

/**
 * What the pane is showing: the document, or the text a machine read out of
 * it. Two tabs and not more — a third for "notes" would be a feature, not a
 * view of this document.
 */
export type MaterialPaneTab = "source" | "transcript"

/**
 * A document, read where it was found.
 *
 * Opening something used to cost you the screen: an upload appeared in a dialog
 * over the browser, and a revision sheet navigated away to a page of its own.
 * Both threw away the folder you were in, the rail, and the selection — to show
 * you a document that belongs to that folder.
 *
 * So the pane takes the place of the table and nothing else. The rail stays,
 * the trail still says where you are and now also what you are reading, and
 * going back is one control rather than a browser history you have to guess at.
 *
 * What is shown inside it is not this component's business: it asks the
 * registry which renderer wants the row and gets out of the way. That is what
 * makes a new file type one file rather than another branch here.
 */
export function MaterialDocumentPane({
  row,
  mode,
  tab,
  onTabChange,
  onModeChange,
  onClose,
  actions,
  badges,
  relatedRows,
}: {
  row: MaterialRow
  mode: MaterialRenderMode
  tab: MaterialPaneTab
  onTabChange: (tab: MaterialPaneTab) => void
  onModeChange: (mode: MaterialRenderMode) => void
  onClose: () => void
  /** The row's own menu, so the pane offers what the list row offered. */
  actions?: ReactNode
  /** Origin and tag chips, drawn from the same helpers the table uses. */
  badges?: ReactNode
  /** Year rows available for sibling assets such as a matching subtitle file. */
  relatedRows?: readonly MaterialRow[]
}) {
  const t = useExtracted()
  const renderer = pickMaterialRenderer(row, MATERIAL_RENDERERS)
  const editable = rendererCanEdit(renderer)
  const View =
    renderer && editable && mode === "edit"
      ? renderer.Editor
      : (renderer?.Reader ?? null)

  const measure = row.bytes !== null ? formatBytes(row.bytes) : null
  const transcribable = hasTranscript(row)
  const showing = transcribable ? tab : "source"

  return (
    <section
      aria-label={row.title}
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("Back to the list")}
          onClick={onClose}
        >
          <XIcon />
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{row.title}</span>
            {badges}
          </h2>
          <p className="truncate text-xs text-muted-foreground">
            {[row.typeLabel, measure].filter(Boolean).join(" · ")}
          </p>
        </div>
        {actions}
      </header>

      {transcribable ? (
        <Tabs
          value={showing}
          onValueChange={(value) => onTabChange(value as MaterialPaneTab)}
          className="shrink-0 border-b px-3 py-1.5"
        >
          <TabsList>
            <TabsTrigger value="source">{t("Source")}</TabsTrigger>
            <TabsTrigger value="transcript">{t("Transcription")}</TabsTrigger>
          </TabsList>
        </Tabs>
      ) : null}

      {showing === "transcript" ? (
        <TranscriptPanel row={row} />
      ) : View ? (
        <View
          row={row}
          relatedRows={relatedRows}
          mode={mode}
          onModeChange={onModeChange}
          onClose={onClose}
        />
      ) : (
        <RendererNotice>
          {t(
            "There is no reader for this kind of file yet. Download it to open it."
          )}
        </RendererNotice>
      )}
    </section>
  )
}
