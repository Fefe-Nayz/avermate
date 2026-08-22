import type { MaterialFolderLike } from "./materials-model"

/**
 * Where a thing came from: added here by hand, or pulled in by an integration.
 * The server has always recorded it; the screen had never shown it, so an
 * imported course folder and one you made looked identical.
 */
export type MaterialOrigin = "manual" | "moodle" | "onedrive" | "googledrive"

/**
 * What the star, the trash and the tags are attached to.
 *
 * The operations router speaks one vocabulary for all four kinds of thing in
 * the browser, so the client does too — note that an uploaded file is a
 * `document` here and a `material` in the row model, which is the one place
 * those two words disagree.
 */
export type MaterialTargetKind = "folder" | "document" | "study" | "recording"

export interface MaterialTarget {
  kind: MaterialTargetKind
  id: string
}

/**
 * The three columns every kind of row now carries.
 *
 * `starredAt` and `deletedAt` are timestamps rather than booleans because the
 * server records when, and "starred a month ago" is an ordering the favourites
 * list will eventually want. `deletedBy` separates a delete you made from a row
 * a sync stopped seeing upstream: the first is restorable, the second is a
 * tombstone and restoring it would only bring it back until the next sync.
 */
export interface MaterialLifecycle {
  starredAt: Date | null
  deletedAt: Date | null
  deletedFrom?: string | null
  deletedBy?: "user" | "provider" | null
  tagIds?: readonly string[]
}

export interface MaterialFolderView
  extends MaterialFolderLike, MaterialLifecycle {
  subjectId: string | null
  origin: MaterialOrigin
}

export interface MaterialDocumentView {
  document: MaterialLifecycle & {
    id: string
    title: string
    folderId: string | null
    sourceType: "file" | "link" | "text"
    sourceUrl: string | null
    origin: MaterialOrigin
    /** Safe extractor family, used only to label the original-source action. */
    sourceKind?: "web" | "youtube" | null
    /** Safe list projection; full provider metadata stays on the detail/artifact. */
    thumbnailUrl?: string | null
    createdAt: Date
  }
  file: {
    id: string
    mimeType: string
    byteSize: number
    status: string
    /** Whether a thumbnail exists yet; see plan 020 §3. */
    previewStatus?: MaterialPreviewStatus | null
  } | null
}

export type MaterialPreviewStatus =
  "pending" | "ready" | "unsupported" | "failed"

/**
 * A tag, as the browser reads it.
 *
 * `color` is a token name and never a hex — the server refuses anything else —
 * so a tag stays legible when the theme changes, which a stored `#8ab4a0` would
 * not. `subjectId` is optional on purpose: a tag can be about a subject
 * ("Physique — TD corrigé") or cut across all of them ("à relire").
 */
export interface MaterialTagView {
  id: string
  name: string
  color: string | null
  subjectId: string | null
  yearId: string
  createdAt: Date
  updatedAt: Date
}

export interface MaterialSubjectView {
  id: string
  name: string
}

export type MaterialFolderDialogState =
  | { mode: "create"; parentId: string | null }
  | { mode: "rename"; folder: MaterialFolderView }
  | { mode: "move"; folder: MaterialFolderView }

export type MaterialDocumentDialogState =
  | { mode: "text"; folderId: string | null }
  | { mode: "link"; folderId: string | null }
  | { mode: "rename"; row: MaterialDocumentView }
  | { mode: "move"; row: MaterialDocumentView }

export type MaterialDeleteTarget =
  | { kind: "folder"; folder: MaterialFolderView }
  | { kind: "document"; row: MaterialDocumentView }
