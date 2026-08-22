import { describe, expect, test } from "bun:test"
import {
  isOfficeEditable,
  isOfficeViewable,
  officeEditorKind,
  officeFileType,
} from "./onlyoffice-model"

describe("which editor opens a file", () => {
  test("routes each family to its own editor", () => {
    expect(officeEditorKind("Rapport.docx")).toBe("word")
    expect(officeEditorKind("Notes.xlsx")).toBe("cell")
    expect(officeEditorKind("Soutenance.pptx")).toBe("slide")
    expect(officeEditorKind("Polycopié.pdf")).toBe("pdf")
  })

  test("ignores the case of the extension", () => {
    expect(officeEditorKind("RAPPORT.DOCX")).toBe("word")
    expect(officeFileType("Polycopié.PDF")).toBe("pdf")
  })

  test("falls back to the MIME type when the name carries no extension", () => {
    expect(
      officeEditorKind(
        "Feuille de calcul",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      )
    ).toBe("cell")
    // Providers append charsets; the type before the semicolon is the type.
    expect(officeFileType("Export", "text/csv; charset=utf-8")).toBe("csv")
  })

  test("the extension wins over a MIME type that disagrees", () => {
    // Storage hands back octet-stream for anything it did not recognise, which
    // is most Office files.
    expect(officeEditorKind("Rapport.docx", "application/octet-stream")).toBe(
      "word"
    )
  })

  test("says no to what it cannot open", () => {
    expect(officeEditorKind("cours.mp3")).toBeNull()
    expect(officeEditorKind("photo.png", "image/png")).toBeNull()
    expect(isOfficeViewable("archive.zip")).toBe(false)
    // A trailing dot is not an extension.
    expect(officeFileType("Rapport.")).toBeNull()
    // Nor is a leading one: `.gitignore` is a name, not an extension.
    expect(officeFileType(".pdf")).toBeNull()
  })
})

describe("what can be saved back", () => {
  test("the open formats round-trip", () => {
    expect(isOfficeEditable("Rapport.docx")).toBe(true)
    expect(isOfficeEditable("Notes.ods")).toBe(true)
    expect(isOfficeEditable("Export.csv")).toBe(true)
  })

  test("the legacy binary formats are read-only", () => {
    // They open, but saving would silently convert the file to a different
    // format — so the screen never offers it.
    expect(isOfficeViewable("Ancien.doc")).toBe(true)
    expect(isOfficeEditable("Ancien.doc")).toBe(false)
    expect(isOfficeEditable("Ancien.ppt")).toBe(false)
    expect(isOfficeEditable("Ancien.xls")).toBe(false)
  })

  test("a fixed-layout document is rendered, never reflowed", () => {
    expect(isOfficeViewable("Polycopié.pdf")).toBe(true)
    expect(isOfficeEditable("Polycopié.pdf")).toBe(false)
  })
})
