"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  BrowserDictationCapture,
  DictationError,
  browserDictationSupport,
  mapDictationCaptureError,
  type DictationRecording,
  type DictationSupport,
} from "./dictation"

export type AssistantDictationPhase =
  "idle" | "requesting" | "recording" | "review" | "transcribing" | "error"

export interface AssistantDictationState {
  phase: AssistantDictationPhase
  support: DictationSupport
  elapsedMs: number
  level: number
  recording: DictationRecording | null
  previewUrl: string | null
  error: DictationError | null
}

export function useAssistantDictation(options: {
  transcribe: (file: File) => Promise<string>
  onTranscript: (text: string) => void
}) {
  const [state, setState] = useState<AssistantDictationState>(() => ({
    phase: "idle",
    support: browserDictationSupport(),
    elapsedMs: 0,
    level: 0,
    recording: null,
    previewUrl: null,
    error: null,
  }))
  const captureRef = useRef<BrowserDictationCapture | null>(null)
  const previewRef = useRef<string | null>(null)

  const revokePreview = useCallback(() => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    previewRef.current = null
  }, [])

  const setFailure = useCallback((error: unknown) => {
    const mapped = mapDictationCaptureError(error)
    setState((current) => ({ ...current, phase: "error", error: mapped }))
  }, [])

  useEffect(
    () => () => {
      captureRef.current?.dispose()
      revokePreview()
    },
    [revokePreview]
  )

  const start = useCallback(async () => {
    const support = browserDictationSupport()
    if (!support.available) {
      setState((current) => ({
        ...current,
        support,
        phase: "error",
        error: support.error,
      }))
      return
    }
    revokePreview()
    captureRef.current?.dispose()
    const capture = new BrowserDictationCapture({
      onElapsed: (elapsedMs) =>
        setState((current) => ({ ...current, elapsedMs })),
      onLevel: (level) => setState((current) => ({ ...current, level })),
    })
    captureRef.current = capture
    setState({
      phase: "requesting",
      support,
      elapsedMs: 0,
      level: 0,
      recording: null,
      previewUrl: null,
      error: null,
    })
    try {
      await capture.start()
      setState((current) => ({ ...current, phase: "recording" }))
    } catch (error) {
      captureRef.current = null
      setFailure(error)
    }
  }, [revokePreview, setFailure])

  const stop = useCallback(async () => {
    const capture = captureRef.current
    if (!capture) return
    try {
      const recording = await capture.stop()
      captureRef.current = null
      revokePreview()
      const previewUrl = URL.createObjectURL(recording.blob)
      previewRef.current = previewUrl
      setState((current) => ({
        ...current,
        phase: "review",
        level: 0,
        recording,
        previewUrl,
        error: null,
      }))
    } catch (error) {
      captureRef.current = null
      setFailure(error)
    }
  }, [revokePreview, setFailure])

  const cancel = useCallback(() => {
    captureRef.current?.cancel()
    captureRef.current = null
    revokePreview()
    setState((current) => ({
      ...current,
      phase: "idle",
      elapsedMs: 0,
      level: 0,
      recording: null,
      previewUrl: null,
      error: null,
    }))
  }, [revokePreview])

  const transcribe = useCallback(async () => {
    if (!state.recording) return
    setState((current) => ({ ...current, phase: "transcribing", error: null }))
    try {
      const text = (await options.transcribe(state.recording.file)).trim()
      if (!text) throw new DictationError("empty-recording")
      options.onTranscript(text)
      cancel()
    } catch (error) {
      setFailure(error)
    }
  }, [cancel, options, setFailure, state.recording])

  const useAudioFile = useCallback(
    async (file: File) => {
      setState((current) => ({
        ...current,
        phase: "transcribing",
        error: null,
      }))
      try {
        const text = (await options.transcribe(file)).trim()
        if (!text) throw new DictationError("empty-recording")
        options.onTranscript(text)
        cancel()
      } catch (error) {
        setFailure(error)
      }
    },
    [cancel, options, setFailure]
  )

  return { state, start, stop, cancel, transcribe, useAudioFile }
}
