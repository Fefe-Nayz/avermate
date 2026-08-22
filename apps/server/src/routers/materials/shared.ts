export interface MaterialFolderTreeRow {
  id: string;
  parentId: string | null;
}

/** Every descendant exactly once, even if historical data already contains a cycle. */
export function collectMaterialFolderDescendantIds(
  rows: readonly MaterialFolderTreeRow[],
  rootId: string,
): string[] {
  const children = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.parentId) continue;
    const siblings = children.get(row.parentId) ?? [];
    siblings.push(row.id);
    children.set(row.parentId, siblings);
  }

  const found: string[] = [];
  const seen = new Set([rootId]);
  const queue = [...(children.get(rootId) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    found.push(id);
    queue.push(...(children.get(id) ?? []));
  }
  return found;
}

/**
 * A human-readable reason a move is unsafe, or null when its parent chain is valid.
 * The 32-hop ceiling bounds both malformed imports and future synced folder trees.
 */
export function materialFolderMoveIssue(
  rows: readonly MaterialFolderTreeRow[],
  folderId: string,
  parentId: string | null,
): string | null {
  if (!parentId) return null;
  if (parentId === folderId) return "A folder cannot be its own parent";

  const parents = new Map(rows.map((row) => [row.id, row.parentId]));
  const seen = new Set<string>();
  let cursor: string | null | undefined = parentId;
  let hops = 0;
  while (cursor) {
    if (cursor === folderId) return "That would nest a folder inside itself";
    if (seen.has(cursor)) return "The folder tree already contains a cycle";
    if (hops >= 32) return "Material folders cannot be nested more than 32 levels";
    seen.add(cursor);
    cursor = parents.get(cursor) ?? null;
    hops += 1;
  }
  return null;
}

/** Stable fallback until link ingestion can read the remote page title. */
export function materialLinkTitle(rawUrl: string): string {
  const url = new URL(rawUrl);
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  return `${url.host}${path}`.slice(0, 160);
}
