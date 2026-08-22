import type { ComponentType } from "react"
import type { MaterialRow } from "../materials-rows"

/**
 * One file type, one file.
 *
 * The viewer had grown a chain of conditions — is it a PDF, is it a link, is it
 * a note, is it a recording — and every new format meant another branch in a
 * component that already did four things. That chain is why nothing beyond a
 * PDF ever got a real reader: the cost of adding one was editing the thing that
 * displayed all the others.
 *
 * So a reader is a registration instead. A renderer says what it accepts and
 * how strongly, and the pane picks the strongest match. Adding a format is one
 * new file in this folder and one line in the list — nothing else changes, and
 * nothing else can break.
 */

export interface MaterialRenderProps {
  row: MaterialRow
  /** Other rows in the current year, used for explicit sibling relations. */
  relatedRows?: readonly MaterialRow[]
  /** Leaving the document and going back to the list. */
  onClose: () => void
  /** Switching between reading and editing, where the renderer offers both. */
  onModeChange?: (mode: MaterialRenderMode) => void
  mode: MaterialRenderMode
}

export type MaterialRenderMode = "read" | "edit"

export interface MaterialRenderer {
  id: string
  /** Whether this renderer can show that row at all. */
  accepts: (row: MaterialRow) => boolean
  /**
   * Which renderer wins when several accept.
   *
   * Higher is more specific. A LaTeX source is also a text file and a `.docx`
   * is also a downloadable blob; without a weight the answer would depend on
   * the order of an array, which is not a decision anybody made.
   */
  priority: number
  Reader: ComponentType<MaterialRenderProps>
  /**
   * Editing, where the format supports it. A renderer with no editor is read
   * only, and the pane simply does not offer the switch.
   */
  Editor?: ComponentType<MaterialRenderProps>
  /**
   * What the assistant should read when it is handed this document.
   *
   * Distinct from what the reader shows: a spreadsheet renders as a grid and
   * reads as CSV, a recording renders as a player and reads as its transcript.
   * Falls back to the transcript pipeline when a renderer has nothing better.
   */
  extract?: (row: MaterialRow) => Promise<string>
}

/**
 * The strongest renderer that accepts the row, or `null`.
 *
 * `null` is a real answer and not a failure: the pane draws the download card
 * for it, which is the honest thing to show for a `.zip`.
 */
export function pickMaterialRenderer(
  row: MaterialRow,
  renderers: readonly MaterialRenderer[]
): MaterialRenderer | null {
  let best: MaterialRenderer | null = null
  for (const renderer of renderers) {
    if (!renderer.accepts(row)) continue
    if (!best || renderer.priority > best.priority) best = renderer
  }
  return best
}

/** Whether the pane should offer a Read/Edit switch for this row. */
export function rendererCanEdit(
  renderer: MaterialRenderer | null
): renderer is MaterialRenderer & {
  Editor: ComponentType<MaterialRenderProps>
} {
  return Boolean(renderer?.Editor)
}
