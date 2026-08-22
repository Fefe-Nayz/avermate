/**
 * What OnlyOffice can open, and as what.
 *
 * The Document Server needs to be told which of its three editors to load —
 * Word, Cell or Slide — and it decides that from a file type it is handed, not
 * from the bytes. So the browser has to answer "what kind of document is this"
 * before anything is fetched, which is a question about the name and the MIME
 * type and nothing else. Hence a pure module.
 *
 * The second question it answers is the one that decides what the screen
 * offers: some formats round-trip and some only render. `.doc` and `.ppt` open
 * fine and cannot be saved back without silently converting the file to a
 * different format, and a Save button that quietly changes what your file *is*
 * is worse than no Save button. Those are view-only here, and the screen says
 * so rather than failing at save time.
 */

import type { Config } from "@onlyoffice/doceditor-types"

export type OfficeEditorKind = "word" | "cell" | "slide" | "pdf"

interface OfficeFormat {
  kind: OfficeEditorKind
  /** Whether the Document Server can write this format back unchanged. */
  editable: boolean
}

/**
 * Extension is the key, not the MIME type.
 *
 * Browsers, storage providers and Moodle disagree about the MIME type of an
 * `.xlsx` — `application/vnd.openxmlformats-officedocument.…`,
 * `application/octet-stream` and `application/zip` are all in circulation for
 * the same file — while the extension is what the person named it and what the
 * Document Server itself keys on.
 */
const FORMATS: Record<string, OfficeFormat> = {
  // Text
  docx: { kind: "word", editable: true },
  docxf: { kind: "word", editable: true },
  odt: { kind: "word", editable: true },
  rtf: { kind: "word", editable: true },
  txt: { kind: "word", editable: true },
  doc: { kind: "word", editable: false },
  dot: { kind: "word", editable: false },
  epub: { kind: "word", editable: false },
  // Spreadsheets
  xlsx: { kind: "cell", editable: true },
  ods: { kind: "cell", editable: true },
  csv: { kind: "cell", editable: true },
  xls: { kind: "cell", editable: false },
  // Slides
  pptx: { kind: "slide", editable: true },
  odp: { kind: "slide", editable: true },
  ppt: { kind: "slide", editable: false },
  pps: { kind: "slide", editable: false },
  // Fixed layout. The Document Server renders these and, since v8, annotates
  // them; it does not reflow them, so they are never "editable" here.
  pdf: { kind: "pdf", editable: false },
  djvu: { kind: "pdf", editable: false },
  xps: { kind: "pdf", editable: false },
}

/** A handful of MIME types are unambiguous, and are the fallback for a file with no extension. */
const BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "text/csv": "csv",
  "text/plain": "txt",
  "application/rtf": "rtf",
  "application/msword": "doc",
  "application/vnd.ms-excel": "xls",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
  "application/vnd.oasis.opendocument.text": "odt",
  "application/vnd.oasis.opendocument.spreadsheet": "ods",
  "application/vnd.oasis.opendocument.presentation": "odp",
}

/**
 * The file type the Document Server is handed.
 *
 * Lower-cased and stripped of the dot, because `Rapport.PDF` and `rapport.pdf`
 * are the same document and only one of them matches a lookup table.
 */
export function officeFileType(
  title: string,
  mimeType?: string | null
): string | null {
  const dot = title.lastIndexOf(".")
  const extension =
    dot > 0 && dot < title.length - 1
      ? title.slice(dot + 1).toLowerCase()
      : null
  if (extension && extension in FORMATS) return extension
  const fromMime = mimeType
    ? BY_MIME[mimeType.split(";")[0]?.trim() ?? ""]
    : null
  return fromMime ?? null
}

/** Which of the three editors opens this, or `null` when none of them does. */
export function officeEditorKind(
  title: string,
  mimeType?: string | null
): OfficeEditorKind | null {
  const fileType = officeFileType(title, mimeType)
  return fileType ? (FORMATS[fileType]?.kind ?? null) : null
}

/**
 * Whether this format can be saved back as itself.
 *
 * The answer decides whether the screen offers an Edit button at all, which is
 * the honest place to decide it: the alternative is finding out at save time
 * that your `.doc` has become a `.docx`.
 */
export function isOfficeEditable(
  title: string,
  mimeType?: string | null
): boolean {
  const fileType = officeFileType(title, mimeType)
  return fileType ? (FORMATS[fileType]?.editable ?? false) : false
}

/** Anything the Document Server will render, editable or not. */
export function isOfficeViewable(
  title: string,
  mimeType?: string | null
): boolean {
  return officeEditorKind(title, mimeType) !== null
}

/**
 * The config the server signs and the browser renders, verbatim.
 *
 * This is the Document Server's own `Config` type rather than a translation of
 * it: everything here is decided server-side — which URL the Document Server
 * can reach, whether the reader may edit, the JWT that says so — and a client
 * that reshapes a signed payload is a client that can disagree with what was
 * signed. Borrowing the vendor's type also means a config the editor would
 * reject does not typecheck.
 */
export type OnlyOfficeConfig = Config

export interface OnlyOfficeSession {
  /** Where the Document Server lives. Configured on the server, never here. */
  documentServerUrl: string
  config: OnlyOfficeConfig
}
