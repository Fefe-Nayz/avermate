import type { MaterialRow } from "../materials-rows"
import { isSubtitleFile, mediaKind } from "./file-formats"
import { materialFileOf } from "./row-file"
import { parseSubtitles } from "./subtitle-model"

function stem(title: string): string {
  return title
    .replace(/\.[^.]+$/, "")
    .normalize("NFKC")
    .toLowerCase()
}

function folderId(row: MaterialRow): string | null | undefined {
  return row.source.kind === "material"
    ? row.source.row.document.folderId
    : undefined
}

/** Pick a same-folder VTT/SRT whose basename matches the opened media. */
export function findAssociatedSubtitle(
  media: MaterialRow,
  rows: readonly MaterialRow[]
): MaterialRow | null {
  const mediaFile = materialFileOf(media)
  if (!mediaFile || !mediaKind(media.title, mediaFile.mimeType)) return null
  const mediaStem = stem(media.title)
  const candidates = rows.filter((candidate) => {
    const file = materialFileOf(candidate)
    if (!file || !isSubtitleFile(candidate.title, file.mimeType)) return false
    if (folderId(candidate) !== folderId(media)) return false
    const subtitleStem = stem(candidate.title)
    return (
      subtitleStem === mediaStem || subtitleStem.startsWith(`${mediaStem}.`)
    )
  })
  return (
    candidates.sort((left, right) => {
      const leftVtt = left.title.toLowerCase().endsWith(".vtt") ? 0 : 1
      const rightVtt = right.title.toLowerCase().endsWith(".vtt") ? 0 : 1
      return leftVtt - rightVtt || left.title.localeCompare(right.title)
    })[0] ?? null
  )
}

/** Convert both accepted subtitle formats to a sanitized browser-native VTT. */
export function subtitleSourceToWebVtt(source: string): string | null {
  const parsed = parseSubtitles(source)
  if (parsed.cues.length === 0) return null
  const timestamp = (milliseconds: number) => {
    const hours = Math.floor(milliseconds / 3_600_000)
    const minutes = Math.floor((milliseconds % 3_600_000) / 60_000)
    const seconds = Math.floor((milliseconds % 60_000) / 1_000)
    const fraction = milliseconds % 1_000
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(fraction).padStart(3, "0")}`
  }
  return `WEBVTT\n\n${parsed.cues
    .map(
      (cue, index) =>
        `${index + 1}\n${timestamp(cue.startMs)} --> ${timestamp(cue.endMs)}\n${cue.text}`
    )
    .join("\n\n")}\n`
}
