import { describe, expect, test } from "bun:test"
import {
  buildSourceCatalogue,
  citationOpenHref,
  coverageLabel,
  locatorLabel,
  nextItemOrder,
} from "./project-model"

describe("project presentation model", () => {
  test("builds a stable catalogue across every source family", () => {
    const catalogue = buildSourceCatalogue({
      materials: [
        {
          document: { id: "m1", title: "Énergie", sourceType: "file" },
          file: { mimeType: "application/pdf" },
        },
      ],
      studyDocuments: [{ id: "d1", title: "Atomes", kind: "fiche" }],
      recordings: [{ id: "r1", title: "Cours oral", status: "ready" }],
      subjects: [
        {
          id: "s1",
          name: "Physique",
          kind: "subject",
          grades: [{ id: "g1", name: "DS 1" }],
        },
      ],
    })
    expect(catalogue.map(({ kind, id }) => `${kind}:${id}`)).toEqual([
      "study-document:d1",
      "recording:r1",
      "grade:g1",
      "material:m1",
      "subject:s1",
    ])
  })

  test("renders exact locator vocabulary and carries it into open links", () => {
    expect(locatorLabel({ kind: "pdf", page: 4 })).toBe("PDF · page 4")
    expect(
      locatorLabel({ kind: "video", startMs: 61_000, endMs: 125_000 })
    ).toBe("Vidéo · 1:01–2:05")
    const href = citationOpenHref({
      kind: "material",
      resourceId: "doc/1",
      locator: { kind: "pdf", page: 4 },
    })
    expect(href).toContain("/materials?open=doc%2F1&locator=")
    expect(decodeURIComponent(href)).toContain('"page":4')

    const conversationHref = citationOpenHref({
      kind: "conversation",
      resourceId: "thread/1",
      locator: {
        kind: "conversation",
        threadId: "thread/1",
        messageId: "message/2",
        partId: "part/3",
        startOffset: 2,
        endOffset: 8,
      },
    })
    expect(conversationHref).toContain("/assistant?thread=thread%2F1&locator=")
    expect(decodeURIComponent(conversationHref)).toContain(
      '"messageId":"message/2"'
    )
  })

  test("does not invent search coverage and reorders without mutating input", () => {
    expect(coverageLabel("metadata-and-locators-only")).toContain("OCR requis")
    const current = ["a", "b", "c"] as const
    expect(nextItemOrder(current, "b", -1)).toEqual(["b", "a", "c"])
    expect(current).toEqual(["a", "b", "c"])
    expect(nextItemOrder(current, "a", -1)).toEqual([...current])
  })
})
