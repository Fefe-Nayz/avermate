import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createRouterClient } from "@orpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

process.env.DATABASE_URL = "file::memory:";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret-that-is-at-least-32-chars";
process.env.CLIENT_URL = "http://localhost:3001";
process.env.NODE_ENV = "test";
process.env.DISABLE_EMAIL = "true";
process.env.DISABLE_UPLOADS = "true";
process.env.DISABLE_JOBS = "true";
process.env.STORAGE_DRIVER = "local";

const migrationDirectory = join(import.meta.dir, "../../drizzle");
const migration = readdirSync(migrationDirectory)
  .filter((file) => /^\d+.*\.sql$/.test(file))
  .sort((left, right) => left.localeCompare(right))
  .map((file) => readFileSync(join(migrationDirectory, file), "utf8"))
  .join("\n");
// Applying the complete migration history through 0060 and releasing its
// relational fixtures can take about 90s on slower Windows/libSQL runners.
const databaseHookTimeout = 120_000;

type AppRouter = typeof import("./index").appRouter;
type Api = ReturnType<
  typeof createRouterClient<AppRouter, Record<never, never>>
>;

let database: typeof import("../db").db;
let schema: typeof import("../db/schema");
let apiA: Api;
let apiB: Api;

const userA = "materials-user-a";
const userB = "materials-user-b";
const yearA = "materials-year-a";
const otherYearA = "materials-year-a-other";
const yearB = "materials-year-b";
const subjectA = "materials-subject-a";
const otherSubjectA = "materials-subject-a-other";

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
        name: "Materials A",
        email: "materials-a@example.com",
        emailVerified: true,
        role: "user",
        banned: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: userB,
        name: "Materials B",
        email: "materials-b@example.com",
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
        name: "Materials year",
        startsAt: new Date("2026-09-01T00:00:00.000Z"),
        endsAt: new Date("2027-07-01T00:00:00.000Z"),
        userId: userA,
      },
      {
        id: otherYearA,
        name: "Other materials year",
        startsAt: new Date("2027-09-01T00:00:00.000Z"),
        endsAt: new Date("2028-07-01T00:00:00.000Z"),
        userId: userA,
      },
      {
        id: yearB,
        name: "Private materials year",
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
        id: otherSubjectA,
        name: "Next year physics",
        yearId: otherYearA,
        userId: userA,
      },
    ])
    .onConflictDoNothing();

  const { appRouter } = await import("./index");
  apiA = createRouterClient(appRouter, {
    context: { headers: new Headers(), session: sessionFor(userA) },
  });
  apiB = createRouterClient(appRouter, {
    context: { headers: new Headers(), session: sessionFor(userB) },
  });
}, databaseHookTimeout);

afterAll(async () => {
  await database
    .delete(schema.materialDocuments)
    .where(inArray(schema.materialDocuments.userId, [userA, userB]));
  await database
    .delete(schema.materialFolders)
    .where(inArray(schema.materialFolders.userId, [userA, userB]));
  await database
    .delete(schema.files)
    .where(inArray(schema.files.userId, [userA, userB]));
  await database
    .delete(schema.users)
    .where(inArray(schema.users.id, [userA, userB]));
}, databaseHookTimeout);

async function storedFile(name: string, mimeType = "application/pdf") {
  const [file] = await database
    .insert(schema.files)
    .values({
      storageKey: `materials-test-${crypto.randomUUID()}`,
      url: `https://example.invalid/${name}`,
      mimeType,
      byteSize: 42,
      purpose: "course-material",
      provider: "test",
      userId: userA,
    })
    .returning();
  return file!;
}

async function ingestionPayload(jobId: string) {
  const [job] = await database
    .select({ payload: schema.jobs.payload })
    .from(schema.jobs)
    .where(eq(schema.jobs.id, jobId));
  const payload = job?.payload as
    { documentId?: unknown; ingestionId?: unknown } | null | undefined;
  if (
    typeof payload?.documentId !== "string" ||
    typeof payload.ingestionId !== "string"
  ) {
    throw new Error(`Missing ingestion payload for job ${jobId}`);
  }
  return {
    documentId: payload.documentId,
    ingestionId: payload.ingestionId,
  };
}

async function fileDocument(
  folderId: string | null,
  title = "Notes.pdf",
  mimeType = "application/pdf",
  yearId = yearA,
) {
  const file = await storedFile(title, mimeType);
  const [document] = await database
    .insert(schema.materialDocuments)
    .values({
      title,
      folderId,
      sourceType: "file",
      fileId: file.id,
      yearId,
      userId: userA,
    })
    .returning();
  return { document: document!, file };
}

describe("materials domain", () => {
  test("creates, renames, lists, moves and reorders folders", async () => {
    const parent = await apiA.materials.folders.create({
      yearId: yearA,
      name: "Mathematics",
      subjectId: subjectA,
    });
    const first = await apiA.materials.folders.create({
      yearId: yearA,
      name: "Chapter 1",
      parentId: parent!.id,
    });
    const second = await apiA.materials.folders.create({
      yearId: yearA,
      name: "Chapter 2",
      parentId: parent!.id,
    });
    const renamed = await apiA.materials.folders.rename({
      folderId: first!.id,
      name: "Sequences",
    });
    expect(renamed?.name).toBe("Sequences");

    await apiA.materials.folders.reorder({
      folderIds: [second!.id, first!.id],
    });
    let children = (
      await apiA.materials.folders.list({ yearId: yearA })
    ).filter((folder) => folder.parentId === parent!.id);
    expect(children.map((folder) => folder.id)).toEqual([
      second!.id,
      first!.id,
    ]);

    await apiA.materials.folders.move({
      folderId: first!.id,
      parentId: null,
      subjectId: null,
    });
    children = (await apiA.materials.folders.list({ yearId: yearA })).filter(
      (folder) => folder.id === first!.id,
    );
    expect(children[0]).toMatchObject({ parentId: null, subjectId: null });
  });

  test("rejects self-parenting and descendant cycles", async () => {
    const parent = await apiA.materials.folders.create({
      yearId: yearA,
      name: "Cycle parent",
    });
    const child = await apiA.materials.folders.create({
      yearId: yearA,
      name: "Cycle child",
      parentId: parent!.id,
    });
    await expect(
      apiA.materials.folders.move({
        folderId: parent!.id,
        parentId: parent!.id,
      }),
    ).rejects.toThrow("own parent");
    await expect(
      apiA.materials.folders.move({
        folderId: parent!.id,
        parentId: child!.id,
      }),
    ).rejects.toThrow("inside itself");
  });

  test("rejects live mutations in a trashed folder", async () => {
    const folder = await apiA.materials.folders.create({
      yearId: yearA,
      name: "Soon trashed",
    });
    await apiA.materials.trash({
      kind: "folder",
      id: folder!.id,
    });

    await expect(
      apiA.materials.folders.create({
        yearId: yearA,
        name: "Hidden child",
        parentId: folder!.id,
      }),
    ).rejects.toThrow("Material folder");
    await expect(
      apiA.materials.documents.createText({
        yearId: yearA,
        folderId: folder!.id,
        title: "Hidden note",
        textContent: "must stay live and visible",
      }),
    ).rejects.toThrow("Material folder");
    await expect(
      apiA.materials.folders.rename({
        folderId: folder!.id,
        name: "Mutated in trash",
      }),
    ).rejects.toThrow("Material folder");
    await apiA.materials.restore({ kind: "folder", id: folder!.id });
  });

  test("rejects parents and subjects from another year", async () => {
    const otherParent = await apiA.materials.folders.create({
      yearId: otherYearA,
      name: "Next year",
    });
    await expect(
      apiA.materials.folders.create({
        yearId: yearA,
        name: "Cross-year parent",
        parentId: otherParent!.id,
      }),
    ).rejects.toThrow("same year");
    await expect(
      apiA.materials.folders.create({
        yearId: yearA,
        name: "Cross-year subject",
        subjectId: otherSubjectA,
      }),
    ).rejects.toThrow("same year");
  });

  test("creates text and link sources with exclusive source columns", async () => {
    const text = await apiA.materials.documents.createText({
      yearId: yearA,
      title: "Definition",
      textContent: "A convergent sequence has a finite limit.",
    });
    const link = await apiA.materials.documents.createLink({
      yearId: yearA,
      url: "https://example.com/course/chapter-1/",
    });
    expect(text.document).toMatchObject({
      sourceType: "text",
      fileId: null,
      sourceUrl: null,
      textContent: "A convergent sequence has a finite limit.",
    });
    expect(link.document).toMatchObject({
      title: "example.com/course/chapter-1",
      sourceType: "link",
      fileId: null,
      sourceUrl: "https://example.com/course/chapter-1/",
      textContent: null,
    });
    expect(link.ingestion).toMatchObject({ status: "pending" });
    const summaries = await apiA.materials.documents.list({ yearId: yearA });
    const textSummary = summaries.find(
      (row) => row.document.id === text.document!.id,
    );
    expect(textSummary?.document).not.toHaveProperty("textContent");
    expect(textSummary?.document).not.toHaveProperty("metaJson");
    expect(textSummary?.document).not.toHaveProperty("userId");
    expect(
      await apiA.materials.documents.get({ documentId: text.document!.id }),
    ).toMatchObject({
      document: {
        textContent: "A convergent sequence has a finite limit.",
      },
    });
    expect(
      await apiA.materials.documents.transcript({
        documentId: link.document!.id,
      }),
    ).toEqual({
      status: "pending",
      content: null,
      meta: null,
      error: null,
    });
    const [job] = await database
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.id, link.ingestion.jobId));
    expect(job).toMatchObject({
      kind: "ingest.link",
      payload: { documentId: link.document!.id },
      status: "queued",
    });
  });

  test("rejects unsafe link syntax before persisting a material or job", async () => {
    const [documentsBefore, jobsBefore] = await Promise.all([
      database
        .select({ id: schema.materialDocuments.id })
        .from(schema.materialDocuments),
      database.select({ id: schema.jobs.id }).from(schema.jobs),
    ]);

    await expect(
      apiA.materials.documents.createLink({
        yearId: yearA,
        url: "https://student:secret@example.com/private-course",
      }),
    ).rejects.toThrow("cannot contain credentials");
    await expect(
      apiA.materials.documents.createLink({
        yearId: yearA,
        url: "ftp://example.com/course",
      }),
    ).rejects.toThrow("Only public HTTP and HTTPS");

    expect(
      await database
        .select({ id: schema.materialDocuments.id })
        .from(schema.materialDocuments),
    ).toHaveLength(documentsBefore.length);
    expect(
      await database.select({ id: schema.jobs.id }).from(schema.jobs),
    ).toHaveLength(jobsBefore.length);
  });

  test("ingests a web article, exposes provenance and improves only a derived title", async () => {
    const { runIngestLinkJob } = await import("../jobs/ingest-link");
    const link = await apiA.materials.documents.createLink({
      yearId: yearA,
      url: "https://example.com/old-path",
    });
    const fetchedAt = new Date("2026-08-20T12:00:00.000Z");
    await expect(
      runIngestLinkJob(await ingestionPayload(link.ingestion.jobId), {
        fetchArticle: async () => ({
          body: new Uint8Array(),
          html: "<article>stubbed by the extractor</article>",
          finalUrl: "https://example.com/canonical-course",
          contentType: "text/html",
        }),
        extractMarkdown: () => ({
          markdown: "> Source : canonical\n\n# Limits\n\nReadable lesson.",
          title: "Limits and continuity",
          byline: "Ada Teacher",
        }),
        now: () => fetchedAt,
      }),
    ).resolves.toMatchObject({
      kind: "article",
      artifactKind: "web-markdown",
      title: "Limits and continuity",
    });

    expect(
      await apiA.materials.documents.transcript({
        documentId: link.document!.id,
      }),
    ).toEqual({
      status: "ready",
      content: "> Source : canonical\n\n# Limits\n\nReadable lesson.",
      meta: {
        finalUrl: "https://example.com/canonical-course",
        fetchedAt: fetchedAt.toISOString(),
        title: "Limits and continuity",
        byline: "Ada Teacher",
        kind: "web",
      },
      error: null,
    });
    expect(
      (
        await apiA.materials.documents.get({
          documentId: link.document!.id,
        })
      )?.document,
    ).toMatchObject({
      title: "Limits and continuity",
      sourceType: "link",
      sourceUrl: "https://example.com/old-path",
      metaJson: {
        externalId: "https://example.com/canonical-course",
        titleWasDerived: false,
      },
    });

    const manual = await apiA.materials.documents.createLink({
      yearId: yearA,
      url: "https://example.com/manual-title",
    });
    await apiA.materials.documents.rename({
      documentId: manual.document!.id,
      title: "My chosen title",
    });
    await runIngestLinkJob(await ingestionPayload(manual.ingestion.jobId), {
      fetchArticle: async () => ({
        body: new Uint8Array(),
        html: "<article>stubbed by the extractor</article>",
        finalUrl: "https://example.com/manual-title",
        contentType: "text/html",
      }),
      extractMarkdown: () => ({
        markdown: "Readable article",
        title: "Remote title",
        byline: null,
      }),
    });
    expect(
      (
        await apiA.materials.documents.get({
          documentId: manual.document!.id,
        })
      )?.document.title,
    ).toBe("My chosen title");
  });

  test("ingests YouTube captions inside the durable link job", async () => {
    const { runIngestLinkJob } = await import("../jobs/ingest-link");
    const link = await apiA.materials.documents.createLink({
      yearId: yearA,
      url: "https://youtu.be/dQw4w9WgXcQ?t=30",
    });
    const fetchedAt = new Date("2026-08-21T10:00:00.000Z");
    const result = await runIngestLinkJob(
      await ingestionPayload(link.ingestion.jobId),
      {
        fetchArticle: async () => {
          throw new Error("generic fetching must not run for YouTube");
        },
        ingestYoutube: async () => ({
          markdown: '---\nsite: "YouTube"\n---\n\n## 0:00\n\nA caption.',
          title: "Limits on video",
          channel: "Ada Teacher",
          finalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          videoId: "dQw4w9WgXcQ",
          durationSec: 120,
          chapters: [
            { at: 0, title: "Introduction" },
            { at: 30, title: "Proof" },
            { at: 90, title: "Exercises" },
          ],
          segments: [{ startMs: 2_500, endMs: 4_750, text: "A caption." }],
          wordCount: 2,
          truncated: false,
        }),
        now: () => fetchedAt,
      },
    );
    expect(result).toMatchObject({
      kind: "youtube",
      artifactKind: "web-markdown",
      videoId: "dQw4w9WgXcQ",
    });
    expect(
      await apiA.materials.documents.transcript({
        documentId: link.document!.id,
      }),
    ).toMatchObject({
      status: "ready",
      meta: {
        kind: "youtube",
        videoId: "dQw4w9WgXcQ",
        channel: "Ada Teacher",
        durationSec: 120,
        chapters: expect.arrayContaining([{ at: 0, title: "Introduction" }]),
      },
    });
    expect(
      (
        await apiA.materials.documents.get({
          documentId: link.document!.id,
        })
      )?.document.metaJson,
    ).toMatchObject({
      kind: "youtube",
      videoId: "dQw4w9WgXcQ",
      channel: "Ada Teacher",
      durationSec: 120,
      chapters: expect.arrayContaining([{ at: 0, title: "Introduction" }]),
    });
    const summary = (
      await apiA.materials.documents.list({ yearId: yearA })
    ).find((row) => row.document.id === link.document!.id);
    expect(summary?.document.sourceKind).toBe("youtube");
    expect(summary?.document.thumbnailUrl).toBeNull();
    const exactSegments = await database.$client.execute({
      sql: `
        SELECT segments.text, segments.locatorJson
        FROM material_artifact_segments AS segments
        JOIN material_artifacts AS artifacts ON artifacts.id = segments.artifactId
        WHERE artifacts.documentId = ? AND artifacts.kind = 'web-markdown'
        ORDER BY segments.ordinal
      `,
      args: [link.document!.id],
    });
    expect(exactSegments.rows).toHaveLength(1);
    expect(exactSegments.rows[0]?.text).toBe("A caption.");
    expect(JSON.parse(String(exactSegments.rows[0]?.locatorJson))).toEqual({
      kind: "video",
      startMs: 2_500,
      endMs: 4_750,
    });
  });

  test("never delegates a sparse page to an unpinned remote renderer", async () => {
    const { IngestError } = await import("../lib/ingest");
    const { runIngestLinkJob } = await import("../jobs/ingest-link");
    const link = await apiA.materials.documents.createLink({
      yearId: yearA,
      url: "https://example.com/client-rendered-course",
    });
    let rendererCalls = 0;
    const options = {
      fetchArticle: async () => ({
        body: new Uint8Array(20_000),
        html: "<main id=app></main>",
        finalUrl: "https://example.com/client-rendered-course",
        contentType: "text/html",
      }),
      extractMarkdown: () => {
        throw new IngestError(
          "The page has no extractable article content",
          false,
        );
      },
      // Deliberately shaped like the removed Browserless options. The cast
      // proves that even stale callers/config cannot re-enable this unsafe path.
      renderServiceUrl: "http://browserless.internal/content",
      fetchRenderedArticle: async () => {
        rendererCalls += 1;
        return "<article>Rendered lesson</article>";
      },
    } as unknown as NonNullable<Parameters<typeof runIngestLinkJob>[1]>;
    await expect(
      runIngestLinkJob(await ingestionPayload(link.ingestion.jobId), options),
    ).rejects.toThrow("no extractable article content");
    expect(rendererCalls).toBe(0);
  });

  test("records terminal link failures without leaving partial content", async () => {
    const { IngestError } = await import("../lib/ingest");
    const { runIngestLinkJob } = await import("../jobs/ingest-link");
    const { NonRetryableJobError } = await import("../lib/jobs");
    const link = await apiA.materials.documents.createLink({
      yearId: yearA,
      title: "Missing page",
      url: "https://example.com/missing",
    });

    await expect(
      runIngestLinkJob(await ingestionPayload(link.ingestion.jobId), {
        fetchArticle: async () => {
          throw new IngestError("The source page returned HTTP 404", false);
        },
      }),
    ).rejects.toBeInstanceOf(NonRetryableJobError);
    expect(
      await apiA.materials.documents.transcript({
        documentId: link.document!.id,
      }),
    ).toEqual({
      status: "failed",
      content: null,
      meta: null,
      error: "The source page returned HTTP 404",
    });
  });

  test("turns a fetched PDF into a stored source and hands it to OCR", async () => {
    const { runIngestLinkJob } = await import("../jobs/ingest-link");
    const link = await apiA.materials.documents.createLink({
      yearId: yearA,
      url: "https://example.com/files/lecture.pdf",
    });
    const stored = await storedFile("remote-lecture.pdf");
    const result = await runIngestLinkJob(
      await ingestionPayload(link.ingestion.jobId),
      {
        fetchArticle: async () => ({
          body: new TextEncoder().encode("%PDF-1.7"),
          html: null,
          finalUrl: "https://cdn.example.com/lecture.pdf",
          contentType: "application/pdf",
        }),
        storeFile: async ({ file }) => {
          expect(file.name).toBe("lecture.pdf");
          expect(file.type).toBe("application/pdf");
          return stored;
        },
      },
    );
    expect(result).toMatchObject({ kind: "pdf", fileId: stored.id });
    if (result.kind !== "pdf") throw new Error("Expected the PDF branch");
    expect(
      (
        await apiA.materials.documents.get({
          documentId: link.document!.id,
        })
      )?.document,
    ).toMatchObject({
      title: "lecture",
      sourceType: "file",
      fileId: stored.id,
      sourceUrl: null,
      textContent: null,
    });
    expect(
      await apiA.materials.documents.transcript({
        documentId: link.document!.id,
      }),
    ).toEqual({
      status: "pending",
      content: null,
      meta: null,
      error: null,
    });
    const [ocrJob] = await database
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.id, result.jobId));
    expect(ocrJob).toMatchObject({
      kind: "ocr.document",
      payload: { documentId: link.document!.id },
      status: "queued",
    });
    const [previewJob] = await database
      .select()
      .from(schema.jobs)
      .where(
        and(
          eq(schema.jobs.kind, "materials.preview"),
          eq(schema.jobs.idempotencyKey, stored.id),
        ),
      );
    expect(previewJob).toMatchObject({
      payload: { fileId: stored.id },
      status: "queued",
    });
    expect(
      await database
        .select()
        .from(schema.materialArtifacts)
        .where(eq(schema.materialArtifacts.documentId, link.document!.id)),
    ).toHaveLength(1);
  });

  test("concurrent PDF ingestions converge on one owned file and one OCR job", async () => {
    const { runIngestLinkJob } = await import("../jobs/ingest-link");
    const link = await apiA.materials.documents.createLink({
      yearId: yearA,
      url: "https://example.com/concurrent.pdf",
    });
    const candidates = [
      await storedFile("concurrent-a.pdf"),
      await storedFile("concurrent-b.pdf"),
    ];
    let storeIndex = 0;
    let releaseStores!: () => void;
    const bothStored = new Promise<void>((resolve) => {
      releaseStores = resolve;
    });
    const storeFile = async () => {
      const index = storeIndex++;
      if (storeIndex === 2) releaseStores();
      await bothStored;
      return candidates[index]!;
    };
    const payload = await ingestionPayload(link.ingestion.jobId);
    const run = () =>
      runIngestLinkJob(payload, {
        fetchArticle: async () => ({
          body: new TextEncoder().encode("%PDF-1.7"),
          html: null,
          finalUrl: "https://example.com/concurrent.pdf",
          contentType: "application/pdf",
        }),
        storeFile,
      });

    const [first, second] = await Promise.all([run(), run()]);
    expect(first).toEqual(second);
    expect(first.kind).toBe("pdf");
    if (first.kind !== "pdf" || second.kind !== "pdf") {
      throw new Error("Expected both concurrent runs to resolve as PDFs");
    }
    const rows = await database
      .select()
      .from(schema.files)
      .where(
        inArray(
          schema.files.id,
          candidates.map((file) => file.id),
        ),
      );
    expect(rows.filter((file) => file.status === "stored")).toHaveLength(1);
    expect(rows.filter((file) => file.status === "deleted")).toHaveLength(1);
    const owned = rows.find((file) => file.status === "stored");
    expect(owned).toBeDefined();
    expect(first.fileId).toBe(owned!.id);
    const ocrJobs = (
      await database
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.kind, "ocr.document"))
    ).filter(
      (job) =>
        (job.payload as { documentId?: string } | null)?.documentId ===
        link.document!.id,
    );
    expect(ocrJobs).toHaveLength(1);
  });

  test("keeps an adopted PDF when the worker loses the transition acknowledgement", async () => {
    const { runIngestLinkJob } = await import("../jobs/ingest-link");
    const link = await apiA.materials.documents.createLink({
      yearId: yearA,
      url: "https://example.com/lost-ack.pdf",
    });
    const stored = await storedFile("lost-ack.pdf");

    const result = await runIngestLinkJob(
      await ingestionPayload(link.ingestion.jobId),
      {
        fetchArticle: async () => ({
          body: new TextEncoder().encode("%PDF-1.7"),
          html: null,
          finalUrl: "https://example.com/lost-ack.pdf",
          contentType: "application/pdf",
        }),
        storeFile: async () => stored,
        afterPdfTransition: () => {
          throw new Error("simulated lost acknowledgement");
        },
      },
    );

    expect(result).toMatchObject({ kind: "pdf", fileId: stored.id });
    const [file] = await database
      .select({ status: schema.files.status })
      .from(schema.files)
      .where(eq(schema.files.id, stored.id));
    expect(file?.status).toBe("stored");
    const current = await apiA.materials.documents.get({
      documentId: link.document!.id,
    });
    expect(current?.document).toMatchObject({
      sourceType: "file",
      fileId: stored.id,
    });
  });

  test("records a durable cleanup when deleting a losing PDF fails", async () => {
    const { runCleanupUnownedFileJob, runIngestLinkJob } =
      await import("../jobs/ingest-link");
    const link = await apiA.materials.documents.createLink({
      yearId: yearA,
      url: "https://example.com/cleanup-race.pdf",
    });
    const candidates = [
      await storedFile("cleanup-race-a.pdf"),
      await storedFile("cleanup-race-b.pdf"),
    ];
    const payload = await ingestionPayload(link.ingestion.jobId);
    let storeIndex = 0;
    let releaseStores!: () => void;
    const bothStored = new Promise<void>((resolve) => {
      releaseStores = resolve;
    });
    const run = () =>
      runIngestLinkJob(payload, {
        fetchArticle: async () => ({
          body: new TextEncoder().encode("%PDF-1.7"),
          html: null,
          finalUrl: "https://example.com/cleanup-race.pdf",
          contentType: "application/pdf",
        }),
        storeFile: async () => {
          const index = storeIndex++;
          if (storeIndex === 2) releaseStores();
          await bothStored;
          return candidates[index]!;
        },
        deleteFile: async () => {
          throw new Error("provider temporarily unavailable");
        },
      });

    const [first, second] = await Promise.all([run(), run()]);
    expect(first).toEqual(second);
    if (first.kind !== "pdf") throw new Error("Expected the PDF branch");
    const cleanupJobs = (
      await database
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.kind, "cleanup.unownedFile"))
    ).filter((job) => {
      const cleanup = job.payload as { fileId?: string } | null;
      return candidates.some((candidate) => candidate.id === cleanup?.fileId);
    });
    expect(cleanupJobs).toHaveLength(1);
    const cleanupPayload = cleanupJobs[0]!.payload as {
      userId: string;
      fileId: string;
    };
    expect(cleanupPayload.fileId).not.toBe(first.fileId);

    await expect(runCleanupUnownedFileJob(cleanupPayload)).resolves.toEqual({
      deleted: true,
      referenced: false,
    });
    const [loser] = await database
      .select({ status: schema.files.status })
      .from(schema.files)
      .where(eq(schema.files.id, cleanupPayload.fileId));
    expect(loser?.status).toBe("deleted");
  });

  test("does not revive a web artifact after a concurrent PDF conversion", async () => {
    const { runIngestLinkJob } = await import("../jobs/ingest-link");
    const link = await apiA.materials.documents.createLink({
      yearId: yearA,
      url: "https://example.com/pdf-wins",
    });
    const payload = await ingestionPayload(link.ingestion.jobId);
    const stored = await storedFile("pdf-wins.pdf");
    let announceStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      announceStarted = resolve;
    });
    let releaseOld!: () => void;
    const oldCanFinish = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    const oldRun = runIngestLinkJob(payload, {
      fetchArticle: async () => {
        announceStarted();
        await oldCanFinish;
        return {
          body: new Uint8Array(),
          html: "<article>stale web result</article>",
          finalUrl: "https://example.com/pdf-wins",
          contentType: "text/html",
        };
      },
      extractMarkdown: () => ({
        markdown: "Stale web result",
        title: "Stale title",
        byline: null,
      }),
    });
    await started;
    const winner = await runIngestLinkJob(payload, {
      fetchArticle: async () => ({
        body: new TextEncoder().encode("%PDF-1.7"),
        html: null,
        finalUrl: "https://example.com/pdf-wins.pdf",
        contentType: "application/pdf",
      }),
      storeFile: async () => stored,
    });
    releaseOld();
    await expect(oldRun).resolves.toEqual(winner);
    expect(winner).toMatchObject({ kind: "pdf", fileId: stored.id });
    expect(
      await database
        .select({ kind: schema.materialArtifacts.kind })
        .from(schema.materialArtifacts)
        .where(eq(schema.materialArtifacts.documentId, link.document!.id)),
    ).toEqual([{ kind: "ocr-markdown" }]);
  });

  test("preserves a manual rename made while an article is being fetched", async () => {
    const { runIngestLinkJob } = await import("../jobs/ingest-link");
    const link = await apiA.materials.documents.createLink({
      yearId: yearA,
      url: "https://example.com/rename-during-fetch",
    });
    let announceStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      announceStarted = resolve;
    });
    let releaseFetch!: () => void;
    const canFinish = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    const running = runIngestLinkJob(
      await ingestionPayload(link.ingestion.jobId),
      {
        fetchArticle: async () => {
          announceStarted();
          await canFinish;
          return {
            body: new Uint8Array(),
            html: "<article>remote result</article>",
            finalUrl: "https://example.com/rename-during-fetch",
            contentType: "text/html",
          };
        },
        extractMarkdown: () => ({
          markdown: "Remote result",
          title: "Remote title",
          byline: null,
        }),
      },
    );
    await started;
    await apiA.materials.documents.rename({
      documentId: link.document!.id,
      title: "Manual title during fetch",
    });
    releaseFetch();
    await running;
    expect(
      (
        await apiA.materials.documents.get({
          documentId: link.document!.id,
        })
      )?.document.title,
    ).toBe("Manual title during fetch");
  });

  test("does not let an obsolete failure replace a newer ready article", async () => {
    const { IngestError } = await import("../lib/ingest");
    const { runIngestLinkJob } = await import("../jobs/ingest-link");
    const { NonRetryableJobError } = await import("../lib/jobs");
    const link = await apiA.materials.documents.createLink({
      yearId: yearA,
      url: "https://example.com/newer-result",
    });
    const payload = await ingestionPayload(link.ingestion.jobId);
    let announceStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      announceStarted = resolve;
    });
    let releaseFailure!: () => void;
    const canFail = new Promise<void>((resolve) => {
      releaseFailure = resolve;
    });
    const staleRun = runIngestLinkJob(payload, {
      fetchArticle: async () => {
        announceStarted();
        await canFail;
        throw new IngestError("The stale source returned HTTP 404", false);
      },
    });
    await started;
    await runIngestLinkJob(payload, {
      fetchArticle: async () => ({
        body: new Uint8Array(),
        html: "<article>new result</article>",
        finalUrl: "https://example.com/newer-result",
        contentType: "text/html",
      }),
      extractMarkdown: () => ({
        markdown: "The newer result",
        title: "Newer result",
        byline: null,
      }),
    });
    releaseFailure();
    await expect(staleRun).rejects.toBeInstanceOf(NonRetryableJobError);
    expect(
      await apiA.materials.documents.transcript({
        documentId: link.document!.id,
      }),
    ).toMatchObject({
      status: "ready",
      content: "The newer result",
      error: null,
    });
  });

  test("repairs a converted PDF whose OCR enqueue was interrupted", async () => {
    const { runIngestLinkJob } = await import("../jobs/ingest-link");
    const link = await apiA.materials.documents.createLink({
      yearId: yearA,
      url: "https://example.com/interrupted.pdf",
    });
    const stored = await storedFile("interrupted.pdf");
    await database
      .update(schema.materialDocuments)
      .set({
        sourceType: "file",
        fileId: stored.id,
        sourceUrl: null,
        metaJson: {
          externalId: "https://example.com/interrupted.pdf",
          titleWasDerived: false,
        },
      })
      .where(eq(schema.materialDocuments.id, link.document!.id));
    await database
      .update(schema.materialArtifacts)
      .set({
        kind: "ocr-markdown",
        status: "failed",
        error: "queue unavailable",
      })
      .where(eq(schema.materialArtifacts.documentId, link.document!.id));

    const result = await runIngestLinkJob(
      { documentId: link.document!.id },
      {
        fetchArticle: async () => {
          throw new Error("A converted PDF must not be fetched again");
        },
      },
    );
    expect(result).toMatchObject({
      kind: "pdf",
      fileId: stored.id,
    });
    if (result.kind !== "pdf") throw new Error("Expected the repaired PDF");
    expect(
      await apiA.materials.documents.transcript({
        documentId: link.document!.id,
      }),
    ).toEqual({
      status: "pending",
      content: null,
      meta: null,
      error: null,
    });
    const [job] = await database
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.id, result.jobId));
    expect(job).toMatchObject({ kind: "ocr.document", status: "queued" });
  });

  test("reingests links with a fresh ledger key and rejects other sources", async () => {
    const note = await apiA.materials.documents.createText({
      yearId: yearA,
      title: "Not a link",
      textContent: "Inline material",
    });
    await expect(
      apiA.materials.documents.reingest({ documentId: note.document!.id }),
    ).rejects.toThrow("Only web-link materials");

    const link = await apiA.materials.documents.createLink({
      yearId: yearA,
      url: "https://example.com/retry",
    });
    const retried = await apiA.materials.documents.reingest({
      documentId: link.document!.id,
    });
    expect(retried.status).toBe("pending");
    expect(retried.jobId).not.toBe(link.ingestion.jobId);
    const rows = await database
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.kind, "ingest.link"));
    expect(
      rows.filter(
        (job) =>
          (job.payload as { documentId?: string } | null)?.documentId ===
          link.document!.id,
      ),
    ).toHaveLength(2);
  });

  test("enforces the inline text limit in UTF-8 bytes", async () => {
    await expect(
      apiA.materials.documents.createText({
        yearId: yearA,
        title: "Too large",
        textContent: "é".repeat(128 * 1024 + 1),
      }),
    ).rejects.toThrow("256 KiB");
  });

  test("rejects an upload through the shared disabled-storage boundary", async () => {
    await expect(
      apiA.materials.documents.upload({
        yearId: yearA,
        file: new File(["%PDF"], "lesson.pdf", { type: "application/pdf" }),
      }),
    ).rejects.toThrow("Course-material uploads are not configured");
    expect((await apiA.materials.documents.uploadsEnabled()).enabled).toBe(
      false,
    );
  });

  test("uploads a personal PDF into an owned folder and exposes it immediately", async () => {
    const { createMaterialDocumentsRouter } =
      await import("./materials/documents");
    const corpusEnqueues: Array<{
      ownerId: string;
      originKind: string;
      originId: string;
    }> = [];
    const router = {
      materials: {
        documents: createMaterialDocumentsRouter({
          storageEnabled: () => true,
          storeFile: async ({ userId, purpose, file }) => {
            const [stored] = await database
              .insert(schema.files)
              .values({
                storageKey: `materials-upload-${crypto.randomUUID()}`,
                url: `https://example.invalid/${encodeURIComponent(file.name)}`,
                mimeType: file.type,
                byteSize: file.size,
                purpose,
                provider: "test",
                userId,
              })
              .returning();
            if (!stored) throw new Error("Upload fixture was not stored");
            return stored;
          },
          enqueueCorpusIndex: async (identity) => {
            const [adopted] = await database
              .select({ id: schema.materialDocuments.id })
              .from(schema.materialDocuments)
              .where(eq(schema.materialDocuments.id, identity.originId));
            expect(adopted?.id).toBe(identity.originId);
            corpusEnqueues.push(identity);
          },
        }),
      },
    };
    const uploadApi = createRouterClient(router, {
      context: { headers: new Headers(), session: sessionFor(userA) },
    });
    const folder = await apiA.materials.folders.create({
      yearId: yearA,
      name: "Personal uploads",
    });
    const file = new File(
      ["%PDF-1.7\nowned material\n%%EOF"],
      "My course.pdf",
      {
        type: "application/pdf",
      },
    );

    expect(await uploadApi.materials.documents.uploadsEnabled()).toMatchObject({
      enabled: true,
      maxBytes: 50 * 1024 * 1024,
      mimeTypes: expect.arrayContaining(["application/pdf"]),
    });
    const uploaded = await uploadApi.materials.documents.upload({
      yearId: yearA,
      folderId: folder!.id,
      file,
    });
    expect(uploaded).toMatchObject({
      document: {
        title: "My course.pdf",
        folderId: folder!.id,
        sourceType: "file",
        origin: "manual",
        yearId: yearA,
        userId: userA,
      },
      file: {
        mimeType: "application/pdf",
        byteSize: file.size,
        status: "stored",
      },
    });
    expect(corpusEnqueues).toEqual([
      {
        ownerId: userA,
        originKind: "material",
        originId: uploaded.document!.id,
      },
    ]);

    expect(
      await uploadApi.materials.documents.download({
        documentId: uploaded.document!.id,
      }),
    ).toMatchObject({
      title: "My course.pdf",
      mimeType: "application/pdf",
      byteSize: file.size,
    });
    expect(
      await uploadApi.materials.documents.list({
        yearId: yearA,
        folderId: folder!.id,
      }),
    ).toEqual([
      expect.objectContaining({
        document: expect.objectContaining({ id: uploaded.document!.id }),
        file: expect.objectContaining({ id: uploaded.file.id }),
      }),
    ]);

    await uploadApi.materials.documents.delete({
      documentId: uploaded.document!.id,
    });
    const [trashedDocument] = await database
      .select({ deletedAt: schema.materialDocuments.deletedAt })
      .from(schema.materialDocuments)
      .where(eq(schema.materialDocuments.id, uploaded.document!.id));
    expect(trashedDocument?.deletedAt).toBeInstanceOf(Date);
    const [retainedFile] = await database
      .select({ status: schema.files.status })
      .from(schema.files)
      .where(eq(schema.files.id, uploaded.file.id));
    expect(retainedFile?.status).toBe("stored");

    await uploadApi.materials.documents.delete({
      documentId: uploaded.document!.id,
    });
    const [deletedFile] = await database
      .select({ status: schema.files.status })
      .from(schema.files)
      .where(eq(schema.files.id, uploaded.file.id));
    expect(deletedFile?.status).toBe("deleted");
  });

  test("reserves a durable server-side upload slot before provider storage", async () => {
    const { createMaterialDocumentsRouter } =
      await import("./materials/documents");
    const steps: string[] = [];
    const router = {
      materials: {
        documents: createMaterialDocumentsRouter({
          storageEnabled: () => true,
          reserveUpload: async (input) => {
            steps.push(`reserve:${input.action}`);
            throw new Error("upload rate limit reached");
          },
          storeFile: async () => {
            steps.push("store");
            throw new Error("provider storage must not run");
          },
        }),
      },
    };
    const uploadApi = createRouterClient(router, {
      context: { headers: new Headers(), session: sessionFor(userA) },
    });

    await expect(
      uploadApi.materials.documents.upload({
        yearId: yearA,
        file: new File(["%PDF"], "bounded.pdf", {
          type: "application/pdf",
        }),
      }),
    ).rejects.toThrow("upload rate limit reached");
    expect(steps).toEqual(["reserve:materials.document.upload"]);
  });

  test("adopts a direct upload exactly once across request replays", async () => {
    const { createMaterialDocumentsRouter } =
      await import("./materials/documents");
    const candidate = await storedFile("direct-replay.pdf");
    let deleteCalls = 0;
    const router = {
      materials: {
        documents: createMaterialDocumentsRouter({
          storageEnabled: () => true,
          reserveUpload: async () => undefined,
          requireUploadedFile: async () => candidate,
          deleteFile: async () => {
            deleteCalls += 1;
            return candidate;
          },
        }),
      },
    };
    const uploadApi = createRouterClient(router, {
      context: { headers: new Headers(), session: sessionFor(userA) },
    });
    const input = {
      yearId: yearA,
      fileId: candidate.id,
      fileName: "direct-replay.pdf",
    };

    const [first, replay] = await Promise.all([
      uploadApi.materials.documents.upload(input),
      uploadApi.materials.documents.upload(input),
    ]);

    expect(replay.document?.id).toBe(first.document?.id);
    expect(deleteCalls).toBe(0);
    expect(
      await database
        .select({ id: schema.materialDocuments.id })
        .from(schema.materialDocuments)
        .where(eq(schema.materialDocuments.fileId, candidate.id)),
    ).toHaveLength(1);
    const corpusJobs = await database
      .select({ payload: schema.jobs.payload })
      .from(schema.jobs)
      .where(eq(schema.jobs.kind, "corpus.indexSource"));
    expect(
      corpusJobs.filter(
        (job) =>
          (job.payload as { originId?: string } | null)?.originId ===
          first.document?.id,
      ),
    ).toHaveLength(1);
  });

  test("resolves preview URLs in one owned batch", async () => {
    const fixture = await fileDocument(null, "preview-source.pdf");
    const previewUrl = `https://example.invalid/${crypto.randomUUID()}.webp`;
    const [preview] = await database
      .insert(schema.files)
      .values({
        storageKey: `material-preview-${crypto.randomUUID()}`,
        url: previewUrl,
        mimeType: "image/webp",
        byteSize: 42,
        purpose: "preview",
        provider: "test",
        previewStatus: "unsupported",
        userId: userA,
      })
      .returning();
    await database
      .update(schema.files)
      .set({ previewFileId: preview!.id, previewStatus: "ready" })
      .where(eq(schema.files.id, fixture.file.id));

    await expect(
      apiB.materials.documents.previewUrls({
        documentIds: [fixture.document.id],
      }),
    ).rejects.toThrow("unavailable");
    expect(
      await apiA.materials.documents.previewUrls({
        documentIds: [fixture.document.id],
      }),
    ).toEqual([{ documentId: fixture.document.id, url: previewUrl }]);
  });

  test("lists, renames, moves, gets and downloads a stored file", async () => {
    const folder = await apiA.materials.folders.create({
      yearId: yearA,
      name: "Downloads",
    });
    const fixture = await fileDocument(null, "lecture.pdf");
    const renamed = await apiA.materials.documents.rename({
      documentId: fixture.document.id,
      title: "Lecture notes",
    });
    expect(renamed?.title).toBe("Lecture notes");
    await apiA.materials.documents.move({
      documentId: fixture.document.id,
      folderId: folder!.id,
    });
    const listed = await apiA.materials.documents.list({
      yearId: yearA,
      folderId: folder!.id,
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.file).not.toHaveProperty("url");
    expect(listed[0]?.file).not.toHaveProperty("provider");
    expect(listed[0]?.file).not.toHaveProperty("storageKey");
    expect(
      (await apiA.materials.documents.get({ documentId: fixture.document.id }))
        ?.document.folderId,
    ).toBe(folder!.id);
    expect(
      await apiA.materials.documents.download({
        documentId: fixture.document.id,
      }),
    ).toMatchObject({ url: fixture.file.url, mimeType: "application/pdf" });

    const { createMaterialDocumentsRouter } =
      await import("./materials/documents");
    let requestedExpiration: string | undefined;
    const previewApi = createRouterClient(
      {
        materials: {
          documents: createMaterialDocumentsRouter({
            fileAccessUrl: async (_file, options) => {
              requestedExpiration = options?.expiresIn;
              return fixture.file.url;
            },
          }),
        },
      },
      { context: { headers: new Headers(), session: sessionFor(userA) } },
    );
    await previewApi.materials.documents.download({
      documentId: fixture.document.id,
    });
    expect(requestedExpiration).toBe("6h");
  });

  test("stars, tags, trashes and restores every materials row kind", async () => {
    const parent = await apiA.materials.folders.create({
      yearId: yearA,
      name: "Recoverable parent",
    });
    const folder = await apiA.materials.folders.create({
      yearId: yearA,
      name: "Recoverable child",
      parentId: parent!.id,
    });
    const material = await apiA.materials.documents.createText({
      yearId: yearA,
      folderId: folder!.id,
      title: "Recoverable source",
      textContent: "Keep me",
    });
    const [study] = await database
      .insert(schema.studyDocuments)
      .values({
        title: "Recoverable fiche",
        folderId: folder!.id,
        yearId: yearA,
        userId: userA,
      })
      .returning();
    const [recording] = await database
      .insert(schema.lectureRecordings)
      .values({
        title: "Recoverable recording",
        status: "uploaded",
        recordedAt: new Date(),
        folderId: folder!.id,
        yearId: yearA,
        userId: userA,
      })
      .returning();
    const targets = [
      { kind: "folder" as const, id: folder!.id },
      { kind: "document" as const, id: material.document!.id },
      { kind: "study" as const, id: study!.id },
      { kind: "recording" as const, id: recording!.id },
    ];
    for (const target of targets) {
      expect(
        (await apiA.materials.star({ ...target, starred: true })).starredAt,
      ).toBeInstanceOf(Date);
    }

    const tag = await apiA.materials.tags.create({
      yearId: yearA,
      name: "Exam review",
      color: "indigo",
      subjectId: subjectA,
    });
    expect(
      await apiA.materials.tags.assign({
        tagId: tag.id,
        targets,
        assigned: true,
      }),
    ).toEqual({ count: 4 });
    expect(
      await apiA.materials.tags.assign({
        tagId: tag.id,
        targets,
        assigned: true,
      }),
    ).toEqual({ count: 0 });

    const folderRow = (
      await apiA.materials.folders.list({ yearId: yearA })
    ).find((row) => row.id === folder!.id);
    const materialRow = (
      await apiA.materials.documents.list({ yearId: yearA })
    ).find((row) => row.document.id === material.document!.id);
    const studyRow = (await apiA.documents.list({ yearId: yearA })).find(
      (row) => row.id === study!.id,
    );
    const recordingRow = (await apiA.recordings.list({ yearId: yearA })).find(
      (row) => row.id === recording!.id,
    );
    expect(folderRow?.tagIds).toEqual([tag.id]);
    expect(materialRow?.document.tagIds).toEqual([tag.id]);
    expect(studyRow?.tagIds).toEqual([tag.id]);
    expect(recordingRow?.tagIds).toEqual([tag.id]);

    const trashed = await apiA.materials.trash({
      kind: "folder",
      id: folder!.id,
    });
    expect(trashed.deletedAt).toBeInstanceOf(Date);
    expect(
      (await apiA.materials.folders.list({ yearId: yearA })).some(
        (row) => row.id === folder!.id,
      ),
    ).toBe(false);
    expect(
      (await apiA.materials.documents.list({ yearId: yearA })).some(
        (row) => row.document.id === material.document!.id,
      ),
    ).toBe(false);
    expect(
      (await apiA.documents.list({ yearId: yearA })).some(
        (row) => row.id === study!.id,
      ),
    ).toBe(false);
    expect(
      (await apiA.recordings.list({ yearId: yearA })).some(
        (row) => row.id === recording!.id,
      ),
    ).toBe(false);
    expect(
      (
        await apiA.materials.documents.list({
          yearId: yearA,
          include: "trashed",
        })
      ).find((row) => row.document.id === material.document!.id)?.document
        .tagIds,
    ).toEqual([tag.id]);

    expect(
      await apiA.materials.restore({ kind: "folder", id: folder!.id }),
    ).toEqual({ folderId: parent!.id });
    expect(
      (await apiA.documents.list({ yearId: yearA })).some(
        (row) => row.id === study!.id,
      ),
    ).toBe(true);
    expect(
      (await apiA.recordings.list({ yearId: yearA })).some(
        (row) => row.id === recording!.id,
      ),
    ).toBe(true);
  });

  test("restoring a folder does not revive a separately trashed same-second child", async () => {
    const folder = await apiA.materials.folders.create({
      yearId: yearA,
      name: "Independent trash batches",
    });
    const note = await apiA.materials.documents.createText({
      yearId: yearA,
      folderId: folder!.id,
      title: "Keep trashed",
      textContent: "independent",
    });
    await apiA.materials.trash({ kind: "document", id: note.document!.id });
    const [independent] = await database
      .select({ deletedBatchId: schema.materialDocuments.deletedBatchId })
      .from(schema.materialDocuments)
      .where(eq(schema.materialDocuments.id, note.document!.id));

    await apiA.materials.trash({ kind: "folder", id: folder!.id });
    const [trashedFolder] = await database
      .select({ deletedAt: schema.materialFolders.deletedAt })
      .from(schema.materialFolders)
      .where(eq(schema.materialFolders.id, folder!.id));
    await database
      .update(schema.materialDocuments)
      .set({ deletedAt: trashedFolder!.deletedAt })
      .where(eq(schema.materialDocuments.id, note.document!.id));

    await apiA.materials.restore({ kind: "folder", id: folder!.id });
    const [stillTrashed] = await database
      .select({
        deletedAt: schema.materialDocuments.deletedAt,
        deletedBatchId: schema.materialDocuments.deletedBatchId,
      })
      .from(schema.materialDocuments)
      .where(eq(schema.materialDocuments.id, note.document!.id));
    expect(stillTrashed?.deletedAt).toBeInstanceOf(Date);
    expect(stillTrashed?.deletedBatchId).toBe(independent?.deletedBatchId);
    await apiA.materials.purge({ kind: "document", id: note.document!.id });
  });

  test("enforces tag ownership and same-year target assignment", async () => {
    const tag = await apiA.materials.tags.create({
      yearId: yearA,
      name: "Private tag",
    });
    const otherYearDocument = await apiA.materials.documents.createText({
      yearId: otherYearA,
      title: "Next year source",
      textContent: "future",
    });
    await expect(
      apiA.materials.tags.assign({
        tagId: tag.id,
        targets: [{ kind: "document", id: otherYearDocument.document!.id }],
        assigned: true,
      }),
    ).rejects.toThrow("same year");
    await expect(
      apiB.materials.tags.update({ tagId: tag.id, name: "Stolen" }),
    ).rejects.toThrow("Material tag not found");
    await expect(
      apiA.materials.tags.create({
        yearId: yearA,
        name: "Bad subject",
        subjectId: otherSubjectA,
      }),
    ).rejects.toThrow("same year");
  });

  test("empties only one owned year's trash and removes polymorphic tag links", async () => {
    const current = await apiA.materials.documents.createText({
      yearId: yearA,
      title: "Empty this trash",
      textContent: "current",
    });
    const future = await apiA.materials.documents.createText({
      yearId: otherYearA,
      title: "Keep other trash",
      textContent: "future",
    });
    const tag = await apiA.materials.tags.create({
      yearId: yearA,
      name: "Disposable link",
    });
    await apiA.materials.tags.assign({
      tagId: tag.id,
      targets: [{ kind: "document", id: current.document!.id }],
      assigned: true,
    });
    await apiA.materials.trash({
      kind: "document",
      id: current.document!.id,
    });
    await apiA.materials.trash({
      kind: "document",
      id: future.document!.id,
    });

    expect(await apiA.materials.emptyTrash({ yearId: yearA })).toEqual({
      purged: 1,
    });
    expect(
      await database
        .select()
        .from(schema.materialDocuments)
        .where(eq(schema.materialDocuments.id, current.document!.id)),
    ).toHaveLength(0);
    expect(
      await database
        .select()
        .from(schema.materialTagLinks)
        .where(eq(schema.materialTagLinks.targetId, current.document!.id)),
    ).toHaveLength(0);
    expect(
      (
        await apiA.materials.documents.list({
          yearId: otherYearA,
          include: "trashed",
        })
      ).some((row) => row.document.id === future.document!.id),
    ).toBe(true);
    await apiA.materials.restore({
      kind: "document",
      id: future.document!.id,
    });
  });

  test("purges only trashed studies and cleans LaTeX builds and jobs", async () => {
    const [study] = await database
      .insert(schema.studyDocuments)
      .values({
        kind: "latex",
        title: "Disposable LaTeX",
        bodyMarkdown: "\\documentclass{article}",
        metaVersion: 2,
        metaJson: { engine: "pdflatex" },
        yearId: yearA,
        userId: userA,
      })
      .returning();
    const [pdf] = await database
      .insert(schema.files)
      .values({
        storageKey: `latex-purge-${crypto.randomUUID()}`,
        url: `https://example.invalid/${crypto.randomUUID()}.pdf`,
        mimeType: "application/pdf",
        byteSize: 42,
        purpose: "latex-build",
        provider: "test",
        userId: userA,
      })
      .returning();
    const [build] = await database
      .insert(schema.studyDocumentBuilds)
      .values({
        documentId: study!.id,
        revision: study!.revision,
        status: "succeeded",
        pdfFileId: pdf!.id,
        userId: userA,
      })
      .returning();
    const [job] = await database
      .insert(schema.jobs)
      .values({
        kind: "build.documentLatex",
        payload: { buildId: build!.id },
        status: "queued",
        userId: userA,
      })
      .returning();

    await expect(
      apiA.materials.purge({ kind: "study", id: study!.id }),
    ).rejects.toThrow("Only a trashed material");
    await apiA.materials.trash({ kind: "study", id: study!.id });
    await expect(
      apiA.materials.purge({ kind: "study", id: study!.id }),
    ).resolves.toEqual({ ok: true });
    expect(
      await database
        .select()
        .from(schema.studyDocumentBuilds)
        .where(eq(schema.studyDocumentBuilds.id, build!.id)),
    ).toHaveLength(0);
    expect(
      await database
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.id, job!.id)),
    ).toHaveLength(0);
    expect(
      (
        await database
          .select({ status: schema.files.status })
          .from(schema.files)
          .where(eq(schema.files.id, pdf!.id))
      )[0]?.status,
    ).toBe("deleted");
  });

  test("durably cleans a purged source and its preview across provider failures", async () => {
    const fixture = await fileDocument(null, "purge-with-preview.pdf");
    const preview = await storedFile("purge-with-preview.webp", "image/webp");
    await database
      .update(schema.files)
      .set({ provider: "s3" })
      .where(inArray(schema.files.id, [fixture.file.id, preview.id]));
    await database
      .update(schema.files)
      .set({
        purpose: "preview",
        previewStatus: "ready",
      })
      .where(eq(schema.files.id, preview.id));
    await database
      .update(schema.files)
      .set({ previewFileId: preview.id, previewStatus: "ready" })
      .where(eq(schema.files.id, fixture.file.id));

    const { createMaterialsOperationsRouter } =
      await import("./materials/operations");
    const storage = await import("../lib/storage");
    const providerUnavailable = async () => {
      throw new Error("simulated storage outage");
    };
    const removeFile: typeof storage.deleteFile = (
      ownedUserId,
      fileId,
      options = {},
    ) =>
      storage.deleteFile(ownedUserId, fileId, {
        ...options,
        deleteProviderFile: providerUnavailable,
        providerTimeoutMs: 100,
      });
    const removePreview: typeof storage.deleteFilePreview = (
      ownedUserId,
      fileId,
      options = {},
    ) =>
      storage.deleteFilePreview(ownedUserId, fileId, {
        ...options,
        deleteProviderFile: providerUnavailable,
        providerTimeoutMs: 100,
      });
    const operationsApi = createRouterClient(
      createMaterialsOperationsRouter({
        deleteFile: removeFile,
        deleteFilePreview: removePreview,
      }),
      {
        context: { headers: new Headers(), session: sessionFor(userA) },
      },
    );

    await apiA.materials.trash({
      kind: "document",
      id: fixture.document.id,
    });
    await expect(
      operationsApi.purge({ kind: "document", id: fixture.document.id }),
    ).resolves.toEqual({ ok: true });

    const storedAfterPurge = await database
      .select({
        id: schema.files.id,
        status: schema.files.status,
        previewFileId: schema.files.previewFileId,
      })
      .from(schema.files)
      .where(inArray(schema.files.id, [fixture.file.id, preview.id]));
    expect(storedAfterPurge).toEqual(
      expect.arrayContaining([
        {
          id: fixture.file.id,
          status: "stored",
          previewFileId: null,
        },
        { id: preview.id, status: "stored", previewFileId: null },
      ]),
    );

    const fileIds = new Set([fixture.file.id, preview.id]);
    const cleanupPayloads = (
      await database
        .select({ payload: schema.jobs.payload })
        .from(schema.jobs)
        .where(eq(schema.jobs.kind, "cleanup.unownedFile"))
    )
      .map((row) => row.payload as { userId?: string; fileId?: string } | null)
      .filter(
        (payload): payload is { userId: string; fileId: string } =>
          payload?.userId === userA &&
          typeof payload.fileId === "string" &&
          fileIds.has(payload.fileId),
      );
    expect(cleanupPayloads.map((payload) => payload.fileId).sort()).toEqual(
      [...fileIds].sort(),
    );

    const { runCleanupUnownedFileJob } = await import("../jobs/ingest-link");
    const confirmProviderDeletion = async () => ({
      success: true,
      deletedCount: 1,
    });
    const cleanupFile: typeof storage.deleteFile = (
      ownedUserId,
      fileId,
      options = {},
    ) =>
      storage.deleteFile(ownedUserId, fileId, {
        ...options,
        deleteProviderFile: confirmProviderDeletion,
      });
    const cleanupPreview: typeof storage.deleteFilePreview = (
      ownedUserId,
      fileId,
      options = {},
    ) =>
      storage.deleteFilePreview(ownedUserId, fileId, {
        ...options,
        deleteProviderFile: confirmProviderDeletion,
      });
    for (const payload of cleanupPayloads) {
      await runCleanupUnownedFileJob(payload, {
        deleteFile: cleanupFile,
        deleteFilePreview: cleanupPreview,
      });
    }
    const deletedFiles = await database
      .select({ id: schema.files.id, status: schema.files.status })
      .from(schema.files)
      .where(inArray(schema.files.id, [...fileIds]));
    expect(deletedFiles.every((file) => file.status === "deleted")).toBe(true);
  });

  test("legacy document deletion trashes first, then purges its file", async () => {
    const fixture = await fileDocument(null, "delete-me.pdf");
    await apiA.materials.documents.delete({ documentId: fixture.document.id });
    const [trashed] = await database
      .select({ deletedAt: schema.materialDocuments.deletedAt })
      .from(schema.materialDocuments)
      .where(eq(schema.materialDocuments.id, fixture.document.id));
    expect(trashed?.deletedAt).toBeInstanceOf(Date);
    const [retainedFile] = await database
      .select()
      .from(schema.files)
      .where(eq(schema.files.id, fixture.file.id));
    expect(retainedFile?.status).toBe("stored");

    await apiA.materials.documents.delete({ documentId: fixture.document.id });
    expect(
      await database
        .select()
        .from(schema.materialDocuments)
        .where(eq(schema.materialDocuments.id, fixture.document.id)),
    ).toHaveLength(0);
    const [file] = await database
      .select()
      .from(schema.files)
      .where(eq(schema.files.id, fixture.file.id));
    expect(file?.status).toBe("deleted");
  });

  test("legacy folder deletion trashes its subtree before permanent purge", async () => {
    const parent = await apiA.materials.folders.create({
      yearId: yearA,
      name: "Delete subtree",
    });
    const child = await apiA.materials.folders.create({
      yearId: yearA,
      name: "Nested",
      parentId: parent!.id,
    });
    const fixture = await fileDocument(child!.id, "nested.pdf");
    const study = await apiA.documents.create({
      yearId: yearA,
      folderId: child!.id,
      title: "Nested study",
    });
    const recordingId = `nested-recording-${crypto.randomUUID()}`;
    await database.insert(schema.lectureRecordings).values({
      id: recordingId,
      title: "Nested lecture",
      status: "ready",
      recordedAt: new Date(),
      durationMs: 0,
      folderId: child!.id,
      yearId: yearA,
      userId: userA,
    });
    await apiA.materials.documents.createText({
      yearId: yearA,
      folderId: parent!.id,
      title: "Nested note",
      textContent: "This goes too.",
    });

    const deleted = await apiA.materials.folders.delete({
      folderId: parent!.id,
    });
    expect(deleted).toMatchObject({ deletedFolders: 2, deletedDocuments: 2 });
    const trashedFolders = await database
      .select({ deletedAt: schema.materialFolders.deletedAt })
      .from(schema.materialFolders)
      .where(inArray(schema.materialFolders.id, [parent!.id, child!.id]));
    expect(trashedFolders).toHaveLength(2);
    expect(trashedFolders.every((row) => row.deletedAt instanceof Date)).toBe(
      true,
    );
    const [retainedFile] = await database
      .select()
      .from(schema.files)
      .where(eq(schema.files.id, fixture.file.id));
    expect(retainedFile?.status).toBe("stored");

    await apiA.materials.folders.delete({ folderId: parent!.id });
    expect(
      await database
        .select()
        .from(schema.materialFolders)
        .where(inArray(schema.materialFolders.id, [parent!.id, child!.id])),
    ).toHaveLength(0);
    const [file] = await database
      .select()
      .from(schema.files)
      .where(eq(schema.files.id, fixture.file.id));
    expect(file?.status).toBe("deleted");
    expect(
      await database
        .select({ id: schema.studyDocuments.id })
        .from(schema.studyDocuments)
        .where(eq(schema.studyDocuments.id, study.document!.id)),
    ).toHaveLength(0);
    expect(
      await database
        .select({ id: schema.lectureRecordings.id })
        .from(schema.lectureRecordings)
        .where(eq(schema.lectureRecordings.id, recordingId)),
    ).toHaveLength(0);
  });

  test("does not reveal or mutate another account's folders or documents", async () => {
    const folder = await apiA.materials.folders.create({
      yearId: yearA,
      name: "Private folder",
    });
    const note = await apiA.materials.documents.createText({
      yearId: yearA,
      folderId: folder!.id,
      title: "Private note",
      textContent: "secret",
    });
    await expect(
      apiB.materials.folders.rename({ folderId: folder!.id, name: "Stolen" }),
    ).rejects.toThrow("Material folder not found");
    await expect(
      apiB.materials.documents.rename({
        documentId: note.document!.id,
        title: "Stolen",
      }),
    ).rejects.toThrow("Material document not found");
    await expect(
      apiB.materials.documents.get({ documentId: note.document!.id }),
    ).rejects.toThrow("Material document not found");
  });

  test("root-folder filtering is distinct from a whole-year list", async () => {
    const folder = await apiA.materials.folders.create({
      yearId: yearA,
      name: "Filter folder",
    });
    const root = await apiA.materials.documents.createText({
      yearId: yearA,
      title: "At root",
      textContent: "root",
    });
    const nested = await apiA.materials.documents.createText({
      yearId: yearA,
      folderId: folder!.id,
      title: "Nested filter note",
      textContent: "nested",
    });
    const atRoot = await apiA.materials.documents.list({
      yearId: yearA,
      folderId: null,
    });
    expect(atRoot.some((row) => row.document.id === root.document!.id)).toBe(
      true,
    );
    expect(atRoot.some((row) => row.document.id === nested.document!.id)).toBe(
      false,
    );
    const wholeYear = await apiA.materials.documents.list({ yearId: yearA });
    expect(
      wholeYear.some((row) => row.document.id === nested.document!.id),
    ).toBe(true);
  });

  test("download refuses non-file source kinds", async () => {
    const note = await apiA.materials.documents.createText({
      yearId: yearA,
      title: "No binary",
      textContent: "inline",
    });
    await expect(
      apiA.materials.documents.download({ documentId: note.document!.id }),
    ).rejects.toThrow("Only uploaded materials");
  });

  test("treats pasted text as an immediately ready transcript", async () => {
    const note = await apiA.materials.documents.createText({
      yearId: yearA,
      title: "Inline transcript",
      textContent: "Already searchable.",
    });
    expect(
      await apiA.materials.documents.transcript({
        documentId: note.document!.id,
      }),
    ).toEqual({
      status: "ready",
      content: "Already searchable.",
      meta: null,
      error: null,
    });
  });

  test("searches pasted and derived transcripts without exposing their bodies", async () => {
    const note = await apiA.materials.documents.createText({
      yearId: yearA,
      title: "Unrelated inline title",
      textContent: "Le pendule de Foucault démontre la rotation terrestre.",
    });
    const media = await fileDocument(
      null,
      "cours-sans-indice.mp3",
      "audio/mpeg",
    );
    await database.insert(schema.materialArtifacts).values({
      documentId: media.document.id,
      kind: "media-transcript",
      status: "ready",
      content: "Conservation du moment cinétique à 100%.",
      userId: userA,
    });
    const otherYear = await fileDocument(
      null,
      "private-year.mp3",
      "audio/mpeg",
      otherYearA,
    );
    await database.insert(schema.materialArtifacts).values({
      documentId: otherYear.document.id,
      kind: "media-transcript",
      status: "ready",
      content: "Conservation du moment cinétique à 100%.",
      userId: userA,
    });

    expect(
      await apiA.materials.documents.search({
        yearId: yearA,
        query: "Foucault",
      }),
    ).toEqual([note.document!.id]);
    expect(
      await apiA.materials.documents.search({
        yearId: yearA,
        query: "moment cinétique",
      }),
    ).toEqual([media.document.id]);
    expect(
      await apiA.materials.documents.search({
        yearId: yearA,
        query: "%",
      }),
    ).toEqual([media.document.id]);
  });

  test("rejects unsupported OCR sources and a disabled integration", async () => {
    const unsupported = await fileDocument(null, "notes.txt", "text/plain");
    await expect(
      apiA.materials.documents.transcribe({
        documentId: unsupported.document.id,
      }),
    ).rejects.toThrow("file type cannot be transcribed");

    const pdf = await fileDocument(null, "disabled-ocr.pdf");
    process.env.DISABLE_OCR = "true";
    try {
      await expect(
        apiA.materials.documents.transcribe({ documentId: pdf.document.id }),
      ).rejects.toThrow("OCR is not configured");
    } finally {
      process.env.DISABLE_OCR = "false";
    }
  });

  test("previews folder OCR counts across descendants and honors default globs", async () => {
    const parent = await apiA.materials.folders.create({
      yearId: yearA,
      name: "OCR preview",
    });
    const child = await apiA.materials.folders.create({
      yearId: yearA,
      name: "OCR nested",
      parentId: parent!.id,
    });
    await fileDocument(parent!.id, "lesson.pdf");
    await fileDocument(child!.id, "exam_c.pdf");
    await fileDocument(child!.id, "CONTROL_CORRIGE.PDF");
    await fileDocument(child!.id, "diagram.png", "image/png");
    await fileDocument(child!.id, "source.txt", "text/plain");

    expect(
      await apiA.materials.documents.transcribeFolder({
        folderId: parent!.id,
        dryRun: true,
      }),
    ).toEqual({ candidates: 4, skipped: 2, enqueued: 0, jobIds: [] });
  });

  test("transcribes every pending year material with durable live progress and partial retry", async () => {
    process.env.DISABLE_OCR = "false";
    await apiA.serviceKeys.set({ kind: "mistral", key: "batch-ocr-key" });
    const first = await fileDocument(
      null,
      "Batch first.pdf",
      "application/pdf",
      otherYearA,
    );
    const second = await fileDocument(
      null,
      "Batch second.png",
      "image/png",
      otherYearA,
    );
    await fileDocument(
      null,
      "Batch solution_corrige.pdf",
      "application/pdf",
      otherYearA,
    );
    await fileDocument(null, "Batch source.txt", "text/plain", otherYearA);

    expect(
      await apiA.materials.documents.transcribeAll({
        yearId: otherYearA,
        dryRun: true,
      }),
    ).toEqual({
      candidates: 3,
      skipped: 1,
      enqueued: 0,
      batchId: null,
      alreadyRunning: false,
    });

    const started = await apiA.materials.documents.transcribeAll({
      yearId: otherYearA,
      dryRun: false,
    });
    expect(started).toMatchObject({
      enqueued: 2,
      skipped: 1,
      alreadyRunning: false,
    });
    if (!started.batchId) throw new Error("Expected a durable OCR batch");

    const duplicate = await apiA.materials.documents.transcribeAll({
      yearId: otherYearA,
      dryRun: false,
    });
    expect(duplicate).toMatchObject({
      batchId: started.batchId,
      enqueued: 0,
      alreadyRunning: true,
    });

    const active = await apiA.materials.documents.activeTranscriptionBatch({
      yearId: otherYearA,
    });
    expect(active).toMatchObject({
      id: started.batchId,
      status: "running",
      total: 2,
      processed: 0,
      queued: 2,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
      currentFile: "Batch first.pdf",
    });
    const { getTranscriptionBatchProgress } =
      await import("./materials/documents");
    expect(
      await getTranscriptionBatchProgress(userB, started.batchId),
    ).toBeNull();

    const [batch] = await database
      .select({ payload: schema.jobs.payload })
      .from(schema.jobs)
      .where(eq(schema.jobs.id, started.batchId));
    const items = (
      batch?.payload as {
        items?: Array<{ jobId: string; documentId: string; title: string }>;
      }
    )?.items;
    if (!items || items.length !== 2) {
      throw new Error("Expected two OCR child jobs");
    }
    const firstItem = items.find(
      (item) => item.documentId === first.document.id,
    );
    const secondItem = items.find(
      (item) => item.documentId === second.document.id,
    );
    if (!firstItem || !secondItem) throw new Error("Missing OCR batch item");

    await database
      .update(schema.jobs)
      .set({ status: "succeeded", result: { pageCount: 4 } })
      .where(eq(schema.jobs.id, firstItem.jobId));
    await database
      .update(schema.jobs)
      .set({ status: "failed", error: "provider unavailable" })
      .where(eq(schema.jobs.id, secondItem.jobId));
    await database.insert(schema.materialArtifacts).values({
      documentId: first.document.id,
      kind: "ocr-markdown",
      status: "ready",
      content: "First transcript",
      userId: userA,
    });

    expect(
      await apiA.materials.documents.activeTranscriptionBatch({
        yearId: otherYearA,
      }),
    ).toMatchObject({
      id: started.batchId,
      status: "completed_with_errors",
      total: 2,
      processed: 2,
      succeeded: 1,
      failed: 1,
      cancelled: 0,
      currentFile: null,
      failures: [
        {
          documentId: second.document.id,
          title: "Batch second.png",
          error: "provider unavailable",
        },
      ],
    });
    expect(
      await apiA.materials.documents.activeTranscriptionBatch({
        yearId: otherYearA,
      }),
    ).toBeNull();

    const retry = await apiA.materials.documents.transcribeAll({
      yearId: otherYearA,
      dryRun: false,
    });
    expect(retry).toMatchObject({
      candidates: 2,
      skipped: 1,
      enqueued: 1,
      alreadyRunning: false,
    });
    expect(retry.batchId).not.toBe(started.batchId);
    await expect(
      apiB.materials.documents.activeTranscriptionBatch({
        yearId: otherYearA,
      }),
    ).rejects.toThrow();
  });

  test("claims a concurrent year batch before enqueueing children", async () => {
    const raceYearId = "materials-batch-race-year";
    await database.insert(schema.years).values({
      id: raceYearId,
      name: "Batch race year",
      startsAt: new Date("2028-09-01T00:00:00.000Z"),
      endsAt: new Date("2029-07-01T00:00:00.000Z"),
      userId: userA,
    });
    await apiA.serviceKeys.set({ kind: "mistral", key: "batch-race-key" });
    const first = await fileDocument(
      null,
      "Race one.pdf",
      "application/pdf",
      raceYearId,
    );
    const second = await fileDocument(
      null,
      "Race two.pdf",
      "application/pdf",
      raceYearId,
    );

    const results = await Promise.all([
      apiA.materials.documents.transcribeAll({
        yearId: raceYearId,
        skipPatterns: ["Race two.*"],
        dryRun: false,
      }),
      apiA.materials.documents.transcribeAll({
        yearId: raceYearId,
        skipPatterns: ["Race one.*"],
        dryRun: false,
      }),
    ]);
    expect(results[0].batchId).toBe(results[1].batchId);
    expect(results.reduce((sum, result) => sum + result.enqueued, 0)).toBe(1);

    const [batch] = await database
      .select({ payload: schema.jobs.payload })
      .from(schema.jobs)
      .where(eq(schema.jobs.id, results[0].batchId!));
    const items = (
      batch?.payload as {
        items?: Array<{ jobId: string; documentId: string }>;
      }
    )?.items;
    expect(items).toHaveLength(1);
    const childJobs = await database
      .select({
        id: schema.jobs.id,
        idempotencyKey: schema.jobs.idempotencyKey,
      })
      .from(schema.jobs)
      .where(
        and(
          eq(schema.jobs.kind, "ocr.document"),
          inArray(schema.jobs.idempotencyKey, [
            first.document.id,
            second.document.id,
          ]),
        ),
      );
    expect(childJobs).toHaveLength(1);
    if (!childJobs[0] || !items?.[0]) throw new Error("Missing batch child");
    expect(childJobs[0].id).toBe(items[0].jobId);
  });

  test("resumes a durable batch left in preparation", async () => {
    const recoveryYearId = "materials-batch-recovery-year";
    await database.insert(schema.years).values({
      id: recoveryYearId,
      name: "Batch recovery year",
      startsAt: new Date("2029-09-01T00:00:00.000Z"),
      endsAt: new Date("2030-07-01T00:00:00.000Z"),
      userId: userA,
    });
    const fixture = await fileDocument(
      null,
      "Recovered batch.pdf",
      "application/pdf",
      recoveryYearId,
    );
    const [batch] = await database
      .insert(schema.jobs)
      .values({
        kind: "ocr.batch",
        status: "running",
        maxAttempts: 1,
        idempotencyKey: `year:${recoveryYearId}`,
        userId: userA,
        payload: {
          version: 1,
          phase: "preparing",
          yearId: recoveryYearId,
          folderId: null,
          candidates: 1,
          skipped: 0,
          documents: [
            {
              documentId: fixture.document.id,
              title: fixture.document.title,
            },
          ],
        },
      })
      .returning();

    expect(
      await apiA.materials.documents.activeTranscriptionBatch({
        yearId: recoveryYearId,
      }),
    ).toMatchObject({
      id: batch!.id,
      status: "running",
      total: 1,
      queued: 1,
      currentFile: "Recovered batch.pdf",
    });
    const [prepared] = await database
      .select({ payload: schema.jobs.payload })
      .from(schema.jobs)
      .where(eq(schema.jobs.id, batch!.id));
    expect(prepared?.payload).toMatchObject({
      phase: "running",
      items: [{ documentId: fixture.document.id }],
    });
  });

  test("enqueues OCR idempotently per document", async () => {
    process.env.DISABLE_OCR = "false";
    await apiA.serviceKeys.set({ kind: "mistral", key: "materials-ocr-key" });
    const fixture = await fileDocument(null, "idempotent.pdf");
    const first = await apiA.materials.documents.transcribe({
      documentId: fixture.document.id,
    });
    const second = await apiA.materials.documents.transcribe({
      documentId: fixture.document.id,
    });
    expect(second.jobId).toBe(first.jobId);
    expect(
      await database
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.idempotencyKey, fixture.document.id)),
    ).toHaveLength(1);
  });

  test("writes a ready artifact only after OCR content succeeds", async () => {
    const { runOcrDocumentJob } = await import("../jobs/ocr");
    const fixture = await fileDocument(null, "processed.pdf");
    const times = [1_000, 1_250];
    const result = await runOcrDocumentJob(
      { documentId: fixture.document.id },
      {
        fetch: async () => new Response("pdf bytes", { status: 200 }),
        runOcr: async () => ({
          markdown: "<!-- Page 0 -->\n# Processed",
          pageCount: 1,
          providerFileId: "mistral-file-1",
        }),
        now: () => times.shift() ?? 1_250,
      },
    );
    expect(result.pageCount).toBe(1);
    expect(
      await apiA.materials.documents.transcript({
        documentId: fixture.document.id,
      }),
    ).toMatchObject({
      status: "ready",
      content: "<!-- Page 0 -->\n# Processed",
      meta: {
        model: "mistral-ocr-latest",
        pageCount: 1,
        providerFileId: "mistral-file-1",
        durationMs: 250,
      },
      error: null,
    });
  });

  test("reads managed OCR sources directly without an authenticated HTTP hop", async () => {
    const { runOcrDocumentJob } = await import("../jobs/ocr");
    const fixture = await fileDocument(null, "local-source.pdf");
    await database
      .update(schema.files)
      .set({ provider: "local" })
      .where(eq(schema.files.id, fixture.file.id));
    let directReads = 0;

    await runOcrDocumentJob(
      { documentId: fixture.document.id },
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
          expect(storageKey).toBe(fixture.file.storageKey);
          expect(options?.maxBytes).toBe(50 * 1024 * 1024);
          return new Uint8Array([1, 2, 3]).buffer;
        },
        runOcr: async (_userId, file) => {
          expect(file.blob.size).toBe(3);
          return {
            markdown: "Read directly",
            pageCount: 1,
            providerFileId: "mistral-file-local",
          };
        },
      },
    );

    expect(directReads).toBe(1);
    expect(
      await apiA.materials.documents.transcript({
        documentId: fixture.document.id,
      }),
    ).toMatchObject({ status: "ready", content: "Read directly" });
  });

  test("records a failed artifact without partial content and allows a clean retry", async () => {
    const { runOcrDocumentJob } = await import("../jobs/ocr");
    const fixture = await fileDocument(null, "failed.pdf");
    await expect(
      runOcrDocumentJob(
        { documentId: fixture.document.id },
        {
          fetch: async () => new Response("pdf bytes", { status: 200 }),
          runOcr: async () => {
            throw new Error("provider unavailable");
          },
        },
      ),
    ).rejects.toThrow("provider unavailable");
    expect(
      await apiA.materials.documents.transcript({
        documentId: fixture.document.id,
      }),
    ).toEqual({
      status: "failed",
      content: null,
      meta: null,
      error: "provider unavailable",
    });

    await runOcrDocumentJob(
      { documentId: fixture.document.id },
      {
        fetch: async () => new Response("pdf bytes", { status: 200 }),
        runOcr: async () => ({
          markdown: "Recovered",
          pageCount: 1,
          providerFileId: "mistral-file-retry",
        }),
      },
    );
    expect(
      await database
        .select()
        .from(schema.materialArtifacts)
        .where(eq(schema.materialArtifacts.documentId, fixture.document.id)),
    ).toHaveLength(1);
  });

  test("never persists or exposes a provider-reflected OCR credential", async () => {
    const { runOcrDocumentJob } = await import("../jobs/ocr");
    const { runMistralOcr } = await import("../lib/ocr");
    const fixture = await fileDocument(null, "reflected-secret.pdf");
    const secret = "mistral-material-secret-that-must-not-leak";

    await expect(
      runOcrDocumentJob(
        { documentId: fixture.document.id },
        {
          fetch: async () => new Response("pdf bytes", { status: 200 }),
          runOcr: (userId, file, options) =>
            runMistralOcr(userId, file, {
              ...options,
              key: secret,
              fetch: async () =>
                new Response(
                  JSON.stringify({ message: `invalid credential ${secret}` }),
                  { status: 401 },
                ),
              sleep: async () => undefined,
            }),
        },
      ),
    ).rejects.toThrow("invalid credential [redacted]");

    const transcript = await apiA.materials.documents.transcript({
      documentId: fixture.document.id,
    });
    expect(transcript).toMatchObject({
      status: "failed",
      content: null,
      meta: null,
      error: expect.stringContaining("invalid credential [redacted]"),
    });
    expect(JSON.stringify(transcript)).not.toContain(secret);

    const [artifact] = await database
      .select()
      .from(schema.materialArtifacts)
      .where(eq(schema.materialArtifacts.documentId, fixture.document.id));
    expect(artifact?.error).toContain("invalid credential [redacted]");
    expect(JSON.stringify(artifact)).not.toContain(secret);
  });
});
