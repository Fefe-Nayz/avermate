"use client"

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangleIcon,
  CalendarDaysIcon,
  MicIcon,
  PauseIcon,
  PlayIcon,
  SquareIcon,
  Trash2Icon,
} from "lucide-react"
import { useExtracted, useFormatter } from "next-intl"
import { toast } from "sonner"
import { SelectField, TextField } from "@/components/forms/controls"
import { FormFlow, type FlowStep } from "@/components/forms/form-flow"
import { PageMeta } from "@/components/shell/page-chrome"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { useYear } from "@/components/year/year-provider"
import { flattenMaterialFolders } from "@/components/materials/materials-model"
import type { MaterialFolderView } from "@/components/materials/materials-types"
import { haptic } from "@/lib/haptics"
import { uploadBrowserFile } from "@/lib/file-upload"
import { orpc } from "@/lib/orpc"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"
import {
  lectureRecordingsInput,
  materialsFoldersInput,
} from "@/lib/route-query-inputs"
import {
  formatRecordingTimestamp,
  preferredRecordingMimeType,
  recordingFileExtension,
  recordingSegmentDurationMs,
  recordingUploadMimeType,
  RECORDING_MAX_DURATION_MS,
} from "./recording-model"
import {
  CaptureGeneration,
  RecordingCaptureSession,
  persistUnmountedCapture,
  recordingCaptureDurationLimit,
  retainCaptureStream,
  type CaptureHaltReason,
} from "./recording-capture-session"
import { RecordingUploadQueue } from "./recording-upload-queue"

const ROOT_FOLDER = "__recording_root__"
const NO_SUBJECT = "__recording_no_subject__"
const WEB_SEGMENT_DURATION_MS = recordingSegmentDurationMs(
  process.env.NODE_ENV === "development",
  process.env.NEXT_PUBLIC_RECORDING_SEGMENT_MS
)

type RecorderPhase =
  "setup" | "permission" | "recording" | "paused" | "finishing" | "failed"

type FailureKind = "permission" | "upload" | "capture" | "finish" | null

export type LecturePlanningContext =
  | { kind: "calendarEvent"; eventId: string; startsAt: string | null }
  | { kind: "occurrence"; occurrenceId: string; startsAt: string | null }
  | {
      kind: "seriesOccurrence"
      seriesId: string
      occurrenceDate: string
      startsAt: string | null
    }

export function planningLocatorFromContext(
  context: LecturePlanningContext | null
) {
  if (!context) return null
  if (context.kind === "calendarEvent") {
    return { kind: "calendarEvent" as const, eventId: context.eventId }
  }
  if (context.kind === "occurrence") {
    return {
      kind: "timetableOccurrence" as const,
      occurrenceId: context.occurrenceId,
    }
  }
  return {
    kind: "timetableSeriesOccurrence" as const,
    seriesId: context.seriesId,
    occurrenceDate: context.occurrenceDate,
  }
}

interface PendingAudioSegment {
  seq: number
  durationMs: number
  file: File
}

function subscribeToRecorderSupport(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => undefined

  const mediaDevices = navigator.mediaDevices
  window.addEventListener("focus", onStoreChange)
  window.addEventListener("pageshow", onStoreChange)
  mediaDevices?.addEventListener?.("devicechange", onStoreChange)
  return () => {
    window.removeEventListener("focus", onStoreChange)
    window.removeEventListener("pageshow", onStoreChange)
    mediaDevices?.removeEventListener?.("devicechange", onStoreChange)
  }
}

function browserRecordingMimeType(): string | null | undefined {
  if (typeof window === "undefined") return undefined
  if (
    typeof window.MediaRecorder === "undefined" ||
    typeof navigator.mediaDevices?.getUserMedia !== "function"
  ) {
    return null
  }
  if (typeof window.MediaRecorder.isTypeSupported !== "function") return ""

  return (
    preferredRecordingMimeType((mimeType) =>
      window.MediaRecorder.isTypeSupported(mimeType)
    ) ?? ""
  )
}

function stopStream(stream: MediaStream | null) {
  for (const track of stream?.getTracks() ?? []) track.stop()
}

function captureHaltMessage(
  reason: CaptureHaltReason,
  messages: {
    disconnected: string
    rejected: string
    stopped: string
  }
): Error {
  if (reason === "track-ended") {
    return new Error(messages.disconnected)
  }
  if (reason === "segment-rejected") {
    return new Error(messages.rejected)
  }
  return new Error(messages.stopped)
}

export function LectureRecorder({
  initialFolderId,
  initialTitle = "",
  initialSubjectId = null,
  initialPlanningContext = null,
}: {
  initialFolderId: string | null
  initialTitle?: string
  initialSubjectId?: string | null
  initialPlanningContext?: LecturePlanningContext | null
}) {
  const t = useExtracted()
  const format = useFormatter()
  const haltMessages = {
    disconnected: t(
      "The microphone disconnected. Completed audio parts are still available to save."
    ),
    rejected: t(
      "The latest audio part could not be saved. Earlier completed parts are still available."
    ),
    stopped: t(
      "Audio capture stopped. Completed audio parts are still available to save."
    ),
  }
  const router = useRouter()
  const queryClient = useQueryClient()
  const { yearId, graph } = useYear()
  const supportedMimeType = useSyncExternalStore(
    subscribeToRecorderSupport,
    browserRecordingMimeType,
    () => undefined
  )
  const [uploadQueue] = useState(
    () => new RecordingUploadQueue<PendingAudioSegment>()
  )
  const [captureGeneration] = useState(() => new CaptureGeneration())
  const uploadSnapshot = useSyncExternalStore(
    uploadQueue.subscribe,
    uploadQueue.getSnapshot,
    uploadQueue.getSnapshot
  )
  const [phase, setPhase] = useState<RecorderPhase>("setup")
  const phaseRef = useRef<RecorderPhase>("setup")
  const [title, setTitle] = useState(initialTitle)
  const [titleError, setTitleError] = useState("")
  const [folderId, setFolderId] = useState<string | null>(initialFolderId)
  const [subjectId, setSubjectId] = useState<string | null>(initialSubjectId)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [failureKind, setFailureKind] = useState<FailureKind>(null)
  const [failureMessage, setFailureMessage] = useState("")
  const [discardOpen, setDiscardOpen] = useState(false)
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const [segmentCount, setSegmentCount] = useState(0)
  const streamRef = useRef<MediaStream | null>(null)
  const captureSessionRef = useRef<RecordingCaptureSession | null>(null)
  const unmountPersistenceRef = useRef<
    ((session: RecordingCaptureSession) => Promise<void>) | null
  >(null)
  const recordingIdRef = useRef<string | null>(null)
  const recordingYearIdRef = useRef<string | null>(null)
  const nextSeqRef = useRef(0)
  const discardingRef = useRef(false)
  const mountedRef = useRef(true)
  const finishingRequestedRef = useRef(false)
  const resumeAfterRetryRef = useRef(false)
  const serverTerminalRef = useRef(false)
  const serverFinishPromiseRef = useRef<Promise<void> | null>(null)

  const transition = useCallback((next: RecorderPhase) => {
    phaseRef.current = next
    setPhase(next)
  }, [])

  const foldersQuery = useQuery({
    ...orpc.materials.folders.list.queryOptions({
      input: materialsFoldersInput(yearId ?? ""),
    }),
    enabled: Boolean(yearId),
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  const capabilities = useQuery({
    ...orpc.recordings.capabilities.queryOptions(),
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  const startMutation = useMutation(orpc.recordings.start.mutationOptions())
  const appendMutation = useMutation(
    orpc.recordings.appendSegment.mutationOptions()
  )
  const finishMutation = useMutation(orpc.recordings.finish.mutationOptions())
  const deleteMutation = useMutation(orpc.recordings.delete.mutationOptions())

  const folders = (foldersQuery.data ?? []) as MaterialFolderView[]
  const folderIds = new Set(folders.map((folder) => folder.id))
  const safeFolderId = folderId && folderIds.has(folderId) ? folderId : null
  const selectedFolder = folders.find((folder) => folder.id === safeFolderId)
  const allSubjects = graph.flatten()
  const subjectIds = new Set(allSubjects.map((subject) => subject.id))
  const safeSubjectId = selectedFolder?.subjectId
    ? selectedFolder.subjectId
    : subjectId && subjectIds.has(subjectId)
      ? subjectId
      : null
  const folderOptions = [
    { value: ROOT_FOLDER, label: t("No folder") },
    ...flattenMaterialFolders(folders).map(({ folder, depth }) => ({
      value: folder.id,
      label: `${"— ".repeat(depth)}${folder.name}`,
    })),
  ]
  const subjectOptions = [
    { value: NO_SUBJECT, label: t("No subject") },
    ...allSubjects.map((subject) => ({
      value: subject.id,
      label: subject.name,
      disabled: subject.kind === "category",
    })),
  ]

  const invalidateRecordingList = useCallback(() => {
    const recordingYearId = recordingYearIdRef.current
    if (!recordingYearId) return Promise.resolve()
    return queryClient.invalidateQueries({
      queryKey: orpc.recordings.list.queryKey({
        input: lectureRecordingsInput(recordingYearId),
      }),
      exact: true,
      refetchType: "all",
    })
  }, [queryClient])

  const uploadPendingSegment = useCallback(
    async (item: PendingAudioSegment) => {
      const recordingId = recordingIdRef.current
      if (!recordingId) throw new Error("No active lecture recording")
      const uploaded = await uploadBrowserFile("lectureAudioSegment", item.file)
      await appendMutation.mutateAsync({
        recordingId,
        seq: item.seq,
        durationMs: item.durationMs,
        fileId: uploaded.fileId,
      })
    },
    [appendMutation]
  )

  const fail = useCallback(
    (kind: Exclude<FailureKind, null>, error: unknown) => {
      if (!mountedRef.current) return
      const message =
        error instanceof Error && error.message
          ? error.message
          : t("The recording could not continue.")
      setFailureKind(kind)
      setFailureMessage(message)
      transition("failed")
      haptic("error")
    },
    [t, transition]
  )

  const pauseForUploadFailure = useCallback(
    (error: unknown) => {
      if (discardingRef.current) return
      const captureSession = captureSessionRef.current
      if (captureSession?.pause()) {
        setElapsedMs(captureSession.elapsedMs)
        resumeAfterRetryRef.current = true
      }
      fail("upload", error)
    },
    [fail]
  )

  const drainUploads = useCallback(
    () => uploadQueue.drain(uploadPendingSegment),
    [uploadPendingSegment, uploadQueue]
  )

  const commitServerRecording = useCallback((): Promise<void> => {
    const recordingId = recordingIdRef.current
    if (!recordingId || serverTerminalRef.current) return Promise.resolve()
    if (serverFinishPromiseRef.current) return serverFinishPromiseRef.current

    const operation = finishMutation
      .mutateAsync({ recordingId })
      .then(() => {
        serverTerminalRef.current = true
      })
      .catch((error: unknown) => {
        if (serverFinishPromiseRef.current === operation) {
          serverFinishPromiseRef.current = null
        }
        throw error
      })
    serverFinishPromiseRef.current = operation
    return operation
  }, [finishMutation])

  const finalizeOnServer = useCallback(async () => {
    const recordingId = recordingIdRef.current
    if (!recordingId) return
    try {
      await drainUploads()
      await commitServerRecording()
      await invalidateRecordingList()
      if (!mountedRef.current) return
      haptic("success")
      toast.success(t("Lecture recording saved."))
      router.replace(`/materials/recordings/${recordingId}`)
    } catch (error) {
      fail(
        uploadQueue.getSnapshot().pendingCount > 0 ? "upload" : "finish",
        error
      )
    }
  }, [
    commitServerRecording,
    drainUploads,
    fail,
    invalidateRecordingList,
    router,
    t,
    uploadQueue,
  ])

  const finishCapture = async () => {
    if (!recordingIdRef.current) return
    finishingRequestedRef.current = true
    transition("finishing")
    try {
      await captureSessionRef.current?.finish()
      stopStream(streamRef.current)
      streamRef.current = null
      await finalizeOnServer()
    } catch {
      stopStream(streamRef.current)
      streamRef.current = null
      fail("capture", captureHaltMessage("error", haltMessages))
    }
  }

  useEffect(() => {
    unmountPersistenceRef.current = async (captureSession) => {
      const recordingId = recordingIdRef.current
      if (!recordingId || discardingRef.current || serverTerminalRef.current) {
        await captureSession.dispose()
        return
      }
      const outcome = await persistUnmountedCapture({
        dispose: () => captureSession.dispose(),
        drain: drainUploads,
        finish: commitServerRecording,
      })
      if (outcome === "finished") {
        serverTerminalRef.current = true
        await invalidateRecordingList().catch(() => undefined)
      }
    }
  }, [commitServerRecording, drainUploads, invalidateRecordingList])

  useEffect(() => {
    if (phase !== "recording") return
    const timer = window.setInterval(() => {
      const captureSession = captureSessionRef.current
      if (captureSession) setElapsedMs(captureSession.elapsedMs)
    }, 500)
    return () => window.clearInterval(timer)
  }, [phase])

  useEffect(() => {
    const active =
      phase === "permission" ||
      phase === "recording" ||
      phase === "paused" ||
      phase === "finishing" ||
      Boolean(recordingIdRef.current)
    if (!active) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [phase])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      captureGeneration.cancel()
      const captureSession = captureSessionRef.current
      const persist = unmountPersistenceRef.current
      if (captureSession && persist) void persist(captureSession)
      else void captureSession?.dispose()
      stopStream(streamRef.current)
      streamRef.current = null
    }
  }, [captureGeneration])

  const validateTitle = () => {
    const clean = title.trim()
    const error = !clean
      ? t("Give this recording a title.")
      : clean.length > 160
        ? t("Keep the title under 160 characters.")
        : ""
    setTitleError(error)
    return !error
  }

  const beginCapture = async () => {
    if (
      !yearId ||
      supportedMimeType === null ||
      supportedMimeType === undefined ||
      capabilities.data?.uploadsEnabled !== true ||
      !validateTitle()
    ) {
      return
    }
    transition("permission")
    setFailureKind(null)
    setFailureMessage("")
    const captureToken = captureGeneration.begin()
    try {
      const permissionStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })
      const stream = retainCaptureStream(
        captureGeneration,
        captureToken,
        permissionStream
      )
      if (!stream) return
      streamRef.current = stream
      const recording = await startMutation.mutateAsync({
        yearId,
        title: title.trim(),
        folderId: safeFolderId,
        subjectId: safeSubjectId,
        planningLocator: planningLocatorFromContext(initialPlanningContext),
      })
      if (!captureGeneration.isCurrent(captureToken)) {
        stopStream(stream)
        if (streamRef.current === stream) streamRef.current = null
        await deleteMutation
          .mutateAsync({ recordingId: recording.id })
          .catch(() => undefined)
        return
      }
      recordingIdRef.current = recording.id
      recordingYearIdRef.current = yearId
      setRecordingId(recording.id)
      void invalidateRecordingList().catch(() => undefined)

      nextSeqRef.current = 0
      finishingRequestedRef.current = false
      resumeAfterRetryRef.current = false
      serverTerminalRef.current = false
      serverFinishPromiseRef.current = null
      discardingRef.current = false
      setSegmentCount(0)
      setElapsedMs(0)

      const maxSegments = capabilities.data?.maxSegments ?? 24
      const maxDurationMs = recordingCaptureDurationLimit(
        capabilities.data?.maxDurationMs ?? RECORDING_MAX_DURATION_MS,
        maxSegments,
        WEB_SEGMENT_DURATION_MS
      )
      const captureSession = new RecordingCaptureSession({
        stream,
        segmentDurationMs: WEB_SEGMENT_DURATION_MS,
        maxSegments,
        maxDurationMs,
        maxSegmentDurationMs:
          capabilities.data?.maxSegmentDurationMs ?? 15 * 60_000,
        createRecorder: (captureStream) => {
          const options: MediaRecorderOptions = {
            audioBitsPerSecond: 64_000,
          }
          if (supportedMimeType) options.mimeType = supportedMimeType
          return new MediaRecorder(captureStream as MediaStream, options)
        },
        onSegment: (segment) => {
          if (discardingRef.current) return { accepted: true }
          const uploadMimeType = recordingUploadMimeType(
            segment.mimeType || supportedMimeType
          )
          if (!uploadMimeType) {
            return {
              accepted: false,
              error: new Error(t("This audio encoding is not supported.")),
            }
          }
          const file = new File(
            [segment.blob],
            `lecture-part-${segment.seq + 1}.${recordingFileExtension(uploadMimeType)}`,
            { type: uploadMimeType }
          )
          const enqueued = uploadQueue.enqueue({
            seq: segment.seq,
            durationMs: segment.durationMs,
            file,
          })
          if (!enqueued) {
            return {
              accepted: false,
              error: new Error(t("This audio part was already queued.")),
            }
          }
          nextSeqRef.current = segment.seq + 1
          if (mountedRef.current) {
            setSegmentCount(nextSeqRef.current)
            setElapsedMs(captureSession.elapsedMs)
          }
          void drainUploads().catch(pauseForUploadFailure)
          return { accepted: true }
        },
        onHalt: (reason) => {
          if (!mountedRef.current) return
          setElapsedMs(captureSession.elapsedMs)
          if (discardingRef.current) return
          fail("capture", captureHaltMessage(reason, haltMessages))
        },
        onLimit: () => {
          if (!mountedRef.current) return
          finishingRequestedRef.current = true
          transition("finishing")
          void finalizeOnServer()
        },
      })
      captureSessionRef.current = captureSession
      streamRef.current = null
      captureSession.start()
      if (captureSession.state === "recording") {
        transition("recording")
        haptic("success")
      }
    } catch (error) {
      stopStream(streamRef.current)
      streamRef.current = null
      const recordingId = recordingIdRef.current
      if (recordingId) {
        await deleteMutation.mutateAsync({ recordingId }).catch(() => undefined)
        await invalidateRecordingList().catch(() => undefined)
      }
      recordingIdRef.current = null
      recordingYearIdRef.current = null
      if (mountedRef.current) setRecordingId(null)
      if (!captureGeneration.isCurrent(captureToken)) return
      const permissionDenied =
        error instanceof DOMException &&
        (error.name === "NotAllowedError" || error.name === "SecurityError")
      fail(permissionDenied ? "permission" : "capture", error)
    }
  }

  const pause = () => {
    const captureSession = captureSessionRef.current
    if (!captureSession?.pause()) return
    setElapsedMs(captureSession.elapsedMs)
    transition("paused")
    haptic("light")
  }

  const resume = () => {
    const captureSession = captureSessionRef.current
    if (!captureSession?.resume()) return
    transition("recording")
    haptic("light")
  }

  const retry = async () => {
    if (!recordingIdRef.current) {
      setFailureKind(null)
      setFailureMessage("")
      transition("setup")
      return
    }
    transition(finishingRequestedRef.current ? "finishing" : "paused")
    try {
      await drainUploads()
      if (!mountedRef.current) return
      if (finishingRequestedRef.current) {
        transition("finishing")
        await finalizeOnServer()
        return
      }
      if (failureKind !== "upload") {
        transition("finishing")
        await finalizeOnServer()
        return
      }
      if (
        resumeAfterRetryRef.current &&
        captureSessionRef.current?.state === "paused" &&
        captureSessionRef.current.resume()
      ) {
        resumeAfterRetryRef.current = false
        transition("recording")
      } else {
        transition("paused")
      }
      setFailureKind(null)
      setFailureMessage("")
    } catch (error) {
      pauseForUploadFailure(error)
    }
  }

  const discard = async () => {
    const recordingId = recordingIdRef.current
    if (!recordingId) return
    discardingRef.current = true
    setDiscardOpen(false)
    transition("finishing")
    await captureSessionRef.current?.dispose().catch(() => undefined)
    stopStream(streamRef.current)
    streamRef.current = null
    await drainUploads().catch(() => undefined)
    try {
      await deleteMutation.mutateAsync({ recordingId })
      serverTerminalRef.current = true
      await invalidateRecordingList()
      recordingIdRef.current = null
      recordingYearIdRef.current = null
      if (!mountedRef.current) return
      setRecordingId(null)
      toast.success(t("Lecture recording discarded."))
      router.replace("/materials")
    } catch (error) {
      discardingRef.current = false
      fail("finish", error)
    }
  }

  if (supportedMimeType === undefined || capabilities.isPending) {
    return <RecorderStatus title={t("Checking audio recording…")} />
  }

  if (supportedMimeType === null) {
    const insecureContext =
      typeof window !== "undefined" && window.isSecureContext === false
    return (
      <RecorderUnavailable
        title={t("Audio recording is unavailable in this browser")}
        description={
          insecureContext
            ? t(
                "Microphone access requires HTTPS, except on localhost. Open this page over HTTPS or use localhost, then try again."
              )
            : t(
                "Use a current browser with MediaRecorder support, then try again."
              )
        }
      />
    )
  }

  if (capabilities.isError || !capabilities.data?.uploadsEnabled) {
    return (
      <RecorderUnavailable
        title={t("Lecture recording is unavailable")}
        description={
          capabilities.error?.message ||
          t("Audio uploads are not configured for this account.")
        }
      />
    )
  }

  if (phase === "setup" || (phase === "failed" && !recordingId)) {
    const setupError = phase === "failed" ? failureMessage : ""
    const steps: FlowStep[] = [
      {
        id: "details",
        title: t("Which lecture are you recording?"),
        description: t(
          "Give it a title you will recognize in Materials and search results."
        ),
        validate: validateTitle,
        summary: <span>{title || t("Untitled lecture")}</span>,
        content: (
          <div className="flex flex-col gap-4">
            {setupError ? (
              <Alert variant="destructive">
                <AlertTriangleIcon />
                <AlertTitle>
                  {failureKind === "permission"
                    ? t("Microphone access was not granted")
                    : t("The recording could not start")}
                </AlertTitle>
                <AlertDescription>{setupError}</AlertDescription>
              </Alert>
            ) : null}
            {initialPlanningContext ? (
              <Alert>
                <CalendarDaysIcon />
                <AlertTitle>{t("Linked to a scheduled class")}</AlertTitle>
                <AlertDescription>
                  {initialPlanningContext.startsAt &&
                  !Number.isNaN(
                    new Date(initialPlanningContext.startsAt).getTime()
                  )
                    ? t("Scheduled for {date}.", {
                        date: format.dateTime(
                          new Date(initialPlanningContext.startsAt),
                          { dateStyle: "medium", timeStyle: "short" }
                        ),
                      })
                    : t(
                        "The class context is kept while you prepare this recording."
                      )}
                </AlertDescription>
              </Alert>
            ) : null}
            <TextField
              label={t("Lecture title")}
              value={title}
              required
              maxLength={160}
              autoFocus
              error={titleError}
              placeholder={t("Introduction to organic chemistry")}
              onChange={(event) => {
                setTitle(event.target.value)
                setTitleError("")
              }}
            />
          </div>
        ),
      },
      {
        id: "location",
        title: t("Where should it be filed?"),
        description: t("Both links are optional and can be changed later."),
        summary: (
          <span>
            {folderOptions.find(
              (option) => option.value === (safeFolderId ?? ROOT_FOLDER)
            )?.label ?? t("No folder")}
            {safeSubjectId
              ? ` · ${
                  subjectOptions.find(
                    (option) => option.value === safeSubjectId
                  )?.label ?? t("Subject")
                }`
              : ""}
          </span>
        ),
        content: (
          <div className="flex flex-col gap-5">
            <SelectField
              label={t("Folder")}
              value={safeFolderId ?? ROOT_FOLDER}
              options={folderOptions}
              onValueChange={(value) => {
                const nextFolderId = value === ROOT_FOLDER ? null : value
                setFolderId(nextFolderId)
                const nextFolder = folders.find(
                  (folder) => folder.id === nextFolderId
                )
                if (nextFolder?.subjectId) setSubjectId(nextFolder.subjectId)
              }}
            />
            <SelectField
              label={t("Subject")}
              value={safeSubjectId ?? NO_SUBJECT}
              options={subjectOptions}
              disabled={Boolean(selectedFolder?.subjectId)}
              description={
                selectedFolder?.subjectId
                  ? t("This folder already determines the subject.")
                  : t("Optional. Link the recording to one subject.")
              }
              onValueChange={(value) =>
                setSubjectId(value === NO_SUBJECT ? null : value)
              }
            />
          </div>
        ),
      },
    ]

    return (
      <FormFlow
        title={t("Record a lecture")}
        description={t(
          "Audio is split and uploaded safely while you keep recording."
        )}
        backHref="/materials"
        steps={steps}
        submitLabel={t("Allow microphone and start")}
        submitting={startMutation.isPending}
        disabled={foldersQuery.isPending || !yearId}
        footerNote={t(
          "Your browser will ask for microphone permission before anything is recorded."
        )}
        onSubmit={() => void beginCapture()}
      />
    )
  }

  if (phase === "permission") {
    return <RecorderStatus title={t("Waiting for microphone permission…")} />
  }

  const failed = phase === "failed"
  const paused = phase === "paused"
  const finishing = phase === "finishing"
  const hasCompletedAudio = segmentCount > 0 || uploadSnapshot.pendingCount > 0
  return (
    <>
      <PageMeta title={title.trim()} subtitle={t("Lecture recording")} />
      <main className="mx-auto flex min-h-[min(42rem,78vh)] w-full max-w-3xl flex-col justify-center">
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="flex flex-col items-center px-5 py-8 text-center sm:px-10 sm:py-12">
            <span
              className={`grid size-20 place-items-center rounded-full ${
                phase === "recording"
                  ? "bg-destructive/15 text-destructive motion-safe:animate-pulse"
                  : "bg-muted text-muted-foreground"
              }`}
              aria-hidden
            >
              {finishing ? (
                <Spinner className="size-7" />
              ) : (
                <MicIcon className="size-8" />
              )}
            </span>
            <p className="mt-5 text-sm font-medium text-muted-foreground">
              {failed
                ? t("Recording needs attention")
                : finishing
                  ? t("Saving every audio segment…")
                  : paused
                    ? t("Recording paused")
                    : t("Recording in progress")}
            </p>
            <p className="numeric mt-1 text-5xl font-semibold tracking-tight sm:text-6xl">
              {formatRecordingTimestamp(elapsedMs)}
            </p>
            <h1 className="mt-4 max-w-xl text-xl font-semibold text-balance sm:text-2xl">
              {title.trim()}
            </h1>
            <div
              role="status"
              aria-live="polite"
              className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm text-muted-foreground"
            >
              <span>
                {t("{count} audio parts", { count: String(segmentCount) })}
              </span>
              <span>
                {uploadSnapshot.pendingCount > 0
                  ? t("{count} waiting to upload", {
                      count: String(uploadSnapshot.pendingCount),
                    })
                  : t("Audio saved so far")}
              </span>
            </div>

            {failed ? (
              <Alert variant="destructive" className="mt-6 max-w-xl text-left">
                <AlertTriangleIcon />
                <AlertTitle>
                  {failureKind === "upload"
                    ? t("An audio part could not be uploaded")
                    : failureKind === "finish"
                      ? t("The recording could not be finalized")
                      : t("Audio capture stopped unexpectedly")}
                </AlertTitle>
                <AlertDescription>{failureMessage}</AlertDescription>
              </Alert>
            ) : null}

            <div className="mt-8 flex w-full max-w-md flex-col-reverse gap-3 sm:flex-row sm:justify-center">
              <Button
                variant="outline"
                size="lg"
                disabled={
                  finishing ||
                  (failed && failureKind !== "upload" && !hasCompletedAudio)
                }
                onClick={failed ? () => void retry() : paused ? resume : pause}
              >
                {failed ? <PlayIcon /> : paused ? <PlayIcon /> : <PauseIcon />}
                {failed
                  ? failureKind === "upload"
                    ? t("Retry upload")
                    : hasCompletedAudio
                      ? t("Save completed audio")
                      : t("No completed audio to save")
                  : paused
                    ? t("Resume")
                    : t("Pause")}
              </Button>
              <Button
                size="lg"
                disabled={finishing || failed}
                onClick={() => void finishCapture()}
              >
                {finishing ? <Spinner /> : <SquareIcon />}
                {finishing ? t("Finishing…") : t("Finish recording")}
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t bg-muted/25 px-5 py-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8">
            <p>{t("Audio uploads sequentially in ten-minute parts.")}</p>
            <Button
              variant="ghost"
              size="sm"
              className="self-start text-destructive hover:bg-destructive/10 hover:text-destructive sm:self-auto"
              disabled={finishing}
              onClick={() => setDiscardOpen(true)}
            >
              <Trash2Icon /> {t("Discard recording")}
            </Button>
          </div>
        </section>
      </main>

      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <Trash2Icon />
            </AlertDialogMedia>
            <AlertDialogTitle>{t("Discard this recording?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "Every uploaded audio part will be permanently deleted. This cannot be undone."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Keep recording")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void discard()}
            >
              {t("Discard")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function RecorderStatus({ title }: { title: string }) {
  return (
    <div className="grid min-h-[65vh] place-items-center">
      <div
        role="status"
        className="flex items-center gap-3 text-sm text-muted-foreground"
      >
        <Spinner className="size-5" /> {title}
      </div>
    </div>
  )
}

function RecorderUnavailable({
  title,
  description,
}: {
  title: string
  description: string
}) {
  const t = useExtracted()
  return (
    <>
      <PageMeta title={t("Record a lecture")} backHref="/materials" />
      <div className="mx-auto w-full max-w-xl py-12">
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>{title}</AlertTitle>
          <AlertDescription>{description}</AlertDescription>
        </Alert>
        <Button
          className="mt-4"
          variant="outline"
          render={<a href="/materials" />}
        >
          {t("Back to materials")}
        </Button>
      </div>
    </>
  )
}
