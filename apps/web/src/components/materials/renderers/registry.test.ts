import { describe, expect, test } from "bun:test"
import {
  pickMaterialRenderer,
  rendererCanEdit,
  type MaterialRenderer,
} from "./registry"
import { MATERIAL_RENDERERS } from "./index"
import { hasTranscript } from "./transcript-panel"
import type { MaterialRow } from "../materials-rows"

const row = (overrides: Partial<MaterialRow> = {}): MaterialRow =>
  ({
    id: "d-1",
    kind: "material",
    title: "Rapport.tex",
    badge: "TEX",
    typeLabel: "Fichier",
    bytes: 1_000,
    durationMs: null,
    itemCount: null,
    origin: "manual",
    modifiedAt: null,
    target: { kind: "document", id: "d-1" },
    starred: false,
    trashed: false,
    tombstone: false,
    tagIds: [],
    previewStatus: null,
    source: {} as MaterialRow["source"],
    ...overrides,
  }) as MaterialRow

const Blank = () => null

const fileRow = (title: string, mimeType: string): MaterialRow =>
  row({
    title,
    source: {
      kind: "material",
      row: {
        document: {
          id: "d-1",
          title,
          folderId: null,
          sourceType: "file",
          sourceUrl: null,
          origin: "manual",
          createdAt: new Date(0),
          starredAt: null,
          deletedAt: null,
        },
        file: {
          id: "f-1",
          mimeType,
          byteSize: 1_000,
          status: "stored",
        },
      },
    },
  })

const renderer = (
  id: string,
  priority: number,
  accepts: (row: MaterialRow) => boolean,
  editable = false
): MaterialRenderer => ({
  id,
  priority,
  accepts,
  Reader: Blank,
  ...(editable ? { Editor: Blank } : {}),
})

describe("picking a renderer", () => {
  test("the most specific one wins, whatever the order in the list", () => {
    const generic = renderer("download", 0, () => true)
    const text = renderer("text", 50, () => true)
    const latex = renderer("latex", 100, (candidate) =>
      candidate.title.endsWith(".tex")
    )

    // A .tex is also a text file and also a downloadable blob; without the
    // weight the answer would be whichever happened to be first.
    expect(pickMaterialRenderer(row(), [generic, text, latex])?.id).toBe(
      "latex"
    )
    expect(pickMaterialRenderer(row(), [latex, text, generic])?.id).toBe(
      "latex"
    )
  })

  test("falls to the next one when the specific renderer refuses", () => {
    const text = renderer("text", 50, () => true)
    const latex = renderer("latex", 100, (candidate) =>
      candidate.title.endsWith(".tex")
    )
    expect(
      pickMaterialRenderer(row({ title: "notes.md" }), [text, latex])?.id
    ).toBe("text")
  })

  test("no renderer is an answer, not a crash", () => {
    const latex = renderer("latex", 100, (candidate) =>
      candidate.title.endsWith(".tex")
    )
    expect(
      pickMaterialRenderer(row({ title: "archive.zip" }), [latex])
    ).toBeNull()
    expect(pickMaterialRenderer(row(), [])).toBeNull()
  })
})

describe("whether the pane offers editing", () => {
  test("only where the renderer brought an editor", () => {
    expect(rendererCanEdit(renderer("a", 1, () => true, true))).toBe(true)
    expect(rendererCanEdit(renderer("b", 1, () => true))).toBe(false)
    expect(rendererCanEdit(null)).toBe(false)
  })
})

describe("the built-in file renderer registrations", () => {
  test.each([
    ["lab.ipynb", "application/x-ipynb+json", "notebook"],
    ["manuel.epub", "application/epub+zip", "epub"],
    ["cours.mp4", "video/mp4", "media"],
    ["analyse.py", "text/x-python", "code"],
    ["captions.vtt", "text/vtt", "subtitles"],
  ])("routes %s to %s", (title, mimeType, rendererId) => {
    expect(
      pickMaterialRenderer(fileRow(title, mimeType), MATERIAL_RENDERERS)?.id
    ).toBe(rendererId)
  })

  test("offers the transcript tab for uploaded audio and video", () => {
    expect(hasTranscript(fileRow("cours.mp4", "video/mp4"))).toBe(true)
    expect(hasTranscript(fileRow("podcast.mp3", "audio/mpeg"))).toBe(true)
    expect(hasTranscript(fileRow("source.py", "text/x-python"))).toBe(false)
  })
})
