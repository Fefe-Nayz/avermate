import type { MaterialRow } from "../materials-rows"
import type { MaterialDocumentView } from "../materials-types"

/**
 * The stored file behind a row, if there is one.
 *
 * Every renderer asks this first and most of them ask nothing else, so it is
 * one function rather than the same three-line narrowing repeated in each: a
 * row is only a file when it is an uploaded document *and* the upload actually
 * finished, and a renderer that forgets the second half opens a URL for bytes
 * that are still being written.
 */
export function materialFileOf(
  row: MaterialRow
): NonNullable<MaterialDocumentView["file"]> | null {
  if (row.source.kind !== "material") return null
  const { document, file } = row.source.row
  if (document.sourceType !== "file" || !file) return null
  return file.status === "stored" || file.status === "ready" ? file : null
}

/** The document behind a row, for the renderers that need more than its bytes. */
export function materialDocumentOf(
  row: MaterialRow
): MaterialDocumentView | null {
  return row.source.kind === "material" ? row.source.row : null
}
