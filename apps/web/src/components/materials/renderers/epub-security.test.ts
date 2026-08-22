import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

describe("EPUB reader security boundary", () => {
  test("loads epub.js lazily with scripts disabled and a content sanitizer", () => {
    const source = readFileSync(`${import.meta.dir}/epub-renderer.tsx`, "utf8")
    expect(source).toContain('await import("epubjs")')
    expect(source).toContain("allowScriptedContent: false")
    expect(source).toContain("book.spine.hooks.content.register")
    expect(source).toContain("sanitizeEpubDocument(contents.document)")
    expect(source).not.toMatch(/^import (?!type\b).* from "epubjs"/m)
  })

  test("the sanitizer covers active nodes, event handlers and remote CSS", () => {
    const source = readFileSync(`${import.meta.dir}/epub-sanitize.ts`, "utf8")
    expect(source).toContain("script, iframe, frame, object, embed, form, base")
    expect(source).toContain('name.startsWith("on")')
    expect(source).toContain("@import")
    expect(source).toContain('name === "srcset"')
    expect(source).toContain("Content-Security-Policy")
    expect(source).toContain("connect-src 'none'")
  })
})
