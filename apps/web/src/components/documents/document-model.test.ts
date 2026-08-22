import { describe, expect, test } from "bun:test"
import {
  DOCUMENT_AUTOSAVE_DELAY_MS,
  DOCUMENT_BODY_MAX_BYTES,
  DOCUMENT_CALLOUT_KINDS,
  DOCUMENT_CALLOUT_SNIPPETS,
  documentBodyByteLength,
  documentDraftIsDirty,
  documentDraftIsValid,
  isDocumentConflictError,
} from "./document-model"

describe("study document editor model", () => {
  test("holds autosave for exactly 1.5 seconds", () => {
    expect(DOCUMENT_AUTOSAVE_DELAY_MS).toBe(1_500)
  })

  test("measures the server's UTF-8 body boundary, not JavaScript characters", () => {
    expect(documentBodyByteLength("é")).toBe(2)
    expect(
      documentDraftIsValid({
        title: "Fiche",
        bodyMarkdown: "a".repeat(DOCUMENT_BODY_MAX_BYTES),
      })
    ).toBe(true)
    expect(
      documentDraftIsValid({
        title: "Fiche",
        bodyMarkdown: "é".repeat(DOCUMENT_BODY_MAX_BYTES / 2 + 1),
      })
    ).toBe(false)
  })

  test("distinguishes a saved draft from either local edit", () => {
    const saved = { title: "Algebra", bodyMarkdown: "# Rings" }
    expect(documentDraftIsDirty(saved, saved)).toBe(false)
    expect(documentDraftIsDirty({ ...saved, title: "Groups" }, saved)).toBe(
      true
    )
    expect(
      documentDraftIsDirty({ ...saved, bodyMarkdown: "# Fields" }, saved)
    ).toBe(true)
  })

  test("recognises only the server's non-destructive revision conflict", () => {
    expect(
      isDocumentConflictError(
        new Error("This fiche changed elsewhere — reload")
      )
    ).toBe(true)
    expect(isDocumentConflictError(new Error("Network unavailable"))).toBe(
      false
    )
  })

  test("ships every CPGE callout as an insertable GitHub-alert directive", () => {
    expect(DOCUMENT_CALLOUT_KINDS).toEqual([
      "DEF",
      "THM",
      "METH",
      "PIEGE",
      "CHECK",
    ])
    for (const kind of DOCUMENT_CALLOUT_KINDS) {
      expect(DOCUMENT_CALLOUT_SNIPPETS[kind]).toBe(`> [!${kind}]\n> `)
    }
  })
})
