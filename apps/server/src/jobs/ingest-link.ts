import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  documentArtifacts,
  gradeAttachments,
  materialArtifacts,
  materialDocuments,
  files,
  recordingSegments,
  studyDocumentBuilds,
  studyDocumentExports,
  type MaterialMetaV1,
  type WebMarkdownMetaV1,
} from "../db/schema";
import {
  extractMarkdown,
  fetchArticle,
  IngestError,
  type FetchedArticle,
} from "../lib/ingest";
import { newId } from "../lib/id";
import { enqueueJob, NonRetryableJobError } from "../lib/jobs";
import { deleteFile, deleteFilePreview, storeFile } from "../lib/storage";
import { ingestYoutube, parseYoutubeUrl } from "../lib/youtube";
import { OCR_JOB_KIND } from "./ocr";
import { enqueueMaterialPreview } from "./material-preview";

const payloadSchema = z
  .object({
    documentId: z.string().min(1),
    ingestionId: z.string().min(1).optional(),
  })
  .strict();
const cleanupPayloadSchema = z
  .object({ userId: z.string().min(1), fileId: z.string().min(1) })
  .strict();

export const INGEST_LINK_JOB_KIND = "ingest.link";
export const CLEANUP_UNOWNED_FILE_JOB_KIND = "cleanup.unownedFile";

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    8_000,
  );
}

function pdfName(finalUrl: string, fallbackTitle: string) {
  let candidate = "";
  try {
    const segment = new URL(finalUrl).pathname
      .split("/")
      .filter(Boolean)
      .at(-1);
    candidate = segment ? decodeURIComponent(segment) : "";
  } catch {
    // The URL has already passed fetch validation; retain a defensive fallback.
  }
  const base = (candidate || fallbackTitle || "course-material")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 150);
  return `${base || "course-material"}${base.toLowerCase().endsWith(".pdf") ? "" : ".pdf"}`;
}

async function setArtifactFailure(
  documentId: string,
  kind: "web-markdown" | "ocr-markdown",
  error: unknown,
  runId?: string,
) {
  await db
    .update(materialArtifacts)
    .set({
      status: "failed",
      content: null,
      metaJson: null,
      error: safeError(error),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(materialArtifacts.documentId, documentId),
        eq(materialArtifacts.kind, kind),
        runId ? eq(materialArtifacts.runId, runId) : undefined,
      ),
    );
}

async function convertedPdfState(documentId: string, userId: string) {
  const [document] = await db
    .select()
    .from(materialDocuments)
    .where(
      and(
        eq(materialDocuments.id, documentId),
        eq(materialDocuments.userId, userId),
      ),
    )
    .limit(1);
  if (
    !document ||
    document.sourceType !== "file" ||
    !document.fileId ||
    !document.metaJson?.externalId
  ) {
    return null;
  }
  const [artifact] = await db
    .select()
    .from(materialArtifacts)
    .where(
      and(
        eq(materialArtifacts.documentId, document.id),
        eq(materialArtifacts.kind, "ocr-markdown"),
      ),
    )
    .limit(1);
  if (!artifact) return null;

  return { document, artifact, fileId: document.fileId };
}

async function convertedPdfResult(
  documentId: string,
  userId: string,
  enqueuePreview: typeof enqueueMaterialPreview = enqueueMaterialPreview,
) {
  const state = await convertedPdfState(documentId, userId);
  if (!state) return null;
  const { document, artifact, fileId } = state;

  const job = await enqueueJob({
    kind: OCR_JOB_KIND,
    payload: { documentId: document.id },
    userId: document.userId,
    idempotencyKey: document.id,
    maxAttempts: 3,
  });
  await enqueuePreview({ fileId, userId: document.userId });
  if (
    artifact.status === "failed" &&
    (job.status === "queued" || job.status === "running")
  ) {
    await db
      .update(materialArtifacts)
      .set({ status: "pending", error: null, updatedAt: new Date() })
      .where(eq(materialArtifacts.id, artifact.id));
  }
  return { kind: "pdf" as const, fileId, jobId: job.id };
}

async function transitionPdfToOcr(input: {
  documentId: string;
  userId: string;
  sourceUrl: string;
  fileId: string;
  derivedTitle: string;
  finalUrl: string;
  runId: string;
}) {
  const now = Math.floor(Date.now() / 1_000);
  const jobId = newId("job");
  await db.$client.batch(
    [
      {
        sql: `UPDATE "material_documents" SET "title" = CASE WHEN json_extract("metaJson", '$.titleWasDerived') = 1 THEN ? ELSE "title" END, "sourceType" = 'file', "fileId" = ?, "sourceUrl" = NULL, "textContent" = NULL, "metaVersion" = 1, "metaJson" = json_set(COALESCE("metaJson", '{}'), '$.externalId', ?, '$.titleWasDerived', json('false')), "updatedAt" = ? WHERE "id" = ? AND "userId" = ? AND "sourceType" = 'link' AND "sourceUrl" = ?`,
        args: [
          input.derivedTitle,
          input.fileId,
          input.finalUrl,
          now,
          input.documentId,
          input.userId,
          input.sourceUrl,
        ],
      },
      {
        // A lost CAS aborts the whole batch before the artifact or queue moves.
        sql: `INSERT INTO "jobs" ("id", "kind", "payloadVersion", "status", "attempts", "maxAttempts", "runAt", "userId", "createdAt", "updatedAt") SELECT NULL, '__pdf_transition_guard__', 1, 'failed', 0, 1, ?, ?, ?, ? WHERE changes() = 0`,
        args: [now, input.userId, now, now],
      },
      {
        sql: `UPDATE "material_artifacts" SET "kind" = 'ocr-markdown', "status" = 'pending', "content" = NULL, "metaVersion" = 1, "metaJson" = NULL, "error" = NULL, "runId" = NULL, "updatedAt" = ? WHERE "documentId" = ? AND "kind" = 'web-markdown' AND "runId" = ?`,
        args: [now, input.documentId, input.runId],
      },
      {
        sql: `INSERT INTO "jobs" ("id", "kind", "payloadVersion", "status", "attempts", "maxAttempts", "runAt", "userId", "createdAt", "updatedAt") SELECT NULL, '__pdf_artifact_guard__', 1, 'failed', 0, 1, ?, ?, ?, ? WHERE changes() = 0`,
        args: [now, input.userId, now, now],
      },
      {
        sql: `INSERT OR IGNORE INTO "jobs" ("id", "kind", "payload", "payloadVersion", "status", "attempts", "maxAttempts", "runAt", "idempotencyKey", "userId", "createdAt", "updatedAt") VALUES (?, ?, ?, 1, 'queued', 0, 3, ?, ?, ?, ?, ?)`,
        args: [
          jobId,
          OCR_JOB_KIND,
          JSON.stringify({ documentId: input.documentId }),
          now,
          input.documentId,
          input.userId,
          now,
          now,
        ],
      },
    ],
    "write",
  );
}

async function claimLinkIngestion(input: {
  documentId: string;
  userId: string;
  sourceUrl: string;
  ingestionId?: string;
}) {
  const generation = input.ingestionId ?? "legacy";
  const runId = `${generation}:${newId("run")}`;
  const now = Math.floor(Date.now() / 1_000);
  const generationPredicate = input.ingestionId
    ? `("runId" = ? OR "runId" LIKE ?)`
    : `("runId" IS NULL OR "runId" LIKE 'legacy:%')`;
  const generationArgs = input.ingestionId
    ? [generation, `${generation}:%`]
    : [];
  const claimed = await db.$client.execute({
    sql: `UPDATE "material_artifacts" SET "status" = 'pending', "content" = NULL, "metaVersion" = 1, "metaJson" = NULL, "error" = NULL, "runId" = ?, "updatedAt" = ? WHERE "documentId" = ? AND "kind" = 'web-markdown' AND ${generationPredicate} AND EXISTS (SELECT 1 FROM "material_documents" WHERE "id" = ? AND "userId" = ? AND "sourceType" = 'link' AND "sourceUrl" = ?)`,
    args: [
      runId,
      now,
      input.documentId,
      ...generationArgs,
      input.documentId,
      input.userId,
      input.sourceUrl,
    ],
  });
  return claimed.rowsAffected === 1 ? runId : null;
}

async function publishArticle(input: {
  documentId: string;
  userId: string;
  sourceUrl: string;
  runId: string;
  title: string;
  markdown: string;
  meta: WebMarkdownMetaV1;
  documentMeta?: MaterialMetaV1;
}) {
  const now = Math.floor(Date.now() / 1_000);
  const documentMeta = JSON.stringify({
    ...input.documentMeta,
    externalId: input.meta.finalUrl,
    titleWasDerived: false,
  } satisfies MaterialMetaV1);
  await db.$client.batch(
    [
      {
        sql: `UPDATE "material_documents" SET "title" = CASE WHEN json_extract("metaJson", '$.titleWasDerived') = 1 THEN ? ELSE "title" END, "metaVersion" = 1, "metaJson" = json_patch(COALESCE("metaJson", '{}'), json(?)), "updatedAt" = ? WHERE "id" = ? AND "userId" = ? AND "sourceType" = 'link' AND "sourceUrl" = ?`,
        args: [
          input.title.slice(0, 160),
          documentMeta,
          now,
          input.documentId,
          input.userId,
          input.sourceUrl,
        ],
      },
      {
        sql: `INSERT INTO "jobs" ("id", "kind", "payloadVersion", "status", "attempts", "maxAttempts", "runAt", "userId", "createdAt", "updatedAt") SELECT NULL, '__article_document_guard__', 1, 'failed', 0, 1, ?, ?, ?, ? WHERE changes() = 0`,
        args: [now, input.userId, now, now],
      },
      {
        sql: `UPDATE "material_artifacts" SET "status" = 'ready', "content" = ?, "metaVersion" = 1, "metaJson" = ?, "error" = NULL, "runId" = NULL, "updatedAt" = ? WHERE "documentId" = ? AND "kind" = 'web-markdown' AND "runId" = ?`,
        args: [
          input.markdown,
          JSON.stringify(input.meta),
          now,
          input.documentId,
          input.runId,
        ],
      },
      {
        sql: `INSERT INTO "jobs" ("id", "kind", "payloadVersion", "status", "attempts", "maxAttempts", "runAt", "userId", "createdAt", "updatedAt") SELECT NULL, '__article_artifact_guard__', 1, 'failed', 0, 1, ?, ?, ?, ? WHERE changes() = 0`,
        args: [now, input.userId, now, now],
      },
    ],
    "write",
  );
}

export async function recordUnownedFileCleanup(
  userId: string,
  fileId: string,
  remove: typeof deleteFile,
) {
  const job = await enqueueJob({
    kind: CLEANUP_UNOWNED_FILE_JOB_KIND,
    payload: { userId, fileId },
    userId,
    idempotencyKey: fileId,
    maxAttempts: 6,
  });
  await remove(userId, fileId, { deferOnProviderFailure: false }).catch(
    () => undefined,
  );
  return job;
}

export async function runCleanupUnownedFileJob(
  payload: unknown,
  options: {
    deleteFile?: typeof deleteFile;
    deleteFilePreview?: typeof deleteFilePreview;
  } = {},
) {
  const input = cleanupPayloadSchema.parse(payload);
  const references = await Promise.all([
    db
      .select({ id: materialDocuments.id })
      .from(materialDocuments)
      .where(
        and(
          eq(materialDocuments.userId, input.userId),
          eq(materialDocuments.fileId, input.fileId),
        ),
      )
      .limit(1),
    db
      .select({ id: documentArtifacts.id })
      .from(documentArtifacts)
      .where(
        and(
          eq(documentArtifacts.userId, input.userId),
          eq(documentArtifacts.fileId, input.fileId),
        ),
      )
      .limit(1),
    db
      .select({ id: studyDocumentExports.documentId })
      .from(studyDocumentExports)
      .where(
        and(
          eq(studyDocumentExports.userId, input.userId),
          eq(studyDocumentExports.fileId, input.fileId),
        ),
      )
      .limit(1),
    db
      .select({ id: studyDocumentBuilds.id })
      .from(studyDocumentBuilds)
      .where(
        and(
          eq(studyDocumentBuilds.userId, input.userId),
          eq(studyDocumentBuilds.pdfFileId, input.fileId),
        ),
      )
      .limit(1),
    db
      .select({ id: files.id })
      .from(files)
      .where(
        and(
          eq(files.userId, input.userId),
          eq(files.previewFileId, input.fileId),
          eq(files.status, "stored"),
        ),
      )
      .limit(1),
    db
      .select({ id: recordingSegments.id })
      .from(recordingSegments)
      .where(
        and(
          eq(recordingSegments.userId, input.userId),
          eq(recordingSegments.fileId, input.fileId),
        ),
      )
      .limit(1),
    db
      .select({ id: gradeAttachments.id })
      .from(gradeAttachments)
      .where(
        and(
          eq(gradeAttachments.userId, input.userId),
          eq(gradeAttachments.fileId, input.fileId),
        ),
      )
      .limit(1),
  ]);
  if (references.some((rows) => rows.length > 0)) {
    return { deleted: false, referenced: true };
  }
  // A source file can itself own a derivative. Remove that edge first so a
  // cleanup job for the source cannot strand its preview after the source is
  // marked deleted. Strict mode keeps both provider failures retryable here.
  await (options.deleteFilePreview ?? deleteFilePreview)(
    input.userId,
    input.fileId,
    { deferOnProviderFailure: false },
  );
  await (options.deleteFile ?? deleteFile)(input.userId, input.fileId, {
    deferOnProviderFailure: false,
  });
  return { deleted: true, referenced: false };
}

export async function enqueueLinkIngestion(input: {
  documentId: string;
  userId: string;
  idempotencyKey?: string;
}) {
  const ingestionId = newId("ing");
  await db
    .insert(materialArtifacts)
    .values({
      documentId: input.documentId,
      kind: "web-markdown",
      status: "pending",
      content: null,
      metaVersion: 1,
      metaJson: null,
      error: null,
      runId: ingestionId,
      userId: input.userId,
    })
    .onConflictDoUpdate({
      target: [materialArtifacts.documentId, materialArtifacts.kind],
      set: {
        status: "pending",
        content: null,
        metaVersion: 1,
        metaJson: null,
        error: null,
        runId: ingestionId,
        updatedAt: new Date(),
      },
    });
  try {
    return await enqueueJob({
      kind: INGEST_LINK_JOB_KIND,
      payload: { documentId: input.documentId, ingestionId },
      userId: input.userId,
      idempotencyKey: input.idempotencyKey ?? input.documentId,
      maxAttempts: 3,
    });
  } catch (error) {
    await setArtifactFailure(
      input.documentId,
      "web-markdown",
      error,
      ingestionId,
    );
    throw error;
  }
}

export async function runIngestLinkJob(
  payload: unknown,
  options: {
    fetchArticle?: typeof fetchArticle;
    extractMarkdown?: typeof extractMarkdown;
    ingestYoutube?: typeof ingestYoutube;
    storeFile?: typeof storeFile;
    deleteFile?: typeof deleteFile;
    enqueuePreview?: typeof enqueueMaterialPreview;
    now?: () => Date;
    signal?: AbortSignal;
    afterPdfTransition?: () => Promise<void> | void;
  } = {},
) {
  const { documentId, ingestionId } = payloadSchema.parse(payload);
  const [document] = await db
    .select()
    .from(materialDocuments)
    .where(eq(materialDocuments.id, documentId))
    .limit(1);
  if (!document) {
    throw new NonRetryableJobError("Link source document not found");
  }
  if (document.sourceType !== "link" || !document.sourceUrl) {
    const converted = await convertedPdfResult(
      document.id,
      document.userId,
      options.enqueuePreview,
    );
    if (converted) return converted;
    throw new NonRetryableJobError("Link source document not found");
  }

  const runId = await claimLinkIngestion({
    documentId,
    userId: document.userId,
    sourceUrl: document.sourceUrl,
    ingestionId,
  });
  if (!runId) {
    const converted = await convertedPdfResult(
      document.id,
      document.userId,
      options.enqueuePreview,
    );
    if (converted) return converted;
    throw new NonRetryableJobError("Link ingestion was superseded");
  }

  let unownedStoredFileId: string | null = null;
  try {
    const capturedAt = options.now?.() ?? new Date();
    if (parseYoutubeUrl(document.sourceUrl)) {
      const extracted = await (options.ingestYoutube ?? ingestYoutube)(
        document.sourceUrl,
        { now: capturedAt, signal: options.signal },
      );
      const meta: WebMarkdownMetaV1 = {
        finalUrl: extracted.finalUrl,
        fetchedAt: capturedAt.toISOString(),
        title: extracted.title,
        byline: extracted.channel,
        site: "YouTube",
        wordCount: extracted.wordCount,
        truncated: extracted.truncated,
        kind: "youtube",
        videoId: extracted.videoId,
        channel: extracted.channel ?? undefined,
        durationSec: extracted.durationSec ?? undefined,
        chapters: extracted.chapters,
      };
      await publishArticle({
        documentId: document.id,
        userId: document.userId,
        sourceUrl: document.sourceUrl,
        runId,
        title: extracted.title,
        markdown: extracted.markdown,
        meta,
        documentMeta: {
          kind: "youtube",
          videoId: extracted.videoId,
          channel: extracted.channel ?? undefined,
          durationSec: extracted.durationSec ?? undefined,
          chapters: extracted.chapters,
        },
      });
      return {
        kind: "youtube" as const,
        artifactKind: "web-markdown" as const,
        title: extracted.title,
        videoId: extracted.videoId,
      };
    }

    const fetched: FetchedArticle = await (
      options.fetchArticle ?? fetchArticle
    )(document.sourceUrl, { signal: options.signal });

    if (fetched.contentType === "application/pdf") {
      const file = new File(
        [Uint8Array.from(fetched.body).buffer as ArrayBuffer],
        pdfName(fetched.finalUrl, document.title),
        { type: "application/pdf" },
      );
      const stored = await (options.storeFile ?? storeFile)({
        userId: document.userId,
        purpose: "course-material",
        file,
      });
      unownedStoredFileId = stored.id;
      await transitionPdfToOcr({
        documentId: document.id,
        userId: document.userId,
        sourceUrl: document.sourceUrl,
        fileId: stored.id,
        derivedTitle: file.name.replace(/\.pdf$/i, ""),
        finalUrl: fetched.finalUrl,
        runId,
      });
      await options.afterPdfTransition?.();
      unownedStoredFileId = null;
      const converted = await convertedPdfResult(
        document.id,
        document.userId,
        options.enqueuePreview,
      );
      if (!converted)
        throw new Error("The converted PDF could not be resolved");
      return converted;
    }

    if (!fetched.html) {
      throw new IngestError(
        `Unsupported source content type: ${fetched.contentType || "unknown"}`,
        false,
      );
    }
    const extractor = options.extractMarkdown ?? extractMarkdown;
    let extracted: ReturnType<typeof extractMarkdown> | null = null;
    let staticExtractionError: unknown = null;
    try {
      extracted = extractor(fetched.html, fetched.finalUrl, {
        now: capturedAt,
      });
    } catch (error) {
      if (!(error instanceof IngestError)) throw error;
      staticExtractionError = error;
    }

    if (!extracted) {
      throw (
        staticExtractionError ??
        new IngestError("The page has no extractable article content", false)
      );
    }

    const fetchedAt = capturedAt.toISOString();
    const meta: WebMarkdownMetaV1 = {
      finalUrl: fetched.finalUrl,
      fetchedAt,
      title: extracted.title,
      byline: extracted.byline,
      site: extracted.site,
      publishedAt: extracted.publishedAt,
      wordCount: extracted.wordCount,
      truncated: extracted.truncated,
      kind: "web",
    };
    await publishArticle({
      documentId: document.id,
      userId: document.userId,
      sourceUrl: document.sourceUrl,
      runId,
      title: extracted.title,
      markdown: extracted.markdown,
      meta,
    });
    return {
      kind: "article" as const,
      artifactKind: "web-markdown" as const,
      title: extracted.title,
    };
  } catch (error) {
    const state = await convertedPdfState(document.id, document.userId).catch(
      () => null,
    );
    if (unownedStoredFileId) {
      if (state?.document.fileId === unownedStoredFileId) {
        unownedStoredFileId = null;
        const adopted = await convertedPdfResult(
          document.id,
          document.userId,
          options.enqueuePreview,
        );
        if (adopted) return adopted;
      } else {
        await recordUnownedFileCleanup(
          document.userId,
          unownedStoredFileId,
          options.deleteFile ?? deleteFile,
        );
        unownedStoredFileId = null;
      }
    }
    const converted = state
      ? await convertedPdfResult(
          document.id,
          document.userId,
          options.enqueuePreview,
        ).catch(() => null)
      : null;
    if (converted) return converted;
    await setArtifactFailure(document.id, "web-markdown", error, runId);
    if (error instanceof IngestError && !error.retryable) {
      throw new NonRetryableJobError(error.message, { cause: error });
    }
    throw error;
  }
}
