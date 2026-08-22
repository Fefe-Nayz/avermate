import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from "bun:test";
import { createRouterClient } from "@orpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// This file exercises real SQLite transactions, storage ledgers and job
// reconciliation. Keep a bounded integration-test budget that tolerates a
// concurrently running development server without turning stalls infinite.
setDefaultTimeout(15_000);

const sharedTestDatabase = join(
  tmpdir(),
  `avermate-recordings-${process.pid}.db`,
).replaceAll("\\", "/");
process.env.DATABASE_URL = `file:${sharedTestDatabase}`;
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret-that-is-at-least-32-chars";
process.env.CLIENT_URL = "http://localhost:3001";
process.env.NODE_ENV = "test";
process.env.DISABLE_EMAIL = "true";
process.env.DISABLE_UPLOADS = "true";
process.env.DISABLE_JOBS = "true";
process.env.DISABLE_TRANSCRIPTION = "false";
delete process.env.TRANSCRIPTION_API_KEY;

const migrationDirectory = join(import.meta.dir, "../../drizzle");
const migration = readdirSync(migrationDirectory)
  .filter((file) => /^\d+.*\.sql$/.test(file))
  .sort((left, right) => left.localeCompare(right))
  .map((file) => readFileSync(join(migrationDirectory, file), "utf8"))
  .join("\n");
// Applying the complete migration history through 0060 and releasing its
// relational fixtures can take about 90s on slower Windows/libSQL runners.
const databaseHookTimeout = 120_000;

type StoreFile = typeof import("../lib/storage").storeFile;
type DeleteFile = typeof import("../lib/storage").deleteFile;
type TestRouter = {
  recordings: ReturnType<
    (typeof import("./recordings"))["createRecordingsRouter"]
  >;
};
type Api = ReturnType<
  typeof createRouterClient<TestRouter, Record<never, never>>
>;

let database: typeof import("../db").db;
let schema: typeof import("../db/schema");
let apiA: Api;
let apiB: Api;

const userA = "recordings-user-a";
const userB = "recordings-user-b";
const yearA = "recordings-year-a";
const yearAOther = "recordings-year-a-other";
const yearB = "recordings-year-b";
const subjectA = "recordings-subject-a";
const subjectAOther = "recordings-subject-a-other";
const subjectOtherYear = "recordings-subject-other-year";
const folderA = "recordings-folder-a";
const folderOtherYear = "recordings-folder-other-year";

const storedBodies = new Map<string, Uint8Array>();
const storedFileIds: string[] = [];
const deletedFileIds: string[] = [];

let storeBehavior: StoreFile;
let deleteBehavior: DeleteFile;
let afterAppendCommit: () => Promise<void> | void = () => undefined;
let afterCleanupArmed: (jobId: string) => Promise<void> | void = () =>
  undefined;
let afterScopeValidated: () => Promise<void> | void = () => undefined;
let afterTranscriptionEnqueued: (runId: string) => Promise<void> | void = () =>
  undefined;

function sessionFor(id: string) {
  const now = new Date("2026-08-01T00:00:00.000Z");
  return {
    user: {
      id,
      name: id,
      email: `${id}@example.com`,
      emailVerified: true,
      image: null,
      role: "user",
      banned: false,
      banReason: null,
      banExpires: null,
      createdAt: now,
      updatedAt: now,
    },
    session: {
      id: `session-${id}`,
      token: `token-${id}`,
      userId: id,
      expiresAt: new Date("2027-12-01T00:00:00.000Z"),
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: null,
      impersonatedBy: null,
    },
  };
}

const persistFile: StoreFile = async ({ userId, purpose, file }) => {
  expect(purpose).toBe("lecture-audio-segment");
  const suffix = crypto.randomUUID();
  const url = `https://example.invalid/recording/${suffix}`;
  const body = new Uint8Array(await file.arrayBuffer());
  const [stored] = await database
    .insert(schema.files)
    .values({
      provider: "test",
      storageKey: `recording-test-${suffix}`,
      url,
      mimeType: file.type,
      byteSize: file.size,
      purpose,
      userId,
    })
    .returning();
  if (!stored) throw new Error("The recording fixture file was not stored");
  storedBodies.set(url, body);
  storedFileIds.push(stored.id);
  return stored;
};

const softDeleteFile: DeleteFile = async (userId, fileId) => {
  const [deleted] = await database
    .update(schema.files)
    .set({ status: "deleted", updatedAt: new Date() })
    .where(and(eq(schema.files.id, fileId), eq(schema.files.userId, userId)))
    .returning();
  if (!deleted) throw new Error("Recording fixture file not found");
  deletedFileIds.push(fileId);
  return deleted;
};

beforeAll(async () => {
  ({ db: database, schema } = await import("../db"));
  const migrated = await database.$client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
  );
  if (migrated.rows.length === 0) {
    await database.$client.executeMultiple(migration);
  }

  const now = new Date("2026-08-01T00:00:00.000Z");
  await database
    .insert(schema.users)
    .values([
      {
        id: userA,
        name: "Recording user A",
        email: "recording-a@example.com",
        emailVerified: true,
        role: "user",
        banned: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: userB,
        name: "Recording user B",
        email: "recording-b@example.com",
        emailVerified: true,
        role: "user",
        banned: false,
        createdAt: now,
        updatedAt: now,
      },
    ])
    .onConflictDoNothing();
  await database
    .insert(schema.years)
    .values([
      {
        id: yearA,
        name: "Recording year A",
        startsAt: new Date("2026-09-01T00:00:00.000Z"),
        endsAt: new Date("2027-07-01T00:00:00.000Z"),
        userId: userA,
      },
      {
        id: yearAOther,
        name: "Recording other year A",
        startsAt: new Date("2027-09-01T00:00:00.000Z"),
        endsAt: new Date("2028-07-01T00:00:00.000Z"),
        userId: userA,
      },
      {
        id: yearB,
        name: "Recording year B",
        startsAt: new Date("2026-09-01T00:00:00.000Z"),
        endsAt: new Date("2027-07-01T00:00:00.000Z"),
        userId: userB,
      },
    ])
    .onConflictDoNothing();
  await database
    .insert(schema.subjects)
    .values([
      { id: subjectA, name: "Mathematics", yearId: yearA, userId: userA },
      {
        id: subjectAOther,
        name: "Physics",
        yearId: yearA,
        userId: userA,
      },
      {
        id: subjectOtherYear,
        name: "Next-year chemistry",
        yearId: yearAOther,
        userId: userA,
      },
    ])
    .onConflictDoNothing();
  await database
    .insert(schema.materialFolders)
    .values([
      {
        id: folderA,
        name: "Mathematics recordings",
        subjectId: subjectA,
        yearId: yearA,
        userId: userA,
      },
      {
        id: folderOtherYear,
        name: "Other-year recordings",
        subjectId: subjectOtherYear,
        yearId: yearAOther,
        userId: userA,
      },
    ])
    .onConflictDoNothing();

  storeBehavior = persistFile;
  deleteBehavior = softDeleteFile;
  const { createRecordingsRouter } = await import("./recordings");
  const router: TestRouter = {
    recordings: createRecordingsRouter({
      storeFile: (input) => storeBehavior(input),
      deleteFile: (userId, fileId) => deleteBehavior(userId, fileId),
      storageEnabled: () => true,
      transcriptionEnabled: async () => true,
      afterAppendCommit: () => afterAppendCommit(),
      afterCleanupArmed: (jobId) => afterCleanupArmed(jobId),
      afterScopeValidated: () => afterScopeValidated(),
      afterTranscriptionEnqueued: (runId) => afterTranscriptionEnqueued(runId),
    }),
  };
  apiA = createRouterClient(router, {
    context: { headers: new Headers(), session: sessionFor(userA) },
  });
  apiB = createRouterClient(router, {
    context: { headers: new Headers(), session: sessionFor(userB) },
  });
}, databaseHookTimeout);

afterEach(() => {
  storeBehavior = persistFile;
  deleteBehavior = softDeleteFile;
  afterAppendCommit = () => undefined;
  afterCleanupArmed = () => undefined;
  afterScopeValidated = () => undefined;
  afterTranscriptionEnqueued = () => undefined;
});

afterAll(async () => {
  await database
    .delete(schema.lectureRecordings)
    .where(inArray(schema.lectureRecordings.userId, [userA, userB]));
  await database
    .delete(schema.files)
    .where(inArray(schema.files.userId, [userA, userB]));
  await database
    .delete(schema.users)
    .where(inArray(schema.users.id, [userA, userB]));
}, databaseHookTimeout);

async function startRecording(title = `Lecture ${crypto.randomUUID()}`) {
  return apiA.recordings.start({ yearId: yearA, title });
}

async function append(
  recordingId: string,
  seq: number,
  durationMs: number,
  body = `audio-${seq}`,
) {
  return apiA.recordings.appendSegment({
    recordingId,
    seq,
    durationMs,
    file: new File([body], `segment-${seq}.webm`, { type: "audio/webm" }),
  });
}

async function audioFetch(url: string | URL | Request) {
  const body = storedBodies.get(String(url));
  if (!body) return new Response("missing", { status: 404 });
  return new Response(Uint8Array.from(body).buffer, {
    status: 200,
    headers: { "content-type": "audio/webm" },
  });
}

describe("lecture recordings capture protocol", () => {
  test("enforces ownership and a coherent year/folder/subject scope", async () => {
    const created = await apiA.recordings.start({
      yearId: yearA,
      title: "Algebra lecture",
      folderId: folderA,
    });
    expect(created).toMatchObject({
      title: "Algebra lecture",
      yearId: yearA,
      folderId: folderA,
      subjectId: subjectA,
      status: "recording",
      durationMs: 0,
    });
    expect("userId" in created).toBe(false);
    await expect(
      apiB.recordings.get({ recordingId: created.id }),
    ).rejects.toThrow("Lecture recording not found");
    await expect(
      apiB.recordings.start({ yearId: yearA, title: "Stolen scope" }),
    ).rejects.toThrow("Year not found");
    await expect(
      apiA.recordings.start({
        yearId: yearA,
        title: "Cross-year folder",
        folderId: folderOtherYear,
      }),
    ).rejects.toThrow("same year");
    await expect(
      apiA.recordings.start({
        yearId: yearA,
        title: "Mismatched subject",
        folderId: folderA,
        subjectId: subjectAOther,
      }),
    ).rejects.toThrow("must match");
  });

  test("lists only the stable public recording read model", async () => {
    const created = await startRecording("Public list projection");
    const listed = await apiA.recordings.list({ yearId: yearA });
    const row = listed.find((recording) => recording.id === created.id);

    expect(row).toMatchObject({
      id: created.id,
      title: "Public list projection",
      status: "recording",
      yearId: yearA,
    });
    expect(row && "userId" in row).toBe(false);
    expect(row && "transcriptionRunId" in row).toBe(false);
  });

  test("persists one owned Planning locator and clears it when its target is deleted", async () => {
    const eventId = `recording-event-${crypto.randomUUID()}`;
    const occurrenceId = `recording-occurrence-${crypto.randomUUID()}`;
    const startsAt = new Date("2026-09-07T08:00:00.000Z");
    await database.insert(schema.calendarEvents).values({
      id: eventId,
      title: "Chemistry lab",
      startsAt,
      endsAt: new Date("2026-09-07T10:00:00.000Z"),
      subjectId: subjectA,
      yearId: yearA,
      userId: userA,
    });
    await database.insert(schema.timetableOccurrences).values({
      id: occurrenceId,
      occurrenceDate: "2026-09-07",
      title: "Algebra class",
      startsAt,
      endsAt: new Date("2026-09-07T09:00:00.000Z"),
      subjectId: subjectA,
      yearId: yearA,
      userId: userA,
    });

    const eventRecording = await apiA.recordings.start({
      yearId: yearA,
      title: "Linked lab",
      planningLocator: { kind: "calendarEvent", eventId },
    });
    const occurrenceRecording = await apiA.recordings.start({
      yearId: yearA,
      title: "Linked class",
      planningLocator: {
        kind: "timetableOccurrence",
        occurrenceId,
      },
    });

    expect(eventRecording).toMatchObject({
      subjectId: subjectA,
      planningLocator: { kind: "calendarEvent", eventId },
    });
    expect(occurrenceRecording).toMatchObject({
      subjectId: subjectA,
      planningLocator: { kind: "timetableOccurrence", occurrenceId },
    });
    expect(
      (await apiA.recordings.get({ recordingId: eventRecording.id })).recording
        .planningLocator,
    ).toEqual({ kind: "calendarEvent", eventId });
    expect(
      (await apiA.recordings.list({ yearId: yearA })).find(
        (row) => row.id === occurrenceRecording.id,
      )?.planningLocator,
    ).toEqual({ kind: "timetableOccurrence", occurrenceId });
    await expect(
      database
        .insert(schema.lectureRecordings)
        .values({
          id: `invalid-double-link-${crypto.randomUUID()}`,
          title: "Invalid double link",
          recordedAt: startsAt,
          calendarEventId: eventId,
          timetableOccurrenceId: occurrenceId,
          yearId: yearA,
          userId: userA,
        })
        .run(),
    ).rejects.toThrow();

    await database
      .delete(schema.calendarEvents)
      .where(eq(schema.calendarEvents.id, eventId));
    await database
      .delete(schema.timetableOccurrences)
      .where(eq(schema.timetableOccurrences.id, occurrenceId));
    expect(
      (await apiA.recordings.get({ recordingId: eventRecording.id })).recording
        .planningLocator,
    ).toBeNull();
    expect(
      (await apiA.recordings.get({ recordingId: occurrenceRecording.id }))
        .recording.planningLocator,
    ).toBeNull();
  });

  test("materializes a recurring lesson before storing its concrete locator", async () => {
    const seriesId = `recording-series-${crypto.randomUUID()}`;
    await database.insert(schema.timetableSeries).values({
      id: seriesId,
      title: "Monday mathematics",
      startsOn: "2026-09-01",
      endsOn: "2027-06-30",
      startMinutes: 8 * 60,
      durationMinutes: 60,
      timezone: "UTC",
      recurrenceFrequency: "weekly",
      recurrenceInterval: 1,
      recurrenceWeekdays: [1],
      subjectId: subjectA,
      yearId: yearA,
      userId: userA,
    });
    const created = await apiA.recordings.start({
      yearId: yearA,
      title: "Recurring mathematics",
      planningLocator: {
        kind: "timetableSeriesOccurrence",
        seriesId,
        occurrenceDate: "2026-09-07",
      },
    });
    expect(created.planningLocator?.kind).toBe("timetableOccurrence");
    const occurrenceId =
      created.planningLocator?.kind === "timetableOccurrence"
        ? created.planningLocator.occurrenceId
        : null;
    expect(occurrenceId).not.toBeNull();
    expect(
      await database
        .select({ id: schema.timetableOccurrences.id })
        .from(schema.timetableOccurrences)
        .where(eq(schema.timetableOccurrences.id, occurrenceId!)),
    ).toHaveLength(1);
  });

  test("rolls back virtual materialization when recording validation fails", async () => {
    const seriesId = `recording-rejected-series-${crypto.randomUUID()}`;
    await database.insert(schema.timetableSeries).values({
      id: seriesId,
      title: "Physics series",
      startsOn: "2026-09-01",
      endsOn: "2027-06-30",
      startMinutes: 10 * 60,
      durationMinutes: 60,
      timezone: "UTC",
      recurrenceFrequency: "weekly",
      recurrenceInterval: 1,
      recurrenceWeekdays: [1],
      subjectId: subjectAOther,
      yearId: yearA,
      userId: userA,
    });
    await expect(
      apiA.recordings.start({
        yearId: yearA,
        title: "Rejected recurring class",
        subjectId: subjectA,
        planningLocator: {
          kind: "timetableSeriesOccurrence",
          seriesId,
          occurrenceDate: "2026-09-07",
        },
      }),
    ).rejects.toThrow("subjects must match");
    expect(
      await database
        .select({ id: schema.timetableOccurrences.id })
        .from(schema.timetableOccurrences)
        .where(eq(schema.timetableOccurrences.seriesId, seriesId)),
    ).toHaveLength(0);
  });

  test("rejects a cancelled lesson even if it changes after preflight", async () => {
    const occurrenceId = `recording-cancelled-${crypto.randomUUID()}`;
    await database.insert(schema.timetableOccurrences).values({
      id: occurrenceId,
      occurrenceDate: "2026-09-09",
      title: "Cancelled class",
      startsAt: new Date("2026-09-09T08:00:00.000Z"),
      endsAt: new Date("2026-09-09T09:00:00.000Z"),
      status: "scheduled",
      subjectId: subjectA,
      yearId: yearA,
      userId: userA,
    });
    afterScopeValidated = async () => {
      await database
        .update(schema.timetableOccurrences)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(schema.timetableOccurrences.id, occurrenceId));
    };
    await expect(
      apiA.recordings.start({
        yearId: yearA,
        title: "Must not start",
        planningLocator: { kind: "timetableOccurrence", occurrenceId },
      }),
    ).rejects.toThrow("cancelled");
  });

  test("rejects foreign, cross-year, mismatched and raced Planning targets", async () => {
    const foreignEventId = `recording-foreign-event-${crypto.randomUUID()}`;
    const crossYearEventId = `recording-cross-year-event-${crypto.randomUUID()}`;
    const mismatchedEventId = `recording-mismatch-event-${crypto.randomUUID()}`;
    const racedEventId = `recording-raced-event-${crypto.randomUUID()}`;
    const startsAt = new Date("2026-09-08T08:00:00.000Z");
    await database.insert(schema.calendarEvents).values([
      {
        id: foreignEventId,
        title: "Foreign event",
        startsAt,
        yearId: yearB,
        userId: userB,
      },
      {
        id: crossYearEventId,
        title: "Cross-year event",
        startsAt,
        yearId: yearAOther,
        userId: userA,
      },
      {
        id: mismatchedEventId,
        title: "Physics event",
        startsAt,
        subjectId: subjectAOther,
        yearId: yearA,
        userId: userA,
      },
      {
        id: racedEventId,
        title: "Raced event",
        startsAt,
        yearId: yearA,
        userId: userA,
      },
    ]);

    await expect(
      apiA.recordings.start({
        yearId: yearA,
        title: "Foreign",
        planningLocator: { kind: "calendarEvent", eventId: foreignEventId },
      }),
    ).rejects.toThrow("Calendar event not found");
    await expect(
      apiA.recordings.start({
        yearId: yearA,
        title: "Cross-year",
        planningLocator: {
          kind: "calendarEvent",
          eventId: crossYearEventId,
        },
      }),
    ).rejects.toThrow("same year");
    await expect(
      apiA.recordings.start({
        yearId: yearA,
        title: "Mismatched",
        subjectId: subjectA,
        planningLocator: {
          kind: "calendarEvent",
          eventId: mismatchedEventId,
        },
      }),
    ).rejects.toThrow("Planning subjects must match");

    afterScopeValidated = async () => {
      await database
        .delete(schema.calendarEvents)
        .where(eq(schema.calendarEvents.id, racedEventId));
    };
    await expect(
      apiA.recordings.start({
        yearId: yearA,
        title: "Raced",
        planningLocator: { kind: "calendarEvent", eventId: racedEventId },
      }),
    ).rejects.toThrow("unavailable");
  });

  test("atomically rejects a folder whose subject changes after validation", async () => {
    const title = `Scope race ${crypto.randomUUID()}`;
    afterScopeValidated = async () => {
      await database
        .update(schema.materialFolders)
        .set({ subjectId: subjectAOther, updatedAt: new Date() })
        .where(eq(schema.materialFolders.id, folderA));
    };
    try {
      await expect(
        apiA.recordings.start({ yearId: yearA, title, folderId: folderA }),
      ).rejects.toThrow("unavailable");
    } finally {
      await database
        .update(schema.materialFolders)
        .set({ subjectId: subjectA, updatedAt: new Date() })
        .where(eq(schema.materialFolders.id, folderA));
    }
    expect(
      await database
        .select({ id: schema.lectureRecordings.id })
        .from(schema.lectureRecordings)
        .where(eq(schema.lectureRecordings.title, title)),
    ).toHaveLength(0);
  });

  test("appends sequentially, computes offsets and replays without re-uploading", async () => {
    const recording = await startRecording("Sequential lecture");
    const before = storedFileIds.length;
    const first = await append(recording.id, 0, 1_250, "first");
    expect(first).toMatchObject({
      replayed: false,
      segment: {
        seq: 0,
        startOffsetMs: 0,
        durationMs: 1_250,
        transcriptStatus: "pending",
        file: { mimeType: "audio/webm", byteSize: 5 },
      },
    });
    const replay = await append(recording.id, 0, 9_999, "ignored-retry");
    expect(replay.replayed).toBe(true);
    expect(replay.segment.id).toBe(first.segment.id);
    expect(storedFileIds).toHaveLength(before + 1);
    await expect(
      apiA.recordings.appendSegment({
        recordingId: recording.id,
        seq: 0,
        durationMs: 1_250,
        file: new File(["not audio"], "duplicate.txt", {
          type: "text/plain",
        }),
      }),
    ).rejects.toThrow("Only MP4, M4A, WebM and Ogg");
    const oversizedReplay = new File(["tiny"], "duplicate.webm", {
      type: "audio/webm",
    });
    Object.defineProperty(oversizedReplay, "size", {
      value: 32 * 1024 * 1024 + 1,
    });
    await expect(
      apiA.recordings.appendSegment({
        recordingId: recording.id,
        seq: 0,
        durationMs: 1_250,
        file: oversizedReplay,
      }),
    ).rejects.toThrow("32 MiB");
    expect(storedFileIds).toHaveLength(before + 1);
    const [prearmedCleanup] = await database
      .select()
      .from(schema.jobs)
      .where(
        and(
          eq(schema.jobs.kind, "cleanup.unownedFile"),
          eq(schema.jobs.idempotencyKey, first.segment.file.id),
        ),
      );
    expect(prearmedCleanup).toMatchObject({
      status: "cancelled",
      maxAttempts: 6,
      payload: { userId: userA, fileId: first.segment.file.id },
    });
    const [winnerFile] = await database
      .select({ status: schema.files.status })
      .from(schema.files)
      .where(eq(schema.files.id, first.segment.file.id));
    expect(winnerFile?.status).toBe("stored");

    await expect(append(recording.id, 2, 500)).rejects.toThrow(
      "appended in sequence",
    );
    const second = await append(recording.id, 1, 2_000, "second");
    expect(second.segment.startOffsetMs).toBe(1_250);
    const detail = await apiA.recordings.get({ recordingId: recording.id });
    expect(detail.recording.durationMs).toBe(3_250);
    expect(detail.segments.map((segment) => segment.seq)).toEqual([0, 1]);
    expect(detail.transcript).toBeNull();
    const serialized = JSON.stringify(detail);
    expect(serialized).not.toContain("storageKey");
    expect(serialized).not.toContain(userA);

    const finished = await apiA.recordings.finish({
      recordingId: recording.id,
    });
    expect(finished.status).toBe("uploaded");
    expect(
      (await apiA.recordings.finish({ recordingId: recording.id })).status,
    ).toBe("uploaded");
    expect((await append(recording.id, 1, 1, "late replay")).replayed).toBe(
      true,
    );
    await expect(append(recording.id, 2, 1, "late new")).rejects.toThrow(
      "active recording",
    );
  });

  test("reconciles a lost acknowledgement after the append commit", async () => {
    const recording = await startRecording("Lost acknowledgement");
    let fired = false;
    afterAppendCommit = () => {
      if (!fired) {
        fired = true;
        throw new Error("simulated lost acknowledgement");
      }
    };
    const result = await append(recording.id, 0, 1_000, "committed");
    expect(result.replayed).toBe(false);
    const [file] = await database
      .select({ status: schema.files.status })
      .from(schema.files)
      .where(eq(schema.files.id, result.segment.file.id));
    expect(file?.status).toBe("stored");
    expect(
      await database
        .select()
        .from(schema.recordingSegments)
        .where(eq(schema.recordingSegments.recordingId, recording.id)),
    ).toHaveLength(1);
  });

  test("does not adopt a candidate once its cleanup job has won the claim", async () => {
    const recording = await startRecording("Cleanup claim race");
    let candidateFileId = "";
    afterCleanupArmed = async (jobId) => {
      const [job] = await database
        .select({ payload: schema.jobs.payload })
        .from(schema.jobs)
        .where(eq(schema.jobs.id, jobId));
      const payload = job?.payload as { fileId?: unknown } | null;
      candidateFileId = String(payload?.fileId ?? "");
      await database
        .update(schema.jobs)
        .set({
          status: "running",
          lockedBy: "cleanup-race-worker",
          lockedUntil: new Date(Date.now() + 60_000),
        })
        .where(
          and(eq(schema.jobs.id, jobId), eq(schema.jobs.status, "queued")),
        );
    };

    await expect(
      append(recording.id, 0, 1_000, "cleanup-won"),
    ).rejects.toThrow();
    expect(
      await database
        .select()
        .from(schema.recordingSegments)
        .where(eq(schema.recordingSegments.recordingId, recording.id)),
    ).toHaveLength(0);
    const current = await apiA.recordings.get({ recordingId: recording.id });
    expect(current.recording.durationMs).toBe(0);
    const [candidate] = await database
      .select({ status: schema.files.status })
      .from(schema.files)
      .where(eq(schema.files.id, candidateFileId));
    expect(candidate?.status).toBe("deleted");
    const [cleanup] = await database
      .select({ status: schema.jobs.status })
      .from(schema.jobs)
      .where(eq(schema.jobs.idempotencyKey, candidateFileId));
    expect(cleanup?.status).toBe("running");
  });

  test("adopts one concurrent append and durably cleans the loser after deletion fails", async () => {
    const recording = await startRecording("Concurrent upload");
    const candidates: string[] = [];
    let releaseBoth!: () => void;
    const bothStored = new Promise<void>((resolve) => {
      releaseBoth = resolve;
    });
    storeBehavior = async (input) => {
      const stored = await persistFile(input);
      candidates.push(stored.id);
      if (candidates.length === 2) releaseBoth();
      await bothStored;
      return stored;
    };
    deleteBehavior = async () => {
      throw new Error("provider deletion unavailable");
    };
    const results = await Promise.all([
      append(recording.id, 0, 1_000, "candidate-a"),
      append(recording.id, 0, 1_000, "candidate-b"),
    ]);
    expect(results.map((result) => result.replayed).sort()).toEqual([
      false,
      true,
    ]);
    expect(results[0]!.segment.id).toBe(results[1]!.segment.id);
    const winnerFileId = results[0]!.segment.file.id;
    const loserFileId = candidates.find((id) => id !== winnerFileId);
    expect(loserFileId).toBeString();
    const [cleanup] = await database
      .select()
      .from(schema.jobs)
      .where(
        and(
          eq(schema.jobs.kind, "cleanup.unownedFile"),
          eq(schema.jobs.idempotencyKey, loserFileId as string),
        ),
      );
    expect(cleanup).toMatchObject({
      status: "queued",
      maxAttempts: 6,
      payload: { userId: userA, fileId: loserFileId },
    });
    const { runCleanupUnownedFileJob } = await import("../jobs/ingest-link");
    await expect(
      runCleanupUnownedFileJob(cleanup!.payload, {
        deleteFile: softDeleteFile,
      }),
    ).resolves.toEqual({ deleted: true, referenced: false });
    const [loser] = await database
      .select({ status: schema.files.status })
      .from(schema.files)
      .where(eq(schema.files.id, loserFileId as string));
    expect(loser?.status).toBe("deleted");
  });

  test("enforces both the 24-segment and four-hour bounds", async () => {
    const countBound = await startRecording("Segment count bound");
    for (let seq = 0; seq < 24; seq += 1) {
      await append(countBound.id, seq, 1, `count-${seq}`);
    }
    await expect(append(countBound.id, 24, 1, "too-many")).rejects.toThrow();
    expect(
      (await apiA.recordings.get({ recordingId: countBound.id })).segments,
    ).toHaveLength(24);

    const durationBound = await startRecording("Duration bound");
    for (let seq = 0; seq < 16; seq += 1) {
      await append(durationBound.id, seq, 900_000, `duration-${seq}`);
    }
    await expect(
      append(durationBound.id, 16, 1, "over-four-hours"),
    ).rejects.toThrow("4 hours");
    expect(
      (await apiA.recordings.get({ recordingId: durationBound.id })).recording
        .durationMs,
    ).toBe(14_400_000);
  });

  test("deletes the domain first and records cleanup durably when provider deletion fails", async () => {
    const recording = await startRecording("Delete cleanup");
    const appended = await append(recording.id, 0, 2_000, "delete-me");
    deleteBehavior = async () => {
      throw new Error("provider delete failed");
    };
    const trashed = await apiA.recordings.delete({
      recordingId: recording.id,
    });
    expect(trashed).toEqual({ ok: true, cleanupJobIds: [] });
    const result = await apiA.recordings.delete({ recordingId: recording.id });
    expect(result.ok).toBe(true);
    expect(result.cleanupJobIds).toHaveLength(1);
    expect(
      await database
        .select()
        .from(schema.lectureRecordings)
        .where(eq(schema.lectureRecordings.id, recording.id)),
    ).toHaveLength(0);
    const [fileBeforeCleanup] = await database
      .select({ status: schema.files.status })
      .from(schema.files)
      .where(eq(schema.files.id, appended.segment.file.id));
    expect(fileBeforeCleanup?.status).toBe("stored");
    const [cleanup] = await database
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.id, result.cleanupJobIds[0]!));
    expect(cleanup).toMatchObject({
      kind: "cleanup.unownedFile",
      payload: { userId: userA, fileId: appended.segment.file.id },
    });
    const { runCleanupUnownedFileJob } = await import("../jobs/ingest-link");
    await runCleanupUnownedFileJob(cleanup!.payload, {
      deleteFile: softDeleteFile,
    });
    const [fileAfterCleanup] = await database
      .select({ status: schema.files.status })
      .from(schema.files)
      .where(eq(schema.files.id, appended.segment.file.id));
    expect(fileAfterCleanup?.status).toBe("deleted");
  });

  test("fences an in-flight append so its uploaded candidate is not orphaned", async () => {
    const recording = await startRecording("Concurrent deletion");
    let candidateFileId = "";
    let announceStored!: () => void;
    const candidateStored = new Promise<void>((resolve) => {
      announceStored = resolve;
    });
    let releaseUpload!: () => void;
    const uploadCanReturn = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });
    storeBehavior = async (input) => {
      const stored = await persistFile(input);
      candidateFileId = stored.id;
      announceStored();
      await uploadCanReturn;
      return stored;
    };

    await apiA.recordings.delete({ recordingId: recording.id });

    const appending = append(recording.id, 0, 1_000, "in-flight");
    await candidateStored;
    await expect(
      apiA.recordings.delete({ recordingId: recording.id }),
    ).resolves.toMatchObject({ ok: true });
    releaseUpload();
    await expect(appending).rejects.toThrow("Lecture recording not found");

    const [candidate] = await database
      .select({ status: schema.files.status })
      .from(schema.files)
      .where(eq(schema.files.id, candidateFileId));
    expect(candidate?.status).toBe("deleted");
    const [cleanup] = await database
      .select({ maxAttempts: schema.jobs.maxAttempts })
      .from(schema.jobs)
      .where(
        and(
          eq(schema.jobs.kind, "cleanup.unownedFile"),
          eq(schema.jobs.idempotencyKey, candidateFileId),
        ),
      );
    expect(cleanup?.maxAttempts).toBe(6);
  });

  test("purges transcription results and fences a stale worker when deleting", async () => {
    const recording = await startRecording("Confidential deletion");
    await append(recording.id, 0, 1_000, "private-audio-0");
    await append(recording.id, 1, 1_000, "private-audio-1");
    await apiA.recordings.finish({ recordingId: recording.id });
    const queued = await apiA.recordings.transcribe({
      recordingId: recording.id,
    });
    const persistedSecret = "private transcript already persisted in a job";
    await database
      .update(schema.jobs)
      .set({
        status: "succeeded",
        result: {
          segmentId: queued.segmentJobs[0]!.segmentId,
          provider: "mistral",
          text: persistedSecret,
          segments: [],
        },
      })
      .where(eq(schema.jobs.id, queued.segmentJobs[0]!.jobId));
    const staleWorkerId = "stale-recording-worker";
    await database
      .update(schema.jobs)
      .set({
        status: "running",
        lockedBy: staleWorkerId,
        lockedUntil: new Date(Date.now() + 60_000),
      })
      .where(eq(schema.jobs.id, queued.segmentJobs[1]!.jobId));

    await apiA.recordings.delete({ recordingId: recording.id });
    await apiA.recordings.delete({ recordingId: recording.id });
    const transcriptionJobIds = [
      ...queued.segmentJobs.map((job) => job.jobId),
      queued.finalizeJob.jobId,
    ];
    expect(
      await database
        .select()
        .from(schema.jobs)
        .where(inArray(schema.jobs.id, transcriptionJobIds)),
    ).toHaveLength(0);
    const { completeJob } = await import("../lib/jobs");
    await expect(
      completeJob(
        queued.segmentJobs[1]!.jobId,
        { text: "late private transcript" },
        { instanceId: staleWorkerId },
      ),
    ).rejects.toThrow("was not found");
    expect(
      JSON.stringify(
        await database
          .select({ result: schema.jobs.result })
          .from(schema.jobs)
          .where(eq(schema.jobs.userId, userA)),
      ),
    ).not.toContain(persistedSecret);
  }, 15_000);

  test("exposes truthful capability limits and rejects an empty finish", async () => {
    expect(await apiA.recordings.capabilities()).toEqual({
      uploadsEnabled: true,
      transcriptionEnabled: true,
      maxSegments: 24,
      maxDurationMs: 14_400_000,
      maxSegmentDurationMs: 900_000,
    });
    const recording = await startRecording("Empty recording");
    await expect(
      apiA.recordings.finish({ recordingId: recording.id }),
    ).rejects.toThrow("audio segment");
  });
});

describe("lecture transcription jobs", () => {
  test("a stale enqueue post-check only purges its own generation", async () => {
    const recording = await startRecording("Post-check generation race");
    const appended = await append(recording.id, 0, 1_000, "generation-audio");
    await apiA.recordings.finish({ recordingId: recording.id });
    const newerRunId = `trun-newer-${crypto.randomUUID()}`;
    let staleRunId = "";
    let newerJobIds: string[] = [];
    afterTranscriptionEnqueued = async (runId) => {
      staleRunId = runId;
      await database
        .update(schema.lectureRecordings)
        .set({ transcriptionRunId: newerRunId, updatedAt: new Date() })
        .where(eq(schema.lectureRecordings.id, recording.id));
      const { enqueueRecordingTranscription } =
        await import("../jobs/transcription");
      const newer = await enqueueRecordingTranscription({
        userId: userA,
        recordingId: recording.id,
        runId: newerRunId,
        segmentIds: [appended.segment.id],
      });
      newerJobIds = [
        ...newer.segmentJobs.map((job) => job.jobId),
        newer.finalizeJob.jobId,
      ];
    };

    await expect(
      apiA.recordings.transcribe({ recordingId: recording.id }),
    ).rejects.toThrow("changed before transcription");
    expect(staleRunId).not.toBe("");
    expect(
      await database
        .select({ id: schema.jobs.id })
        .from(schema.jobs)
        .where(inArray(schema.jobs.id, newerJobIds)),
    ).toHaveLength(2);
    expect(
      await database
        .select({ id: schema.jobs.id })
        .from(schema.jobs)
        .where(
          inArray(schema.jobs.idempotencyKey, [
            `${appended.segment.id}:${staleRunId}`,
            `${recording.id}:${staleRunId}:0`,
          ]),
        ),
    ).toHaveLength(0);
  });

  test("enqueues idempotently and assembles two segments with shifted offsets", async () => {
    const recording = await startRecording("Offset assembly");
    await append(recording.id, 0, 1_000, "alpha-audio");
    await append(recording.id, 1, 2_000, "beta-audio");
    await apiA.recordings.finish({ recordingId: recording.id });
    const queued = await apiA.recordings.transcribe({
      recordingId: recording.id,
    });
    const replay = await apiA.recordings.transcribe({
      recordingId: recording.id,
    });
    expect(replay.segmentJobs.map((job) => job.jobId)).toEqual(
      queued.segmentJobs.map((job) => job.jobId),
    );
    expect(replay.finalizeJob.jobId).toBe(queued.finalizeJob.jobId);
    expect(queued.segmentJobs).toHaveLength(2);
    const queuedRows = await database
      .select()
      .from(schema.jobs)
      .where(
        inArray(
          schema.jobs.id,
          queued.segmentJobs.map((job) => job.jobId),
        ),
      );
    expect(queuedRows.every((job) => job.maxAttempts === 1)).toBe(true);

    const { runFinalizeTranscriptionJob, runTranscribeSegmentJob } =
      await import("../jobs/transcription");
    for (const job of queued.segmentJobs) {
      const result = await runTranscribeSegmentJob(
        { segmentId: job.segmentId, runId: queued.runId },
        {
          fetch: audioFetch,
          getProvider: async () => ({
            id: "mistral",
            transcribeSegment: async ({ blob }) => {
              const source = await blob.text();
              const alpha = source === "alpha-audio";
              return {
                text: alpha ? "Alpha paragraph" : "Beta paragraph",
                language: "fr",
                segments: [
                  {
                    startMs: alpha ? 100 : 200,
                    endMs: alpha ? 500 : 800,
                    text: alpha ? "Alpha" : "Beta",
                  },
                ],
              };
            },
          }),
        },
      );
      await database
        .update(schema.jobs)
        .set({ status: "succeeded", result, error: null })
        .where(eq(schema.jobs.id, job.jobId));
    }
    const finalized = await runFinalizeTranscriptionJob({
      recordingId: recording.id,
      runId: queued.runId,
      pollAttempt: 0,
    });
    expect(finalized).toMatchObject({
      status: "ready",
      recordingId: recording.id,
      transcriptSegments: 2,
    });
    const detail = await apiA.recordings.get({ recordingId: recording.id });
    expect(detail.recording.status).toBe("ready");
    expect(detail.transcript).toMatchObject({
      text: "Alpha paragraph\n\nBeta paragraph",
      segmentsVersion: 1,
      language: "fr",
      provider: "mistral",
      segments: [
        { startMs: 100, endMs: 500, text: "Alpha" },
        { startMs: 1_200, endMs: 1_800, text: "Beta" },
      ],
    });
    expect(JSON.stringify(detail)).not.toContain("alpha-audio");
    expect(
      await runFinalizeTranscriptionJob({
        recordingId: recording.id,
        runId: queued.runId,
        pollAttempt: 0,
      }),
    ).toEqual({
      status: "ready",
      recordingId: recording.id,
      runId: queued.runId,
    });
  });

  test("reads managed audio directly without an authenticated HTTP hop", async () => {
    const recording = await startRecording("Managed storage audio");
    const appended = await append(recording.id, 0, 1_000, "managed-audio");
    const [managedFile] = await database
      .update(schema.files)
      .set({ provider: "local" })
      .where(eq(schema.files.id, appended.segment.file.id))
      .returning({ storageKey: schema.files.storageKey });
    if (!managedFile) throw new Error("Expected a managed recording file");
    await apiA.recordings.finish({ recordingId: recording.id });
    const queued = await apiA.recordings.transcribe({
      recordingId: recording.id,
    });
    const job = queued.segmentJobs[0];
    if (!job) throw new Error("Expected a transcription segment job");

    const { runTranscribeSegmentJob } = await import("../jobs/transcription");
    let directReads = 0;
    const result = await runTranscribeSegmentJob(
      { segmentId: job.segmentId, runId: queued.runId },
      {
        fileAccessUrl: async () => {
          throw new Error("Managed storage must not use a browser URL");
        },
        fetch: async () => {
          throw new Error("Managed storage must not use HTTP");
        },
        readStorageObject: async (provider, storageKey, options) => {
          directReads += 1;
          expect(provider).toBe("local");
          expect(storageKey).toBe(managedFile.storageKey);
          expect(options?.maxBytes).toBe(32 * 1024 * 1024);
          return new TextEncoder().encode("managed-audio").buffer;
        },
        getProvider: async () => ({
          id: "mistral",
          transcribeSegment: async ({ blob }) => ({
            text: await blob.text(),
            segments: [],
          }),
        }),
      },
    );

    expect(directReads).toBe(1);
    expect(result.text).toBe("managed-audio");
  });

  test("lets a successful lease winner repair a stale worker failure", async () => {
    const recording = await startRecording("Stale segment worker");
    await append(recording.id, 0, 1_000, "race-audio");
    await apiA.recordings.finish({ recordingId: recording.id });
    const queued = await apiA.recordings.transcribe({
      recordingId: recording.id,
    });
    const segmentJob = queued.segmentJobs[0]!;
    const { runTranscribeSegmentJob } = await import("../jobs/transcription");
    let announceWinnerStarted!: () => void;
    const winnerStarted = new Promise<void>((resolve) => {
      announceWinnerStarted = resolve;
    });
    let releaseWinner!: () => void;
    const winnerCanFinish = new Promise<void>((resolve) => {
      releaseWinner = resolve;
    });
    const winnerRun = runTranscribeSegmentJob(
      { segmentId: segmentJob.segmentId, runId: queued.runId },
      {
        fetch: audioFetch,
        getProvider: async () => ({
          id: "mistral",
          transcribeSegment: async () => {
            announceWinnerStarted();
            await winnerCanFinish;
            return {
              text: "Durable winner",
              segments: [{ startMs: 0, endMs: 500, text: "Winner" }],
            };
          },
        }),
      },
    );
    await winnerStarted;
    await expect(
      runTranscribeSegmentJob(
        { segmentId: segmentJob.segmentId, runId: queued.runId },
        {
          fetch: audioFetch,
          getProvider: async () => ({
            id: "mistral",
            transcribeSegment: async () => {
              throw new Error("stale lease failed");
            },
          }),
        },
      ),
    ).rejects.toThrow("stale lease failed");
    const [failedBeforeWinner] = await database
      .select({ status: schema.recordingSegments.transcriptStatus })
      .from(schema.recordingSegments)
      .where(eq(schema.recordingSegments.id, segmentJob.segmentId));
    expect(failedBeforeWinner?.status).toBe("failed");
    releaseWinner();
    const winner = await winnerRun;
    const [readyAfterWinner] = await database
      .select({
        status: schema.recordingSegments.transcriptStatus,
        error: schema.recordingSegments.transcriptError,
      })
      .from(schema.recordingSegments)
      .where(eq(schema.recordingSegments.id, segmentJob.segmentId));
    expect(readyAfterWinner).toEqual({ status: "ready", error: null });
    await database
      .update(schema.jobs)
      .set({ status: "succeeded", result: winner, error: null })
      .where(eq(schema.jobs.id, segmentJob.jobId));
  });

  test("bounds both a suspended source fetch and source body read", async () => {
    const recording = await startRecording("Suspended source download");
    await append(recording.id, 0, 1_000, "download-timeout-audio");
    await apiA.recordings.finish({ recordingId: recording.id });
    const queued = await apiA.recordings.transcribe({
      recordingId: recording.id,
    });
    const segmentJob = queued.segmentJobs[0]!;
    const { runTranscribeSegmentJob } = await import("../jobs/transcription");
    let fetchSignal: AbortSignal | null = null;
    let providerCalls = 0;
    await expect(
      runTranscribeSegmentJob(
        { segmentId: segmentJob.segmentId, runId: queued.runId },
        {
          downloadTimeoutMs: 5,
          fetch: async (_url, init) => {
            fetchSignal = init?.signal ?? null;
            return new Promise<Response>((_resolve, reject) => {
              fetchSignal?.addEventListener(
                "abort",
                () => reject(fetchSignal?.reason),
                { once: true },
              );
            });
          },
          getProvider: async () => {
            providerCalls += 1;
            throw new Error(
              "Provider must not run before the source downloads",
            );
          },
        },
      ),
    ).rejects.toThrow("download timed out");
    expect((fetchSignal as AbortSignal | null)?.aborted).toBe(true);
    expect(providerCalls).toBe(0);

    await database
      .update(schema.recordingSegments)
      .set({
        transcriptStatus: "pending",
        transcriptError: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.recordingSegments.id, segmentJob.segmentId));
    let bodySignal: AbortSignal | null = null;
    await expect(
      runTranscribeSegmentJob(
        { segmentId: segmentJob.segmentId, runId: queued.runId },
        {
          downloadTimeoutMs: 5,
          fetch: async (_url, init) => {
            bodySignal = init?.signal ?? null;
            return new Response(
              new ReadableStream<Uint8Array>({
                pull: () => new Promise<void>(() => undefined),
              }),
              { status: 200 },
            );
          },
          getProvider: async () => {
            providerCalls += 1;
            throw new Error(
              "Provider must not run before the source downloads",
            );
          },
        },
      ),
    ).rejects.toThrow("download timed out");
    expect((bodySignal as AbortSignal | null)?.aborted).toBe(true);
    expect(providerCalls).toBe(0);
  });

  test("marks the recording failed with exact segment numbers", async () => {
    const recording = await startRecording("Failed segment");
    await append(recording.id, 0, 1_000, "failure-audio");
    await apiA.recordings.finish({ recordingId: recording.id });
    const queued = await apiA.recordings.transcribe({
      recordingId: recording.id,
    });
    const segmentJob = queued.segmentJobs[0]!;
    const { runFinalizeTranscriptionJob, runTranscribeSegmentJob } =
      await import("../jobs/transcription");
    await expect(
      runTranscribeSegmentJob(
        { segmentId: segmentJob.segmentId, runId: queued.runId },
        {
          fetch: audioFetch,
          getProvider: async () => ({
            id: "mistral",
            transcribeSegment: async () => {
              throw new Error("provider exhausted six retries");
            },
          }),
        },
      ),
    ).rejects.toThrow("six retries");
    await database
      .update(schema.jobs)
      .set({
        status: "failed",
        result: null,
        error: "provider exhausted six retries",
      })
      .where(eq(schema.jobs.id, segmentJob.jobId));
    const result = await runFinalizeTranscriptionJob({
      recordingId: recording.id,
      runId: queued.runId,
      pollAttempt: 0,
    });
    expect(result).toMatchObject({ status: "failed", failedSeqs: [0] });
    const detail = await apiA.recordings.get({ recordingId: recording.id });
    expect(detail.recording).toMatchObject({
      status: "failed",
      error: "Transcription failed for segments: 0",
    });
  });

  test("retries a failed BYOK run, reuses successes and fences stale workers", async () => {
    const recording = await startRecording("BYOK recovery generation");
    await append(recording.id, 0, 1_000, "reusable-audio");
    await append(recording.id, 1, 1_000, "retry-audio");
    await apiA.recordings.finish({ recordingId: recording.id });
    const { resolveTranscriptionProvider } =
      await import("../lib/transcription");
    const { setServiceKey } = await import("../lib/service-keys");
    const { runFinalizeTranscriptionJob, runTranscribeSegmentJob } =
      await import("../jobs/transcription");
    await setServiceKey(userA, "transcription", "byok-generation-k1");
    const firstRun = await apiA.recordings.transcribe({
      recordingId: recording.id,
    });
    const reusableJob = firstRun.segmentJobs[0]!;
    const failedJob = firstRun.segmentJobs[1]!;

    const reusableResult = await runTranscribeSegmentJob(
      { segmentId: reusableJob.segmentId, runId: firstRun.runId },
      {
        fetch: audioFetch,
        getProvider: async () => ({
          id: "mistral",
          transcribeSegment: async () => ({
            text: "Reusable success",
            language: "fr",
            segments: [{ startMs: 0, endMs: 400, text: "Reusable" }],
          }),
        }),
      },
    );
    await database
      .update(schema.jobs)
      .set({ status: "succeeded", result: reusableResult, error: null })
      .where(eq(schema.jobs.id, reusableJob.jobId));

    const staleWorkerId = `stale-generation-${crypto.randomUUID()}`;
    await database
      .update(schema.jobs)
      .set({
        status: "running",
        lockedBy: staleWorkerId,
        lockedUntil: new Date(Date.now() + 60_000),
      })
      .where(eq(schema.jobs.id, failedJob.jobId));
    let announceStaleStarted!: () => void;
    const staleStarted = new Promise<void>((resolve) => {
      announceStaleStarted = resolve;
    });
    let releaseStale!: () => void;
    const staleCanFinish = new Promise<void>((resolve) => {
      releaseStale = resolve;
    });
    const inFlightStaleWorker = runTranscribeSegmentJob(
      { segmentId: failedJob.segmentId, runId: firstRun.runId },
      {
        fetch: audioFetch,
        getProvider: async () => ({
          id: "mistral",
          transcribeSegment: async () => {
            announceStaleStarted();
            await staleCanFinish;
            return {
              text: "Stale result must never be reused",
              language: "fr",
              segments: [{ startMs: 0, endMs: 300, text: "Stale" }],
            };
          },
        }),
      },
    );
    await staleStarted;

    let rejectedAuthorization = "";
    await expect(
      runTranscribeSegmentJob(
        { segmentId: failedJob.segmentId, runId: firstRun.runId },
        {
          fetch: audioFetch,
          getProvider: (userId) =>
            resolveTranscriptionProvider(userId, {
              sleep: async () => undefined,
              fetch: async (_url, init) => {
                rejectedAuthorization =
                  new Headers(init?.headers).get("authorization") ?? "";
                return Response.json(
                  { message: "invalid byok-generation-k1" },
                  { status: 401 },
                );
              },
            }),
        },
      ),
    ).rejects.toThrow("401");
    expect(rejectedAuthorization).toBe("Bearer byok-generation-k1");
    await database
      .update(schema.jobs)
      .set({ status: "failed", error: "Mistral transcription returned 401" })
      .where(eq(schema.jobs.id, failedJob.jobId));
    await expect(
      runFinalizeTranscriptionJob({
        recordingId: recording.id,
        runId: firstRun.runId,
        pollAttempt: 0,
      }),
    ).resolves.toMatchObject({ status: "failed", failedSeqs: [1] });
    expect(
      (await apiA.recordings.get({ recordingId: recording.id })).recording
        .status,
    ).toBe("failed");

    await setServiceKey(userA, "transcription", "byok-generation-k2");
    const retry = await apiA.recordings.transcribe({
      recordingId: recording.id,
    });
    expect(retry.runId).not.toBe(firstRun.runId);
    expect(retry.segmentJobs[0]).toEqual({
      segmentId: reusableJob.segmentId,
      jobId: reusableJob.jobId,
      status: "succeeded",
    });
    expect(retry.segmentJobs[1]!.jobId).not.toBe(failedJob.jobId);
    expect(
      await database
        .select({ id: schema.jobs.id })
        .from(schema.jobs)
        .where(eq(schema.jobs.id, failedJob.jobId)),
    ).toHaveLength(0);
    releaseStale();
    const staleResult = await inFlightStaleWorker;
    const { completeJob } = await import("../lib/jobs");
    await expect(
      completeJob(failedJob.jobId, staleResult, {
        instanceId: staleWorkerId,
      }),
    ).rejects.toThrow("was not found");
    expect(
      (
        await database
          .select({ status: schema.recordingSegments.transcriptStatus })
          .from(schema.recordingSegments)
          .where(eq(schema.recordingSegments.id, failedJob.segmentId))
      )[0]?.status,
    ).toBe("pending");

    let staleProviderCalls = 0;
    await expect(
      runTranscribeSegmentJob(
        { segmentId: failedJob.segmentId, runId: firstRun.runId },
        {
          fetch: audioFetch,
          getProvider: async () => {
            staleProviderCalls += 1;
            throw new Error("A stale worker must not resolve a provider");
          },
        },
      ),
    ).rejects.toThrow("superseded");
    expect(staleProviderCalls).toBe(0);
    await expect(
      runFinalizeTranscriptionJob({
        recordingId: recording.id,
        runId: firstRun.runId,
        pollAttempt: 23,
      }),
    ).resolves.toMatchObject({ status: "superseded" });

    let acceptedAuthorization = "";
    const retriedJob = retry.segmentJobs[1]!;
    const retriedResult = await runTranscribeSegmentJob(
      { segmentId: retriedJob.segmentId, runId: retry.runId },
      {
        fetch: audioFetch,
        getProvider: (userId) =>
          resolveTranscriptionProvider(userId, {
            fetch: async (_url, init) => {
              acceptedAuthorization =
                new Headers(init?.headers).get("authorization") ?? "";
              return Response.json({
                text: "Recovered success",
                language: "fr",
                segments: [{ start: 0.1, end: 0.6, text: "Recovered" }],
              });
            },
          }),
      },
    );
    expect(acceptedAuthorization).toBe("Bearer byok-generation-k2");
    await database
      .update(schema.jobs)
      .set({ status: "succeeded", result: retriedResult, error: null })
      .where(eq(schema.jobs.id, retriedJob.jobId));
    await expect(
      runFinalizeTranscriptionJob({
        recordingId: recording.id,
        runId: retry.runId,
        pollAttempt: 0,
      }),
    ).resolves.toMatchObject({ status: "ready", transcriptSegments: 2 });
    const detail = await apiA.recordings.get({ recordingId: recording.id });
    expect(detail.recording.status).toBe("ready");
    expect(detail.transcript?.text).toBe(
      "Reusable success\n\nRecovered success",
    );
  }, 15_000);

  test("re-enqueues finalization at +60 seconds and stops after 24 polls", async () => {
    const recording = await startRecording("Pending finalization");
    await append(recording.id, 0, 1_000, "pending-audio");
    await apiA.recordings.finish({ recordingId: recording.id });
    const queued = await apiA.recordings.transcribe({
      recordingId: recording.id,
    });
    const { runFinalizeTranscriptionJob } =
      await import("../jobs/transcription");
    const now = new Date("2026-08-20T10:00:00.000Z");
    const pending = await runFinalizeTranscriptionJob(
      { recordingId: recording.id, runId: queued.runId, pollAttempt: 0 },
      { now: () => now },
    );
    expect(pending).toMatchObject({
      status: "pending",
      pollAttempt: 1,
      pendingSeqs: [0],
    });
    if (pending.status !== "pending")
      throw new Error("Expected a pending poll");
    const [next] = await database
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.id, pending.nextJobId));
    expect(next?.runAt.toISOString()).toBe("2026-08-20T10:01:00.000Z");
    expect(next?.idempotencyKey).toBe(`${recording.id}:${queued.runId}:1`);

    const exhausted = await runFinalizeTranscriptionJob({
      recordingId: recording.id,
      runId: queued.runId,
      pollAttempt: 23,
    });
    expect(exhausted).toMatchObject({
      status: "failed",
      pendingSeqs: [0],
    });
    expect(
      (await apiA.recordings.get({ recordingId: recording.id })).recording
        .error,
    ).toContain("timed out");
  });

  test("resumes the latest failed finalize poll instead of reusing succeeded poll zero", async () => {
    const recording = await startRecording("Finalize recovery");
    await append(recording.id, 0, 1_000, "pending-recovery-audio");
    await apiA.recordings.finish({ recordingId: recording.id });
    const queued = await apiA.recordings.transcribe({
      recordingId: recording.id,
    });
    const { runFinalizeTranscriptionJob } =
      await import("../jobs/transcription");
    const firstResult = await runFinalizeTranscriptionJob({
      recordingId: recording.id,
      runId: queued.runId,
      pollAttempt: 0,
    });
    if (firstResult.status !== "pending") {
      throw new Error("Expected the first finalize poll to remain pending");
    }
    await database
      .update(schema.jobs)
      .set({ status: "succeeded", result: firstResult, error: null })
      .where(eq(schema.jobs.id, queued.finalizeJob.jobId));
    await database
      .update(schema.jobs)
      .set({ status: "failed", error: "worker infrastructure failed" })
      .where(eq(schema.jobs.id, firstResult.nextJobId));

    const resumed = await apiA.recordings.transcribe({
      recordingId: recording.id,
    });
    expect(resumed.finalizeJob).toEqual({
      jobId: firstResult.nextJobId,
      status: "queued",
    });
    const [rearmed] = await database
      .select({
        status: schema.jobs.status,
        attempts: schema.jobs.attempts,
        error: schema.jobs.error,
        payload: schema.jobs.payload,
      })
      .from(schema.jobs)
      .where(eq(schema.jobs.id, firstResult.nextJobId));
    expect(rearmed).toEqual({
      status: "queued",
      attempts: 0,
      error: null,
      payload: {
        recordingId: recording.id,
        runId: queued.runId,
        pollAttempt: 1,
      },
    });
  });

  test("does not claim a recording language when one segment has none", async () => {
    const recording = await startRecording("Mixed language confidence");
    await append(recording.id, 0, 1_000, "known-language");
    await append(recording.id, 1, 1_000, "unknown-language");
    await apiA.recordings.finish({ recordingId: recording.id });
    const queued = await apiA.recordings.transcribe({
      recordingId: recording.id,
    });
    const { runFinalizeTranscriptionJob } =
      await import("../jobs/transcription");
    for (const [index, job] of queued.segmentJobs.entries()) {
      await database
        .update(schema.jobs)
        .set({
          status: "succeeded",
          error: null,
          result: {
            segmentId: job.segmentId,
            provider: "mistral",
            text: `Segment ${index}`,
            segments: [{ startMs: 0, endMs: 500, text: `Part ${index}` }],
            ...(index === 0 ? { language: "fr" } : {}),
          },
        })
        .where(eq(schema.jobs.id, job.jobId));
    }
    await expect(
      runFinalizeTranscriptionJob({
        recordingId: recording.id,
        runId: queued.runId,
        pollAttempt: 0,
      }),
    ).resolves.toMatchObject({ status: "ready" });
    expect(
      (await apiA.recordings.get({ recordingId: recording.id })).transcript
        ?.language,
    ).toBeNull();
  });

  test("uses sealed BYOK, invalidates it on 401 and never exposes it", async () => {
    const { runMistralTranscription, transcriptionEnabled } =
      await import("../lib/transcription");
    const { setServiceKey } = await import("../lib/service-keys");
    const secret = "private-transcription-key-9x4f";
    await setServiceKey(userB, "transcription", secret);
    expect(await transcriptionEnabled(userB)).toBe(true);
    let authorization = "";
    let thrown: unknown;
    try {
      await runMistralTranscription(
        userB,
        { blob: new Blob(["audio"]), mimeType: "audio/mp4" },
        {
          fetch: async (_url, init) => {
            authorization =
              new Headers(init?.headers).get("authorization") ?? "";
            return Response.json(
              { message: `invalid credential ${secret}` },
              { status: 401 },
            );
          },
        },
      );
    } catch (error) {
      thrown = error;
    }
    expect(authorization).toBe(`Bearer ${secret}`);
    expect((thrown as Error).message).not.toContain(secret);
    const [row] = await database
      .select({
        status: schema.userServiceKeys.status,
        sealedKey: schema.userServiceKeys.sealedKey,
      })
      .from(schema.userServiceKeys)
      .where(
        and(
          eq(schema.userServiceKeys.userId, userB),
          eq(schema.userServiceKeys.kind, "transcription"),
        ),
      );
    expect(row?.status).toBe("invalid");
    expect(row?.sealedKey).not.toContain(secret);
    expect(await transcriptionEnabled(userB)).toBe(false);
  });
});
