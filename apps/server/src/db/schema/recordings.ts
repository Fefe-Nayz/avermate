import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { newId } from "../../lib/id";
import { subjects, years } from "./app";
import { users } from "./auth";
import { files } from "./files";
import { materialFolders, type MaterialDeletionActor } from "./materials";
import { calendarEvents, timetableOccurrences } from "./planning";

export type LectureRecordingStatus =
  "recording" | "uploaded" | "transcribing" | "ready" | "failed" | "deleting";
export type RecordingSegmentTranscriptStatus = "pending" | "ready" | "failed";

export interface TranscriptSegmentV1 {
  startMs: number;
  endMs: number;
  text: string;
}

const timestamps = {
  createdAt: integer({ mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer({ mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
};

const owner = () =>
  text()
    .notNull()
    .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" });

/** A logical lecture assembled from independently stored capture segments. */
export const lectureRecordings = sqliteTable(
  "lecture_recordings",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("rec")),
    title: text().notNull(),
    status: text()
      .$type<LectureRecordingStatus>()
      .notNull()
      .default("recording"),
    recordedAt: integer({ mode: "timestamp" }).notNull(),
    durationMs: integer().notNull().default(0),
    error: text(),
    /** Fences every transcription/finalize execution generation. */
    transcriptionRunId: text(),
    subjectId: text().references(() => subjects.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    folderId: text().references(() => materialFolders.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    /**
     * A recording may belong to one concrete Planning item. Recurring lessons
     * are materialized before this FK is stored, so the link never depends on
     * a virtual identifier.
     */
    calendarEventId: text().references(() => calendarEvents.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    timetableOccurrenceId: text().references(() => timetableOccurrences.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    yearId: text()
      .notNull()
      .references(() => years.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: owner(),
    starredAt: integer({ mode: "timestamp" }),
    deletedAt: integer({ mode: "timestamp" }),
    deletedFrom: text(),
    deletedBy: text().$type<MaterialDeletionActor>(),
    deletedBatchId: text(),
    ...timestamps,
  },
  (table) => [
    index("lecture_recordings_year_idx").on(table.yearId, table.recordedAt),
    index("lecture_recordings_user_idx").on(table.userId),
    index("lecture_recordings_deleted_idx").on(table.userId, table.deletedAt),
    index("lecture_recordings_calendar_event_idx").on(table.calendarEventId),
    index("lecture_recordings_timetable_occurrence_idx").on(
      table.timetableOccurrenceId,
    ),
    check(
      "lecture_recordings_status_check",
      sql`${table.status} in ('recording', 'uploaded', 'transcribing', 'ready', 'failed', 'deleting')`,
    ),
    check(
      "lecture_recordings_duration_check",
      sql`${table.durationMs} >= 0 and ${table.durationMs} <= 14400000`,
    ),
    check(
      "lecture_recordings_planning_target_check",
      sql`${table.calendarEventId} is null or ${table.timetableOccurrenceId} is null`,
    ),
  ],
);

/** One bounded capture chunk. Audio bytes are never concatenated server-side. */
export const recordingSegments = sqliteTable(
  "recording_segments",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("rseg")),
    recordingId: text()
      .notNull()
      .references(() => lectureRecordings.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    seq: integer().notNull(),
    fileId: text()
      .notNull()
      .references(() => files.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    startOffsetMs: integer().notNull(),
    durationMs: integer().notNull(),
    transcriptStatus: text()
      .$type<RecordingSegmentTranscriptStatus>()
      .notNull()
      .default("pending"),
    transcriptError: text(),
    userId: owner(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("recording_segments_recording_seq_unique").on(
      table.recordingId,
      table.seq,
    ),
    uniqueIndex("recording_segments_file_unique").on(table.fileId),
    index("recording_segments_user_idx").on(table.userId),
    check(
      "recording_segments_seq_check",
      sql`${table.seq} >= 0 and ${table.seq} < 24`,
    ),
    check("recording_segments_offset_check", sql`${table.startOffsetMs} >= 0`),
    check(
      "recording_segments_duration_check",
      sql`${table.durationMs} > 0 and ${table.durationMs} <= 900000 and ${table.startOffsetMs} + ${table.durationMs} <= 14400000`,
    ),
    check(
      "recording_segments_status_check",
      sql`${table.transcriptStatus} in ('pending', 'ready', 'failed')`,
    ),
  ],
);

/** Final searchable transcript with recording-relative timestamps. */
export const recordingTranscripts = sqliteTable(
  "recording_transcripts",
  {
    recordingId: text()
      .notNull()
      .primaryKey()
      .references(() => lectureRecordings.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    text: text().notNull(),
    segmentsVersion: integer().notNull().default(1),
    segmentsJson: text({ mode: "json" })
      .$type<TranscriptSegmentV1[]>()
      .notNull(),
    language: text(),
    provider: text().notNull(),
    /** Nullable only for transcripts created before migration 0065. */
    model: text(),
    userId: owner(),
    ...timestamps,
  },
  (table) => [
    index("recording_transcripts_user_idx").on(table.userId),
    check(
      "recording_transcripts_version_check",
      sql`${table.segmentsVersion} = 1`,
    ),
  ],
);
