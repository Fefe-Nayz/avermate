import type { DocumentCalloutKind } from "./document-model"

interface MarkdownNode {
  type?: string
  value?: string
  children?: MarkdownNode[]
  data?: {
    hName?: string
    hProperties?: Record<string, unknown>
    [key: string]: unknown
  }
}

const CALLOUT_MARKER = /^\[!(DEF|THM|METH|PIEGE|CHECK)\](?:[ \t]*\r?\n)?/

/** Turn one supported blockquote into a semantic aside for react-markdown. */
export function transformCalloutBlockquote(
  node: MarkdownNode
): DocumentCalloutKind | null {
  if (node.type !== "blockquote") return null
  const paragraph = node.children?.[0]
  if (paragraph?.type !== "paragraph") return null
  const markerNode = paragraph.children?.[0]
  if (markerNode?.type !== "text" || typeof markerNode.value !== "string") {
    return null
  }
  const match = CALLOUT_MARKER.exec(markerNode.value)
  if (!match) return null
  const kind = match[1] as DocumentCalloutKind
  markerNode.value = markerNode.value.slice(match[0].length)
  if (!markerNode.value) {
    paragraph.children?.shift()
    if (paragraph.children?.length === 0) node.children?.shift()
  }
  node.data = {
    ...node.data,
    hName: "aside",
    hProperties: {
      ...node.data?.hProperties,
      "data-callout": kind,
      role: "note",
    },
  }
  return kind
}

function walk(node: MarkdownNode): void {
  transformCalloutBlockquote(node)
  for (const child of node.children ?? []) walk(child)
}

/** remark plugin kept dependency-free so its five directives stay testable. */
export function remarkCallouts() {
  return (tree: unknown) => walk(tree as MarkdownNode)
}
