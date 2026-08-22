import { describe, expect, test } from "bun:test"
import {
  normalizedLinkIngestionStatus,
  safeWebSourceHref,
  webIngestionMeta,
  webProvenance,
} from "./link-ingestion-model"

describe("link ingestion presentation", () => {
  test("preserves every honest server state and labels loading separately", () => {
    expect(normalizedLinkIngestionStatus(undefined, true)).toBe("loading")
    expect(normalizedLinkIngestionStatus(undefined, false, true)).toBe(
      "unavailable"
    )
    expect(normalizedLinkIngestionStatus(undefined)).toBe("idle")
    expect(normalizedLinkIngestionStatus("pending")).toBe("pending")
    expect(normalizedLinkIngestionStatus("ready")).toBe("ready")
    expect(normalizedLinkIngestionStatus("failed")).toBe("failed")
  })

  test("prefers the final fetched URL and exposes a validated capture date", () => {
    const provenance = webProvenance(
      {
        finalUrl: "https://docs.example.edu/final/chapter",
        fetchedAt: "2026-08-20T08:30:00.000Z",
        byline: "  Ada Lovelace  ",
      },
      "https://example.edu/redirect"
    )

    expect(provenance).toEqual({
      url: "https://docs.example.edu/final/chapter",
      host: "docs.example.edu",
      fetchedAt: new Date("2026-08-20T08:30:00.000Z"),
      byline: "Ada Lovelace",
    })
  })

  test("falls back safely for pending, legacy or malformed metadata", () => {
    expect(webProvenance(null, "https://example.edu/source")?.host).toBe(
      "example.edu"
    )
    expect(
      webProvenance({ finalUrl: "not a URL", fetchedAt: "not a date" }, null)
    ).toBeNull()
    expect(webProvenance(null, null)).toBeNull()
  })

  test("rejects OCR and media-transcript metadata at the union boundary", () => {
    expect(
      webIngestionMeta({ provider: "mistral", segmentCount: 12 })
    ).toBeNull()
    expect(
      webIngestionMeta({ model: "ocr", pageCount: 2, durationMs: 50 })
    ).toBeNull()
    expect(
      webIngestionMeta({
        finalUrl: "https://example.edu/course",
        fetchedAt: "2026-08-21T10:00:00.000Z",
        title: "Course",
      })
    ).not.toBeNull()
  })

  test("only turns HTTP sources into browser links", () => {
    expect(safeWebSourceHref("https://example.edu/chapter")).toBe(
      "https://example.edu/chapter"
    )
    expect(safeWebSourceHref("http://example.edu/chapter")).toBe(
      "http://example.edu/chapter"
    )
    expect(safeWebSourceHref("javascript:alert(1)")).toBeNull()
    expect(safeWebSourceHref("ftp://example.edu/file")).toBeNull()
    expect(safeWebSourceHref("not a URL")).toBeNull()
  })
})
