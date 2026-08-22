export const RECORDING_SEGMENT_DURATION_MS = 10 * 60_000
export const RECORDING_MAX_SEGMENTS = 24
export const RECORDING_MAX_DURATION_MS =
  RECORDING_SEGMENT_DURATION_MS * RECORDING_MAX_SEGMENTS

const MIN_DEV_SEGMENT_DURATION_MS = 5_000

export const RECORDING_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
] as const

export type RecordingUploadMimeType =
  "audio/webm" | "audio/mp4" | "audio/m4a" | "audio/ogg"

export interface RecordingClock {
  accumulatedMs: number
  runningSinceMs: number | null
  segmentBoundaryMs: number
}

export interface PlaybackSegment {
  seq: number
  startOffsetMs: number
  durationMs: number
}

export interface PlaybackPosition {
  segmentIndex: number
  localMs: number
  globalMs: number
}

/** Select the best explicit encoding; the caller may still use the browser default. */
export function preferredRecordingMimeType(
  isTypeSupported: (mimeType: string) => boolean
): (typeof RECORDING_MIME_CANDIDATES)[number] | null {
  return (
    RECORDING_MIME_CANDIDATES.find((mimeType) => isTypeSupported(mimeType)) ??
    null
  )
}

/**
 * Storage validates bare MIME values, while MediaRecorder commonly includes a
 * codec parameter. Normalize only the audio families accepted by the API.
 */
export function recordingUploadMimeType(
  mediaRecorderMimeType: string
): RecordingUploadMimeType | null {
  const bare = mediaRecorderMimeType.split(";", 1)[0]?.trim().toLowerCase()
  if (
    bare === "audio/webm" ||
    bare === "audio/mp4" ||
    bare === "audio/m4a" ||
    bare === "audio/ogg"
  ) {
    return bare
  }
  return null
}

export function recordingFileExtension(mimeType: RecordingUploadMimeType) {
  if (mimeType === "audio/webm") return "webm"
  if (mimeType === "audio/ogg") return "ogg"
  return "m4a"
}

/** Production always keeps the 10-minute protocol boundary. */
export function recordingSegmentDurationMs(
  development: boolean,
  rawOverride: string | undefined
): number {
  if (!development || !rawOverride) return RECORDING_SEGMENT_DURATION_MS
  const override = Number(rawOverride)
  if (
    !Number.isSafeInteger(override) ||
    override < MIN_DEV_SEGMENT_DURATION_MS ||
    override > RECORDING_SEGMENT_DURATION_MS
  ) {
    return RECORDING_SEGMENT_DURATION_MS
  }
  return override
}

export function createRecordingClock(nowMs: number): RecordingClock {
  return {
    accumulatedMs: 0,
    runningSinceMs: nowMs,
    segmentBoundaryMs: 0,
  }
}

export function recordingElapsedMs(
  clock: RecordingClock,
  nowMs: number
): number {
  return Math.max(
    0,
    clock.accumulatedMs +
      (clock.runningSinceMs === null ? 0 : nowMs - clock.runningSinceMs)
  )
}

export function pauseRecordingClock(
  clock: RecordingClock,
  nowMs: number
): RecordingClock {
  if (clock.runningSinceMs === null) return clock
  return {
    ...clock,
    accumulatedMs: recordingElapsedMs(clock, nowMs),
    runningSinceMs: null,
  }
}

export function resumeRecordingClock(
  clock: RecordingClock,
  nowMs: number
): RecordingClock {
  return clock.runningSinceMs === null
    ? { ...clock, runningSinceMs: nowMs }
    : clock
}

export function completeRecordingSegment(
  clock: RecordingClock,
  nowMs: number
): { clock: RecordingClock; durationMs: number } {
  const elapsedMs = recordingElapsedMs(clock, nowMs)
  const durationMs = Math.max(
    1,
    Math.round(elapsedMs - clock.segmentBoundaryMs)
  )
  return {
    clock: { ...clock, segmentBoundaryMs: elapsedMs },
    durationMs,
  }
}

export function recordingTotalDurationMs(
  segments: readonly PlaybackSegment[]
): number {
  return segments.reduce(
    (total, segment) =>
      Math.max(total, segment.startOffsetMs + segment.durationMs),
    0
  )
}

/** Map a recording-relative time onto the independently playable segment. */
export function recordingPlaybackPosition(
  segments: readonly PlaybackSegment[],
  requestedMs: number
): PlaybackPosition | null {
  if (segments.length === 0) return null
  const totalMs = recordingTotalDurationMs(segments)
  const globalMs = Math.min(Math.max(0, requestedMs), totalMs)
  let segmentIndex = segments.length - 1

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    const next = segments[index + 1]
    if (!segment) continue
    if (!next || globalMs < next.startOffsetMs) {
      segmentIndex = index
      break
    }
  }

  const segment = segments[segmentIndex]
  if (!segment) return null
  return {
    segmentIndex,
    localMs: Math.min(
      Math.max(0, globalMs - segment.startOffsetMs),
      segment.durationMs
    ),
    globalMs,
  }
}

export function formatRecordingTimestamp(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000))
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`
}

export function isActiveRecordingJob(status: string | undefined): boolean {
  return status === "queued" || status === "running"
}
