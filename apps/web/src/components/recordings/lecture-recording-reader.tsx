"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import {
  AlertTriangleIcon,
  CalendarDaysIcon,
  CheckCircle2Icon,
  MicIcon,
  RotateCcwIcon,
  ScanTextIcon,
  Trash2Icon,
  UploadCloudIcon,
} from "lucide-react"
import { useExtracted, useFormatter } from "next-intl"
import { toast } from "sonner"
import { PageActions, PageMeta } from "@/components/shell/page-chrome"
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
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"
import {
  lectureRecordingInput,
  lectureRecordingsInput,
} from "@/lib/route-query-inputs"
import {
  formatRecordingTimestamp,
  isActiveRecordingJob,
} from "./recording-model"
import { RecordingPlayback } from "./recording-playback"
import type {
  LectureRecordingDetailView,
  LectureRecordingPlanningLocator,
  LectureRecordingStatus,
} from "./recording-types"

function planningHref(locator: LectureRecordingPlanningLocator) {
  const params = new URLSearchParams()
  if (locator.kind === "calendarEvent") params.set("eventId", locator.eventId)
  else params.set("occurrenceId", locator.occurrenceId)
  return `/planning/calendar?${params.toString()}`
}

function recordingStatusLabel(
  status: LectureRecordingStatus,
  t: ReturnType<typeof useExtracted>
) {
  if (status === "recording") return t("Interrupted recording")
  if (status === "uploaded") return t("Ready to transcribe")
  if (status === "transcribing") return t("Transcribing")
  if (status === "ready") return t("Transcript ready")
  if (status === "failed") return t("Transcription failed")
  return t("Deleting recording")
}

export function LectureRecordingReader({
  recordingId,
}: {
  recordingId: string
}) {
  const t = useExtracted()
  const format = useFormatter()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { subjects } = useYear()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [jobIds, setJobIds] = useState<string[]>([])
  const transcriptionRecoveryRef = useRef(false)
  const input = lectureRecordingInput(recordingId)
  const recordingQuery = useQuery({
    ...orpc.recordings.get.queryOptions({ input }),
    staleTime: COMMON_QUERY_STALE_TIME,
    refetchInterval: (query) => {
      const status = query.state.data?.recording.status
      return status === "transcribing" || status === "deleting" ? 1_500 : false
    },
  })
  const recordingYearId = (
    recordingQuery.data as LectureRecordingDetailView | undefined
  )?.recording.yearId
  const capabilities = useQuery({
    ...orpc.recordings.capabilities.queryOptions(),
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  const jobs = useQueries({
    queries: jobIds.map((jobId) => ({
      ...orpc.jobs.get.queryOptions({ input: { jobId } }),
      refetchInterval: (query: { state: { data?: { status?: string } } }) =>
        isActiveRecordingJob(query.state.data?.status) ? 1_500 : false,
    })),
  })
  const invalidateRecording = () =>
    queryClient.invalidateQueries({
      queryKey: orpc.recordings.get.queryKey({ input }),
      exact: true,
      refetchType: "all",
    })
  const invalidateList = () => {
    if (!recordingYearId) return Promise.resolve()
    return queryClient.invalidateQueries({
      queryKey: orpc.recordings.list.queryKey({
        input: lectureRecordingsInput(recordingYearId),
      }),
      exact: true,
      refetchType: "all",
    })
  }

  const finish = useMutation({
    ...orpc.recordings.finish.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      toast.success(t("Uploaded audio finalized."))
      await Promise.all([invalidateRecording(), invalidateList()])
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("The recording could not be finalized."))
    },
  })
  const transcribe = useMutation({
    ...orpc.recordings.transcribe.mutationOptions(),
    onSuccess: async (result) => {
      const resumed = transcriptionRecoveryRef.current
      transcriptionRecoveryRef.current = false
      haptic("success")
      setJobIds([
        ...new Set([
          ...result.segmentJobs.map((job) => job.jobId),
          result.finalizeJob.jobId,
        ]),
      ])
      toast.success(
        resumed
          ? t("Lecture transcription resumed.")
          : t("Lecture transcription queued.")
      )
      await Promise.all([invalidateRecording(), invalidateList()])
    },
    onError: (error: Error) => {
      const resumed = transcriptionRecoveryRef.current
      transcriptionRecoveryRef.current = false
      haptic("error")
      toast.error(
        error.message ||
          (resumed
            ? t("Transcription could not be resumed.")
            : t("Transcription could not start."))
      )
    },
  })
  const remove = useMutation({
    ...orpc.recordings.delete.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      setDeleteOpen(false)
      queryClient.removeQueries({
        queryKey: orpc.recordings.get.queryKey({ input }),
        exact: true,
      })
      await invalidateList()
      toast.success(t("Lecture recording deleted."))
      router.replace("/materials")
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("The recording could not be deleted."))
    },
  })
  const requestTranscription = (resume: boolean) => {
    transcriptionRecoveryRef.current = resume
    transcribe.mutate({ recordingId })
  }

  if (recordingQuery.isPending) {
    return <div className="h-[70vh] animate-pulse rounded-xl bg-muted/50" />
  }
  if (recordingQuery.isError) {
    return (
      <Alert variant="destructive">
        <AlertTriangleIcon />
        <AlertTitle>{t("The recording could not be loaded.")}</AlertTitle>
        <AlertDescription>{recordingQuery.error.message}</AlertDescription>
      </Alert>
    )
  }

  const detail = recordingQuery.data as LectureRecordingDetailView
  const recording = detail.recording
  const subject = subjects.find(
    (candidate) => candidate.id === recording.subjectId
  )
  const activeJobs = jobs.filter(
    (job) => job.isPending || isActiveRecordingJob(job.data?.status)
  ).length
  const failedJobs = jobs.filter(
    (job) =>
      job.isError ||
      job.data?.status === "failed" ||
      job.data?.status === "cancelled"
  ).length
  const completedJobs = jobs.filter(
    (job) => job.data?.status === "succeeded"
  ).length
  const canTranscribe = capabilities.data?.transcriptionEnabled === true

  return (
    <>
      <PageMeta
        title={recording.title}
        subtitle={recordingStatusLabel(recording.status, t)}
        backHref="/materials"
      />
      <PageActions>
        {recording.planningLocator ? (
          <Button
            variant="outline"
            render={<Link href={planningHref(recording.planningLocator)} />}
          >
            <CalendarDaysIcon /> {t("Open linked Planning item")}
          </Button>
        ) : null}
        {recording.status !== "deleting" ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("Delete recording")}
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2Icon />
          </Button>
        ) : null}
      </PageActions>

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-5">
        <header className="rounded-xl border bg-card px-5 py-5 shadow-xs sm:px-7 sm:py-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <MicIcon className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {recordingStatusLabel(recording.status, t)}
                </p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
                  {recording.title}
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  {format.dateTime(recording.recordedAt, {
                    dateStyle: "long",
                    timeStyle: "short",
                  })}
                  <span aria-hidden> · </span>
                  {formatRecordingTimestamp(recording.durationMs)}
                  {subject ? (
                    <>
                      <span aria-hidden> · </span>
                      {subject.name}
                    </>
                  ) : null}
                </p>
              </div>
            </div>
            {recording.status === "uploaded" ||
            recording.status === "failed" ? (
              <Button
                disabled={
                  transcribe.isPending ||
                  (recording.status === "uploaded" && !canTranscribe)
                }
                onClick={() => requestTranscription(false)}
              >
                {transcribe.isPending ? <Spinner /> : <ScanTextIcon />}
                {recording.status === "failed"
                  ? t("Retry transcription")
                  : t("Transcribe lecture")}
              </Button>
            ) : recording.status === "transcribing" ? (
              <div className="flex flex-col items-stretch gap-2 sm:items-end">
                <div
                  role="status"
                  className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary"
                >
                  <Spinner /> {t("Transcription in progress…")}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={transcribe.isPending}
                  onClick={() => requestTranscription(true)}
                >
                  {transcribe.isPending ? <Spinner /> : <RotateCcwIcon />}
                  {t("Resume transcription")}
                </Button>
              </div>
            ) : recording.status === "ready" ? (
              <div className="flex items-center gap-2 text-sm text-primary">
                <CheckCircle2Icon className="size-4" /> {t("Transcript ready")}
              </div>
            ) : recording.status === "deleting" ? (
              <div className="flex flex-col items-stretch gap-2 sm:items-end">
                <div
                  role="status"
                  className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground"
                >
                  <Spinner /> {t("Deletion in progress…")}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={remove.isPending}
                  onClick={() => setDeleteOpen(true)}
                >
                  <RotateCcwIcon /> {t("Retry deletion")}
                </Button>
              </div>
            ) : null}
          </div>
        </header>

        {recording.status === "recording" ? (
          <Alert>
            <UploadCloudIcon />
            <AlertTitle>{t("This recording was interrupted")}</AlertTitle>
            <AlertDescription>
              {detail.segments.length > 0
                ? t(
                    "The audio parts already uploaded are safe. Finalize them to keep this lecture."
                  )
                : t("No audio part reached the server before capture stopped.")}
              {detail.segments.length > 0 ? (
                <Button
                  className="mt-3"
                  size="sm"
                  disabled={finish.isPending}
                  onClick={() => finish.mutate({ recordingId })}
                >
                  {finish.isPending ? <Spinner /> : <UploadCloudIcon />}
                  {t("Finalize uploaded audio")}
                </Button>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}

        {recording.status === "uploaded" && !canTranscribe ? (
          <Alert>
            <ScanTextIcon />
            <AlertTitle>{t("Audio is ready")}</AlertTitle>
            <AlertDescription>
              {capabilities.isPending
                ? t("Checking transcription availability…")
                : t("Transcription is not configured for this account.")}
            </AlertDescription>
          </Alert>
        ) : null}

        {recording.status === "failed" ? (
          <Alert variant="destructive">
            <AlertTriangleIcon />
            <AlertTitle>{t("Lecture transcription failed")}</AlertTitle>
            <AlertDescription>
              {recording.error ||
                t("One or more audio parts could not be transcribed.")}
            </AlertDescription>
          </Alert>
        ) : null}

        {jobIds.length > 0 ? (
          <div
            role="status"
            aria-live="polite"
            className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/30 px-4 py-3 text-sm text-muted-foreground"
          >
            {activeJobs > 0 ? <Spinner className="size-4" /> : null}
            {activeJobs > 0
              ? t(
                  "Transcribing lecture: {done} finished, {active} in progress.",
                  {
                    done: String(completedJobs),
                    active: String(activeJobs),
                  }
                )
              : t(
                  "Transcription jobs finished: {done} succeeded, {failed} failed.",
                  {
                    done: String(completedJobs),
                    failed: String(failedJobs),
                  }
                )}
          </div>
        ) : null}

        <RecordingPlayback
          segments={detail.segments}
          transcriptSegments={detail.transcript?.segments ?? []}
        />

        {recording.status === "ready" && !detail.transcript ? (
          <Alert>
            <ScanTextIcon />
            <AlertTitle>{t("Transcript is being finalized")}</AlertTitle>
            <AlertDescription>
              {t("Refresh shortly if the timestamped text does not appear.")}
            </AlertDescription>
          </Alert>
        ) : null}
      </main>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <Trash2Icon />
            </AlertDialogMedia>
            <AlertDialogTitle>
              {t("Delete recording {title}?", { title: recording.title })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "Every audio part and the transcript will be permanently deleted."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>
              {t("Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => remove.mutate({ recordingId })}
            >
              {remove.isPending ? <Spinner /> : null}
              {recording.status === "deleting"
                ? t("Retry deletion")
                : t("Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
