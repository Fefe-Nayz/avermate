import { describe, expect, test } from "bun:test"
import {
  studyDocumentInput,
  studyDocumentsInput,
} from "@/lib/route-query-inputs"

async function source(relativePath: string): Promise<string> {
  return Bun.file(new URL(relativePath, import.meta.url)).text()
}

describe("study document web boundaries", () => {
  test("pins exactly the editor and safe renderer stack from plan 010", async () => {
    const packageJson = (await Bun.file(
      new URL("../../../package.json", import.meta.url)
    ).json()) as { dependencies: Record<string, string> }
    expect(
      Object.fromEntries(
        [
          "codemirror",
          "@codemirror/lang-markdown",
          "@codemirror/view",
          "react-markdown",
          "remark-gfm",
          "remark-math",
          "rehype-katex",
          "katex",
          "@xyflow/react",
        ].map((name) => [name, packageJson.dependencies[name]])
      )
    ).toEqual({
      codemirror: "6.0.2",
      "@codemirror/lang-markdown": "6.5.2",
      "@codemirror/view": "6.43.9",
      "react-markdown": "10.1.0",
      "remark-gfm": "4.0.1",
      "remark-math": "6.0.0",
      "rehype-katex": "7.0.1",
      katex: "0.18.4",
      "@xyflow/react": "12.11.5",
    })
  })

  test("hydrates exact reader and editor queries from server-owned routes", async () => {
    const [readerPage, editorPage, presentPage, reader, editor, presenter] =
      await Promise.all([
        source("../../app/(app)/materials/fiches/[documentId]/page.tsx"),
        source("../../app/(app)/materials/fiches/[documentId]/edit/page.tsx"),
        source(
          "../../app/(app)/materials/fiches/[documentId]/present/page.tsx"
        ),
        source("./study-document-reader.tsx"),
        source("./study-document-editor.tsx"),
        source("./slide-deck-presenter.tsx"),
      ])
    for (const page of [readerPage, presentPage]) {
      expect(page).not.toContain('"use client"')
      expect(page).toContain("prepareAuthenticatedShell")
      expect(page).toContain("studyDocumentInput(documentId)")
      expect(page).toContain("documents.get.queryOptions")
      expect(page).toContain("HydrateClient")
    }
    expect(editorPage).not.toContain('"use client"')
    expect(editorPage).toContain("prepareAuthenticatedShell")
    expect(editorPage).toContain("studyDocumentInput(documentId)")
    expect(editorPage).toContain("documents.getForEdit.queryOptions")
    expect(editorPage).toContain("HydrateClient")
    expect(reader).toContain('"use client"')
    expect(editor).toContain('"use client"')
    expect(editor).toContain("orpc.documents.getForEdit.queryOptions")
    expect(presenter).toContain('"use client"')
    expect(studyDocumentInput("doc-1")).toEqual({ documentId: "doc-1" })
  })

  test("hydrates the whole-year fiche list into the materials tree", async () => {
    const [page, client] = await Promise.all([
      source("../../app/(app)/materials/page.tsx"),
      source("../materials/materials-client.tsx"),
    ])
    expect(page).toContain("studyDocumentsInput(activeYearId)")
    expect(page).toContain("orpc.documents.list.queryOptions")
    expect(client).toContain("studyDocumentsInput(yearId")
    expect(client).toContain("orpc.documents.list.queryOptions")
    expect(studyDocumentsInput("year-1")).toEqual({
      yearId: "year-1",
      include: "live",
    })
  })

  test("keeps mutations inside documents keys and lazy-loads CodeMirror", async () => {
    const [editor, create, reader] = await Promise.all([
      source("./study-document-editor.tsx"),
      source("./study-document-create.tsx"),
      source("./study-document-reader.tsx"),
    ])
    const combined = [editor, create, reader].join("\n")
    expect(combined).toContain("orpc.documents.list.key()")
    expect(combined).toContain("orpc.documents.get.queryKey")
    expect(combined).not.toContain("orpc.materials.folders.key()")
    expect(combined).not.toContain("orpc.materials.documents.key()")
    expect(combined).not.toContain(["snapshot", "get"].join("."))
    expect(editor).toContain('import("./markdown-editor")')
    expect(editor).toContain("ssr: false")
    expect(editor).toContain("DOCUMENT_AUTOSAVE_DELAY_MS")
  })

  test("keeps exact values keyboard-readable and print output A4-safe", async () => {
    const [markdown, editor, styles] = await Promise.all([
      source("./document-markdown.tsx"),
      source("./study-document-editor.tsx"),
      source("./document-styles.css"),
    ])
    expect(markdown).toContain('role="note"')
    expect(markdown).toContain("aria-label={labels[kind]}")
    expect(markdown).not.toContain("dangerouslySetInnerHTML")
    expect(editor).toContain('role="toolbar"')
    expect(editor).toContain('aria-live="polite"')
    expect(editor).toContain("DOCUMENT_CALLOUT_KINDS.map")
    expect(styles).toContain("@page")
    expect(styles).toContain("size: A4")
    expect(styles).toContain("break-inside: avoid")
  })
})
