import type { MouseEvent, ReactNode } from "react"
import type { MaterialRow } from "./materials-rows"

/**
 * What a row means, apart from how it is drawn.
 *
 * The table and the card grid show the same rows in two shapes. Neither of them
 * knows what a row *is* — that a link is still importing, that a recording is
 * linked to a lesson, that a folder belongs to a subject — so the screen that
 * does answers it once, here, and both views read the answer.
 */
export interface MaterialRowPresentation {
  /** The glyph in the leading tile. */
  icon: ReactNode
  /** The quiet second line: what the row is, or where it points. */
  detail?: ReactNode
  /** Sits directly after the name — an import status, for instance. */
  adornment?: ReactNode
  /**
   * A real destination, when the row has one — a folder, a sheet, a recording.
   * An anchor, so a middle click opens it in a tab the way a file browser does;
   * `onClick` is what turns a plain left click into an in-place move.
   */
  link?: {
    href: string
    prefetch?: boolean
    onClick?: (event: MouseEvent<HTMLAnchorElement>) => void
  }
  /** Study material is the app's own; a plain upload is not. */
  tone?: "accent" | "muted"
}

export type PresentMaterialRow = (row: MaterialRow) => MaterialRowPresentation

/**
 * The two shapes a folder's contents can take.
 *
 * A table is for comparing — sorting by size, scanning dates down a column. A
 * grid is for recognising: bigger targets, one thing per card, the shape every
 * file browser offers next to its list.
 */
export type MaterialsView = "table" | "grid"

/** The columns a reader can switch off, in the order the toolbar lists them. */
export const OPTIONAL_MATERIAL_COLUMNS = ["type", "size", "modified"] as const

/**
 * The drag type an internal move uses.
 *
 * A private MIME type, so the page's upload drop zone — which only reacts to
 * `Files` — cannot mistake a row being filed for a file being uploaded, and a
 * drag out of this app carries nothing a browser would try to open.
 */
export const MATERIALS_DRAG_TYPE = "application/x-avermate-materials"

/** What a drag carries: the rows being moved, by id. */
export function readMaterialsDrag(data: string): string[] {
  try {
    const parsed: unknown = JSON.parse(data)
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : []
  } catch {
    return []
  }
}
