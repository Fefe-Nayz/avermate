import { describe, expect, test } from "bun:test"
import {
  lectureRecordingInput,
  lectureRecordingsInput,
} from "@/lib/route-query-inputs"

async function source(relativePath: string): Promise<string> {
  return Bun.file(new URL(relativePath, import.meta.url)).text()
}

describe("lecture recording Web boundaries", () => {
  test("shares exact year and detail inputs across SSR and hydrated clients", async () => {
    expect(lectureRecordingsInput("year_1")).toEqual({
      yearId: "year_1",
      include: "live",
    })
    expect(lectureRecordingInput("rec_1")).toEqual({ recordingId: "rec_1" })

    const [
      materialsPage,
      materialsClient,
      detailPage,
      reader,
      newPage,
      recorder,
    ] = await Promise.all([
      source("../../app/(app)/materials/page.tsx"),
      source("../materials/materials-client.tsx"),
      source("../../app/(app)/materials/recordings/[recordingId]/page.tsx"),
      source("./lecture-recording-reader.tsx"),
      source("../../app/(app)/materials/recordings/new/page.tsx"),
      source("./lecture-recorder.tsx"),
    ])

    expect(materialsPage).not.toContain('"use client"')
    expect(materialsPage).toContain("lectureRecordingsInput(activeYearId)")
    expect(materialsPage).toContain("recordings.list.queryOptions")
    expect(materialsClient).toContain("lectureRecordingsInput(yearId")
    expect(materialsClient).toContain("recordings.list.queryOptions")

    expect(detailPage).not.toContain('"use client"')
    expect(detailPage).toContain("lectureRecordingInput(recordingId)")
    expect(detailPage).toContain("recordings.get.queryOptions")
    expect(reader).toContain("lectureRecordingInput(recordingId)")
    expect(reader).toContain("recordings.get.queryOptions")

    expect(newPage).not.toContain('"use client"')
    expect(newPage).toContain("recordings.capabilities.queryOptions")
    expect(newPage).toContain("HydrateClient")
    expect(recorder).toContain("recordings.capabilities.queryOptions")
  })

  test("keeps recording mutations inside the recordings cache family", async () => {
    const [reader, recorder] = await Promise.all([
      source("./lecture-recording-reader.tsx"),
      source("./lecture-recorder.tsx"),
    ])
    const combined = `${reader}\n${recorder}`

    expect(combined).toContain("orpc.recordings.list.queryKey")
    expect(combined).toContain("orpc.recordings.get.queryKey")
    expect(combined).not.toContain("queryKey: orpc.materials.documents.key()")
    expect(combined).not.toContain("queryKey: orpc.documents.list.key()")
    expect(combined).not.toContain(["snapshot", "get"].join("."))
  })

  test("persists and surfaces the discriminated Planning locator", async () => {
    const [page, recorder, reader, materials, calendarPage, calendarClient] =
      await Promise.all([
        source("../../app/(app)/materials/recordings/new/page.tsx"),
        source("./lecture-recorder.tsx"),
        source("./lecture-recording-reader.tsx"),
        source("../materials/materials-client.tsx"),
        source("../../app/(app)/planning/calendar/page.tsx"),
        source("../planning/planning-calendar-client.tsx"),
      ])

    expect(page).toContain("eventId")
    expect(page).toContain("occurrenceId")
    expect(page).toContain("seriesOccurrence")
    expect(recorder).toContain("planningLocatorFromContext")
    expect(recorder).toContain(
      "planningLocator: planningLocatorFromContext(initialPlanningContext)"
    )
    expect(reader).toContain("recording.planningLocator")
    expect(reader).toContain("Open linked Planning item")
    expect(materials).toContain("recording.planningLocator")
    expect(materials).toContain("Linked to Planning")
    expect(calendarPage).toContain("planningLocatorFromSearchParams")
    expect(calendarPage).toContain("orpc.planning.locate.queryOptions")
    expect(calendarPage).toContain("initialFocusId={focus?.id ?? null}")
    expect(calendarPage).toContain("initialFocusStartsAt")
    expect(calendarPage).toContain("calendarYearId")
    expect(calendarPage).toContain("focus?.timezone")
    expect(calendarPage).toContain("Number(selectedDay.slice(5, 7)) - 1")
    expect(calendarClient).toContain("data-planning-item-id")
    expect(calendarClient).toContain("target.scrollIntoView")
    expect(calendarClient).toContain('effectiveView = focusId ? "day" : view')
    expect(calendarClient).toContain("selectYear(initialYearId)")
    expect(calendarClient).toContain("isoDateInTimeZone")
  })

  test("recovers failed and interrupted transcription through the existing exact cache flow", async () => {
    const reader = await source("./lecture-recording-reader.tsx")

    expect(
      reader.match(/orpc\.recordings\.transcribe\.mutationOptions\(\)/g)
    ).toHaveLength(1)
    expect(reader).toContain('recording.status === "failed"')
    expect(reader).toContain('t("Retry transcription")')
    expect(reader).toContain('t("Resume transcription")')
    expect(reader).toContain('t("Lecture transcription resumed.")')
    expect(
      reader.match(/transcribe\.mutate\(\{ recordingId \}\)/g)
    ).toHaveLength(1)
    expect(reader).toContain("requestTranscription(false)")
    expect(reader).toContain("requestTranscription(true)")
    expect(reader).toContain(
      "await Promise.all([invalidateRecording(), invalidateList()])"
    )
    expect(reader).toContain('recording.status !== "deleting"')
    expect(reader).toContain('t("Deletion in progress…")')
    expect(reader).toContain('t("Retry deletion")')
    expect(reader).toContain("onClick={() => setDeleteOpen(true)}")
    expect(reader).toContain("remove.mutate({ recordingId })")
    expect(reader).toContain(
      'status === "transcribing" || status === "deleting"'
    )

    const materialsClient = await source("../materials/materials-client.tsx")
    expect(materialsClient).toContain('recording.status === "deleting"')
  })

  test("feature-detects capture, uploads normalized chunks FIFO, and finishes after drain", async () => {
    const [recorder, captureSession, model, queue, nextConfig] =
      await Promise.all([
        source("./lecture-recorder.tsx"),
        source("./recording-capture-session.ts"),
        source("./recording-model.ts"),
        source("./recording-upload-queue.ts"),
        source("../../../next.config.ts"),
      ])

    expect(model).toContain("10 * 60_000")
    expect(model).toContain('"audio/webm;codecs=opus"')
    expect(model).toContain('"audio/mp4"')
    expect(recorder).toContain("MediaRecorder.isTypeSupported")
    expect(recorder).toContain('?? ""')
    expect(recorder).toContain(
      "if (supportedMimeType) options.mimeType = supportedMimeType"
    )
    expect(recorder).toContain("getUserMedia")
    expect(recorder).toContain("retainCaptureStream")
    expect(recorder).toContain("captureGeneration.isCurrent(captureToken)")
    expect(recorder).toContain("captureSessionRef.current?.dispose()")
    expect(recorder).toContain("persistUnmountedCapture")
    expect(recorder).toContain("commitServerRecording")
    expect(captureSession).toContain("recorder.start()")
    expect(captureSession).not.toContain(
      "recorder.start(this.options.segmentDurationMs)"
    )
    expect(captureSession).toContain("new Blob(cycle.blobs")
    expect(recorder).toContain("recordingUploadMimeType")
    expect(recorder).toContain("new File(")
    expect(nextConfig).toContain("microphone=(self)")
    expect(nextConfig).not.toContain("microphone=()")
    expect(recorder).toContain("await drainUploads()")
    expect(recorder.indexOf("await drainUploads()")).toBeLessThan(
      recorder.indexOf("await commitServerRecording()")
    )
    expect(recorder).toContain("if (!mountedRef.current) return")
    expect(queue).toContain("this.items[0]")
    expect(queue).toContain("failedSeq: item.seq")
  })

  test("exposes offset-aware playback and timestamp buttons on responsive layouts", async () => {
    const playback = await source("./recording-playback.tsx")
    const reader = await source("./lecture-recording-reader.tsx")

    expect(playback).toContain("recordingPlaybackPosition")
    expect(playback).toContain("activeSegment.startOffsetMs")
    expect(playback).toContain("<audio")
    expect(playback).toContain('type="range"')
    expect(playback).toContain("aria-valuetext")
    expect(playback).toContain("aria-label={`${seekLabel} ${timestamp}`}")
    expect(playback).toContain("xl:grid-cols-")
    expect(reader).toContain("refetchInterval")
    expect(reader).toContain("orpc.jobs.get.queryOptions")
    expect(reader).toContain('aria-live="polite"')
  })
})
