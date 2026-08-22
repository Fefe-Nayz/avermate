export const MINDMAP_MAX_DEPTH = 8
export const MINDMAP_MAX_NODES = 500
export const MINDMAP_LABEL_MAX_LENGTH = 120
export const MINDMAP_NOTE_MAX_LENGTH = 8 * 1024
export const MINDMAP_META_MAX_BYTES = 512 * 1024

export interface MindmapNodeV1 {
  id: string
  label: string
  children?: MindmapNodeV1[]
  note?: string
}

export interface MindmapContentV1 {
  version: 1
  root: MindmapNodeV1
}

export interface MindmapOutlineRow {
  id: string
  label: string
  note?: string
  depth: number
  parentId: string | null
}

export interface MindmapLayoutNode extends MindmapOutlineRow {
  x: number
  y: number
}

export interface MindmapLayoutEdge {
  id: string
  source: string
  target: string
}

export interface MindmapLayout {
  nodes: MindmapLayoutNode[]
  edges: MindmapLayoutEdge[]
  width: number
  height: number
}

export function createMindmapContent(
  label: string,
  id: string
): MindmapContentV1 {
  return {
    version: 1,
    root: { id, label: label.trim().slice(0, MINDMAP_LABEL_MAX_LENGTH) },
  }
}

export function flattenMindmap(content: MindmapContentV1): MindmapOutlineRow[] {
  const rows: MindmapOutlineRow[] = []
  const visit = (
    node: MindmapNodeV1,
    depth: number,
    parentId: string | null
  ) => {
    rows.push({
      id: node.id,
      label: node.label,
      ...(node.note === undefined ? {} : { note: node.note }),
      depth,
      parentId,
    })
    for (const child of node.children ?? []) visit(child, depth + 1, node.id)
  }
  visit(content.root, 0, null)
  return rows
}

function rebuildMindmap(rows: readonly MindmapOutlineRow[]): MindmapContentV1 {
  const built: MindmapNodeV1[] = []
  const stack: MindmapNodeV1[] = []

  for (const row of rows) {
    const node: MindmapNodeV1 = {
      id: row.id,
      label: row.label,
      ...(row.note === undefined ? {} : { note: row.note }),
    }
    built.push(node)
    if (row.depth > 0) {
      const parent = stack[row.depth - 1]
      if (parent) parent.children = [...(parent.children ?? []), node]
    }
    stack[row.depth] = node
    stack.length = row.depth + 1
  }

  return { version: 1, root: built[0]! }
}

function subtreeEnd(rows: readonly MindmapOutlineRow[], index: number): number {
  const depth = rows[index]?.depth
  if (depth === undefined) return index
  let end = index + 1
  while (end < rows.length && (rows[end]?.depth ?? 0) > depth) end += 1
  return end
}

function validNewNode(
  content: MindmapContentV1,
  node: MindmapNodeV1,
  targetDepth: number
): boolean {
  const existingIds = new Set(flattenMindmap(content).map((row) => row.id))
  const stack = [{ node, depth: targetDepth }]
  let added = 0
  while (stack.length > 0) {
    const current = stack.pop()!
    added += 1
    if (
      !current.node.id.trim() ||
      current.node.id.length > 160 ||
      existingIds.has(current.node.id) ||
      !current.node.label.trim() ||
      current.node.label.length > MINDMAP_LABEL_MAX_LENGTH ||
      (current.node.note?.length ?? 0) > MINDMAP_NOTE_MAX_LENGTH ||
      current.depth >= MINDMAP_MAX_DEPTH
    ) {
      return false
    }
    existingIds.add(current.node.id)
    for (const child of current.node.children ?? []) {
      stack.push({ node: child, depth: current.depth + 1 })
    }
  }
  return flattenMindmap(content).length + added <= MINDMAP_MAX_NODES
}

function flattenedNode(
  node: MindmapNodeV1,
  depth: number,
  parentId: string | null
): MindmapOutlineRow[] {
  return flattenMindmap({ version: 1, root: node }).map((row) => ({
    ...row,
    depth: row.depth + depth,
    parentId: row.depth === 0 ? parentId : row.parentId,
  }))
}

export function addMindmapChild(
  content: MindmapContentV1,
  parentId: string,
  node: MindmapNodeV1
): MindmapContentV1 {
  const rows = flattenMindmap(content)
  const parentIndex = rows.findIndex((row) => row.id === parentId)
  if (parentIndex < 0) return content
  const depth = rows[parentIndex]!.depth + 1
  if (!validNewNode(content, node, depth)) return content
  rows.splice(
    subtreeEnd(rows, parentIndex),
    0,
    ...flattenedNode(node, depth, parentId)
  )
  return rebuildMindmap(rows)
}

export function addMindmapSibling(
  content: MindmapContentV1,
  targetId: string,
  node: MindmapNodeV1
): MindmapContentV1 {
  const rows = flattenMindmap(content)
  const targetIndex = rows.findIndex((row) => row.id === targetId)
  const target = rows[targetIndex]
  if (!target || target.depth === 0) return content
  if (!validNewNode(content, node, target.depth)) return content
  rows.splice(
    subtreeEnd(rows, targetIndex),
    0,
    ...flattenedNode(node, target.depth, target.parentId)
  )
  return rebuildMindmap(rows)
}

export function setMindmapLabel(
  content: MindmapContentV1,
  nodeId: string,
  label: string
): MindmapContentV1 {
  if (label.length > MINDMAP_LABEL_MAX_LENGTH) return content
  const rows = flattenMindmap(content)
  const target = rows.find((row) => row.id === nodeId)
  if (!target || target.label === label) return content
  target.label = label
  return rebuildMindmap(rows)
}

export function setMindmapNote(
  content: MindmapContentV1,
  nodeId: string,
  note: string
): MindmapContentV1 {
  if (note.length > MINDMAP_NOTE_MAX_LENGTH) return content
  const rows = flattenMindmap(content)
  const target = rows.find((row) => row.id === nodeId)
  if (!target || (target.note ?? "") === note) return content
  target.note = note || undefined
  return rebuildMindmap(rows)
}

export function deleteMindmapNode(
  content: MindmapContentV1,
  nodeId: string
): MindmapContentV1 {
  const rows = flattenMindmap(content)
  const index = rows.findIndex((row) => row.id === nodeId)
  if (index <= 0) return content
  rows.splice(index, subtreeEnd(rows, index) - index)
  return rebuildMindmap(rows)
}

export function indentMindmapNode(
  content: MindmapContentV1,
  nodeId: string
): MindmapContentV1 {
  const rows = flattenMindmap(content)
  const index = rows.findIndex((row) => row.id === nodeId)
  const current = rows[index]
  if (!current || current.depth === 0) return content

  let previousIndex = index - 1
  while (previousIndex >= 0 && rows[previousIndex]!.depth > current.depth) {
    previousIndex -= 1
  }
  if (rows[previousIndex]?.depth !== current.depth) return content

  const end = subtreeEnd(rows, index)
  const maxDepth = Math.max(...rows.slice(index, end).map((row) => row.depth))
  if (maxDepth + 1 >= MINDMAP_MAX_DEPTH) return content
  for (let cursor = index; cursor < end; cursor += 1) {
    rows[cursor]!.depth += 1
  }
  return rebuildMindmap(rows)
}

export function outdentMindmapNode(
  content: MindmapContentV1,
  nodeId: string
): MindmapContentV1 {
  const rows = flattenMindmap(content)
  const index = rows.findIndex((row) => row.id === nodeId)
  const current = rows[index]
  if (!current || current.depth <= 1) return content

  let parentIndex = index - 1
  while (parentIndex >= 0 && rows[parentIndex]!.depth >= current.depth) {
    parentIndex -= 1
  }
  if (rows[parentIndex]?.depth !== current.depth - 1) return content

  const end = subtreeEnd(rows, index)
  const moved = rows.splice(index, end - index).map((row) => ({
    ...row,
    depth: row.depth - 1,
  }))
  const insertionIndex = subtreeEnd(rows, parentIndex)
  rows.splice(insertionIndex, 0, ...moved)
  return rebuildMindmap(rows)
}

export function mindmapContentIssue(content: MindmapContentV1): string | null {
  if (content.version !== 1 || !content.root) return "Invalid mind map content"
  const ids = new Set<string>()
  const seenObjects = new WeakSet<object>()
  const stack = [{ node: content.root, depth: 1 }]
  let count = 0

  while (stack.length > 0) {
    const { node, depth } = stack.pop()!
    count += 1
    if (count > MINDMAP_MAX_NODES) return "Too many mind map nodes"
    if (depth > MINDMAP_MAX_DEPTH) return "The mind map is too deep"
    if (seenObjects.has(node)) return "The mind map cannot contain cycles"
    seenObjects.add(node)
    if (!node.id.trim() || node.id.length > 160 || ids.has(node.id)) {
      return "Mind map node ids must be unique"
    }
    if (!node.label.trim() || node.label.length > MINDMAP_LABEL_MAX_LENGTH) {
      return "Every mind map node needs a short label"
    }
    if ((node.note?.length ?? 0) > MINDMAP_NOTE_MAX_LENGTH) {
      return "A mind map note is too long"
    }
    ids.add(node.id)
    for (let index = (node.children?.length ?? 0) - 1; index >= 0; index -= 1) {
      stack.push({ node: node.children![index]!, depth: depth + 1 })
    }
  }
  if (
    new TextEncoder().encode(JSON.stringify(content)).byteLength >
    MINDMAP_META_MAX_BYTES
  ) {
    return "The mind map must stay under 512 KiB"
  }
  return null
}

export function layoutMindmap(
  content: MindmapContentV1,
  options: { columnGap?: number; rowGap?: number } = {}
): MindmapLayout {
  const columnGap = options.columnGap ?? 240
  const rowGap = options.rowGap ?? 96
  const positions = new Map<string, { x: number; y: number }>()
  const edges: MindmapLayoutEdge[] = []
  let nextLeaf = 0

  const visit = (node: MindmapNodeV1, depth: number): number => {
    const childYs = (node.children ?? []).map((child) => {
      edges.push({
        id: `${node.id}->${child.id}`,
        source: node.id,
        target: child.id,
      })
      return visit(child, depth + 1)
    })
    const y =
      childYs.length > 0
        ? (childYs[0]! + childYs[childYs.length - 1]!) / 2
        : nextLeaf++ * rowGap
    positions.set(node.id, { x: depth * columnGap, y })
    return y
  }
  visit(content.root, 0)

  const rows = flattenMindmap(content)
  const nodes = rows.map((row) => ({ ...row, ...positions.get(row.id)! }))
  const maxDepth = Math.max(0, ...rows.map((row) => row.depth))
  return {
    nodes,
    edges,
    width: maxDepth * columnGap + 220,
    height: Math.max(rowGap, nextLeaf * rowGap),
  }
}
