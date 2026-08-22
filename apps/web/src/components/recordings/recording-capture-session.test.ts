import { describe, expect, test } from "bun:test"
import {
  CaptureGeneration,
  RecordingCaptureSession,
  persistUnmountedCapture,
  recordingCaptureDurationLimit,
  retainCaptureStream,
  type CaptureHaltReason,
  type CaptureRecorder,
  type CaptureStream,
  type CaptureTrack,
  type StandaloneCaptureSegment,
} from "./recording-capture-session"

class FakeTrack extends EventTarget implements CaptureTrack {
  readyState: MediaStreamTrackState = "live"
  stopCalls = 0

  stop() {
    if (this.readyState === "ended") return
    this.stopCalls += 1
    this.readyState = "ended"
  }

  endFromDevice() {
    if (this.readyState === "ended") return
    this.readyState = "ended"
    this.dispatchEvent(new Event("ended"))
  }
}

class FakeStream implements CaptureStream {
  readonly track = new FakeTrack()

  getTracks() {
    return [this.track]
  }
}

class FakeRecorder extends EventTarget implements CaptureRecorder {
  readonly mimeType = "audio/webm;codecs=opus"
  state: RecordingState = "inactive"
  startCalls = 0
  stopCalls = 0
  pauseError: Error | null = null
  resumeError: Error | null = null
  deferStop = false
  blob: Blob
  private stopPending = false

  constructor(
    readonly id: number,
    private readonly activity: { active: number; maxActive: number }
  ) {
    super()
    this.blob = new Blob([`standalone-recorder-${id}`], {
      type: "audio/webm;codecs=opus",
    })
  }

  start() {
    if (this.state !== "inactive")
      throw new DOMException("active", "InvalidStateError")
    this.state = "recording"
    this.startCalls += 1
    this.activity.active += 1
    this.activity.maxActive = Math.max(
      this.activity.maxActive,
      this.activity.active
    )
  }

  pause() {
    if (this.state !== "recording")
      throw new DOMException("inactive", "InvalidStateError")
    if (this.pauseError) throw this.pauseError
    this.state = "paused"
  }

  resume() {
    if (this.state !== "paused")
      throw new DOMException("inactive", "InvalidStateError")
    if (this.resumeError) throw this.resumeError
    this.state = "recording"
  }

  stop() {
    if (this.state === "inactive") return
    this.state = "inactive"
    this.stopCalls += 1
    this.activity.active -= 1
    if (this.deferStop) {
      this.stopPending = true
      return
    }
    this.emitFinalStop()
  }

  flushStop() {
    if (!this.stopPending) return
    this.stopPending = false
    this.emitFinalStop()
  }

  beginAutomaticStop() {
    if (this.state === "inactive") return
    this.state = "inactive"
    this.activity.active -= 1
    this.stopPending = true
  }

  fail(error = new Error("encoder failure")) {
    const event = new Event("error") as ErrorEvent
    Object.defineProperty(event, "error", { value: error })
    this.dispatchEvent(event)
  }

  stopUnexpectedly() {
    if (this.state === "inactive") return
    this.state = "inactive"
    this.activity.active -= 1
    if (this.blob.size > 0) this.emitBlob(this.blob)
    this.dispatchEvent(new Event("stop"))
  }

  private emitBlob(blob: Blob) {
    const event = new Event("dataavailable") as BlobEvent
    Object.defineProperty(event, "data", { value: blob })
    this.dispatchEvent(event)
  }

  private emitFinalStop() {
    if (this.blob.size > 0) this.emitBlob(this.blob)
    this.dispatchEvent(new Event("stop"))
  }
}

class FakeScheduler {
  nowMs = 0
  private nextId = 1
  private readonly timers = new Map<
    number,
    { at: number; callback: () => void }
  >()

  readonly now = () => this.nowMs
  readonly schedule = (callback: () => void, delayMs: number) => {
    const id = this.nextId++
    this.timers.set(id, { at: this.nowMs + delayMs, callback })
    return id as unknown as ReturnType<typeof setTimeout>
  }
  readonly cancel = (handle: ReturnType<typeof setTimeout>) => {
    this.timers.delete(handle as unknown as number)
  }

  advance(ms: number) {
    const target = this.nowMs + ms
    while (true) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((left, right) => left[1].at - right[1].at)[0]
      if (!due) break
      const [id, timer] = due
      this.timers.delete(id)
      this.nowMs = timer.at
      timer.callback()
    }
    this.nowMs = target
  }
}

function captureHarness(
  overrides: Partial<{
    maxDurationMs: number
    maxSegmentDurationMs: number
    maxSegments: number
    segmentDurationMs: number
  }> = {}
) {
  const stream = new FakeStream()
  const scheduler = new FakeScheduler()
  const recorders: FakeRecorder[] = []
  const segments: StandaloneCaptureSegment[] = []
  const halts: Array<{ reason: CaptureHaltReason; error: Error }> = []
  const stopped: string[] = []
  let limits = 0
  const activity = { active: 0, maxActive: 0 }
  const session = new RecordingCaptureSession({
    stream,
    segmentDurationMs: overrides.segmentDurationMs ?? 1_000,
    maxSegmentDurationMs: overrides.maxSegmentDurationMs ?? 1_500,
    maxDurationMs: overrides.maxDurationMs ?? 10_000,
    maxSegments: overrides.maxSegments ?? 10,
    now: scheduler.now,
    schedule: scheduler.schedule,
    cancelScheduled: scheduler.cancel,
    createRecorder: () => {
      const recorder = new FakeRecorder(recorders.length, activity)
      recorders.push(recorder)
      return recorder
    },
    onSegment: (segment) => {
      segments.push(segment)
      return { accepted: true }
    },
    onHalt: (reason, error) => halts.push({ reason, error }),
    onLimit: () => {
      limits += 1
    },
    onStopped: (reason) => stopped.push(reason),
  })
  return {
    activity,
    halts,
    limits: () => limits,
    recorders,
    scheduler,
    segments,
    session,
    stopped,
    stream,
  }
}

describe("recording capture lifecycle", () => {
  test("stops a permission stream that resolves after its generation was cancelled", async () => {
    const generation = new CaptureGeneration()
    const token = generation.begin()
    const stream = new FakeStream()
    let resolvePermission!: (value: FakeStream) => void
    const permission = new Promise<FakeStream>((resolve) => {
      resolvePermission = resolve
    })
    const retained = permission.then((value) =>
      retainCaptureStream(generation, token, value)
    )

    generation.cancel()
    resolvePermission(stream)

    expect(await retained).toBeNull()
    expect(stream.track.stopCalls).toBe(1)
  })

  test("rotates complete recorder instances without overlap or timeslice fragments", async () => {
    const harness = captureHarness()
    harness.session.start()

    harness.scheduler.advance(1_000)
    harness.scheduler.advance(1_000)

    expect(harness.recorders).toHaveLength(3)
    expect(harness.recorders.map((recorder) => recorder.startCalls)).toEqual([
      1, 1, 1,
    ])
    expect(harness.recorders.map((recorder) => recorder.stopCalls)).toEqual([
      1, 1, 0,
    ])
    expect(harness.activity.maxActive).toBe(1)
    expect(
      harness.segments.map(({ seq, durationMs }) => ({ seq, durationMs }))
    ).toEqual([
      { seq: 0, durationMs: 1_000 },
      { seq: 1, durationMs: 1_000 },
    ])
    expect(
      await Promise.all(harness.segments.map((segment) => segment.blob.text()))
    ).toEqual(["standalone-recorder-0", "standalone-recorder-1"])
  })

  test("excludes asynchronous stop finalization gaps from segment durations", () => {
    const harness = captureHarness({ maxDurationMs: 1_500 })
    harness.session.start()
    harness.scheduler.advance(1_000)
    harness.recorders[1]!.deferStop = true

    harness.scheduler.advance(500)
    harness.scheduler.advance(250)
    expect(harness.segments.map((segment) => segment.durationMs)).toEqual([
      1_000,
    ])

    harness.recorders[1]!.flushStop()

    expect(harness.segments.map((segment) => segment.durationMs)).toEqual([
      1_000, 500,
    ])
    expect(harness.halts).toHaveLength(0)
    expect(harness.limits()).toBe(1)
  })

  test("stops immediately and preserves the completed final part when a track ends", () => {
    const harness = captureHarness()
    harness.session.start()
    harness.scheduler.advance(400)

    harness.stream.track.endFromDevice()

    expect(harness.session.state).toBe("inactive")
    expect(harness.segments).toHaveLength(1)
    expect(harness.segments[0]?.durationMs).toBe(400)
    expect(harness.halts.map((halt) => halt.reason)).toEqual(["track-ended"])
    expect(harness.recorders).toHaveLength(1)
  })

  test("waits for the final Blob when a device ends after the recorder became inactive", () => {
    const harness = captureHarness()
    harness.session.start()
    harness.scheduler.advance(400)
    harness.recorders[0]!.beginAutomaticStop()

    harness.stream.track.endFromDevice()
    expect(harness.segments).toHaveLength(0)

    harness.recorders[0]!.flushStop()
    expect(harness.segments.map((segment) => segment.durationMs)).toEqual([400])
    expect(harness.halts.map((halt) => halt.reason)).toEqual(["track-ended"])
  })

  test("discards the current encoder output and stops tracks on recorder error", () => {
    const harness = captureHarness()
    harness.session.start()
    harness.scheduler.advance(400)

    harness.recorders[0]!.fail()

    expect(harness.session.state).toBe("inactive")
    expect(harness.segments).toHaveLength(0)
    expect(harness.halts.map((halt) => halt.reason)).toEqual(["error"])
    expect(harness.stream.track.stopCalls).toBe(1)
  })

  test("turns a recorder pause failure into a terminal capture failure", () => {
    const harness = captureHarness()
    harness.session.start()
    harness.scheduler.advance(400)
    harness.recorders[0]!.pauseError = new Error("pause failed")

    expect(harness.session.pause()).toBeFalse()

    expect(harness.session.state).toBe("inactive")
    expect(harness.segments.map((segment) => segment.durationMs)).toEqual([400])
    expect(harness.halts.map((halt) => halt.reason)).toEqual(["error"])
    expect(harness.stream.track.stopCalls).toBe(1)
  })

  test("treats an unrequested recorder stop as terminal instead of showing fake capture", () => {
    const harness = captureHarness()
    harness.session.start()
    harness.scheduler.advance(400)

    harness.recorders[0]!.stopUnexpectedly()

    expect(harness.session.state).toBe("inactive")
    expect(harness.segments).toHaveLength(1)
    expect(harness.halts.map((halt) => halt.reason)).toEqual([
      "unexpected-stop",
    ])
    expect(harness.stream.track.stopCalls).toBe(1)
  })

  test("fails honestly on an empty scheduled part instead of advancing silently", () => {
    const harness = captureHarness()
    harness.session.start()
    harness.recorders[0]!.blob = new Blob([], { type: "audio/webm" })

    harness.scheduler.advance(1_000)

    expect(harness.segments).toHaveLength(0)
    expect(harness.recorders).toHaveLength(1)
    expect(harness.halts.map((halt) => halt.reason)).toEqual([
      "segment-rejected",
    ])
    expect(harness.stream.track.stopCalls).toBe(1)
  })

  test("stops at the smaller server duration and segment-count limits", () => {
    expect(recordingCaptureDurationLimit(9_000, 2, 1_000)).toBe(2_000)
    expect(recordingCaptureDurationLimit(1_500, 2, 1_000)).toBe(1_500)

    const durationHarness = captureHarness({ maxDurationMs: 1_500 })
    durationHarness.session.start()
    durationHarness.scheduler.advance(1_500)
    expect(
      durationHarness.segments.map((segment) => segment.durationMs)
    ).toEqual([1_000, 500])
    expect(durationHarness.limits()).toBe(1)
    expect(durationHarness.stream.track.stopCalls).toBe(1)

    const countHarness = captureHarness({ maxSegments: 1 })
    countHarness.session.start()
    countHarness.scheduler.advance(1_000)
    expect(countHarness.segments).toHaveLength(1)
    expect(countHarness.recorders).toHaveLength(1)
    expect(countHarness.limits()).toBe(1)
  })

  test("stops tracks synchronously on unmount and still offers the final Blob to the queue", async () => {
    const harness = captureHarness()
    harness.session.start()
    harness.scheduler.advance(400)

    await harness.session.dispose()

    expect(harness.stream.track.stopCalls).toBe(1)
    expect(harness.segments).toHaveLength(1)
    expect(harness.segments[0]?.durationMs).toBe(400)
    expect(harness.stopped).toEqual(["unmount"])
    expect(harness.halts).toHaveLength(0)
  })

  test("hands an unmounted final part to FIFO before terminal server finish", async () => {
    const harness = captureHarness()
    const events: string[] = []
    harness.session.start()
    harness.scheduler.advance(400)

    const result = await persistUnmountedCapture({
      dispose: async () => {
        events.push("dispose")
        await harness.session.dispose()
      },
      drain: async () => {
        events.push(`drain:${harness.segments.length}`)
      },
      finish: async () => {
        events.push("finish")
      },
    })

    expect(result).toBe("finished")
    expect(events).toEqual(["dispose", "drain:1", "finish"])
    expect(harness.stream.track.stopCalls).toBe(1)
  })

  test("reports an unmounted network failure as recoverable without UI callbacks", async () => {
    const callbacks: string[] = []
    const result = await persistUnmountedCapture({
      dispose: async () => {
        callbacks.push("dispose")
      },
      drain: async () => {
        callbacks.push("drain")
      },
      finish: async () => {
        callbacks.push("finish")
        throw new Error("offline")
      },
    })

    expect(result).toBe("recoverable")
    expect(callbacks).toEqual(["dispose", "drain", "finish"])
  })
})
