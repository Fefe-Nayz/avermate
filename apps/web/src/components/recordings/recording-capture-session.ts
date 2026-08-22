import {
  createRecordingClock,
  pauseRecordingClock,
  recordingElapsedMs,
  resumeRecordingClock,
  type RecordingClock,
} from "./recording-model"

export type CaptureStopReason = "finish" | "limit" | "rotation" | "unmount"

export type CaptureHaltReason =
  "error" | "segment-rejected" | "track-ended" | "unexpected-stop"

export interface CaptureTrack extends EventTarget {
  readonly readyState: MediaStreamTrackState
  stop(): void
}

export interface CaptureStream {
  getTracks(): CaptureTrack[]
}

export interface CaptureRecorder extends EventTarget {
  readonly mimeType: string
  readonly state: RecordingState
  pause(): void
  resume(): void
  start(): void
  stop(): void
}

export interface StandaloneCaptureSegment {
  blob: Blob
  durationMs: number
  mimeType: string
  seq: number
}

export type CaptureSegmentAcceptance =
  { accepted: true } | { accepted: false; error: Error }

interface RecorderCycle {
  blobs: Blob[]
  discard: boolean
  recorder: CaptureRecorder
  requestedReason: CaptureStopReason | CaptureHaltReason | null
  settled: boolean
  settledPromise: Promise<void>
  resolveSettled: () => void
}

export interface RecordingCaptureSessionOptions {
  createRecorder: (stream: CaptureStream) => CaptureRecorder
  maxDurationMs: number
  maxSegmentDurationMs: number
  maxSegments: number
  now?: () => number
  onHalt: (reason: CaptureHaltReason, error: Error) => void
  onLimit: () => void
  onSegment: (segment: StandaloneCaptureSegment) => CaptureSegmentAcceptance
  onStopped?: (reason: "finish" | "unmount") => void
  schedule?: (
    callback: () => void,
    delayMs: number
  ) => ReturnType<typeof setTimeout>
  cancelScheduled?: (handle: ReturnType<typeof setTimeout>) => void
  segmentDurationMs: number
  stream: CaptureStream
}

export function recordingCaptureDurationLimit(
  serverMaxDurationMs: number,
  maxSegments: number,
  segmentDurationMs: number
): number {
  return Math.min(serverMaxDurationMs, maxSegments * segmentDurationMs)
}

/**
 * Best-effort SPA handoff: produce the final standalone Blob, wait for the FIFO,
 * then move the server row out of `recording`. A failed network handoff leaves
 * the row intentionally recoverable through the interrupted-recording detail.
 */
export async function persistUnmountedCapture(options: {
  dispose: () => Promise<void>
  drain: () => Promise<void>
  finish: () => Promise<unknown>
}): Promise<"finished" | "recoverable"> {
  try {
    await options.dispose()
    await options.drain()
    await options.finish()
    return "finished"
  } catch {
    return "recoverable"
  }
}

const STOP_PRIORITY: Record<CaptureStopReason | CaptureHaltReason, number> = {
  rotation: 0,
  limit: 1,
  finish: 2,
  unmount: 3,
  "unexpected-stop": 4,
  "track-ended": 5,
  "segment-rejected": 6,
  error: 7,
}

/**
 * Owns one microphone stream while rotating complete MediaRecorder instances.
 * Every emitted segment is the complete output of one recorder, so it does not
 * depend on initialization bytes from an earlier `timeslice` Blob.
 */
export class RecordingCaptureSession {
  private readonly cancelScheduled: NonNullable<
    RecordingCaptureSessionOptions["cancelScheduled"]
  >
  private readonly now: NonNullable<RecordingCaptureSessionOptions["now"]>
  private readonly schedule: NonNullable<
    RecordingCaptureSessionOptions["schedule"]
  >
  private readonly trackEnded = () => {
    this.haltCurrent(
      "track-ended",
      new Error("The microphone track ended while recording")
    )
  }
  private clock: RecordingClock
  private current: RecorderCycle | null = null
  private disposed = false
  private halt: { error: Error; reason: CaptureHaltReason } | null = null
  private haltReported = false
  private nextSeq = 0
  private scheduled: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly options: RecordingCaptureSessionOptions) {
    this.now = options.now ?? (() => performance.now())
    this.schedule =
      options.schedule ?? ((callback, delay) => setTimeout(callback, delay))
    this.cancelScheduled =
      options.cancelScheduled ?? ((handle) => clearTimeout(handle))
    this.clock = createRecordingClock(this.now())
  }

  start(): void {
    if (this.current || this.disposed || this.halt) return
    for (const track of this.options.stream.getTracks()) {
      track.addEventListener("ended", this.trackEnded)
    }
    this.startCycle()
  }

  get elapsedMs(): number {
    return recordingElapsedMs(this.clock, this.now())
  }

  get segmentCount(): number {
    return this.nextSeq
  }

  get state(): "inactive" | "paused" | "recording" {
    const recorderState = this.current?.recorder.state
    return recorderState === "paused" || recorderState === "recording"
      ? recorderState
      : "inactive"
  }

  pause(): boolean {
    const cycle = this.current
    if (!cycle || cycle.recorder.state !== "recording" || this.halt)
      return false
    this.clearScheduled()
    try {
      cycle.recorder.pause()
    } catch (error) {
      this.haltCurrent(
        "error",
        asError(error, "The audio recorder could not pause")
      )
      return false
    }
    this.clock = pauseRecordingClock(this.clock, this.now())
    return true
  }

  resume(): boolean {
    const cycle = this.current
    if (!cycle || cycle.recorder.state !== "paused" || this.halt) return false
    try {
      cycle.recorder.resume()
    } catch (error) {
      this.haltCurrent(
        "error",
        asError(error, "The audio recorder could not resume")
      )
      return false
    }
    this.clock = resumeRecordingClock(this.clock, this.now())
    this.scheduleBoundary()
    return true
  }

  async finish(): Promise<void> {
    await this.requestStop("finish")
    if (this.halt) throw this.halt.error
  }

  /**
   * Cleanup cannot promise that an in-flight network upload will survive route
   * destruction. It does synchronously stop capture and lets the already-bound
   * segment callback enqueue the recorder's final Blob when the browser emits it.
   */
  dispose(): Promise<void> {
    if (this.disposed) return this.current?.settledPromise ?? Promise.resolve()
    this.disposed = true
    const stopped = this.requestStop("unmount")
    this.stopTracks()
    return stopped
  }

  private startCycle(): void {
    if (this.disposed || this.halt) return
    if (
      this.nextSeq >= this.options.maxSegments ||
      this.elapsedMs >= this.options.maxDurationMs
    ) {
      this.stopTracks()
      this.options.onLimit()
      return
    }
    if (
      this.options.stream
        .getTracks()
        .every((track) => track.readyState === "ended")
    ) {
      this.setHalt(
        "track-ended",
        new Error("The microphone track ended while recording")
      )
      this.stopTracks()
      this.reportHalt()
      return
    }

    let resolveSettled: () => void = () => undefined
    const settledPromise = new Promise<void>((resolve) => {
      resolveSettled = resolve
    })
    let recorder: CaptureRecorder
    try {
      recorder = this.options.createRecorder(this.options.stream)
    } catch (error) {
      this.setHalt(
        "error",
        asError(error, "The audio recorder could not start")
      )
      this.stopTracks()
      this.reportHalt()
      return
    }
    const cycle: RecorderCycle = {
      blobs: [],
      discard: false,
      recorder,
      requestedReason: null,
      settled: false,
      settledPromise,
      resolveSettled,
    }
    this.current = cycle

    recorder.addEventListener("dataavailable", (event) => {
      const blob = (event as BlobEvent).data
      if (blob?.size > 0) cycle.blobs.push(blob)
    })
    recorder.addEventListener("error", (event) => {
      const cause = (event as ErrorEvent).error
      cycle.discard = true
      this.haltCurrent(
        "error",
        asError(cause, "The browser stopped capturing audio")
      )
    })
    recorder.addEventListener("stop", () => {
      if (!cycle.requestedReason) {
        this.clock = pauseRecordingClock(this.clock, this.now())
        this.setHalt(
          "unexpected-stop",
          new Error("The browser stopped capturing audio unexpectedly")
        )
        cycle.requestedReason = "unexpected-stop"
      }
      this.settleCycle(cycle)
    })

    try {
      recorder.start()
    } catch (error) {
      this.current = null
      this.setHalt(
        "error",
        asError(error, "The audio recorder could not start")
      )
      this.stopTracks()
      cycle.settled = true
      cycle.resolveSettled()
      this.reportHalt()
      return
    }
    this.clock = resumeRecordingClock(this.clock, this.now())
    this.scheduleBoundary()
  }

  private scheduleBoundary(): void {
    this.clearScheduled()
    if (!this.current || this.current.recorder.state !== "recording") return
    const elapsedMs = this.elapsedMs
    const segmentElapsedMs = Math.max(
      0,
      elapsedMs - this.clock.segmentBoundaryMs
    )
    const segmentRemainingMs = Math.max(
      0,
      this.options.segmentDurationMs - segmentElapsedMs
    )
    const totalRemainingMs = Math.max(0, this.options.maxDurationMs - elapsedMs)
    const delayMs = Math.min(segmentRemainingMs, totalRemainingMs)
    this.scheduled = this.schedule(() => {
      this.scheduled = null
      const reason =
        this.elapsedMs >= this.options.maxDurationMs ? "limit" : "rotation"
      void this.requestStop(reason)
    }, delayMs)
  }

  private requestStop(reason: CaptureStopReason): Promise<void> {
    const cycle = this.current
    this.clearScheduled()
    if (!cycle) {
      if (reason === "finish" || reason === "unmount") {
        this.stopTracks()
        this.options.onStopped?.(reason)
      }
      return Promise.resolve()
    }
    this.promoteReason(cycle, reason)
    this.clock = pauseRecordingClock(this.clock, this.now())
    if (cycle.recorder.state !== "inactive") {
      try {
        cycle.recorder.stop()
      } catch (error) {
        this.setHalt(
          "error",
          asError(error, "The audio recorder could not stop")
        )
        cycle.discard = true
        this.stopTracks()
        this.settleCycle(cycle)
      }
    }
    return cycle.settledPromise
  }

  private haltCurrent(reason: CaptureHaltReason, error: Error): void {
    const cycle = this.current
    if (!cycle) {
      this.setHalt(reason, error)
      this.stopTracks()
      this.reportHalt()
      return
    }
    this.setHalt(reason, error)
    this.promoteReason(cycle, reason)
    this.clearScheduled()
    this.clock = pauseRecordingClock(this.clock, this.now())
    if (cycle.recorder.state !== "inactive") {
      try {
        cycle.recorder.stop()
      } catch {
        cycle.discard = true
        this.settleCycle(cycle)
      }
    }
    this.stopTracks()
  }

  private settleCycle(cycle: RecorderCycle): void {
    if (cycle.settled) return
    cycle.settled = true
    if (this.current === cycle) this.current = null
    this.clearScheduled()

    const reason = cycle.requestedReason ?? "unexpected-stop"
    const uncappedElapsedMs = this.elapsedMs
    const completedElapsedMs = Math.min(
      uncappedElapsedMs,
      this.options.maxDurationMs
    )
    const completed = {
      durationMs: Math.max(
        1,
        Math.round(completedElapsedMs - this.clock.segmentBoundaryMs)
      ),
    }
    this.clock = {
      ...this.clock,
      accumulatedMs: completedElapsedMs,
      runningSinceMs: null,
      segmentBoundaryMs: completedElapsedMs,
    }
    let rejected: Error | null = null
    const remainingDurationMs = Math.max(
      0,
      this.options.maxDurationMs -
        this.clock.segmentBoundaryMs +
        completed.durationMs
    )

    if (
      !cycle.discard &&
      cycle.blobs.length === 0 &&
      reason !== "unmount" &&
      completed.durationMs >= 1_000
    ) {
      rejected = new Error("The browser returned an empty audio segment")
    } else if (!cycle.discard && cycle.blobs.length > 0) {
      if (completed.durationMs > this.options.maxSegmentDurationMs) {
        rejected = new Error(
          "The completed audio segment is too long to upload"
        )
      } else if (completed.durationMs > remainingDurationMs) {
        rejected = new Error("The recording duration limit was reached")
      } else if (this.nextSeq >= this.options.maxSegments) {
        rejected = new Error("The recording segment limit was reached")
      } else {
        const mimeType =
          cycle.blobs.find((blob) => blob.type)?.type || cycle.recorder.mimeType
        const blob =
          cycle.blobs.length === 1
            ? cycle.blobs[0]!
            : new Blob(cycle.blobs, { type: mimeType })
        try {
          const acceptance = this.options.onSegment({
            blob,
            durationMs: completed.durationMs,
            mimeType,
            seq: this.nextSeq,
          })
          if (acceptance.accepted) this.nextSeq += 1
          else rejected = acceptance.error
        } catch (error) {
          rejected = asError(
            error,
            "The completed audio segment could not be queued"
          )
        }
      }
    }

    if (rejected) {
      this.setHalt("segment-rejected", rejected)
      this.stopTracks()
    }

    if (reason === "rotation" && !this.halt && !this.disposed) {
      this.startCycle()
    } else if (reason === "limit" && !this.halt) {
      this.stopTracks()
      this.options.onLimit()
    } else if (reason === "finish" || reason === "unmount") {
      this.stopTracks()
      this.options.onStopped?.(reason)
    } else {
      this.stopTracks()
      this.reportHalt()
    }

    cycle.resolveSettled()
  }

  private promoteReason(
    cycle: RecorderCycle,
    reason: CaptureStopReason | CaptureHaltReason
  ): void {
    if (
      !cycle.requestedReason ||
      STOP_PRIORITY[reason] > STOP_PRIORITY[cycle.requestedReason]
    ) {
      cycle.requestedReason = reason
    }
  }

  private setHalt(reason: CaptureHaltReason, error: Error): void {
    if (!this.halt || STOP_PRIORITY[reason] > STOP_PRIORITY[this.halt.reason]) {
      this.halt = { reason, error }
    }
  }

  private reportHalt(): void {
    if (!this.halt || this.haltReported || this.disposed) return
    this.haltReported = true
    this.options.onHalt(this.halt.reason, this.halt.error)
  }

  private clearScheduled(): void {
    if (this.scheduled === null) return
    this.cancelScheduled(this.scheduled)
    this.scheduled = null
  }

  private stopTracks(): void {
    for (const track of this.options.stream.getTracks()) {
      track.removeEventListener("ended", this.trackEnded)
      if (track.readyState !== "ended") track.stop()
    }
  }
}

export class CaptureGeneration {
  private generation = 0

  begin(): number {
    this.generation += 1
    return this.generation
  }

  cancel(): void {
    this.generation += 1
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation
  }
}

/** Stop a permission result that arrived after its route/session was cancelled. */
export function retainCaptureStream<T extends CaptureStream>(
  generation: CaptureGeneration,
  token: number,
  stream: T
): T | null {
  if (generation.isCurrent(token)) return stream
  for (const track of stream.getTracks()) track.stop()
  return null
}

function asError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback)
}
