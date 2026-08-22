export type LectureRecordingStatus =
  "recording" | "uploaded" | "transcribing" | "ready" | "failed" | "deleting"

export type LectureRecordingPlanningLocator =
  | { kind: "calendarEvent"; eventId: string }
  | { kind: "timetableOccurrence"; occurrenceId: string }

export interface LectureRecordingView {
  id: string
  title: string
  status: LectureRecordingStatus
  recordedAt: Date
  durationMs: number
  error: string | null
  subjectId: string | null
  folderId: string | null
  planningLocator: LectureRecordingPlanningLocator | null
  yearId: string
  /** Favourites and the recoverable delete the server records; see plan 020 §1. */
  starredAt: Date | null
  deletedAt: Date | null
  deletedFrom: string | null
  deletedBy: "user" | "provider" | null
  /** The tags on this recording; only the list projection carries them. */
  tagIds?: readonly string[]
  createdAt: Date
  updatedAt: Date
}

export interface LectureRecordingSegmentView {
  id: string
  recordingId: string
  seq: number
  startOffsetMs: number
  durationMs: number
  transcriptStatus: "pending" | "ready" | "failed"
  transcriptError: string | null
  file: {
    id: string
    url: string
    mimeType: string
    byteSize: number
  }
}

export interface LectureTranscriptSegmentView {
  startMs: number
  endMs: number
  text: string
}

export interface LectureTranscriptView {
  text: string
  segmentsVersion: number
  segments: LectureTranscriptSegmentView[]
  language: string | null
  provider: string
}

export interface LectureRecordingDetailView {
  recording: LectureRecordingView
  segments: LectureRecordingSegmentView[]
  transcript: LectureTranscriptView | null
}
