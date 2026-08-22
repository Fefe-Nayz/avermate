import type {
  MaterialDocumentView,
  MaterialFolderView,
  MaterialOrigin,
  MaterialPreviewStatus,
  MaterialTarget,
} from "./materials-types"
import type { MaterialsLocation } from "./materials-location"
import type { StudyDocument } from "@/components/documents/document-types"
import type { LectureRecordingView } from "@/components/recordings/recording-types"

/**
 * Everything a folder holds, as one list.
 *
 * Subfolders; uploads, links and pasted notes; revision sheets and mind maps;
 * lecture recordings. They were rendered by near-identical blocks of markup,
 * each inventing its own meta sentence — which is why the pane could never
 * become a table: a column needs every row to answer the same question, and
 * nothing was asking them.
 *
 * So the question is asked here, once, and the answer is data: a kind, a badge,
 * a size, a date. Sorting and filtering then work on all of them without knowing
 * what any of them is.
 */

export type MaterialRowKind = "folder" | "material" | "study" | "recording"

export interface MaterialRow {
  id: string
  kind: MaterialRowKind
  title: string
  /** Short, upper-case token in the type column — "PDF", "LIEN", "FICHE". */
  badge: string
  /** What the row is, in words, for the accessible name and the type filter. */
  typeLabel: string
  /** Bytes for a file, milliseconds for a recording, `null` when neither applies. */
  bytes: number | null
  durationMs: number | null
  /** How many things a folder holds; `null` for everything that is not one. */
  itemCount: number | null
  /**
   * Added here, or pulled in by an integration. A folder of lecture notes
   * Moodle pushed and one you built by hand looked exactly alike, which is
   * precisely when you want to know which is which.
   */
  origin: MaterialOrigin
  /** A folder has no edit date of its own, so it has none to show. */
  modifiedAt: Date | null
  /**
   * What the star, trash and tag procedures call this row.
   *
   * The row model says `material` where the API says `document`; every call
   * that acts on a row goes through here rather than translating at each call
   * site, which is where that mismatch would eventually be got wrong.
   */
  target: MaterialTarget
  starred: boolean
  /** In the bin. Only ever true in the trash view, which reads its own lists. */
  trashed: boolean
  /**
   * A row a sync deleted upstream rather than one you deleted. Restoring it
   * would bring it back only until the next sync, so the trash offers it the
   * permanent delete alone.
   */
  tombstone: boolean
  tagIds: readonly string[]
  /** Whether a thumbnail exists for the grid; `null` when the row can't have one. */
  previewStatus: MaterialPreviewStatus | null
  /** Whatever the row needs to open; the screen decides how. */
  source:
    | { kind: "folder"; folder: MaterialFolderView }
    | { kind: "material"; row: MaterialDocumentView }
    | { kind: "study"; document: StudyDocument }
    | { kind: "recording"; recording: LectureRecordingView }
}

export type MaterialSortKey = "name" | "type" | "size" | "modified"
export type SortDirection = "asc" | "desc"

export interface MaterialSort {
  key: MaterialSortKey
  direction: SortDirection
}

/**
 * The badge a file wears.
 *
 * From the extension where there is one, because that is what a person recognises at a
 * glance and what every file manager shows — `application/vnd.openxmlformats-…` is not a
 * type anybody reads. The MIME subtype is the fallback, upper-cased and trimmed.
 */
export function fileBadge(title: string, mimeType: string | null): string {
  const extension = title.includes(".") ? title.split(".").pop() : null
  if (extension && extension.length <= 5 && /^[a-z0-9]+$/i.test(extension)) {
    return extension.toUpperCase()
  }
  if (!mimeType) return "FILE"
  const subtype = mimeType.split("/").pop() ?? mimeType
  return subtype.split(/[.+-]/).pop()?.toUpperCase().slice(0, 5) ?? "FILE"
}

/**
 * A file size a person can read.
 *
 * Binary units, because that is what the upload limit is expressed in: telling
 * someone a 50 MiB cap rejected their 52 MB file, in different units, is how a
 * size limit becomes a mystery.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

export interface MaterialRowLabels {
  folder: string
  link: string
  note: string
  file: string
  fiche: string
  mindmap: string
  slides: string
  studyNote: string
  quiz?: string
  latex?: string
  recording: string
}

/** One list from every source, in no particular order — sorting is separate. */
export function materialRows(input: {
  folders?: readonly MaterialFolderView[]
  documents: readonly MaterialDocumentView[]
  studyDocuments: readonly StudyDocument[]
  recordings: readonly LectureRecordingView[]
  /** How many things each folder holds directly, keyed by folder id. */
  folderCounts?: ReadonlyMap<string, number>
  labels: MaterialRowLabels
}): MaterialRow[] {
  const { labels } = input
  return [
    ...(input.folders ?? []).map((folder): MaterialRow => ({
      id: folder.id,
      kind: "folder",
      title: folder.name,
      badge: labels.folder.toUpperCase(),
      typeLabel: labels.folder,
      bytes: null,
      durationMs: null,
      itemCount: input.folderCounts?.get(folder.id) ?? 0,
      origin: folder.origin,
      modifiedAt: null,
      target: { kind: "folder", id: folder.id },
      starred: folder.starredAt !== null,
      trashed: folder.deletedAt !== null,
      tombstone: isTombstone(folder.origin, folder.deletedBy),
      tagIds: folder.tagIds ?? [],
      previewStatus: null,
      source: { kind: "folder", folder },
    })),
    ...input.documents.map((row): MaterialRow => {
      const { document, file } = row
      const isFile = document.sourceType === "file"
      return {
        id: document.id,
        kind: "material",
        title: document.title,
        badge: isFile
          ? fileBadge(document.title, file?.mimeType ?? null)
          : document.sourceType === "link"
            ? labels.link.toUpperCase()
            : labels.note.toUpperCase(),
        typeLabel: isFile
          ? labels.file
          : document.sourceType === "link"
            ? labels.link
            : labels.note,
        bytes: file?.byteSize ?? null,
        durationMs: null,
        itemCount: null,
        origin: document.origin,
        modifiedAt: document.createdAt,
        target: { kind: "document", id: document.id },
        starred: document.starredAt !== null,
        trashed: document.deletedAt !== null,
        tombstone: isTombstone(document.origin, document.deletedBy),
        tagIds: document.tagIds ?? [],
        previewStatus: isFile
          ? (file?.previewStatus ?? "pending")
          : document.thumbnailUrl
            ? "ready"
            : null,
        source: { kind: "material", row },
      }
    }),
    ...input.studyDocuments.map((document): MaterialRow => {
      const typeLabel =
        document.kind === "fiche"
          ? labels.fiche
          : document.kind === "mindmap"
            ? labels.mindmap
            : document.kind === "slides"
              ? labels.slides
              : document.kind === "quiz"
                ? (labels.quiz ?? "Quiz")
                : document.kind === "latex"
                  ? (labels.latex ?? "LaTeX")
                  : labels.studyNote
      return {
        id: document.id,
        kind: "study",
        title: document.title,
        badge: typeLabel.toUpperCase(),
        typeLabel,
        bytes: null,
        durationMs: null,
        itemCount: null,
        // A revision sheet or a recording is always something you made here.
        origin: "manual",
        modifiedAt: document.updatedAt,
        target: { kind: "study", id: document.id },
        starred: document.starredAt !== null,
        trashed: document.deletedAt !== null,
        tombstone: false,
        tagIds: document.tagIds ?? [],
        previewStatus: null,
        source: { kind: "study", document },
      }
    }),
    ...input.recordings.map((recording): MaterialRow => ({
      id: recording.id,
      kind: "recording",
      title: recording.title,
      badge: labels.recording.toUpperCase(),
      typeLabel: labels.recording,
      bytes: null,
      durationMs: recording.durationMs,
      itemCount: null,
      origin: "manual",
      modifiedAt: recording.recordedAt,
      target: { kind: "recording", id: recording.id },
      starred: recording.starredAt !== null,
      trashed: recording.deletedAt !== null,
      tombstone: false,
      tagIds: recording.tagIds ?? [],
      previewStatus: null,
      source: { kind: "recording", recording },
    })),
  ]
}

/**
 * A row a provider removed upstream, rather than one you deleted.
 *
 * The server marks both with `deletedAt`, and only `deletedBy` separates them.
 * Restoring a provider's tombstone would put the row back until the next sync
 * noticed it was gone again, so the trash offers those the permanent delete
 * alone rather than a button that quietly undoes itself.
 */
function isTombstone(
  origin: MaterialOrigin,
  deletedBy: "user" | "provider" | null | undefined
): boolean {
  return origin !== "manual" && deletedBy === "provider"
}

/** Rows whose title or server-indexed material body matches a query. */
export function searchMaterialRows(
  rows: readonly MaterialRow[],
  query: string,
  contentMatches: ReadonlySet<string> = new Set()
): MaterialRow[] {
  const needle = normalize(query)
  if (!needle) return [...rows]
  return rows.filter(
    (row) =>
      normalize(row.title).includes(needle) ||
      (row.kind === "material" && contentMatches.has(row.id))
  )
}

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().trim()
}

/**
 * Rows of one type, by the token in the type column.
 *
 * A folder is never filtered away: it is the way further in, and hiding it would
 * take the only route into it out of this pane.
 */
export function filterMaterialRowsByType(
  rows: readonly MaterialRow[],
  badge: string | null
): MaterialRow[] {
  if (!badge) return [...rows]
  return rows.filter((row) => row.kind === "folder" || row.badge === badge)
}

/**
 * Rows carrying a tag.
 *
 * Unlike the type filter, a folder is not spared here: a tag view that always
 * listed every folder would bury the handful of things actually tagged, and
 * folders can be tagged themselves.
 */
export function filterMaterialRowsByTag(
  rows: readonly MaterialRow[],
  tagId: string | null
): MaterialRow[] {
  if (!tagId) return [...rows]
  return rows.filter((row) => row.tagIds.includes(tagId))
}

/**
 * What the row-shaped locations keep.
 *
 * The folder-shaped places have already decided membership by `folderId` before
 * a row gets here, so they keep everything they are handed. Favoris, Corbeille
 * and a tag ask the row instead — which is the whole reason they are separate
 * from `locationHolds`.
 */
export function filterMaterialRowsByLocation(
  rows: readonly MaterialRow[],
  location: MaterialsLocation
): MaterialRow[] {
  switch (location.kind) {
    case "starred":
      return rows.filter((row) => row.starred)
    case "trash":
      return rows.filter((row) => row.trashed)
    case "tag":
      return filterMaterialRowsByTag(rows, location.tagId)
    default:
      return [...rows]
  }
}

/** Rows from one place — what you added, or what an integration brought in. */
export function filterMaterialRowsByOrigin(
  rows: readonly MaterialRow[],
  origin: MaterialOrigin | null
): MaterialRow[] {
  if (!origin) return [...rows]
  return rows.filter((row) => row.origin === origin)
}

/**
 * Ordered for the column that was clicked.
 *
 * Folders come first whatever the column, the way they do in every file browser:
 * they are the way further in, and a name sort that buries them among fifty
 * files makes a folder something you hunt for rather than something you open.
 *
 * Name sorts by the reader's locale, so "École" lands with the E's. Size treats
 * a row with nothing to measure as smallest rather than dropping it, because a
 * sorted list that quietly loses its notes is worse than one that puts them at
 * one end.
 */
export function sortMaterialRows(
  rows: readonly MaterialRow[],
  sort: MaterialSort,
  locale = "fr"
): MaterialRow[] {
  const direction = sort.direction === "asc" ? 1 : -1
  const measure = (row: MaterialRow) => row.bytes ?? row.durationMs ?? -1
  const time = (row: MaterialRow) => row.modifiedAt?.getTime() ?? -1
  const byName = (left: MaterialRow, right: MaterialRow) =>
    left.title.localeCompare(right.title, locale)

  return [...rows].sort((left, right) => {
    if (left.kind !== right.kind) {
      if (left.kind === "folder") return -1
      if (right.kind === "folder") return 1
    }
    switch (sort.key) {
      case "type":
        return (
          (left.badge.localeCompare(right.badge, locale) ||
            byName(left, right)) * direction
        )
      case "size":
        return (
          (measure(left) - measure(right) || byName(left, right)) * direction
        )
      case "modified":
        return (time(left) - time(right) || byName(left, right)) * direction
      default:
        return byName(left, right) * direction
    }
  })
}

/**
 * The table's own sorting state, read as a sort.
 *
 * The column heads belong to the data grid, so the state they write is
 * TanStack's: a list of columns, of which this list only ever has one. Nothing
 * sorted means newest first, which is what a folder you have just added
 * something to should show.
 */
export function materialSortFromState(
  state: readonly { id: string; desc: boolean }[]
): MaterialSort {
  const first = state[0]
  if (!first || !isSortKey(first.id)) {
    return { key: "modified", direction: "desc" }
  }
  return { key: first.id, direction: first.desc ? "desc" : "asc" }
}

function isSortKey(id: string): id is MaterialSortKey {
  return id === "name" || id === "type" || id === "size" || id === "modified"
}
