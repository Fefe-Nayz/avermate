import { describe, expect, test } from "bun:test"
import {
  epubArchiveIssue,
  MAX_EPUB_ENTRIES,
  MAX_EPUB_ENTRY_BYTES,
} from "./epub-archive"

function centralDirectoryArchive(
  entries: ReadonlyArray<{
    name: string
    compressed?: number
    uncompressed?: number
  }>
): ArrayBuffer {
  const encoder = new TextEncoder()
  const names = entries.map((entry) => encoder.encode(entry.name))
  const centralSize = names.reduce((size, name) => size + 46 + name.length, 0)
  const bytes = new Uint8Array(centralSize + 22)
  const view = new DataView(bytes.buffer)
  let cursor = 0
  entries.forEach((entry, index) => {
    const name = names[index]!
    view.setUint32(cursor, 0x02014b50, true)
    view.setUint16(cursor + 10, 8, true)
    view.setUint32(cursor + 20, entry.compressed ?? 10, true)
    view.setUint32(cursor + 24, entry.uncompressed ?? 10, true)
    view.setUint16(cursor + 28, name.length, true)
    bytes.set(name, cursor + 46)
    cursor += 46 + name.length
  })
  view.setUint32(cursor, 0x06054b50, true)
  view.setUint16(cursor + 8, entries.length, true)
  view.setUint16(cursor + 10, entries.length, true)
  view.setUint32(cursor + 12, centralSize, true)
  view.setUint32(cursor + 16, 0, true)
  return bytes.buffer
}

describe("EPUB archive limits", () => {
  test("accepts a small, ordinary central directory", () => {
    expect(
      epubArchiveIssue(
        centralDirectoryArchive([
          { name: "mimetype" },
          { name: "META-INF/container.xml" },
          { name: "OEBPS/chapter.xhtml" },
        ])
      )
    ).toBeNull()
  })

  test("refuses oversized entries and path traversal before inflation", () => {
    expect(
      epubArchiveIssue(
        centralDirectoryArchive([
          { name: "large.bin", uncompressed: MAX_EPUB_ENTRY_BYTES + 1 },
        ])
      )
    ).toContain("too large")
    expect(
      epubArchiveIssue(centralDirectoryArchive([{ name: "../outside.xhtml" }]))
    ).toContain("unsafe file path")
  })

  test("caps central-directory complexity", () => {
    const entries = Array.from(
      { length: MAX_EPUB_ENTRIES + 1 },
      (_, index) => ({
        name: `chapter-${index}.xhtml`,
        compressed: 0,
        uncompressed: 0,
      })
    )
    expect(epubArchiveIssue(centralDirectoryArchive(entries))).toContain(
      `at most ${MAX_EPUB_ENTRIES}`
    )
  })
})
