import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  files,
  materialArtifacts,
  materialDocuments,
  type OcrMetaV1,
} from "../db/schema";
import { MISTRAL_OCR_MODEL, runMistralOcr } from "../lib/ocr";
import { fileAccessUrl } from "../lib/storage";
import { readStorageObject } from "../lib/storage-backend";

const payloadSchema = z.object({ documentId: z.string().min(1) }).strict();
const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
const MAX_OCR_SOURCE_BYTES = 50 * 1024 * 1024;
const OCR_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export const OCR_JOB_KIND = "ocr.document";

export function isOcrMimeType(value: string) {
  return OCR_MIME_TYPES.has(value);
}

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    8_000,
  );
}

export async function runOcrDocumentJob(
  payload: unknown,
  options: {
    fetch?: Fetcher;
    runOcr?: typeof runMistralOcr;
    fileAccessUrl?: typeof fileAccessUrl;
    readStorageObject?: typeof readStorageObject;
    now?: () => number;
    signal?: AbortSignal;
  } = {},
) {
  const { documentId } = payloadSchema.parse(payload);
  const [source] = await db
    .select({ document: materialDocuments, file: files })
    .from(materialDocuments)
    .innerJoin(
      files,
      and(
        eq(files.id, materialDocuments.fileId),
        eq(files.userId, materialDocuments.userId),
        eq(files.status, "stored"),
      ),
    )
    .where(eq(materialDocuments.id, documentId))
    .limit(1);
  if (!source || source.document.sourceType !== "file") {
    throw new Error("OCR source document not found");
  }
  if (!isOcrMimeType(source.file.mimeType)) {
    throw new Error("OCR accepts only PDF, PNG, JPEG and WebP documents");
  }

  const now = new Date();
  const [artifact] = await db
    .insert(materialArtifacts)
    .values({
      documentId,
      kind: "ocr-markdown",
      status: "pending",
      content: null,
      metaVersion: 1,
      metaJson: null,
      error: null,
      userId: source.document.userId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [materialArtifacts.documentId, materialArtifacts.kind],
      set: {
        status: "pending",
        content: null,
        metaVersion: 1,
        metaJson: null,
        error: null,
        updatedAt: now,
      },
    })
    .returning({ id: materialArtifacts.id });
  if (!artifact) throw new Error("OCR artifact could not be initialized");

  const clock = options.now ?? Date.now;
  const startedAt = clock();
  try {
    let bytes: ArrayBuffer;
    if (source.file.provider === "local" || source.file.provider === "s3") {
      bytes = await (options.readStorageObject ?? readStorageObject)(
        source.file.provider,
        source.file.storageKey,
        { signal: options.signal, maxBytes: MAX_OCR_SOURCE_BYTES },
      );
    } else {
      if (
        source.file.provider !== "uploadthing" &&
        !options.fetch &&
        !options.fileAccessUrl
      ) {
        throw new Error("OCR source uses an unsupported storage provider");
      }
      const fetcher = options.fetch ?? fetch;
      const sourceUrl = await (options.fileAccessUrl ?? fileAccessUrl)(
        source.file,
      );
      const response = await fetcher(sourceUrl, { signal: options.signal });
      if (!response.ok) {
        throw new Error(`Stored material download returned ${response.status}`);
      }
      bytes = await response.arrayBuffer();
      if (bytes.byteLength > MAX_OCR_SOURCE_BYTES) {
        throw new Error("Stored material is larger than 50 MiB");
      }
    }
    const blob = new Blob([bytes], { type: source.file.mimeType });
    const result = await (options.runOcr ?? runMistralOcr)(
      source.document.userId,
      { blob, name: source.document.title },
      { signal: options.signal },
    );
    if (
      new TextEncoder().encode(result.markdown).byteLength > MAX_MARKDOWN_BYTES
    ) {
      throw new Error("OCR transcript is larger than 2 MiB");
    }
    const meta: OcrMetaV1 = {
      model: MISTRAL_OCR_MODEL,
      pageCount: result.pageCount,
      providerFileId: result.providerFileId,
      durationMs: Math.max(0, clock() - startedAt),
    };
    await db
      .update(materialArtifacts)
      .set({
        status: "ready",
        content: result.markdown,
        metaVersion: 1,
        metaJson: meta,
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(materialArtifacts.id, artifact.id));
    return {
      artifactId: artifact.id,
      pageCount: result.pageCount,
    };
  } catch (error) {
    await db
      .update(materialArtifacts)
      .set({
        status: "failed",
        content: null,
        metaJson: null,
        error: errorMessage(error),
        updatedAt: new Date(),
      })
      .where(eq(materialArtifacts.id, artifact.id));
    throw error;
  }
}
