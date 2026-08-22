import { describe, expect, test } from "bun:test"
import {
  completeRecordingSegment,
  createRecordingClock,
  formatRecordingTimestamp,
  pauseRecordingClock,
  preferredRecordingMimeType,
  recordingPlaybackPosition,
  recordingSegmentDurationMs,
  recordingUploadMimeType,
  RECORDING_SEGMENT_DURATION_MS,
  resumeRecordingClock,
} from "./recording-model"
import { RecordingUploadQueue } from "./recording-upload-queue"

describe("lecture recording capture model", () => {
  test("keeps a ten-minute production segment and bounds the dev override", () => {
    expect(RECORDING_SEGMENT_DURATION_MS).toBe(600_000)
    expect(recordingSegmentDurationMs(false, "15000")).toBe(600_000)
    expect(recordingSegmentDurationMs(true, "15000")).toBe(15_000)
    expect(recordingSegmentDurationMs(true, "4999")).toBe(600_000)
    expect(recordingSegmentDurationMs(true, "not-a-number")).toBe(600_000)
  })

  test("prefers Opus, falls back to MP4, and strips codec parameters for upload", () => {
    expect(
      preferredRecordingMimeType((type) =>
        ["audio/webm;codecs=opus", "audio/mp4"].includes(type)
      )
    ).toBe("audio/webm;codecs=opus")
    expect(preferredRecordingMimeType((type) => type === "audio/mp4")).toBe(
      "audio/mp4"
    )
    expect(preferredRecordingMimeType((type) => type === "audio/webm")).toBe(
      "audio/webm"
    )
    expect(preferredRecordingMimeType((type) => type === "audio/ogg")).toBe(
      "audio/ogg"
    )
    expect(preferredRecordingMimeType(() => false)).toBeNull()
    expect(recordingUploadMimeType("audio/webm;codecs=opus")).toBe("audio/webm")
    expect(recordingUploadMimeType("video/webm")).toBeNull()
  })

  test("excludes paused time from elapsed time and segment durations", () => {
    let clock = createRecordingClock(1_000)
    clock = pauseRecordingClock(clock, 6_000)
    clock = resumeRecordingClock(clock, 16_000)
    const first = completeRecordingSegment(clock, 21_000)
    expect(first.durationMs).toBe(10_000)
    const second = completeRecordingSegment(first.clock, 24_500)
    expect(second.durationMs).toBe(3_500)
  })
})

describe("segmented recording playback", () => {
  const segments = [
    { seq: 0, startOffsetMs: 0, durationMs: 10_000 },
    { seq: 1, startOffsetMs: 10_000, durationMs: 8_000 },
  ]

  test("maps global seeks across the exact segment boundary", () => {
    expect(recordingPlaybackPosition(segments, 9_999)).toEqual({
      segmentIndex: 0,
      localMs: 9_999,
      globalMs: 9_999,
    })
    expect(recordingPlaybackPosition(segments, 10_000)).toEqual({
      segmentIndex: 1,
      localMs: 0,
      globalMs: 10_000,
    })
    expect(recordingPlaybackPosition(segments, 99_000)).toEqual({
      segmentIndex: 1,
      localMs: 8_000,
      globalMs: 18_000,
    })
  })

  test("formats recording-relative timestamps", () => {
    expect(formatRecordingTimestamp(0)).toBe("0:00")
    expect(formatRecordingTimestamp(65_900)).toBe("1:05")
    expect(formatRecordingTimestamp(3_661_000)).toBe("1:01:01")
  })
})

describe("sequential recording uploads", () => {
  test("never overlaps uploads and preserves FIFO order", async () => {
    const queue = new RecordingUploadQueue<{ seq: number }>()
    const events: string[] = []
    queue.enqueue({ seq: 0 })
    queue.enqueue({ seq: 1 })

    await Promise.all([
      queue.drain(async ({ seq }) => {
        events.push(`start:${seq}`)
        await Promise.resolve()
        events.push(`end:${seq}`)
      }),
      queue.drain(async () => {
        throw new Error("a second drain must share the active promise")
      }),
    ])

    expect(events).toEqual(["start:0", "end:0", "start:1", "end:1"])
    expect(queue.getSnapshot()).toMatchObject({ pendingCount: 0 })
  })

  test("retains the failed seq so an idempotent retry cannot skip audio", async () => {
    const queue = new RecordingUploadQueue<{ seq: number }>()
    const attempts: number[] = []
    queue.enqueue({ seq: 7 })

    await expect(
      queue.drain(async ({ seq }) => {
        attempts.push(seq)
        throw new Error("offline")
      })
    ).rejects.toThrow("offline")
    await queue.drain(async ({ seq }) => {
      attempts.push(seq)
    })

    expect(attempts).toEqual([7, 7])
    expect(queue.getSnapshot()).toMatchObject({
      pendingCount: 0,
      failedSeq: null,
    })
  })
})
