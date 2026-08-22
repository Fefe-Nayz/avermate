import GithubSlugger from "github-slugger"

interface MarkdownNode {
  type: string
  value?: string
  alt?: string
  depth?: number
  url?: string
  children?: MarkdownNode[]
  data?: {
    hProperties?: Record<string, unknown>
    [key: string]: unknown
  }
}

interface TocEntry {
  depth: number
  id: string
  label: string
  children: TocEntry[]
}

const TOC_MARKER = /^\[toc\]$/i

function nodeText(node: MarkdownNode): string {
  if (typeof node.value === "string") return node.value
  if (typeof node.alt === "string") return node.alt
  return (node.children ?? []).map(nodeText).join("")
}

function tocList(entries: readonly TocEntry[]): MarkdownNode {
  return {
    type: "list",
    children: entries.map((entry) => ({
      type: "listItem",
      children: [
        {
          type: "paragraph",
          children: [
            {
              type: "link",
              url: `#${entry.id}`,
              children: [{ type: "text", value: entry.label }],
            },
          ],
        },
        ...(entry.children.length > 0 ? [tocList(entry.children)] : []),
      ],
    })),
  }
}

function isTocMarker(node: MarkdownNode): boolean {
  return (
    node.type === "paragraph" &&
    node.children?.length === 1 &&
    node.children[0]?.type === "text" &&
    TOC_MARKER.test(node.children[0].value?.trim() ?? "")
  )
}

/**
 * Give headings stable GitHub-compatible ids and expand MPE's standalone
 * `[TOC]` marker into a real, keyboard-navigable list.
 *
 * The ids are written on the Markdown tree before `rehype-slug` runs. That
 * keeps duplicate and accented headings identical between the generated links
 * and the eventual heading elements, while `rehype-slug` remains the fallback
 * for headings created by another plugin later in the pipeline.
 */
export function remarkDocumentToc() {
  return (tree: unknown) => {
    const root = tree as MarkdownNode
    const headings: TocEntry[] = []
    const stack: TocEntry[] = []
    const slugger = new GithubSlugger()

    for (const node of root.children ?? []) {
      if (node.type !== "heading" || !node.depth) continue
      const label = nodeText(node).trim()
      if (!label) continue
      const id = slugger.slug(label)
      node.data = {
        ...node.data,
        hProperties: { ...node.data?.hProperties, id },
      }
      const entry: TocEntry = { depth: node.depth, id, label, children: [] }
      while (stack.at(-1) && stack.at(-1)!.depth >= entry.depth) stack.pop()
      const parent = stack.at(-1)
      if (parent) parent.children.push(entry)
      else headings.push(entry)
      stack.push(entry)
    }

    root.children = (root.children ?? []).map((node) => {
      if (!isTocMarker(node)) return node
      return headings.length > 0
        ? tocList(headings)
        : { type: "paragraph", children: [] }
    })
  }
}
