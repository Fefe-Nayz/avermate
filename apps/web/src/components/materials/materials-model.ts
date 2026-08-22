export interface MaterialFolderLike {
  id: string
  name: string
  parentId: string | null
  sortOrder: number
}

export type MaterialFolderTreeIssue = "cycle" | "orphan" | null

export interface MaterialFolderTreeNode<T extends MaterialFolderLike> {
  folder: T
  children: MaterialFolderTreeNode<T>[]
  issue: MaterialFolderTreeIssue
}

export interface FlatMaterialFolder<T extends MaterialFolderLike> {
  folder: T
  depth: number
  issue: MaterialFolderTreeIssue
}

function compareFolders(a: MaterialFolderLike, b: MaterialFolderLike): number {
  return (
    a.sortOrder - b.sortOrder ||
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
    a.id.localeCompare(b.id)
  )
}

/**
 * Find every row participating in a parent cycle. Broken parent references are
 * not cycles: they become explicit roots so the browser never hides data.
 */
function cycleIds<T extends MaterialFolderLike>(
  folders: readonly T[],
  byId: ReadonlyMap<string, T>
): Set<string> {
  const cycles = new Set<string>()

  for (const folder of folders) {
    const path: string[] = []
    const position = new Map<string, number>()
    let current: T | undefined = folder

    while (current) {
      if (position.has(current.id)) {
        const start = position.get(current.id) ?? 0
        for (const id of path.slice(start)) cycles.add(id)
        break
      }
      position.set(current.id, path.length)
      path.push(current.id)
      current = current.parentId ? byId.get(current.parentId) : undefined
    }
  }

  return cycles
}

/**
 * Build a deterministic, lossless folder tree. Orphans and cycle members are
 * promoted to roots instead of disappearing behind an invalid parent edge.
 */
export function buildMaterialFolderTree<T extends MaterialFolderLike>(
  folders: readonly T[]
): MaterialFolderTreeNode<T>[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const cycles = cycleIds(folders, byId)
  const nodes = new Map<string, MaterialFolderTreeNode<T>>()

  for (const folder of folders) {
    nodes.set(folder.id, {
      folder,
      children: [],
      issue: cycles.has(folder.id)
        ? "cycle"
        : folder.parentId && !byId.has(folder.parentId)
          ? "orphan"
          : null,
    })
  }

  const roots: MaterialFolderTreeNode<T>[] = []
  for (const node of nodes.values()) {
    const parent = node.folder.parentId
      ? nodes.get(node.folder.parentId)
      : undefined
    if (!parent || node.issue) roots.push(node)
    else parent.children.push(node)
  }

  const sortNodes = (items: MaterialFolderTreeNode<T>[]) => {
    items.sort((a, b) => compareFolders(a.folder, b.folder))
    for (const item of items) sortNodes(item.children)
  }
  sortNodes(roots)
  return roots
}

export function flattenMaterialFolderTree<T extends MaterialFolderLike>(
  tree: readonly MaterialFolderTreeNode<T>[]
): FlatMaterialFolder<T>[] {
  const flat: FlatMaterialFolder<T>[] = []
  const seen = new Set<string>()

  const visit = (node: MaterialFolderTreeNode<T>, depth: number) => {
    if (seen.has(node.folder.id)) return
    seen.add(node.folder.id)
    flat.push({ folder: node.folder, depth, issue: node.issue })
    for (const child of node.children) visit(child, depth + 1)
  }

  for (const root of tree) visit(root, 0)
  return flat
}

/**
 * The path from a root down to one folder, that folder included.
 *
 * This is what the header breadcrumb reads: "Matières / Physique / TP" rather
 * than a single name with no idea what it sits inside. A folder that is not
 * there has no path — an empty trail, never a partial one — and a parent cycle
 * stops at the first folder it meets twice instead of walking forever.
 */
export function materialFolderTrail<T extends MaterialFolderLike>(
  folders: readonly T[],
  folderId: string
): T[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const seen = new Set<string>()
  const trail: T[] = []

  let current = byId.get(folderId)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    trail.unshift(current)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return trail
}

/** One node of the folder tree, in the shape a headless tree asks for. */
export interface MaterialTreeItem {
  name: string
  childIds: string[]
  issue: MaterialFolderTreeIssue
}

/** The id of the node every real folder hangs off; it is never rendered. */
export const MATERIAL_TREE_ROOT = "__materials_root__"

/**
 * The folder tree as a flat record keyed by id.
 *
 * A tree component asks two questions about an id — what is it called, and what
 * is inside it — so that is what this answers. Order comes from
 * `buildMaterialFolderTree`, which also decides what happens to a folder whose
 * parent is missing or circular: it becomes a root, so nothing can disappear
 * behind a broken edge.
 */
export function materialTreeItems<T extends MaterialFolderLike>(
  folders: readonly T[]
): Record<string, MaterialTreeItem> {
  const tree = buildMaterialFolderTree(folders)
  const items: Record<string, MaterialTreeItem> = {
    [MATERIAL_TREE_ROOT]: {
      name: "",
      childIds: tree.map((node) => node.folder.id),
      issue: null,
    },
  }

  const visit = (node: MaterialFolderTreeNode<T>) => {
    items[node.folder.id] = {
      name: node.folder.name,
      childIds: node.children.map((child) => child.folder.id),
      issue: node.issue,
    }
    for (const child of node.children) visit(child)
  }
  for (const root of tree) visit(root)

  return items
}

/** Every folder inside `folderId`, at any depth, and the folder itself. */
export function materialFolderBranch<T extends MaterialFolderLike>(
  folders: readonly T[],
  folderId: string
): Set<string> {
  const childrenOf = new Map<string | null, string[]>()
  for (const folder of folders) {
    const siblings = childrenOf.get(folder.parentId) ?? []
    siblings.push(folder.id)
    childrenOf.set(folder.parentId, siblings)
  }

  const branch = new Set<string>()
  const walk = (id: string) => {
    if (branch.has(id)) return
    branch.add(id)
    for (const child of childrenOf.get(id) ?? []) walk(child)
  }
  walk(folderId)
  return branch
}

export function flattenMaterialFolders<T extends MaterialFolderLike>(
  folders: readonly T[]
): FlatMaterialFolder<T>[] {
  return flattenMaterialFolderTree(buildMaterialFolderTree(folders))
}

/** Mirror the server's self/descendant/cycle rejection for move pickers. */
export function canMoveMaterialFolder<T extends MaterialFolderLike>(
  folders: readonly T[],
  folderId: string,
  parentId: string | null
): boolean {
  if (parentId === null) return true
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  if (!byId.has(folderId) || !byId.has(parentId)) return false

  const seen = new Set<string>()
  let current: T | undefined = byId.get(parentId)
  while (current) {
    if (current.id === folderId || seen.has(current.id)) return false
    seen.add(current.id)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return true
}
