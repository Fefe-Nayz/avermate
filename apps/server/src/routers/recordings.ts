import {
  expandTimetableRecurrence,
  zonedDateTimeToDate,
} from "@avermate/core/planning";
import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  calendarEvents,
  files,
  lectureRecordings,
  materialFolders,
  materialTagLinks,
  recordingSegments,
  recordingTranscripts,
  subjects,
  timetableOccurrences,
  timetableSeries,
  years,
} from "../db/schema";
import {
  CLEANUP_UNOWNED_FILE_JOB_KIND,
  recordUnownedFileCleanup,
} from "../jobs/ingest-link";
import {
  enqueueRecordingTranscription,
  purgeRecordingTranscriptionJobs,
  TRANSCRIBE_FINALIZE_JOB_KIND,
  TRANSCRIBE_SEGMENT_JOB_KIND,
} from "../jobs/transcription";
import { assertSameYear } from "../lib/domain-integrity";
import { newId } from "../lib/id";
import { enqueueJob } from "../lib/jobs";
import { badRequest, protectedProcedure } from "../lib/orpc";
import {
  requireLiveMaterialFolder,
  requireRecording,
  requireSubject,
  requireYear,
} from "../lib/ownership";
import {
  deleteFile,
  fileAccessUrl,
  storageEnabled,
  storeFile,
  requireUploadedFile,
  validateFileForPurpose,
} from "../lib/storage";
import { transcriptionEnabled } from "../lib/transcription";
import {
  assertActive,
  dateOnlySchema,
  requireCalendarEvent,
  requireTimetableOccurrence,
  requireTimetableSeries,
} from "./planning/shared";
import { materialTagIdsByTarget } from "./materials/tags";
import { trashMaterialTarget } from "./materials/operations";

export const MAX_RECORDING_SEGMENTS = 24;
export const MAX_RECORDING_DURATION_MS = 4 * 60 * 60 * 1_000;
export const MAX_RECORDING_SEGMENT_DURATION_MS = 15 * 60 * 1_000;

const titleSchema = z.string().trim().min(1).max(160);
const idSchema = z.string().min(1);

const concretePlanningLocatorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("calendarEvent"), eventId: idSchema }).strict(),
  z
    .object({
      kind: z.literal("timetableOccurrence"),
      occurrenceId: idSchema,
    })
    .strict(),
]);

const startPlanningLocatorSchema = z.discriminatedUnion("kind", [
  ...concretePlanningLocatorSchema.options,
  z
    .object({
      kind: z.literal("timetableSeriesOccurrence"),
      seriesId: idSchema,
      occurrenceDate: dateOnlySchema,
    })
    .strict(),
]);

type StartPlanningLocator = z.infer<typeof startPlanningLocatorSchema>;

type StoreFile = typeof storeFile;
type DeleteFile = typeof deleteFile;
type EnqueueJob = typeof enqueueJob;

export interface RecordingsRouterDependencies {
  storeFile?: StoreFile;
  deleteFile?: DeleteFile;
  enqueueJob?: EnqueueJob;
  storageEnabled?: () => boolean;
  transcriptionEnabled?: (userId: string) => Promise<boolean>;
  /** Test seam for an acknowledgement lost after the append transaction. */
  afterAppendCommit?: () => Promise<void> | void;
  /** Test seam for cleanup-claim versus adoption serialization. */
  afterCleanupArmed?: (jobId: string) => Promise<void> | void;
  /** Test seam for a scope mutation between validation and atomic INSERT. */
  afterScopeValidated?: () => Promise<void> | void;
  /** Test seam for a generation change after enqueue and before post-check. */
  afterTranscriptionEnqueued?: (runId: string) => Promise<void> | void;
}

type RecordingRow = typeof lectureRecordings.$inferSelect;
type PublicRecordingSource = Omit<
  RecordingRow,
  "userId" | "transcriptionRunId" | "deletedBatchId"
> &
  Partial<
    Pick<RecordingRow, "userId" | "transcriptionRunId" | "deletedBatchId">
  >;

function publicRecording(recording: PublicRecordingSource) {
  const {
    userId: _userId,
    transcriptionRunId: _transcriptionRunId,
    deletedBatchId: _deletedBatchId,
    calendarEventId,
    timetableOccurrenceId,
    ...visible
  } = recording;
  return {
    ...visible,
    planningLocator: planningLocatorOf({
      calendarEventId,
      timetableOccurrenceId,
    }),
  };
}

function planningLocatorOf(input: {
  calendarEventId: string | null;
  timetableOccurrenceId: string | null;
}) {
  if (input.calendarEventId) {
    return { kind: "calendarEvent" as const, eventId: input.calendarEventId };
  }
  if (input.timetableOccurrenceId) {
    return {
      kind: "timetableOccurrence" as const,
      occurrenceId: input.timetableOccurrenceId,
    };
  }
  return null;
}

/**
 * The collection endpoint is a public read model, not a dump of the storage
 * row. Keeping the projection explicit avoids exposing the owner/generation
 * fence and lets additive internal columns roll out independently from this
 * read-only list.
 */
const publicRecordingFields = {
  id: lectureRecordings.id,
  title: lectureRecordings.title,
  status: lectureRecordings.status,
  recordedAt: lectureRecordings.recordedAt,
  durationMs: lectureRecordings.durationMs,
  error: lectureRecordings.error,
  subjectId: lectureRecordings.subjectId,
  folderId: lectureRecordings.folderId,
  calendarEventId: lectureRecordings.calendarEventId,
  timetableOccurrenceId: lectureRecordings.timetableOccurrenceId,
  yearId: lectureRecordings.yearId,
  starredAt: lectureRecordings.starredAt,
  deletedAt: lectureRecordings.deletedAt,
  deletedFrom: lectureRecordings.deletedFrom,
  deletedBy: lectureRecordings.deletedBy,
  createdAt: lectureRecordings.createdAt,
  updatedAt: lectureRecordings.updatedAt,
};

type ResolvedPlanningTarget = {
  calendarEventId: string | null;
  timetableOccurrenceId: string | null;
  subjectId: string | null;
  pendingOccurrence: ReturnType<typeof occurrenceFromSeries> | null;
};

const noPlanningTarget: ResolvedPlanningTarget = {
  calendarEventId: null,
  timetableOccurrenceId: null,
  subjectId: null,
  pendingOccurrence: null,
};

function assertRecordableOccurrence(
  occurrence: typeof timetableOccurrences.$inferSelect,
) {
  assertActive(occurrence, "Timetable occurrence");
  if (occurrence.status !== "scheduled") {
    badRequest("A cancelled timetable occurrence cannot be recorded");
  }
}

function occurrenceFromSeries(
  series: typeof timetableSeries.$inferSelect,
  occurrenceDate: string,
) {
  if (
    expandTimetableRecurrence(
      {
        frequency: series.recurrenceFrequency,
        interval: series.recurrenceInterval,
        weekdays: series.recurrenceWeekdays,
        startsOn: series.startsOn,
        endsOn: series.endsOn,
      },
      occurrenceDate,
      occurrenceDate,
    ).length === 0
  ) {
    badRequest("That date is not generated by the timetable series");
  }
  const startsAt = zonedDateTimeToDate(
    occurrenceDate,
    series.startMinutes,
    series.timezone,
  );
  return {
    seriesId: series.id,
    occurrenceDate,
    title: series.title,
    notes: series.notes,
    localNote: series.localNote,
    startsAt,
    endsAt: new Date(startsAt.getTime() + series.durationMinutes * 60_000),
    timezone: series.timezone,
    status: "scheduled" as const,
    isException: true,
    location: series.location,
    subjectId: series.subjectId,
    yearId: series.yearId,
    userId: series.userId,
    sourceConnectionId: series.sourceConnectionId,
    externalId:
      series.externalId && series.sourceConnectionId
        ? `${series.externalId}#${occurrenceDate}`
        : null,
    syncState: series.syncState,
  };
}

async function resolvePlanningTarget(input: {
  userId: string;
  yearId: string;
  locator: StartPlanningLocator | null;
}): Promise<ResolvedPlanningTarget> {
  const { locator, userId, yearId } = input;
  if (!locator) return noPlanningTarget;

  if (locator.kind === "calendarEvent") {
    const event = await requireCalendarEvent(userId, locator.eventId);
    assertActive(event, "Calendar event");
    assertSameYear("Lecture recording calendar event", yearId, event.yearId);
    return {
      calendarEventId: event.id,
      timetableOccurrenceId: null,
      subjectId: event.subjectId,
      pendingOccurrence: null,
    };
  }

  if (locator.kind === "timetableOccurrence") {
    const occurrence = await requireTimetableOccurrence(
      userId,
      locator.occurrenceId,
    );
    assertRecordableOccurrence(occurrence);
    assertSameYear(
      "Lecture recording timetable occurrence",
      yearId,
      occurrence.yearId,
    );
    return {
      calendarEventId: null,
      timetableOccurrenceId: occurrence.id,
      subjectId: occurrence.subjectId,
      pendingOccurrence: null,
    };
  }

  const series = await requireTimetableSeries(userId, locator.seriesId);
  assertActive(series, "Timetable series");
  assertSameYear("Lecture recording timetable series", yearId, series.yearId);
  const candidate = occurrenceFromSeries(series, locator.occurrenceDate);
  const [occurrence] = await db
    .select()
    .from(timetableOccurrences)
    .where(
      and(
        eq(timetableOccurrences.userId, userId),
        eq(timetableOccurrences.yearId, yearId),
        eq(timetableOccurrences.seriesId, series.id),
        eq(timetableOccurrences.occurrenceDate, locator.occurrenceDate),
      ),
    )
    .limit(1);
  if (occurrence) {
    assertRecordableOccurrence(occurrence);
    return {
      calendarEventId: null,
      timetableOccurrenceId: occurrence.id,
      subjectId: occurrence.subjectId,
      pendingOccurrence: null,
    };
  }
  return {
    calendarEventId: null,
    timetableOccurrenceId: null,
    subjectId: candidate.subjectId,
    pendingOccurrence: candidate,
  };
}

async function segmentView(userId: string, recordingId: string, seq: number) {
  const [row] = await db
    .select({
      id: recordingSegments.id,
      recordingId: recordingSegments.recordingId,
      seq: recordingSegments.seq,
      startOffsetMs: recordingSegments.startOffsetMs,
      durationMs: recordingSegments.durationMs,
      transcriptStatus: recordingSegments.transcriptStatus,
      transcriptError: recordingSegments.transcriptError,
      createdAt: recordingSegments.createdAt,
      updatedAt: recordingSegments.updatedAt,
      fileId: files.id,
      fileProvider: files.provider,
      fileStorageKey: files.storageKey,
      fileUrl: files.url,
      fileMimeType: files.mimeType,
      fileByteSize: files.byteSize,
    })
    .from(recordingSegments)
    .innerJoin(
      files,
      and(
        eq(files.id, recordingSegments.fileId),
        eq(files.userId, userId),
        eq(files.status, "stored"),
      ),
    )
    .where(
      and(
        eq(recordingSegments.userId, userId),
        eq(recordingSegments.recordingId, recordingId),
        eq(recordingSegments.seq, seq),
      ),
    )
    .limit(1);
  if (!row) return null;
  const {
    fileId,
    fileProvider,
    fileStorageKey,
    fileUrl,
    fileMimeType,
    fileByteSize,
    ...segment
  } = row;
  return {
    ...segment,
    file: {
      id: fileId,
      url: await fileAccessUrl(
        {
          provider: fileProvider,
          storageKey: fileStorageKey,
          url: fileUrl,
        },
        { expiresIn: "6h" },
      ),
      mimeType: fileMimeType,
      byteSize: fileByteSize,
    },
  };
}

async function allSegmentViews(userId: string, recordingId: string) {
  const rows = await db
    .select({
      id: recordingSegments.id,
      recordingId: recordingSegments.recordingId,
      seq: recordingSegments.seq,
      startOffsetMs: recordingSegments.startOffsetMs,
      durationMs: recordingSegments.durationMs,
      transcriptStatus: recordingSegments.transcriptStatus,
      transcriptError: recordingSegments.transcriptError,
      createdAt: recordingSegments.createdAt,
      updatedAt: recordingSegments.updatedAt,
      fileId: files.id,
      fileProvider: files.provider,
      fileStorageKey: files.storageKey,
      fileUrl: files.url,
      fileMimeType: files.mimeType,
      fileByteSize: files.byteSize,
    })
    .from(recordingSegments)
    .innerJoin(
      files,
      and(
        eq(files.id, recordingSegments.fileId),
        eq(files.userId, userId),
        eq(files.status, "stored"),
      ),
    )
    .where(
      and(
        eq(recordingSegments.userId, userId),
        eq(recordingSegments.recordingId, recordingId),
      ),
    )
    .orderBy(asc(recordingSegments.seq));
  return Promise.all(
    rows.map(async (row) => {
      const {
        fileId,
        fileProvider,
        fileStorageKey,
        fileUrl,
        fileMimeType,
        fileByteSize,
        ...segment
      } = row;
      return {
        ...segment,
        file: {
          id: fileId,
          url: await fileAccessUrl(
            {
              provider: fileProvider,
              storageKey: fileStorageKey,
              url: fileUrl,
            },
            { expiresIn: "6h" },
          ),
          mimeType: fileMimeType,
          byteSize: fileByteSize,
        },
      };
    }),
  );
}

async function validateScope(input: {
  userId: string;
  yearId: string;
  subjectId: string | null;
  folderId: string | null;
}) {
  await requireYear(input.userId, input.yearId);
  let folder: typeof materialFolders.$inferSelect | null = null;
  if (input.folderId) {
    folder = await requireLiveMaterialFolder(input.userId, input.folderId);
    assertSameYear("Lecture recording folder", input.yearId, folder.yearId);
  }
  if (input.subjectId) {
    const subject = await requireSubject(input.userId, input.subjectId);
    assertSameYear("Lecture recording subject", input.yearId, subject.yearId);
  }
  if (
    folder?.subjectId &&
    input.subjectId &&
    folder.subjectId !== input.subjectId
  ) {
    badRequest("Lecture recording folder and subject must match");
  }
  return { subjectId: input.subjectId ?? folder?.subjectId ?? null };
}

async function candidateWasAdopted(
  userId: string,
  recordingId: string,
  seq: number,
  fileId: string,
) {
  const [reference] = await db
    .select({ id: recordingSegments.id })
    .from(recordingSegments)
    .where(
      and(
        eq(recordingSegments.userId, userId),
        eq(recordingSegments.recordingId, recordingId),
        eq(recordingSegments.seq, seq),
        eq(recordingSegments.fileId, fileId),
      ),
    )
    .limit(1);
  return Boolean(reference);
}

async function appendCandidateAtomically(input: {
  segmentId: string;
  recordingId: string;
  userId: string;
  seq: number;
  fileId: string;
  cleanupJobId: string;
  durationMs: number;
}) {
  const now = Math.floor(Date.now() / 1_000);
  const statements = [
    {
      sql: `INSERT OR IGNORE INTO "recording_segments" ("id", "recordingId", "seq", "fileId", "startOffsetMs", "durationMs", "transcriptStatus", "transcriptError", "userId", "createdAt", "updatedAt") SELECT ?, "id", ?, ?, "durationMs", ?, 'pending', NULL, ?, ?, ? FROM "lecture_recordings" WHERE "id" = ? AND "userId" = ? AND "status" = 'recording' AND EXISTS (SELECT 1 FROM "files" WHERE "id" = ? AND "userId" = ? AND "purpose" = 'lecture-audio-segment' AND "status" = 'stored') AND ? = (SELECT COUNT(*) FROM "recording_segments" WHERE "recordingId" = ? AND "userId" = ?) AND (SELECT COALESCE(SUM("durationMs"), 0) FROM "recording_segments" WHERE "recordingId" = ? AND "userId" = ?) = "durationMs" AND NOT EXISTS (SELECT 1 FROM "recording_segments" AS current_segment WHERE current_segment."recordingId" = ? AND current_segment."userId" = ? AND current_segment."startOffsetMs" != (SELECT COALESCE(SUM(previous_segment."durationMs"), 0) FROM "recording_segments" AS previous_segment WHERE previous_segment."recordingId" = current_segment."recordingId" AND previous_segment."seq" < current_segment."seq")) AND "durationMs" + ? <= ?`,
      args: [
        input.segmentId,
        input.seq,
        input.fileId,
        input.durationMs,
        input.userId,
        now,
        now,
        input.recordingId,
        input.userId,
        input.fileId,
        input.userId,
        input.seq,
        input.recordingId,
        input.userId,
        input.recordingId,
        input.userId,
        input.recordingId,
        input.userId,
        input.durationMs,
        MAX_RECORDING_DURATION_MS,
      ],
    },
    {
      sql: `UPDATE "jobs" SET "status" = 'cancelled', "error" = NULL, "updatedAt" = ? WHERE "id" = ? AND "kind" = ? AND "userId" = ? AND "status" = 'queued' AND EXISTS (SELECT 1 FROM "recording_segments" WHERE "id" = ? AND "fileId" = ?)`,
      args: [
        now,
        input.cleanupJobId,
        CLEANUP_UNOWNED_FILE_JOB_KIND,
        input.userId,
        input.segmentId,
        input.fileId,
      ],
    },
    {
      sql: `INSERT INTO "jobs" ("id", "kind", "payloadVersion", "status", "attempts", "maxAttempts", "runAt", "userId", "createdAt", "updatedAt") SELECT NULL, '__recording_cleanup_guard__', 1, 'failed', 0, 1, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM "recording_segments" WHERE "id" = ? AND "fileId" = ?) AND NOT EXISTS (SELECT 1 FROM "jobs" WHERE "id" = ? AND "kind" = ? AND "userId" = ? AND "status" = 'cancelled')`,
      args: [
        now,
        input.userId,
        now,
        now,
        input.segmentId,
        input.fileId,
        input.cleanupJobId,
        CLEANUP_UNOWNED_FILE_JOB_KIND,
        input.userId,
      ],
    },
    {
      sql: `UPDATE "lecture_recordings" SET "durationMs" = "durationMs" + ?, "updatedAt" = ? WHERE "id" = ? AND "userId" = ? AND "status" = 'recording' AND EXISTS (SELECT 1 FROM "recording_segments" WHERE "id" = ? AND "recordingId" = "lecture_recordings"."id" AND "fileId" = ? AND "startOffsetMs" = "lecture_recordings"."durationMs")`,
      args: [
        input.durationMs,
        now,
        input.recordingId,
        input.userId,
        input.segmentId,
        input.fileId,
      ],
    },
    {
      sql: `INSERT INTO "jobs" ("id", "kind", "payloadVersion", "status", "attempts", "maxAttempts", "runAt", "userId", "createdAt", "updatedAt") SELECT NULL, '__recording_append_guard__', 1, 'failed', 0, 1, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM "recording_segments" WHERE "id" = ? AND "fileId" = ?) AND changes() = 0`,
      args: [now, input.userId, now, now, input.segmentId, input.fileId],
    },
  ];
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await db.$client.batch(statements, "write");
      return;
    } catch (error) {
      lastError = error;
      if (!String(error).includes("SQLITE_BUSY") || attempt === 3) throw error;
      await new Promise<void>((resolve) =>
        setTimeout(resolve, 10 * 2 ** attempt),
      );
    }
  }
  throw lastError;
}

async function beginFailedTranscriptionRetry(input: {
  recordingId: string;
  userId: string;
  previousRunId: string | null;
  nextRunId: string;
  segmentIds: readonly string[];
}) {
  const now = Math.floor(Date.now() / 1_000);
  const statements = [
    {
      sql: `UPDATE "lecture_recordings" SET "status" = 'transcribing', "error" = NULL, "transcriptionRunId" = ?, "updatedAt" = ? WHERE "id" = ? AND "userId" = ? AND "status" = 'failed' AND "transcriptionRunId" IS ?`,
      args: [
        input.nextRunId,
        now,
        input.recordingId,
        input.userId,
        input.previousRunId,
      ],
    },
    {
      sql: `INSERT INTO "jobs" ("id", "kind", "payloadVersion", "status", "attempts", "maxAttempts", "runAt", "userId", "createdAt", "updatedAt") SELECT NULL, '__recording_retry_generation_guard__', 1, 'failed', 0, 1, ?, ?, ?, ? WHERE changes() = 0`,
      args: [now, input.userId, now, now],
    },
    ...(input.previousRunId
      ? [
          {
            // The generation CAS and stale lease purge share one SQLite batch.
            // A completion that wins first is reusable; otherwise its running
            // row disappears before the new generation becomes visible.
            sql: `DELETE FROM "jobs" WHERE "userId" = ? AND "status" != 'succeeded' AND (("kind" = ? AND "idempotencyKey" LIKE ?) OR ("kind" = ? AND "idempotencyKey" IN (${input.segmentIds.map(() => "?").join(", ")})))`,
            args: [
              input.userId,
              TRANSCRIBE_FINALIZE_JOB_KIND,
              `${input.recordingId}:${input.previousRunId}:%`,
              TRANSCRIBE_SEGMENT_JOB_KIND,
              ...input.segmentIds.map(
                (segmentId) => `${segmentId}:${input.previousRunId}`,
              ),
            ],
          },
        ]
      : []),
    {
      sql: `UPDATE "recording_segments" SET "transcriptStatus" = 'pending', "transcriptError" = NULL, "updatedAt" = ? WHERE "recordingId" = ? AND "userId" = ? AND "transcriptStatus" = 'failed' AND EXISTS (SELECT 1 FROM "lecture_recordings" WHERE "id" = ? AND "userId" = ? AND "status" = 'transcribing' AND "transcriptionRunId" = ?)`,
      args: [
        now,
        input.recordingId,
        input.userId,
        input.recordingId,
        input.userId,
        input.nextRunId,
      ],
    },
  ];
  await db.$client.batch(statements, "write");
}

export function createRecordingsRouter(
  dependencies: RecordingsRouterDependencies = {},
) {
  const saveFile = dependencies.storeFile ?? storeFile;
  const removeFile = dependencies.deleteFile ?? deleteFile;
  const queueJob = dependencies.enqueueJob ?? enqueueJob;
  const canUpload = dependencies.storageEnabled ?? storageEnabled;
  const canTranscribe =
    dependencies.transcriptionEnabled ?? transcriptionEnabled;

  return {
    capabilities: protectedProcedure.handler(async ({ context }) => ({
      uploadsEnabled: canUpload(),
      transcriptionEnabled: await canTranscribe(context.session.user.id),
      maxSegments: MAX_RECORDING_SEGMENTS,
      maxDurationMs: MAX_RECORDING_DURATION_MS,
      maxSegmentDurationMs: MAX_RECORDING_SEGMENT_DURATION_MS,
    })),

    start: protectedProcedure
      .input(
        z
          .object({
            yearId: idSchema,
            title: titleSchema,
            recordedAt: z.coerce.date().optional(),
            subjectId: idSchema.nullable().default(null),
            folderId: idSchema.nullable().default(null),
            planningLocator: startPlanningLocatorSchema
              .nullable()
              .default(null),
          })
          .strict(),
      )
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const scope = await validateScope({ userId, ...input });
        const planningTarget = await resolvePlanningTarget({
          userId,
          yearId: input.yearId,
          locator: input.planningLocator,
        });
        if (
          scope.subjectId &&
          planningTarget.subjectId &&
          scope.subjectId !== planningTarget.subjectId
        ) {
          badRequest("Lecture recording and Planning subjects must match");
        }
        const subjectId = scope.subjectId ?? planningTarget.subjectId;
        if (subjectId && subjectId !== scope.subjectId) {
          const subject = await requireSubject(userId, subjectId);
          assertSameYear(
            "Lecture recording Planning subject",
            input.yearId,
            subject.yearId,
          );
        }
        await dependencies.afterScopeValidated?.();
        const recordingId = newId("rec");
        const created = await db.transaction(async (tx) => {
          const [ownedYear] = await tx
            .select({ id: years.id })
            .from(years)
            .where(and(eq(years.id, input.yearId), eq(years.userId, userId)))
            .limit(1);
          if (!ownedYear)
            badRequest("The lecture recording year is unavailable");

          if (subjectId) {
            const [subject] = await tx
              .select({ id: subjects.id })
              .from(subjects)
              .where(
                and(
                  eq(subjects.id, subjectId),
                  eq(subjects.userId, userId),
                  eq(subjects.yearId, input.yearId),
                ),
              )
              .limit(1);
            if (!subject) {
              badRequest("The lecture recording subject is unavailable");
            }
          }

          if (input.folderId) {
            const [folder] = await tx
              .select()
              .from(materialFolders)
              .where(
                and(
                  eq(materialFolders.id, input.folderId),
                  eq(materialFolders.userId, userId),
                  eq(materialFolders.yearId, input.yearId),
                ),
              )
              .limit(1);
            if (
              !folder ||
              (folder.subjectId !== null && folder.subjectId !== subjectId)
            ) {
              badRequest("The lecture recording folder is unavailable");
            }
          }

          let calendarEventId = planningTarget.calendarEventId;
          let timetableOccurrenceId = planningTarget.timetableOccurrenceId;
          if (planningTarget.pendingOccurrence) {
            const [series] = await tx
              .select()
              .from(timetableSeries)
              .where(
                and(
                  eq(
                    timetableSeries.id,
                    planningTarget.pendingOccurrence.seriesId,
                  ),
                  eq(timetableSeries.userId, userId),
                  eq(timetableSeries.yearId, input.yearId),
                ),
              )
              .limit(1);
            if (!series) badRequest("The timetable series is unavailable");
            assertActive(series, "Timetable series");
            const candidate = occurrenceFromSeries(
              series,
              planningTarget.pendingOccurrence.occurrenceDate,
            );
            await tx
              .insert(timetableOccurrences)
              .values(candidate)
              .onConflictDoNothing();
            const [occurrence] = await tx
              .select()
              .from(timetableOccurrences)
              .where(
                and(
                  eq(timetableOccurrences.userId, userId),
                  eq(timetableOccurrences.yearId, input.yearId),
                  eq(timetableOccurrences.seriesId, series.id),
                  eq(
                    timetableOccurrences.occurrenceDate,
                    planningTarget.pendingOccurrence.occurrenceDate,
                  ),
                ),
              )
              .limit(1);
            if (!occurrence) {
              badRequest("The timetable occurrence could not be materialized");
            }
            assertRecordableOccurrence(occurrence);
            timetableOccurrenceId = occurrence.id;
          }

          if (calendarEventId) {
            const [event] = await tx
              .select()
              .from(calendarEvents)
              .where(
                and(
                  eq(calendarEvents.id, calendarEventId),
                  eq(calendarEvents.userId, userId),
                  eq(calendarEvents.yearId, input.yearId),
                ),
              )
              .limit(1);
            if (!event) badRequest("The calendar event is unavailable");
            assertActive(event, "Calendar event");
            if (event.subjectId !== planningTarget.subjectId) {
              badRequest("The calendar event changed; try again");
            }
          }

          if (timetableOccurrenceId) {
            const [occurrence] = await tx
              .select()
              .from(timetableOccurrences)
              .where(
                and(
                  eq(timetableOccurrences.id, timetableOccurrenceId),
                  eq(timetableOccurrences.userId, userId),
                  eq(timetableOccurrences.yearId, input.yearId),
                ),
              )
              .limit(1);
            if (!occurrence) {
              badRequest("The timetable occurrence is unavailable");
            }
            assertRecordableOccurrence(occurrence);
            if (occurrence.subjectId !== planningTarget.subjectId) {
              badRequest("The timetable occurrence changed; try again");
            }
          }

          const [recording] = await tx
            .insert(lectureRecordings)
            .values({
              id: recordingId,
              title: input.title,
              status: "recording",
              recordedAt: input.recordedAt ?? new Date(),
              durationMs: 0,
              subjectId,
              folderId: input.folderId,
              calendarEventId,
              timetableOccurrenceId,
              yearId: input.yearId,
              userId,
            })
            .returning();
          if (!recording) {
            badRequest("The lecture recording could not be started");
          }
          return recording;
        });
        return publicRecording(created);
      }),

    appendSegment: protectedProcedure
      .input(
        z
          .object({
            recordingId: idSchema,
            seq: z
              .number()
              .int()
              .min(0)
              .max(MAX_RECORDING_SEGMENTS - 1),
            durationMs: z
              .number()
              .int()
              .min(1)
              .max(MAX_RECORDING_SEGMENT_DURATION_MS),
            file: z.instanceof(File).optional(),
            fileId: idSchema.optional(),
          })
          .refine((input) => Boolean(input.file) !== Boolean(input.fileId), {
            message: "Provide exactly one lecture segment upload",
          })
          .strict(),
      )
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const recording = await requireRecording(userId, input.recordingId);
        if (input.file) {
          validateFileForPurpose("lecture-audio-segment", input.file);
        }
        const replay = await segmentView(userId, recording.id, input.seq);
        if (replay) return { segment: replay, replayed: true };
        if (recording.status !== "recording") {
          badRequest("Only an active recording accepts audio segments");
        }

        const candidate = input.fileId
          ? await requireUploadedFile(
              userId,
              input.fileId,
              "lecture-audio-segment",
            )
          : await saveFile({
              userId,
              purpose: "lecture-audio-segment",
              file: input.file!,
              nameHint: `${recording.title}-${input.seq + 1}`,
            });
        let cleanupJob: Awaited<ReturnType<EnqueueJob>>;
        try {
          cleanupJob = await queueJob({
            kind: CLEANUP_UNOWNED_FILE_JOB_KIND,
            payload: { userId, fileId: candidate.id },
            userId,
            idempotencyKey: candidate.id,
            runAt: new Date(Date.now() + 60_000),
            maxAttempts: 6,
          });
          await dependencies.afterCleanupArmed?.(cleanupJob.id);
        } catch (error) {
          // The candidate is not adopted yet, so a best-effort strict removal
          // is safe if the durable cleanup ledger itself cannot be written.
          await removeFile(userId, candidate.id, {
            deferOnProviderFailure: false,
          }).catch(() => undefined);
          throw error;
        }
        let adopted = false;
        let cleanupRecorded = false;
        const recordCleanup = async () => {
          if (cleanupRecorded) return;
          await recordUnownedFileCleanup(userId, candidate.id, removeFile);
          cleanupRecorded = true;
        };
        try {
          await appendCandidateAtomically({
            segmentId: newId("rseg"),
            recordingId: recording.id,
            userId,
            seq: input.seq,
            fileId: candidate.id,
            cleanupJobId: cleanupJob.id,
            durationMs: input.durationMs,
          });
          await dependencies.afterAppendCommit?.();
          adopted = await candidateWasAdopted(
            userId,
            recording.id,
            input.seq,
            candidate.id,
          );
          const segment = await segmentView(userId, recording.id, input.seq);
          if (!segment) {
            const current = await requireRecording(userId, recording.id);
            const existing = await db
              .select()
              .from(recordingSegments)
              .where(
                and(
                  eq(recordingSegments.recordingId, recording.id),
                  eq(recordingSegments.userId, userId),
                ),
              )
              .orderBy(asc(recordingSegments.seq));
            await recordCleanup();
            if (current.status !== "recording") {
              badRequest("Only an active recording accepts audio segments");
            }
            if (existing.length >= MAX_RECORDING_SEGMENTS) {
              badRequest("A lecture recording cannot exceed 24 segments");
            }
            if (
              current.durationMs + input.durationMs >
              MAX_RECORDING_DURATION_MS
            ) {
              badRequest("A lecture recording cannot exceed 4 hours");
            }
            badRequest("Lecture segments must be appended in sequence");
          }
          if (!adopted) {
            await recordCleanup();
          }
          return { segment, replayed: !adopted };
        } catch (error) {
          if (
            await candidateWasAdopted(
              userId,
              recording.id,
              input.seq,
              candidate.id,
            )
          ) {
            adopted = true;
            const segment = await segmentView(userId, recording.id, input.seq);
            if (segment) return { segment, replayed: false };
          }
          if (!adopted) {
            await recordCleanup();
          }
          throw error;
        }
      }),

    finish: protectedProcedure
      .input(z.object({ recordingId: idSchema }).strict())
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const recording = await requireRecording(userId, input.recordingId);
        if (recording.status === "uploaded") return publicRecording(recording);
        if (recording.status !== "recording") {
          badRequest("Only an active recording can be finished");
        }
        const [firstSegment] = await db
          .select({ id: recordingSegments.id })
          .from(recordingSegments)
          .where(eq(recordingSegments.recordingId, recording.id))
          .limit(1);
        if (!firstSegment) badRequest("Add an audio segment before finishing");
        const [finished] = await db
          .update(lectureRecordings)
          .set({ status: "uploaded", error: null, updatedAt: new Date() })
          .where(
            and(
              eq(lectureRecordings.id, recording.id),
              eq(lectureRecordings.userId, userId),
              eq(lectureRecordings.status, "recording"),
            ),
          )
          .returning();
        if (!finished)
          badRequest("The lecture recording changed before finish");
        return publicRecording(finished);
      }),

    list: protectedProcedure
      .input(
        z
          .object({
            yearId: idSchema,
            include: z.enum(["live", "trashed"]).default("live"),
          })
          .strict(),
      )
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        await requireYear(userId, input.yearId);
        const rows = await db
          .select(publicRecordingFields)
          .from(lectureRecordings)
          .where(
            and(
              eq(lectureRecordings.userId, userId),
              eq(lectureRecordings.yearId, input.yearId),
              input.include === "trashed"
                ? isNotNull(lectureRecordings.deletedAt)
                : isNull(lectureRecordings.deletedAt),
            ),
          )
          .orderBy(
            desc(lectureRecordings.recordedAt),
            desc(lectureRecordings.id),
          );
        const tagIds = await materialTagIdsByTarget({
          userId,
          yearId: input.yearId,
          targetKind: "recording",
          targetIds: rows.map((row) => row.id),
        });
        return rows.map((row) => ({
          ...publicRecording(row),
          tagIds: tagIds.get(row.id) ?? [],
        }));
      }),

    get: protectedProcedure
      .input(z.object({ recordingId: idSchema }).strict())
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const recording = await requireRecording(userId, input.recordingId);
        const [segments, transcriptRows] = await Promise.all([
          allSegmentViews(userId, recording.id),
          db
            .select({
              text: recordingTranscripts.text,
              segmentsVersion: recordingTranscripts.segmentsVersion,
              segments: recordingTranscripts.segmentsJson,
              language: recordingTranscripts.language,
              provider: recordingTranscripts.provider,
              model: recordingTranscripts.model,
              createdAt: recordingTranscripts.createdAt,
              updatedAt: recordingTranscripts.updatedAt,
            })
            .from(recordingTranscripts)
            .where(
              and(
                eq(recordingTranscripts.recordingId, recording.id),
                eq(recordingTranscripts.userId, userId),
              ),
            )
            .limit(1),
        ]);
        return {
          recording: publicRecording(recording),
          segments,
          transcript: transcriptRows[0] ?? null,
        };
      }),

    delete: protectedProcedure
      .input(z.object({ recordingId: idSchema }).strict())
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const recording = await requireRecording(userId, input.recordingId);
        if (!recording.deletedAt) {
          await trashMaterialTarget(userId, "recording", recording.id);
          return { ok: true as const, cleanupJobIds: [] };
        }
        const [fenced] = await db
          .update(lectureRecordings)
          .set({
            status: "deleting",
            error: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(lectureRecordings.id, recording.id),
              eq(lectureRecordings.userId, userId),
            ),
          )
          .returning({ id: lectureRecordings.id });
        if (!fenced) badRequest("The lecture recording changed before delete");

        // The deleting-status fence serializes with append/finalize writes. Any
        // append that committed first is included below; a later one cannot be
        // adopted and records cleanup for its own upload candidate.
        const segments = await db
          .select({
            id: recordingSegments.id,
            fileId: recordingSegments.fileId,
          })
          .from(recordingSegments)
          .where(
            and(
              eq(recordingSegments.recordingId, recording.id),
              eq(recordingSegments.userId, userId),
            ),
          );
        const segmentIds = segments.map((segment) => segment.id);
        await purgeRecordingTranscriptionJobs({
          userId,
          recordingId: recording.id,
          segmentIds,
        });
        const cleanupBatchId = newId("cleanup");
        const cleanupJobs = await Promise.all(
          segments.map((segment) =>
            queueJob({
              kind: CLEANUP_UNOWNED_FILE_JOB_KIND,
              payload: { userId, fileId: segment.fileId },
              userId,
              // A previous delete attempt may have left a succeeded
              // `referenced:true` cleanup job. A per-attempt ledger key keeps
              // this retry durable while the underlying deletion stays
              // idempotent.
              idempotencyKey: `${segment.fileId}:${cleanupBatchId}`,
              runAt: new Date(Date.now() + 60_000),
              maxAttempts: 6,
            }),
          ),
        );
        await db.batch([
          db
            .delete(materialTagLinks)
            .where(
              and(
                eq(materialTagLinks.targetKind, "recording"),
                eq(materialTagLinks.targetId, recording.id),
              ),
            ),
          db
            .delete(lectureRecordings)
            .where(
              and(
                eq(lectureRecordings.id, recording.id),
                eq(lectureRecordings.userId, userId),
              ),
            ),
        ]);
        // A transcribe call that crossed the fence performs the same purge on
        // its side. Repeating it here closes the window for jobs enqueued
        // between the first purge and the domain cascade.
        await purgeRecordingTranscriptionJobs({
          userId,
          recordingId: recording.id,
          segmentIds,
        });
        await Promise.all(
          segments.map((segment) =>
            removeFile(userId, segment.fileId, {
              deferOnProviderFailure: false,
            }).catch(() => undefined),
          ),
        );
        return {
          ok: true as const,
          cleanupJobIds: cleanupJobs.map((job) => job.id),
        };
      }),

    transcribe: protectedProcedure
      .input(z.object({ recordingId: idSchema }).strict())
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const recording = await requireRecording(userId, input.recordingId);
        if (!(await canTranscribe(userId))) {
          badRequest("Transcription is not configured for this account");
        }
        if (
          recording.status !== "uploaded" &&
          recording.status !== "transcribing" &&
          recording.status !== "failed"
        ) {
          badRequest("Only an uploaded or failed recording can be transcribed");
        }
        const segments = await db
          .select({
            id: recordingSegments.id,
            seq: recordingSegments.seq,
            transcriptStatus: recordingSegments.transcriptStatus,
            fileStatus: files.status,
            filePurpose: files.purpose,
          })
          .from(recordingSegments)
          .innerJoin(
            files,
            and(
              eq(files.id, recordingSegments.fileId),
              eq(files.userId, userId),
            ),
          )
          .where(
            and(
              eq(recordingSegments.recordingId, recording.id),
              eq(recordingSegments.userId, userId),
            ),
          )
          .orderBy(asc(recordingSegments.seq));
        if (segments.length === 0) {
          badRequest("The lecture recording has no audio segments");
        }
        if (
          segments.some(
            (segment, index) =>
              segment.seq !== index ||
              segment.fileStatus !== "stored" ||
              segment.filePurpose !== "lecture-audio-segment",
          )
        ) {
          badRequest("The lecture recording has an unavailable audio segment");
        }
        let runId = recording.transcriptionRunId;
        if (recording.status === "uploaded" || recording.status === "failed") {
          const nextRunId = newId("trun");
          let transitioned = false;
          let transitionError: unknown;
          if (recording.status === "failed") {
            try {
              await beginFailedTranscriptionRetry({
                recordingId: recording.id,
                userId,
                previousRunId: recording.transcriptionRunId,
                nextRunId,
                segmentIds: segments.map((segment) => segment.id),
              });
              transitioned = true;
              runId = nextRunId;
            } catch (error) {
              transitionError = error;
            }
          } else {
            const [updated] = await db
              .update(lectureRecordings)
              .set({
                status: "transcribing",
                error: null,
                transcriptionRunId: nextRunId,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(lectureRecordings.id, recording.id),
                  eq(lectureRecordings.userId, userId),
                  eq(lectureRecordings.status, "uploaded"),
                ),
              )
              .returning({ runId: lectureRecordings.transcriptionRunId });
            if (updated?.runId) {
              transitioned = true;
              runId = updated.runId;
            }
          }
          if (!transitioned) {
            const current = await requireRecording(userId, recording.id);
            if (
              current.status !== "transcribing" ||
              !current.transcriptionRunId
            ) {
              if (
                transitionError &&
                current.status === recording.status &&
                current.transcriptionRunId === recording.transcriptionRunId
              ) {
                throw transitionError;
              }
              badRequest("The lecture recording changed before transcription");
            }
            runId = current.transcriptionRunId;
          }
        }
        if (!runId) {
          badRequest("The transcription execution could not be initialized");
        }
        const queued = await enqueueRecordingTranscription(
          {
            userId,
            recordingId: recording.id,
            runId,
            segmentIds: segments.map((segment) => segment.id),
          },
          { enqueue: queueJob },
        );
        await dependencies.afterTranscriptionEnqueued?.(runId);
        const [current] = await db
          .select({
            status: lectureRecordings.status,
            runId: lectureRecordings.transcriptionRunId,
          })
          .from(lectureRecordings)
          .where(
            and(
              eq(lectureRecordings.id, recording.id),
              eq(lectureRecordings.userId, userId),
            ),
          )
          .limit(1);
        if (
          !current ||
          current.status !== "transcribing" ||
          current.runId !== runId
        ) {
          await purgeRecordingTranscriptionJobs({
            userId,
            recordingId: recording.id,
            segmentIds: segments.map((segment) => segment.id),
            runId,
          });
          if (!current) await requireRecording(userId, recording.id);
          badRequest("The lecture recording changed before transcription");
        }
        return {
          recordingId: recording.id,
          status: "transcribing" as const,
          runId,
          ...queued,
        };
      }),
  };
}

export const recordingsRouter = createRecordingsRouter();
