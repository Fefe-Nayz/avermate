import { describe, expect, test } from "bun:test"
import type { MaterialRow } from "../materials-rows"
import {
  findAssociatedSubtitle,
  subtitleSourceToWebVtt,
} from "./subtitle-track"

function fileRow(
  id: string,
  title: string,
  mimeType: string,
  folderId: string | null = null
): MaterialRow {
  return {
    id,
    kind: "material",
    title,
    badge: "FILE",
    typeLabel: "File",
    bytes: 20,
    durationMs: null,
    itemCount: null,
    origin: "manual",
    modifiedAt: null,
    target: { kind: "document", id },
    starred: false,
    trashed: false,
    tombstone: false,
    tagIds: [],
    previewStatus: null,
    source: {
      kind: "material",
      row: {
        document: {
          id,
          title,
          folderId,
          sourceType: "file",
          sourceUrl: null,
          origin: "manual",
          starredAt: null,
          deletedAt: null,
          createdAt: new Date(0),
        },
        file: {
          id: `${id}-file`,
          mimeType,
          byteSize: 20,
          status: "stored",
        },
      },
    },
  }
}

describe("media subtitle association", () => {
  test("prefers a same-folder WebVTT with a matching language suffix", () => {
    const media = fileRow("video", "cours.mp4", "video/mp4", "folder")
    const srt = fileRow("srt", "cours.srt", "application/x-subrip", "folder")
    const vtt = fileRow("vtt", "cours.fr.vtt", "text/vtt", "folder")
    const elsewhere = fileRow("other", "cours.vtt", "text/vtt", "elsewhere")
    expect(findAssociatedSubtitle(media, [elsewhere, srt, vtt])?.id).toBe("vtt")
  })

  test("turns SRT into sanitized WebVTT for a native track", () => {
    const value = subtitleSourceToWebVtt(
      "1\n00:00:01,200 --> 00:00:03,000\n<b>Bonjour</b> &amp; bienvenue"
    )
    expect(value).toBe(
      "WEBVTT\n\n1\n00:00:01.200 --> 00:00:03.000\nBonjour & bienvenue\n"
    )
  })
})
