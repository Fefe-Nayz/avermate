import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { files, materialDocuments, type OcrMetaV1 } from "../db/schema";
import {
  MISTRAL_OCR_MODEL,
  resolveOcrProvider,
  runMistralOcr,
  type OcrProvider,
} from "../lib/ocr";
import {
  isInternalOwnedFileProvider,
  readOwnedFileBytes,
} from "../lib/owned-file-storage";
import { fileAccessUrl } from "../lib/storage";
import { readStorageObject } from "../lib/storage-backend";
import { NonRetryableJobError, type JobExecutionIdentity } from "../lib/jobs";
import { canonicalJson, sha256 } from "../search/values";
import { requireUserJobExecution } from "./job-authority";
import {
  claimMaterialArtifactGeneration,
  failMaterialArtifactGeneration,
  publishMaterialArtifactGeneration,
} from "./material-artifact-generation";

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
    resolveProvider?: (userId: string) => Promise<OcrProvider>;
    fileAccessUrl?: typeof fileAccessUrl;
    readStorageObject?: typeof readStorageObject;
    readOwnedFile?: typeof readOwnedFileBytes;
    now?: () => number;
    operationId?: string;
    attempt?: number;
    job?: JobExecutionIdentity;
    signal?: AbortSignal;
  } = {},
) {
  const { documentId } = payloadSchema.parse(payload);
  const authority = await requireUserJobExecution(
    options.job,
    OCR_JOB_KIND,
    (storedPayload) => {
      const parsed = payloadSchema.safeParse(storedPayload);
      return parsed.success && parsed.data.documentId === documentId;
    },
  );
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
    .where(
      and(
        eq(materialDocuments.id, documentId),
        authority ? eq(materialDocuments.userId, authority.userId) : undefined,
      ),
    )
    .limit(1);
  if (!source || source.document.sourceType !== "file") {
    throw authority
      ? new NonRetryableJobError("OCR source document not found")
      : new Error("OCR source document not found");
  }
  if (!isOcrMimeType(source.file.mimeType)) {
    throw new Error("OCR accepts only PDF, PNG, JPEG and WebP documents");
  }

  const generation = await claimMaterialArtifactGeneration({
    documentId,
    kind: "ocr-markdown",
    userId: source.document.userId,
    runToken: authority?.runToken ?? `manual:${crypto.randomUUID()}`,
    job: authority,
  });

  const clock = options.now ?? Date.now;
  const startedAt = clock();
  try {
    let bytes: ArrayBuffer;
    if (
      isInternalOwnedFileProvider(source.file.provider) ||
      options.readOwnedFile
    ) {
      bytes = await (options.readOwnedFile ?? readOwnedFileBytes)(
        source.document.userId,
        source.file,
        {
          signal: options.signal,
          maxBytes: MAX_OCR_SOURCE_BYTES,
          dependencies: options.readStorageObject
            ? { readManagedObject: options.readStorageObject }
            : undefined,
        },
      );
    } else {
      if (!options.fetch || !options.fileAccessUrl) {
        throw new Error("OCR source uses an unsupported storage provider");
      }
      const sourceUrl = await options.fileAccessUrl(source.file);
      const response = await options.fetch(sourceUrl, {
        signal: options.signal,
      });
      if (!response.ok) {
        throw new Error(`Stored material download returned ${response.status}`);
      }
      bytes = await response.arrayBuffer();
      if (bytes.byteLength > MAX_OCR_SOURCE_BYTES) {
        throw new Error("Stored material is larger than 50 MiB");
      }
    }
    const blob = new Blob([bytes], { type: source.file.mimeType });
    const provider = options.runOcr
      ? null
      : await (options.resolveProvider ?? resolveOcrProvider)(
          source.document.userId,
        );
    const result = options.runOcr
      ? await options.runOcr(
          source.document.userId,
          { blob, name: source.document.title },
          {
            operationId: options.operationId,
            attempt: options.attempt,
            signal: options.signal,
          },
        )
      : await provider!.run(
          { blob, name: source.document.title },
          {
            operationId: options.operationId,
            attempt: options.attempt,
            signal: options.signal,
          },
        );
    if (
      new TextEncoder().encode(result.markdown).byteLength > MAX_MARKDOWN_BYTES
    ) {
      throw new Error("OCR transcript is larger than 2 MiB");
    }
    const meta: OcrMetaV1 = {
      model: provider?.model ?? MISTRAL_OCR_MODEL,
      provider: provider?.id ?? "mistral",
      pageCount: result.pageCount,
      providerFileId: result.providerFileId,
      durationMs: Math.max(0, clock() - startedAt),
    };
    await publishMaterialArtifactGeneration({
      generation,
      content: result.markdown,
      metaJson: JSON.stringify(meta),
      segments: (result.pages ?? []).map((page) => ({
        text: page.markdown,
        locatorJson: canonicalJson({
          kind: "pdf",
          page: page.providerIndex + 1,
        }),
        contentHash: sha256(page.markdown),
      })),
    });
    return {
      artifactId: generation.artifactId,
      pageCount: result.pageCount,
    };
  } catch (error) {
    await failMaterialArtifactGeneration({
      generation,
      error: errorMessage(error),
    });
    throw error;
  }
}
