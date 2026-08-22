/**
 * Where in the browser you are, as part of the address.
 *
 * The selected folder used to live in component state, which meant three things
 * were impossible: linking someone to a folder, the back button going back a
 * folder, and — the one that matters most here — the app's own breadcrumb saying
 * where you are. The header trail is built from the URL, so a location that is
 * not in the URL cannot appear in it.
 *
 * There are two families of place, and the difference between them is what the
 * pane is showing:
 *
 * - **Folder-shaped** — `root`, `all`, `folder`. A row belongs here because of
 *   where it is filed, so membership is decided by `folderId` alone.
 * - **Row-shaped** — `starred`, `trash`, `tag`. A row belongs here because of
 *   something about the row itself, so the folder tree is flattened away and the
 *   decision is made per row, in `materials-rows.ts`.
 *
 * The three original places, for the record:
 *
 * - **root** — the top of the tree: the folders that sit at the top, and the
 *   things filed in none of them. This is where you land.
 * - **all** — every source in the year at once, folders flattened away. A search
 *   view, not a place; landing here made the browser one long undifferentiated
 *   list where the folder structure may as well not have existed.
 * - **folder** — one folder: its subfolders and its contents.
 */

export const MATERIALS_FOLDER_PARAM = "folder"
/**
 * A tag is a place too, and it is its own parameter rather than a `folder=`
 * value: a tag id and a folder id are both opaque strings, and sharing one slot
 * would make a link ambiguous the day the two ever collide.
 */
export const MATERIALS_TAG_PARAM = "tag"
/**
 * Which source to open on arrival.
 *
 * An uploaded file has no page of its own — it opens in a viewer over the
 * browser — so this is what makes one linkable at all, and what lets the
 * command palette jump straight to it.
 */
export const MATERIALS_OPEN_PARAM = "open"
/**
 * Reading or editing what is open.
 *
 * In the address rather than in state, for the same reason the folder is:
 * "the LaTeX source I am editing" is a place you should be able to link to and
 * come back to with the back button, and a mode kept in a component is a mode
 * that resets every time the list refetches.
 */
export const MATERIALS_MODE_PARAM = "mode"
/** Which side of an open document you are on: the document, or its text. */
export const MATERIALS_TAB_PARAM = "tab"
export const ALL_PARAM_VALUE = "all"
export const STARRED_PARAM_VALUE = "starred"
export const TRASH_PARAM_VALUE = "trash"

export type MaterialsLocation =
  | { kind: "root" }
  | { kind: "all" }
  | { kind: "starred" }
  | { kind: "trash" }
  | { kind: "tag"; tagId: string }
  | { kind: "folder"; folderId: string }

export const ROOT_MATERIALS: MaterialsLocation = { kind: "root" }
export const ALL_MATERIALS: MaterialsLocation = { kind: "all" }
export const STARRED_MATERIALS: MaterialsLocation = { kind: "starred" }
export const TRASH_MATERIALS: MaterialsLocation = { kind: "trash" }

/**
 * Whether the pane reads live rows or the deleted ones.
 *
 * Every list procedure takes `include` and defaults to live, which is the rule
 * the browser depends on: it has no concept of a hidden row and would otherwise
 * count deleted files in every folder badge.
 */
export type MaterialsInclude = "live" | "trashed"

export function locationInclude(location: MaterialsLocation): MaterialsInclude {
  return location.kind === "trash" ? "trashed" : "live"
}

/**
 * A location whose membership is decided by the row rather than by the folder
 * it sits in. These flatten the tree: showing "the folders inside Favoris" is
 * not a question that has an answer.
 */
export function isFlatLocation(location: MaterialsLocation): boolean {
  return (
    location.kind === "all" ||
    location.kind === "starred" ||
    location.kind === "trash" ||
    location.kind === "tag"
  )
}

/** Anything unrecognised means the root, never an error screen. */
export function parseMaterialsLocation(
  param: string | null | undefined,
  tagParam?: string | null
): MaterialsLocation {
  const tag = tagParam?.trim()
  if (tag) return { kind: "tag", tagId: tag }
  const value = param?.trim()
  if (!value) return ROOT_MATERIALS
  if (value === ALL_PARAM_VALUE) return ALL_MATERIALS
  if (value === STARRED_PARAM_VALUE) return STARRED_MATERIALS
  if (value === TRASH_PARAM_VALUE) return TRASH_MATERIALS
  return { kind: "folder", folderId: value }
}

/** The href of a location, for links and for `history.pushState`. */
export function materialsLocationHref(location: MaterialsLocation): string {
  if (location.kind === "root") return "/materials"
  if (location.kind === "tag") {
    return `/materials?${MATERIALS_TAG_PARAM}=${encodeURIComponent(location.tagId)}`
  }
  const value =
    location.kind === "all"
      ? ALL_PARAM_VALUE
      : location.kind === "starred"
        ? STARRED_PARAM_VALUE
        : location.kind === "trash"
          ? TRASH_PARAM_VALUE
          : location.folderId
  return `/materials?${MATERIALS_FOLDER_PARAM}=${encodeURIComponent(value)}`
}

/**
 * The address of one document, read from where you are.
 *
 * The location is kept rather than replaced: closing the document has to put
 * you back in the folder you opened it from, and a URL that carried only the
 * document could not say which one that was.
 */
export function materialsOpenHref(
  location: MaterialsLocation,
  rowId: string,
  options: { mode?: "read" | "edit"; tab?: "source" | "transcript" } = {}
): string {
  const base = materialsLocationHref(location)
  const separator = base.includes("?") ? "&" : "?"
  const mode = options.mode === "edit" ? `&${MATERIALS_MODE_PARAM}=edit` : ""
  const tab =
    options.tab === "transcript" ? `&${MATERIALS_TAB_PARAM}=transcript` : ""
  return `${base}${separator}${MATERIALS_OPEN_PARAM}=${encodeURIComponent(rowId)}${mode}${tab}`
}

/** The folder a new item would be filed into: only a real folder is one. */
export function locationFolderId(location: MaterialsLocation): string | null {
  return location.kind === "folder" ? location.folderId : null
}

export function sameMaterialsLocation(
  left: MaterialsLocation,
  right: MaterialsLocation
): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind === "folder") {
    return left.folderId === (right as typeof left).folderId
  }
  if (left.kind === "tag") return left.tagId === (right as typeof left).tagId
  return true
}

/**
 * A folder that has been deleted — or that belongs to another year — is not a
 * location. Falling back to the root keeps a stale link working instead of
 * showing an empty folder that cannot be left. A tag that no longer exists is
 * the same story.
 */
export function resolveMaterialsLocation(
  location: MaterialsLocation,
  knownFolderIds: ReadonlySet<string>,
  knownTagIds: ReadonlySet<string> = new Set()
): MaterialsLocation {
  if (location.kind === "tag") {
    return knownTagIds.has(location.tagId) ? location : ROOT_MATERIALS
  }
  if (location.kind !== "folder") return location
  return knownFolderIds.has(location.folderId) ? location : ROOT_MATERIALS
}

/**
 * Whether something filed in `folderId` belongs to this location.
 *
 * The root holds what is filed nowhere; the flat locations hold everything they
 * are handed and let the row decide, which is what makes them views rather than
 * places.
 */
export function locationHolds(
  location: MaterialsLocation,
  folderId: string | null
): boolean {
  switch (location.kind) {
    case "root":
      return folderId === null
    case "folder":
      return folderId === location.folderId
    default:
      return true
  }
}

/**
 * What a search from here should look through.
 *
 * A search that only reads the folder you happen to be standing in is a search
 * that cannot find anything you have filed — which is the only time you need
 * one. So searching widens to the whole branch below you: from the root, the
 * whole year; from a folder, that folder and everything inside it.
 *
 * The folder ids are handed in rather than computed, so this stays a pure
 * decision about scope.
 */
export function materialsSearchScope(
  location: MaterialsLocation,
  branchOf: (folderId: string) => ReadonlySet<string>,
  everyFolderId: readonly string[]
): { unfiled: boolean; folderIds: ReadonlySet<string> } {
  if (location.kind === "folder") {
    return { unfiled: false, folderIds: branchOf(location.folderId) }
  }
  return { unfiled: true, folderIds: new Set(everyFolderId) }
}

/** Whether something filed in `folderId` is inside a search scope. */
export function scopeHolds(
  scope: { unfiled: boolean; folderIds: ReadonlySet<string> },
  folderId: string | null
): boolean {
  return folderId === null ? scope.unfiled : scope.folderIds.has(folderId)
}

/**
 * Whether a folder is one of the ones you can walk into from here.
 *
 * "All" shows no folders: it has already flattened them, and offering a way
 * into one from a list that ignores them reads as a contradiction. Favoris,
 * Corbeille and a tag are different — a folder can itself be starred, deleted
 * or tagged, so it belongs in those lists as a row, and the row filter decides.
 */
export function locationShowsFolder(
  location: MaterialsLocation,
  parentId: string | null
): boolean {
  switch (location.kind) {
    case "all":
      return false
    case "root":
      return parentId === null
    case "folder":
      return parentId === location.folderId
    default:
      return true
  }
}
