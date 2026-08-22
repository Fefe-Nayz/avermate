import { expect, test } from "@playwright/test"

test("Chrome dictation releases the microphone and inserts without sending", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const listeners = new Map<string, Set<(event: Event) => void>>()
    const track = {
      stop() {
        ;(window as Window & { __stoppedTracks?: number }).__stoppedTracks =
          ((window as Window & { __stoppedTracks?: number }).__stoppedTracks ??
            0) + 1
      },
    }
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => ({ getTracks: () => [track] }),
      },
    })
    class FakeMediaRecorder {
      static isTypeSupported(type: string) {
        return type === "audio/webm;codecs=opus"
      }
      state: RecordingState = "inactive"
      readonly mimeType = "audio/webm;codecs=opus"
      addEventListener(type: string, callback: EventListener) {
        const set = listeners.get(type) ?? new Set()
        set.add(callback)
        listeners.set(type, set)
      }
      removeEventListener(type: string, callback: EventListener) {
        listeners.get(type)?.delete(callback)
      }
      start() {
        this.state = "recording"
      }
      stop() {
        this.state = "inactive"
        const data = new Event("dataavailable") as BlobEvent
        Object.defineProperty(data, "data", {
          value: new Blob(["voice"], { type: this.mimeType }),
        })
        for (const callback of listeners.get("dataavailable") ?? []) {
          callback(data)
        }
        for (const callback of listeners.get("stop") ?? []) {
          callback(new Event("stop"))
        }
      }
    }
    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: FakeMediaRecorder,
    })
    class FakeAudioContext {
      createMediaStreamSource() {
        return { connect() {}, disconnect() {} }
      }
      createAnalyser() {
        return {
          fftSize: 256,
          getByteTimeDomainData(samples: Uint8Array) {
            samples.fill(128)
          },
        }
      }
      async close() {}
    }
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: FakeAudioContext,
    })
  })

  await page.goto("/dev/assistant-v1")
  await expect
    .poll(() => page.evaluate(() => window.__assistantFixtureReady === true))
    .toBe(true)
  await page.getByRole("button", { name: "Dictate message" }).click()
  const stop = page.getByRole("button", { name: "Stop dictation recording" })
  const captureError = page.getByRole("alert").filter({ hasText: /.+/ })
  await expect(stop.or(captureError)).toBeVisible()
  if (await captureError.isVisible()) {
    throw new Error(
      `Dictation fixture failed: ${await captureError.innerText()}`
    )
  }
  await stop.click()
  await expect(page.getByText("Review dictation")).toBeVisible()
  await page.getByRole("button", { name: "Insert transcript" }).click()

  await expect(
    page.getByRole("textbox", {
      name: "Ask about your courses, grades or documents…",
    })
  ).toHaveValue("Texte dicté depuis Chrome")
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __stoppedTracks?: number }).__stoppedTracks ?? 0
      )
    )
    .toBe(1)
  expect(
    await page.evaluate(() => window.__assistantFixtureTranscriptions ?? 0)
  ).toBe(1)
  expect(await page.evaluate(() => window.__assistantFixtureSends ?? 0)).toBe(0)
})
