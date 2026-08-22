import {
  preferredRecordingMimeType,
  recordingFileExtension,
  recordingUploadMimeType,
} from "@/components/recordings/recording-model"

export type DictationErrorCode =
  | "insecure-context"
  | "missing-media-devices"
  | "missing-media-recorder"
  | "unsupported-codec"
  | "permission-denied"
  | "no-input-device"
  | "device-unavailable"
  | "capture-aborted"
  | "empty-recording"
  | "capture-failed"

const DICTATION_MESSAGES: Record<
  DictationErrorCode,
  { message: string; action: string }
> = {
  "insecure-context": {
    message: "Microphone access requires HTTPS or localhost.",
    action: "Open Avermate over HTTPS, then try again.",
  },
  "missing-media-devices": {
    message: "This browser does not expose microphone capture.",
    action: "Use a current Chrome, Edge, Firefox, or Safari release.",
  },
  "missing-media-recorder": {
    message: "This browser cannot encode a microphone recording.",
    action: "Update the browser or attach an audio file instead.",
  },
  "unsupported-codec": {
    message: "The browser offers no audio codec accepted by this server.",
    action: "Attach a WebM, OGG, M4A, or MP4 audio file instead.",
  },
  "permission-denied": {
    message: "Microphone permission is blocked.",
    action: "Allow microphone access in the site settings and retry.",
  },
  "no-input-device": {
    message: "No microphone was found.",
    action: "Connect or enable an input device, then retry.",
  },
  "device-unavailable": {
    message: "The microphone is already in use or unavailable.",
    action: "Close the other recording application and retry.",
  },
  "capture-aborted": {
    message: "Audio capture was interrupted.",
    action: "Check the microphone connection and retry.",
  },
  "empty-recording": {
    message: "The browser returned an empty recording.",
    action: "Speak for a moment before stopping, or attach an audio file.",
  },
  "capture-failed": {
    message: "The microphone recording failed.",
    action: "Retry or attach an audio file instead.",
  },
}

export class DictationError extends Error {
  readonly action: string

  constructor(
    readonly code: DictationErrorCode,
    options: { cause?: unknown; detail?: string } = {}
  ) {
    const copy = DICTATION_MESSAGES[code]
    super(options.detail ? `${copy.message} ${options.detail}` : copy.message, {
      cause: options.cause,
    })
    this.name = "DictationError"
    this.action = copy.action
  }
}

export interface DictationSupport {
  available: boolean
  mimeType: string | null
  error: DictationError | null
}

export function inspectDictationSupport(input: {
  isSecureContext: boolean
  hasGetUserMedia: boolean
  hasMediaRecorder: boolean
  isTypeSupported?: (mimeType: string) => boolean
}): DictationSupport {
  if (!input.isSecureContext) {
    return {
      available: false,
      mimeType: null,
      error: new DictationError("insecure-context"),
    }
  }
  if (!input.hasGetUserMedia) {
    return {
      available: false,
      mimeType: null,
      error: new DictationError("missing-media-devices"),
    }
  }
  if (!input.hasMediaRecorder) {
    return {
      available: false,
      mimeType: null,
      error: new DictationError("missing-media-recorder"),
    }
  }
  const mimeType = input.isTypeSupported
    ? preferredRecordingMimeType(input.isTypeSupported)
    : null
  if (!mimeType) {
    return {
      available: false,
      mimeType: null,
      error: new DictationError("unsupported-codec"),
    }
  }
  return { available: true, mimeType, error: null }
}

export function browserDictationSupport(): DictationSupport {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return {
      available: false,
      mimeType: null,
      error: new DictationError("missing-media-devices"),
    }
  }
  const Recorder = window.MediaRecorder
  return inspectDictationSupport({
    isSecureContext: window.isSecureContext,
    hasGetUserMedia: typeof navigator.mediaDevices?.getUserMedia === "function",
    hasMediaRecorder: typeof Recorder === "function",
    isTypeSupported:
      typeof Recorder?.isTypeSupported === "function"
        ? Recorder.isTypeSupported.bind(Recorder)
        : undefined,
  })
}

export function mapDictationCaptureError(error: unknown): DictationError {
  if (error instanceof DictationError) return error
  const name =
    error !== null && typeof error === "object" && "name" in error
      ? String(error.name)
      : ""
  if (name === "NotAllowedError" || name === "SecurityError") {
    return new DictationError("permission-denied", { cause: error })
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return new DictationError("no-input-device", { cause: error })
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return new DictationError("device-unavailable", { cause: error })
  }
  if (name === "AbortError") {
    return new DictationError("capture-aborted", { cause: error })
  }
  return new DictationError("capture-failed", { cause: error })
}

export interface DictationRecording {
  blob: Blob
  durationMs: number
  file: File
  mimeType: string
}

export interface DictationCaptureOptions {
  maxDurationMs?: number
  onElapsed?: (elapsedMs: number) => void
  onLevel?: (level: number) => void
  onLimit?: () => void
  now?: () => number
}

function stopTracks(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) track.stop()
}

/**
 * A short-lived browser capture. The class owns the stream and releases every
 * track after stop, failure, timeout or disposal.
 */
export class BrowserDictationCapture {
  private chunks: Blob[] = []
  private recorder: MediaRecorder | null = null
  private stream: MediaStream | null = null
  private startedAt = 0
  private progressTimer: ReturnType<typeof setInterval> | null = null
  private limitTimer: ReturnType<typeof setTimeout> | null = null
  private audioContext: AudioContext | null = null
  private audioSource: MediaStreamAudioSourceNode | null = null
  private levelFrame: number | null = null
  private stopPromise: Promise<DictationRecording> | null = null
  private resolveStop: ((recording: DictationRecording) => void) | null = null
  private rejectStop: ((error: DictationError) => void) | null = null
  private readonly now: () => number

  constructor(private readonly options: DictationCaptureOptions = {}) {
    this.now = options.now ?? (() => performance.now())
  }

  async start(): Promise<void> {
    if (this.recorder) return
    const support = browserDictationSupport()
    if (!support.available || !support.mimeType) throw support.error

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })
      const recorder = new MediaRecorder(this.stream, {
        mimeType: support.mimeType,
        audioBitsPerSecond: 64_000,
      })
      this.recorder = recorder
      this.chunks = []
      this.startedAt = this.now()
      this.stopPromise = new Promise<DictationRecording>((resolve, reject) => {
        this.resolveStop = resolve
        this.rejectStop = reject
      })
      // Disposal may cancel a capture before a consumer has called `stop()`.
      // Attach a rejection observer immediately so React unmounts never create
      // an unhandled promise while preserving the original promise for callers.
      void this.stopPromise.catch(() => undefined)
      recorder.addEventListener("dataavailable", this.handleData)
      recorder.addEventListener("error", this.handleError)
      recorder.addEventListener("stop", this.handleStop)
      recorder.start(1_000)
      this.startMeters(this.stream)
    } catch (error) {
      this.cleanup()
      throw mapDictationCaptureError(error)
    }
  }

  get elapsedMs(): number {
    return this.startedAt ? Math.max(0, this.now() - this.startedAt) : 0
  }

  async stop(): Promise<DictationRecording> {
    const recorder = this.recorder
    const pending = this.stopPromise
    if (!recorder || !pending) {
      throw new DictationError("capture-failed")
    }
    if (recorder.state !== "inactive") recorder.stop()
    return pending
  }

  cancel(): void {
    const recorder = this.recorder
    if (recorder) {
      recorder.removeEventListener("dataavailable", this.handleData)
      recorder.removeEventListener("error", this.handleError)
      recorder.removeEventListener("stop", this.handleStop)
      if (recorder.state !== "inactive") recorder.stop()
    }
    this.rejectStop?.(new DictationError("capture-aborted"))
    this.cleanup()
  }

  dispose(): void {
    this.cancel()
  }

  private readonly handleData = (event: Event) => {
    const blob = (event as BlobEvent).data
    if (blob?.size) this.chunks.push(blob)
  }

  private readonly handleError = (event: Event) => {
    const cause = (event as ErrorEvent).error
    this.rejectStop?.(mapDictationCaptureError(cause))
    this.cleanup()
  }

  private readonly handleStop = () => {
    const recorder = this.recorder
    const elapsedMs = Math.max(1, Math.round(this.elapsedMs))
    const mimeType =
      this.chunks.find((chunk) => chunk.type)?.type || recorder?.mimeType || ""
    const uploadMimeType = recordingUploadMimeType(mimeType)
    if (this.chunks.length === 0 || !uploadMimeType) {
      this.rejectStop?.(
        new DictationError(
          this.chunks.length === 0 ? "empty-recording" : "unsupported-codec"
        )
      )
      this.cleanup()
      return
    }
    const blob = new Blob(this.chunks, { type: uploadMimeType })
    const file = new File(
      [blob],
      `dictation-${Date.now()}.${recordingFileExtension(uploadMimeType)}`,
      { type: uploadMimeType }
    )
    this.resolveStop?.({
      blob,
      durationMs: elapsedMs,
      file,
      mimeType: uploadMimeType,
    })
    this.cleanup()
  }

  private startMeters(stream: MediaStream): void {
    this.progressTimer = setInterval(() => {
      this.options.onElapsed?.(this.elapsedMs)
    }, 100)
    if (this.options.onLevel && typeof window.AudioContext === "function") {
      try {
        const context = new AudioContext()
        const source = context.createMediaStreamSource(stream)
        const analyser = context.createAnalyser()
        analyser.fftSize = 256
        source.connect(analyser)
        const samples = new Uint8Array(analyser.fftSize)
        this.audioContext = context
        this.audioSource = source
        const meter = () => {
          analyser.getByteTimeDomainData(samples)
          let sum = 0
          for (const sample of samples) {
            const normalized = (sample - 128) / 128
            sum += normalized * normalized
          }
          this.options.onLevel?.(
            Math.min(1, Math.sqrt(sum / samples.length) * 4)
          )
          this.levelFrame = window.requestAnimationFrame(meter)
        }
        meter()
      } catch {
        this.options.onLevel?.(0)
      }
    }
    const maxDurationMs = this.options.maxDurationMs ?? 2 * 60_000
    this.limitTimer = setTimeout(() => {
      this.options.onLimit?.()
      void this.stop().catch(() => undefined)
    }, maxDurationMs)
  }

  private cleanup(): void {
    if (this.progressTimer) clearInterval(this.progressTimer)
    if (this.limitTimer) clearTimeout(this.limitTimer)
    if (this.levelFrame !== null) window.cancelAnimationFrame(this.levelFrame)
    this.progressTimer = null
    this.limitTimer = null
    this.levelFrame = null
    this.audioSource?.disconnect()
    this.audioSource = null
    void this.audioContext?.close().catch(() => undefined)
    this.audioContext = null
    if (this.recorder) {
      this.recorder.removeEventListener("dataavailable", this.handleData)
      this.recorder.removeEventListener("error", this.handleError)
      this.recorder.removeEventListener("stop", this.handleStop)
    }
    stopTracks(this.stream)
    this.stream = null
    this.recorder = null
    this.resolveStop = null
    this.rejectStop = null
  }
}
