"use client"

import { useMemo, useRef, useState } from "react"
import { AudioLinesIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { Button } from "@/components/ui/button"
import {
  formatRecordingTimestamp,
  recordingPlaybackPosition,
  recordingTotalDurationMs,
} from "./recording-model"
import type {
  LectureRecordingSegmentView,
  LectureTranscriptSegmentView,
} from "./recording-types"

export function TimestampedTranscript({
  segments,
  seekLabel,
  onSeek,
}: {
  segments: readonly LectureTranscriptSegmentView[]
  seekLabel: string
  onSeek: (milliseconds: number) => void
}) {
  return (
    <ol className="flex flex-col gap-3">
      {segments.map((segment, index) => {
        const timestamp = formatRecordingTimestamp(segment.startMs)
        return (
          <li
            key={`${segment.startMs}:${segment.endMs}:${index}`}
            className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 rounded-lg border bg-card px-3 py-3"
          >
            <Button
              variant="secondary"
              size="xs"
              className="numeric mt-0.5 min-w-14"
              aria-label={`${seekLabel} ${timestamp}`}
              onClick={() => onSeek(segment.startMs)}
            >
              {timestamp}
            </Button>
            <p className="text-sm leading-relaxed">{segment.text}</p>
          </li>
        )
      })}
    </ol>
  )
}

export function RecordingPlayback({
  segments,
  transcriptSegments,
}: {
  segments: readonly LectureRecordingSegmentView[]
  transcriptSegments: readonly LectureTranscriptSegmentView[]
}) {
  const t = useExtracted()
  const audioRef = useRef<HTMLAudioElement>(null)
  const pendingSeekMs = useRef<number | null>(null)
  const resumeAfterLoad = useRef(false)
  const [segmentIndex, setSegmentIndex] = useState(0)
  const [elapsedMs, setElapsedMs] = useState(0)
  const orderedSegments = useMemo(
    () => [...segments].sort((a, b) => a.seq - b.seq),
    [segments]
  )
  const totalMs = recordingTotalDurationMs(orderedSegments)
  const activeSegment = orderedSegments[segmentIndex]

  const seek = (requestedMs: number) => {
    const position = recordingPlaybackPosition(orderedSegments, requestedMs)
    if (!position) return
    const audio = audioRef.current
    const shouldResume = Boolean(audio && !audio.paused)
    setElapsedMs(position.globalMs)
    if (position.segmentIndex === segmentIndex && audio) {
      audio.currentTime = position.localMs / 1_000
      return
    }
    pendingSeekMs.current = position.localMs
    resumeAfterLoad.current = shouldResume
    setSegmentIndex(position.segmentIndex)
  }

  if (!activeSegment) {
    return (
      <div
        role="status"
        className="grid min-h-40 place-items-center rounded-xl border border-dashed text-sm text-muted-foreground"
      >
        {t("No playable audio segment is available.")}
      </div>
    )
  }

  return (
    <div
      className={
        transcriptSegments.length > 0
          ? "grid items-start gap-5 xl:grid-cols-[minmax(18rem,0.75fr)_minmax(0,1.25fr)]"
          : "mx-auto w-full max-w-3xl"
      }
    >
      <section
        aria-label={t("Lecture audio player")}
        className="rounded-xl border bg-card p-4 shadow-xs sm:p-5 xl:sticky xl:top-4"
      >
        <div className="mb-4 flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
            <AudioLinesIcon className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {t("Segment {current} of {total}", {
                current: String(segmentIndex + 1),
                total: String(orderedSegments.length),
              })}
            </p>
            <p className="numeric text-xs text-muted-foreground">
              {formatRecordingTimestamp(elapsedMs)} /{" "}
              {formatRecordingTimestamp(totalMs)}
            </p>
          </div>
        </div>

        <audio
          ref={audioRef}
          key={activeSegment.id}
          className="w-full"
          controls
          preload="metadata"
          src={activeSegment.file.url}
          onLoadedMetadata={(event) => {
            const audio = event.currentTarget
            const localMs = pendingSeekMs.current
            if (localMs !== null) {
              audio.currentTime = localMs / 1_000
              pendingSeekMs.current = null
            }
            if (resumeAfterLoad.current) {
              resumeAfterLoad.current = false
              void audio.play().catch(() => undefined)
            }
          }}
          onTimeUpdate={(event) =>
            setElapsedMs(
              activeSegment.startOffsetMs +
                event.currentTarget.currentTime * 1_000
            )
          }
          onEnded={() => {
            const next = orderedSegments[segmentIndex + 1]
            if (!next) {
              setElapsedMs(totalMs)
              return
            }
            pendingSeekMs.current = 0
            resumeAfterLoad.current = true
            setSegmentIndex((current) => current + 1)
          }}
        >
          {t("Your browser cannot play this lecture audio.")}
        </audio>

        <label className="mt-5 flex flex-col gap-2 text-xs font-medium text-muted-foreground">
          <span>{t("Position in the full recording")}</span>
          <input
            type="range"
            min={0}
            max={Math.max(totalMs, 1)}
            step={1_000}
            value={Math.min(elapsedMs, totalMs)}
            aria-valuetext={t("{current} of {total}", {
              current: formatRecordingTimestamp(elapsedMs),
              total: formatRecordingTimestamp(totalMs),
            })}
            className="h-10 w-full accent-primary"
            onChange={(event) => seek(Number(event.currentTarget.value))}
          />
        </label>

        <div
          className="mt-3 flex gap-2 overflow-x-auto pb-1"
          aria-label={t("Audio segments")}
        >
          {orderedSegments.map((segment, index) => (
            <Button
              key={segment.id}
              variant={index === segmentIndex ? "secondary" : "ghost"}
              size="xs"
              aria-current={index === segmentIndex ? "true" : undefined}
              onClick={() => seek(segment.startOffsetMs)}
            >
              {t("Part {number}", { number: String(index + 1) })}
            </Button>
          ))}
        </div>
      </section>

      {transcriptSegments.length > 0 ? (
        <section aria-labelledby="lecture-transcript-heading">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {t("Timestamped text")}
              </p>
              <h2
                id="lecture-transcript-heading"
                className="mt-0.5 text-xl font-semibold tracking-tight"
              >
                {t("Transcript")}
              </h2>
            </div>
            <span className="text-xs text-muted-foreground">
              {t("{count} passages", {
                count: String(transcriptSegments.length),
              })}
            </span>
          </div>
          <TimestampedTranscript
            segments={transcriptSegments}
            seekLabel={t("Seek to")}
            onSeek={seek}
          />
        </section>
      ) : null}
    </div>
  )
}
