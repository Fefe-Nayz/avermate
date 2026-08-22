import { describe, expect, test } from "bun:test"
import {
  DictationError,
  inspectDictationSupport,
  mapDictationCaptureError,
} from "./dictation"

describe("assistant dictation diagnostics", () => {
  test("distinguishes browser and origin failures", () => {
    expect(
      inspectDictationSupport({
        isSecureContext: false,
        hasGetUserMedia: true,
        hasMediaRecorder: true,
      }).error?.code
    ).toBe("insecure-context")
    expect(
      inspectDictationSupport({
        isSecureContext: true,
        hasGetUserMedia: false,
        hasMediaRecorder: true,
      }).error?.code
    ).toBe("missing-media-devices")
    expect(
      inspectDictationSupport({
        isSecureContext: true,
        hasGetUserMedia: true,
        hasMediaRecorder: false,
      }).error?.code
    ).toBe("missing-media-recorder")
  })

  test("negotiates a supported MIME type instead of hard-coding one", () => {
    const support = inspectDictationSupport({
      isSecureContext: true,
      hasGetUserMedia: true,
      hasMediaRecorder: true,
      isTypeSupported: (mime) => mime === "audio/mp4",
    })
    expect(support).toMatchObject({ available: true, mimeType: "audio/mp4" })
  })

  test("reports unsupported codecs with an audio-file fallback", () => {
    const support = inspectDictationSupport({
      isSecureContext: true,
      hasGetUserMedia: true,
      hasMediaRecorder: true,
      isTypeSupported: () => false,
    })
    expect(support.error).toBeInstanceOf(DictationError)
    expect(support.error?.code).toBe("unsupported-codec")
    expect(support.error?.action).toContain("Attach")
  })

  test("maps permission, device and capture errors to actionable codes", () => {
    expect(
      mapDictationCaptureError(new DOMException("blocked", "NotAllowedError"))
        .code
    ).toBe("permission-denied")
    expect(
      mapDictationCaptureError(new DOMException("none", "NotFoundError")).code
    ).toBe("no-input-device")
    expect(
      mapDictationCaptureError(new DOMException("busy", "NotReadableError"))
        .code
    ).toBe("device-unavailable")
  })
})
