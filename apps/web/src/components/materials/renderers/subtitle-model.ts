export const MAX_SUBTITLE_CUES = 2_000

export interface SubtitleCue {
  id: string
  startMs: number
  endMs: number
  text: string
}

export interface SubtitleDocument {
  cues: SubtitleCue[]
  invalidBlocks: number
  truncated: boolean
}

function timestampMs(value: string): number | null {
  const match = /^(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})$/.exec(value)
  if (!match) return null
  const hours = Number(match[1] ?? 0)
  const minutes = Number(match[2])
  const seconds = Number(match[3])
  const milliseconds = Number(match[4])
  if (
    !Number.isSafeInteger(hours) ||
    minutes >= 60 ||
    seconds >= 60 ||
    hours > 999
  ) {
    return null
  }
  return ((hours * 60 + minutes) * 60 + seconds) * 1_000 + milliseconds
}

function plainCueText(value: string): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .trim()
}

/** Parse SRT or WebVTT without interpreting cue markup as HTML. */
export function parseSubtitles(
  source: string,
  maximumCues = MAX_SUBTITLE_CUES
): SubtitleDocument {
  const normalized = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n")
  const blocks = normalized.split(/\n{2,}/)
  const cues: SubtitleCue[] = []
  let invalidBlocks = 0
  let truncated = false

  for (const rawBlock of blocks) {
    const block = rawBlock.trim()
    if (!block) continue
    const lines = block.split("\n")
    const first = lines[0]?.trim() ?? ""
    if (
      /^WEBVTT(?:\s|$)/i.test(first) ||
      /^(NOTE|STYLE|REGION)(?:\s|$)/i.test(first)
    ) {
      continue
    }

    const timingIndex = lines.findIndex((line) => line.includes("-->"))
    if (timingIndex < 0) {
      invalidBlocks += 1
      continue
    }
    const timing = lines[timingIndex]!.split("-->")
    const start = timestampMs(timing[0]?.trim() ?? "")
    const endToken = timing[1]?.trim().split(/\s+/, 1)[0] ?? ""
    const end = timestampMs(endToken)
    const text = plainCueText(lines.slice(timingIndex + 1).join("\n"))
    if (start === null || end === null || end < start || !text) {
      invalidBlocks += 1
      continue
    }
    if (cues.length >= maximumCues) {
      truncated = true
      break
    }
    cues.push({
      id:
        timingIndex > 0
          ? (lines[0]?.trim() ?? String(cues.length + 1))
          : String(cues.length + 1),
      startMs: start,
      endMs: end,
      text,
    })
  }

  return { cues, invalidBlocks, truncated }
}

export function formatSubtitleTime(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1_000)
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  const fraction = String(milliseconds % 1_000).padStart(3, "0")
  return `${hours > 0 ? `${String(hours).padStart(2, "0")}:` : ""}${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${fraction}`
}
