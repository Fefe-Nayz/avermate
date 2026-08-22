import { describe, expect, test } from "bun:test"
import { exportedPptxFileId, isActiveExportJob } from "./document-export-model"

describe("slide deck export state", () => {
  test("polls only queued and running jobs", () => {
    expect(isActiveExportJob("queued")).toBe(true)
    expect(isActiveExportJob("running")).toBe(true)
    expect(isActiveExportJob("succeeded")).toBe(false)
    expect(isActiveExportJob("failed")).toBe(false)
  })

  test("recognizes the private file identity from a successful result", () => {
    expect(exportedPptxFileId({ fileId: "file-1" })).toBe("file-1")
    expect(exportedPptxFileId({ fileId: "" })).toBeNull()
    expect(
      exportedPptxFileId({ url: "https://files.example/deck.pptx" })
    ).toBeNull()
    expect(exportedPptxFileId(null)).toBeNull()
  })
})
