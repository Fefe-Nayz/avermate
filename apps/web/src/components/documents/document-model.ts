export const DOCUMENT_AUTOSAVE_DELAY_MS = 1_500
export const DOCUMENT_BODY_MAX_BYTES = 512 * 1024

export type DocumentCalloutKind = "DEF" | "THM" | "METH" | "PIEGE" | "CHECK"

export const DOCUMENT_CALLOUT_KINDS = [
  "DEF",
  "THM",
  "METH",
  "PIEGE",
  "CHECK",
] as const satisfies readonly DocumentCalloutKind[]

export const DOCUMENT_CALLOUT_SNIPPETS: Record<DocumentCalloutKind, string> = {
  DEF: "> [!DEF]\n> ",
  THM: "> [!THM]\n> ",
  METH: "> [!METH]\n> ",
  PIEGE: "> [!PIEGE]\n> ",
  CHECK: "> [!CHECK]\n> ",
}

export interface DocumentDraftSnapshot {
  title: string
  bodyMarkdown: string
}

export function documentBodyByteLength(bodyMarkdown: string): number {
  return new TextEncoder().encode(bodyMarkdown).byteLength
}

export function documentDraftIsDirty(
  draft: DocumentDraftSnapshot,
  saved: DocumentDraftSnapshot
): boolean {
  return (
    draft.title !== saved.title || draft.bodyMarkdown !== saved.bodyMarkdown
  )
}

export function documentDraftIsValid(draft: DocumentDraftSnapshot): boolean {
  const title = draft.title.trim()
  return (
    title.length > 0 &&
    title.length <= 160 &&
    documentBodyByteLength(draft.bodyMarkdown) <= DOCUMENT_BODY_MAX_BYTES
  )
}

export function isDocumentConflictError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("This fiche changed elsewhere")
  )
}
