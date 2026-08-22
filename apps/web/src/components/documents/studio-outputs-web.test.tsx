import { describe, expect, test } from "bun:test"

async function source(relativePath: string): Promise<string> {
  return Bun.file(new URL(relativePath, import.meta.url)).text()
}

describe("studio output Web surfaces", () => {
  test("renders every slide as an exact, labelled region", async () => {
    const view = await source("./slide-deck-view.tsx")
    expect(view).toContain('aria-label={t("Slide deck preview")}')
    expect(view).toContain('aria-label={t("Slide {current} of {total}"')
    expect(view).toContain("<DocumentMarkdown")
    expect(view).toContain("splitMarkdownSlides(markdown)")
  })

  test("keeps the whole mind map in a native nested list without false tree semantics", async () => {
    const view = await source("./mindmap-document-view.tsx")
    expect(view).toContain("<MindmapOutlineBranch node={content.root} />")
    expect(view).toContain("children.map((child)")
    expect(view).toContain("{node.note}")
    expect(view).not.toContain('role="tree"')
    expect(view).not.toContain('role="treeitem"')
    expect(view).not.toContain("tabIndex={0}")
    expect(view).toContain('import("./mindmap-canvas")')
    expect(view).toContain("ssr: false")
  })

  test("lazy-loads browser-only editors and keeps structural edits outside XYFlow", async () => {
    const [editor, mindmapEditor, canvas] = await Promise.all([
      source("./study-document-editor.tsx"),
      source("./mindmap-document-editor.tsx"),
      source("./mindmap-canvas.tsx"),
    ])
    expect(editor).toContain('import("./markdown-editor")')
    expect(editor).toContain("<MindmapDocumentEditor")
    expect(mindmapEditor).toContain('import("./mindmap-canvas")')
    expect(mindmapEditor).toContain("ssr: false")
    expect(mindmapEditor).toContain("renderOutlineNode(content.root, 0)")
    expect(mindmapEditor).toContain(
      "children.map((child) => renderOutlineNode(child, depth + 1))"
    )
    expect(mindmapEditor).not.toContain('role="tree"')
    expect(mindmapEditor).not.toContain('role="treeitem"')
    expect(mindmapEditor).toContain('event.key === "Enter"')
    expect(mindmapEditor).toContain('event.key === "ArrowRight"')
    expect(mindmapEditor).toContain('event.key === "ArrowLeft"')
    expect(mindmapEditor).toContain('event.key === "Backspace"')
    expect(canvas).toContain('from "@xyflow/react"')
    expect(canvas).toContain("nodesDraggable={false}")
    expect(canvas).toContain("elementsSelectable={false}")
    expect(canvas).not.toContain("onNodeDrag")
  })

  test("hydrates presentation and polls only its exact export job", async () => {
    const [route, presenter, exporter] = await Promise.all([
      source("../../app/(app)/materials/fiches/[documentId]/present/page.tsx"),
      source("./slide-deck-presenter.tsx"),
      source("./document-pptx-export.tsx"),
    ])
    expect(route).not.toContain('"use client"')
    expect(route).toContain("prepareAuthenticatedShell")
    expect(route).toContain("documents.get.queryOptions")
    expect(route).toContain("HydrateClient")
    for (const key of [
      'event.key === "Escape"',
      'event.key === "Tab"',
      'event.key === "ArrowRight"',
      'event.key === "ArrowLeft"',
      'event.key === "Home"',
      'event.key === "End"',
    ]) {
      expect(presenter).toContain(key)
    }
    expect(presenter).toContain('aria-live="polite"')
    expect(presenter).toContain('aria-modal="true"')
    expect(exporter).toContain("orpc.documents.exportPptx.mutationOptions")
    expect(exporter).toContain("orpc.documents.downloadPptx.mutationOptions")
    expect(exporter).toContain("orpc.jobs.get.queryOptions")
    expect(exporter).toContain("requested?.jobId")
    expect(exporter).toContain("isActiveExportJob")
    expect(exporter).toContain("1_500")
    expect(exporter).not.toContain(["snapshot", "get"].join("."))
  })

  test("creates versioned structured documents and invalidates documents only", async () => {
    const [create, editor, mindmapEditor, reader] = await Promise.all([
      source("./study-document-create.tsx"),
      source("./study-document-editor.tsx"),
      source("./mindmap-document-editor.tsx"),
      source("./study-document-reader.tsx"),
    ])
    const combined = [create, editor, mindmapEditor, reader].join("\n")
    expect(create).toContain("createMindmapContent")
    expect(create).toContain('kind === "slides"')
    expect(create).toContain("{ version: 1 }")
    expect(mindmapEditor).toContain('bodyMarkdown: ""')
    expect(mindmapEditor).toContain("metaJson: content")
    expect(combined).toContain("orpc.documents.list.key()")
    expect(combined).not.toContain("orpc.materials.documents.key()")
    expect(combined).not.toContain("orpc.materials.folders.key()")
  })
})
