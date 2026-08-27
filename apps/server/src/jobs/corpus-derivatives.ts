import {
  corpusDerivativeWorkerOutputV1Schema,
  sourceLocatorV1Schema,
  type CorpusDerivativeWorkerManifestV1,
  type CorpusDerivativeWorkerOutputV1,
  type SourceLocatorV1,
} from "@avermate/agent-contracts";
import { z } from "zod";
import { db } from "../db";
import type { FilePurpose } from "../db/schema";
import { readOwnedFileBytes } from "../lib/owned-file-storage";
import { deleteFile, storeFile } from "../lib/storage";
import { enqueueJob, NonRetryableJobError } from "../lib/jobs";
import { newId } from "../lib/id";
import { registerContentDerivative } from "../search/derivatives";
import { readEmbeddingPublicationFence } from "../search/embedding-publication-fence";
import { coreCorpusIndexService } from "../search/index-service";
import { createOwnedCorpusVectorRuntime } from "../search/vector-runtime";
import { canonicalJson, jsonValue, sha256 } from "../search/values";
import { runConfiguredSandboxWorker } from "../sandbox/worker-services";
import {
  CORPUS_PRODUCE_DERIVATIVES_JOB_KIND,
  CORPUS_REEMBED_SPACE_JOB_KIND,
} from "./corpus";

const payloadSchema = z.strictObject({
  ownerId: z.string().min(1).max(256),
  versionId: z.string().min(1).max(256),
});

const SUPPORTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const SUPPORTED_AUDIO_TYPES = new Set([
  "audio/mpeg",
  "audio/mp4",
  "audio/m4a",
  "audio/wav",
  "audio/ogg",
  "audio/webm",
]);
const SUPPORTED_VIDEO_TYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);
const SOURCE_BYTES_LIMIT = 500 * 1024 * 1024;
const PDF_BATCH_SIZE = 16;
const MEDIA_BATCH_SIZE = 64;
const MAX_DERIVATIVE_UNITS = 10_000;

export type CorpusDerivativeSource = {
  ownerId: string;
  sourceId: string;
  originId: string;
  title: string;
  versionId: string;
  fileId: string;
  provider: string;
  storageKey: string;
  mimeType: string;
  byteSize: number;
  storageKeyHash: string;
};

export type CorpusDerivativeUnit = {
  chunkId: string;
  locator: SourceLocatorV1;
};

type StoredDerivativeFile = Awaited<ReturnType<typeof storeFile>>;
type WorkerExecution = Awaited<ReturnType<typeof runConfiguredSandboxWorker>>;

export type CorpusDerivativeJobDependencies = {
  loadSource: (
    ownerId: string,
    versionId: string,
  ) => Promise<CorpusDerivativeSource | null>;
  loadUnits: (
    ownerId: string,
    versionId: string,
  ) => Promise<CorpusDerivativeUnit[]>;
  readyKeys: (
    ownerId: string,
    versionId: string,
  ) => Promise<ReadonlySet<string>>;
  readObject: typeof readOwnedFileBytes;
  executeWorker: typeof runConfiguredSandboxWorker;
  store: typeof storeFile;
  remove: typeof deleteFile;
  register: typeof registerContentDerivative;
  enqueueEmbedding: (
    ownerId: string,
    versionId: string,
  ) => Promise<string | null>;
  publishMediaDiscovery: (input: {
    source: CorpusDerivativeSource;
    modality: "audio" | "video";
    durationMs: number;
    execution: WorkerExecution;
    signal?: AbortSignal;
  }) => Promise<{ versionId: string; derivativeJobId: string }>;
};

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function loadOwnedSource(ownerId: string, versionId: string) {
  const result = await db.$client.execute({
    sql: `SELECT sources.userId, sources.id AS sourceId,
        sources.originId, documents.title, versions.id AS versionId,
        json_extract(versions.metadataJson, '$.sourceFileId') AS sourceFileId,
        json_extract(versions.metadataJson, '$.storageKeyHash') AS storageKeyHash,
        files.id AS fileId, files.provider, files.storageKey, files.mimeType,
        files.byteSize, files.status
      FROM content_versions AS versions
      JOIN content_sources AS sources ON sources.id = versions.sourceId
      JOIN material_documents AS documents
        ON documents.id = sources.originId AND documents.userId = sources.userId
      JOIN files ON files.id = json_extract(
        versions.metadataJson, '$.sourceFileId'
      ) AND files.userId = sources.userId
      WHERE versions.id = ? AND sources.userId = ?
        AND sources.originKind = 'material' AND documents.deletedAt IS NULL
      LIMIT 1`,
    args: [versionId, ownerId],
  });
  const row = result.rows[0];
  const provider = String(row?.provider ?? "");
  if (!row || row.status !== "stored" || !provider) {
    return null;
  }
  const byteSize = Number(row.byteSize);
  if (
    !Number.isSafeInteger(byteSize) ||
    byteSize < 1 ||
    byteSize > SOURCE_BYTES_LIMIT ||
    String(row.storageKeyHash) !== sha256(String(row.storageKey))
  ) {
    throw new NonRetryableJobError("CORPUS_DERIVATIVE_SOURCE_IDENTITY_INVALID");
  }
  return {
    ownerId: String(row.userId),
    sourceId: String(row.sourceId),
    originId: String(row.originId),
    title: String(row.title),
    versionId: String(row.versionId),
    fileId: String(row.fileId),
    provider,
    storageKey: String(row.storageKey),
    mimeType: String(row.mimeType).toLowerCase(),
    byteSize,
    storageKeyHash: String(row.storageKeyHash),
  } satisfies CorpusDerivativeSource;
}

async function loadVisualUnits(ownerId: string, versionId: string) {
  const result = await db.$client.execute({
    sql: `SELECT chunks.id, chunks.locatorJson
      FROM content_chunks AS chunks
      JOIN content_versions AS versions ON versions.id = chunks.versionId
      JOIN content_sources AS sources ON sources.id = versions.sourceId
      WHERE chunks.versionId = ? AND sources.userId = ?
        AND chunks.evidenceKind = 'visual-only'
      ORDER BY chunks.ordinal, chunks.id`,
    args: [versionId, ownerId],
  });
  if (result.rows.length > MAX_DERIVATIVE_UNITS) {
    throw new NonRetryableJobError("CORPUS_DERIVATIVE_UNIT_LIMIT_EXCEEDED");
  }
  const byLocator = new Map<string, CorpusDerivativeUnit>();
  for (const row of result.rows) {
    const locator = sourceLocatorV1Schema.parse(jsonValue(row.locatorJson));
    const key = canonicalJson(locator);
    if (!byLocator.has(key)) {
      byLocator.set(key, { chunkId: String(row.id), locator });
    }
  }
  return [...byLocator.values()];
}

function derivativeKey(kind: string, locator: SourceLocatorV1) {
  return `${kind}\0${canonicalJson(locator)}`;
}

async function loadReadyDerivativeKeys(ownerId: string, versionId: string) {
  const result = await db.$client.execute({
    sql: `SELECT derivatives.kind, derivatives.locatorJson
      FROM content_derivatives AS derivatives
      JOIN content_versions AS versions ON versions.id = derivatives.versionId
      JOIN content_sources AS sources ON sources.id = versions.sourceId
      JOIN files ON files.id = derivatives.fileId AND files.userId = sources.userId
      WHERE derivatives.versionId = ? AND sources.userId = ?
        AND derivatives.status = 'ready' AND files.status = 'stored'`,
    args: [versionId, ownerId],
  });
  return new Set(
    result.rows.map((row) =>
      derivativeKey(
        String(row.kind),
        sourceLocatorV1Schema.parse(jsonValue(row.locatorJson)),
      ),
    ),
  );
}

export async function enqueueEmbedding(ownerId: string, versionId: string) {
  const fence = await readEmbeddingPublicationFence(ownerId);
  if (!fence.enabled) return null;
  let runtime: Awaited<ReturnType<typeof createOwnedCorpusVectorRuntime>>;
  try {
    runtime = await createOwnedCorpusVectorRuntime(ownerId);
  } catch {
    return null;
  }
  if (!runtime) return null;
  const job = await enqueueJob({
    kind: CORPUS_REEMBED_SPACE_JOB_KIND,
    payload: {
      ownerId,
      scope: "advanced-projects",
      triggerVersionId: versionId,
      publicationEpoch: fence.publicationEpoch,
    },
    userId: ownerId,
    idempotencyKey: `${runtime.embedding.descriptor().id}:${ownerId}:epoch:${fence.publicationEpoch}:trigger:${versionId}`,
    maxAttempts: 4,
  });
  const currentFence = await readEmbeddingPublicationFence(ownerId);
  if (
    !currentFence.enabled ||
    currentFence.publicationEpoch !== fence.publicationEpoch
  ) {
    const now = Math.floor(Date.now() / 1_000);
    await db.$client.batch(
      [
        {
          sql: `UPDATE jobs SET status = 'cancelled', lockedBy = NULL,
              lockedUntil = NULL, updatedAt = ?
            WHERE id = ? AND userId = ? AND status = 'queued'`,
          args: [now, job.id, ownerId],
        },
        {
          sql: `INSERT INTO job_runtime_metadata
              (jobId, stage, cancellation, createdAt, updatedAt)
            SELECT id, 'running', 'requested', ?, ? FROM jobs
            WHERE id = ? AND userId = ? AND status = 'running'
            ON CONFLICT(jobId) DO UPDATE SET
              cancellation = 'requested', updatedAt = excluded.updatedAt`,
          args: [now, now, job.id, ownerId],
        },
      ],
      "write",
    );
    return null;
  }
  return job.id;
}

export function boundedMediaWindows(
  modality: "audio" | "video",
  durationMs: number,
) {
  if (
    !Number.isSafeInteger(durationMs) ||
    durationMs < 1 ||
    durationMs > 8 * 60 * 60_000
  ) {
    throw new NonRetryableJobError("CORPUS_MEDIA_DURATION_INVALID");
  }
  const maximumMs = modality === "audio" ? 180_000 : 120_000;
  const overlapMs = 10_000;
  const windows: Array<{ startMs: number; endMs: number }> = [];
  let startMs = 0;
  while (startMs < durationMs) {
    const endMs = Math.min(durationMs, startMs + maximumMs);
    windows.push({ startMs, endMs });
    if (windows.length > 1_000) {
      throw new NonRetryableJobError("CORPUS_MEDIA_WINDOW_LIMIT_EXCEEDED");
    }
    if (endMs >= durationMs) break;
    startMs = endMs - overlapMs;
  }
  return windows;
}

async function publishMediaDiscovery(input: {
  source: CorpusDerivativeSource;
  modality: "audio" | "video";
  durationMs: number;
  execution: WorkerExecution;
  signal?: AbortSignal;
}) {
  input.signal?.throwIfAborted();
  const windows = boundedMediaWindows(input.modality, input.durationMs);
  const meta = {
    kind: "media-metadata",
    modality: input.modality,
    durationMs: input.durationMs,
    segmentCount: windows.length,
    worker: "corpus-derivatives.v1",
    rendererProfile: input.execution.profileVersion,
    rendererImageDigest: input.execution.imageDigest,
  } as const;
  const existing = await db.$client.execute({
    sql: `SELECT artifacts.id, artifacts.status, artifacts.metaJson,
        COUNT(segments.id) AS segmentCount
      FROM material_artifacts AS artifacts
      LEFT JOIN material_artifact_segments AS segments
        ON segments.artifactId = artifacts.id
      WHERE artifacts.documentId = ? AND artifacts.userId = ?
        AND artifacts.kind = 'media-metadata'
      GROUP BY artifacts.id LIMIT 1`,
    args: [input.source.originId, input.source.ownerId],
  });
  const existingMeta = existing.rows[0]
    ? jsonValue<Record<string, unknown> | null>(existing.rows[0].metaJson)
    : null;
  const reusable = Boolean(
    existing.rows[0]?.status === "ready" &&
    Number(existing.rows[0]?.segmentCount) === windows.length &&
    existingMeta?.kind === meta.kind &&
    existingMeta.modality === meta.modality &&
    Number(existingMeta.durationMs) === meta.durationMs &&
    existingMeta.rendererProfile === meta.rendererProfile &&
    existingMeta.rendererImageDigest === meta.rendererImageDigest,
  );
  if (!reusable) {
    const artifactId = existing.rows[0]?.id
      ? String(existing.rows[0].id)
      : newId("mart");
    const now = Math.floor(Date.now() / 1_000);
    const transaction = await db.$client.transaction("write");
    try {
      await transaction.execute({
        sql: `INSERT INTO material_artifacts (
            id, documentId, kind, status, content, metaVersion, metaJson,
            error, userId, createdAt, updatedAt
          ) VALUES (?, ?, 'media-metadata', 'pending', NULL, 1, ?, NULL, ?, ?, ?)
          ON CONFLICT(documentId, kind) DO UPDATE SET
            status = 'pending', content = NULL, metaVersion = 1,
            metaJson = excluded.metaJson, error = NULL,
            updatedAt = excluded.updatedAt`,
        args: [
          artifactId,
          input.source.originId,
          canonicalJson(meta),
          input.source.ownerId,
          now,
          now,
        ],
      });
      const current = await transaction.execute({
        sql: `SELECT id FROM material_artifacts
          WHERE documentId = ? AND userId = ? AND kind = 'media-metadata'
          LIMIT 1`,
        args: [input.source.originId, input.source.ownerId],
      });
      const currentArtifactId = String(current.rows[0]?.id ?? "");
      if (!currentArtifactId) {
        throw new Error("CORPUS_MEDIA_METADATA_ARTIFACT_MISSING");
      }
      await transaction.execute({
        sql: `DELETE FROM material_artifact_segments WHERE artifactId = ?`,
        args: [currentArtifactId],
      });
      for (const [ordinal, window] of windows.entries()) {
        const locator = {
          kind: input.modality,
          startMs: window.startMs,
          endMs: window.endMs,
        } as const;
        await transaction.execute({
          sql: `INSERT INTO material_artifact_segments (
              id, artifactId, ordinal, text, locatorJson, contentHash
            ) VALUES (?, ?, ?, ?, ?, ?)`,
          args: [
            newId("maseg"),
            currentArtifactId,
            ordinal,
            input.source.title,
            canonicalJson(locator),
            sha256(canonicalJson([input.source.title, locator])),
          ],
        });
      }
      const published = await transaction.execute({
        sql: `UPDATE material_artifacts SET status = 'ready', updatedAt = ?
          WHERE id = ? AND userId = ? AND status = 'pending'`,
        args: [now, currentArtifactId, input.source.ownerId],
      });
      if (Number(published.rowsAffected) !== 1) {
        throw new Error("CORPUS_MEDIA_METADATA_PUBLICATION_CONFLICT");
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
  input.signal?.throwIfAborted();
  const successor = await coreCorpusIndexService.indexSource(
    {
      ownerId: input.source.ownerId,
      originKind: "material",
      originId: input.source.originId,
    },
    { signal: input.signal },
  );
  if (successor.versionId === input.source.versionId) {
    throw new Error("CORPUS_MEDIA_DISCOVERY_DID_NOT_ADVANCE_VERSION");
  }
  const job = await enqueueJob({
    kind: CORPUS_PRODUCE_DERIVATIVES_JOB_KIND,
    payload: {
      ownerId: input.source.ownerId,
      versionId: successor.versionId,
    },
    userId: input.source.ownerId,
    idempotencyKey: successor.versionId,
    maxAttempts: 4,
  });
  return { versionId: successor.versionId, derivativeJobId: job.id };
}

const defaultDependencies: CorpusDerivativeJobDependencies = {
  loadSource: loadOwnedSource,
  loadUnits: loadVisualUnits,
  readyKeys: loadReadyDerivativeKeys,
  readObject: readOwnedFileBytes,
  executeWorker: runConfiguredSandboxWorker,
  store: storeFile,
  remove: deleteFile,
  register: registerContentDerivative,
  enqueueEmbedding,
  publishMediaDiscovery,
};

function sourceKind(source: CorpusDerivativeSource) {
  if (source.mimeType === "application/pdf") return "pdf" as const;
  if (SUPPORTED_IMAGE_TYPES.has(source.mimeType)) return "image" as const;
  if (SUPPORTED_AUDIO_TYPES.has(source.mimeType)) return "audio" as const;
  if (SUPPORTED_VIDEO_TYPES.has(source.mimeType)) return "video" as const;
  return null;
}

async function readVerifiedSourceBytes(
  source: CorpusDerivativeSource,
  dependencies: CorpusDerivativeJobDependencies,
  signal?: AbortSignal,
) {
  const sourceBytes = new Uint8Array(
    await dependencies.readObject(
      source.ownerId,
      {
        id: source.fileId,
        userId: source.ownerId,
        provider: source.provider,
        storageKey: source.storageKey,
        mimeType: source.mimeType,
        byteSize: source.byteSize,
        status: "stored",
      },
      { signal, maxBytes: source.byteSize },
    ),
  );
  if (sourceBytes.byteLength !== source.byteSize) {
    throw new NonRetryableJobError("CORPUS_DERIVATIVE_SOURCE_SIZE_MISMATCH");
  }
  return {
    bytes: sourceBytes,
    digest: `sha256:${sha256(sourceBytes)}` as const,
  };
}

async function discoverMediaUnits(input: {
  source: CorpusDerivativeSource;
  modality: "audio" | "video";
  dependencies: CorpusDerivativeJobDependencies;
  operationId?: string;
  signal?: AbortSignal;
}) {
  const source = await readVerifiedSourceBytes(
    input.source,
    input.dependencies,
    input.signal,
  );
  input.signal?.throwIfAborted();
  const manifest = {
    schemaVersion: 1,
    worker: "corpus-derivatives.v1",
    source: {
      path: "input/source",
      digest: source.digest,
      byteSize: input.source.byteSize,
      mimeType: input.source
        .mimeType as CorpusDerivativeWorkerManifestV1["source"]["mimeType"],
    },
    request: {
      kind: "media-probe",
      modality: input.modality,
    },
  } satisfies CorpusDerivativeWorkerManifestV1;
  const execution = await input.dependencies.executeWorker({
    workerId: "corpus-derivatives.v1",
    ownerId: input.source.ownerId,
    threadId: input.source.originId,
    branchId: `${input.source.versionId}-media-discovery-v1`,
    operationId: `${input.operationId ?? input.source.versionId}:probe`,
    manifest,
    inputFiles: [
      {
        relativePath: "input/source",
        bytes: source.bytes,
        digest: source.digest,
        mimeType: input.source.mimeType,
      },
    ],
    maximumReturnBytes: 1024 * 1024,
    signal: input.signal,
  });
  const output = corpusDerivativeWorkerOutputV1Schema.parse(execution.output);
  if (output.kind !== "media-probe" || output.modality !== input.modality) {
    throw new Error("CORPUS_DERIVATIVE_WORKER_PROBE_MISMATCH");
  }
  input.signal?.throwIfAborted();
  return input.dependencies.publishMediaDiscovery({
    source: input.source,
    modality: input.modality,
    durationMs: output.durationMs,
    execution,
    signal: input.signal,
  });
}

function requiredDerivativeKeys(
  kind: NonNullable<ReturnType<typeof sourceKind>>,
  units: readonly CorpusDerivativeUnit[],
) {
  return units.flatMap((unit) =>
    kind === "pdf"
      ? [
          derivativeKey("pdf-page", unit.locator),
          derivativeKey("page-image", unit.locator),
        ]
      : [
          derivativeKey(
            kind === "image"
              ? "page-image"
              : kind === "audio"
                ? "audio-segment"
                : "video-segment",
            unit.locator,
          ),
        ],
  );
}

function validateUnitsForSource(
  kind: NonNullable<ReturnType<typeof sourceKind>>,
  units: readonly CorpusDerivativeUnit[],
) {
  const filtered = units.filter((unit) => {
    if (kind === "pdf") return unit.locator.kind === "pdf";
    if (kind === "image") return unit.locator.kind === "text";
    if (kind === "audio") {
      return (
        unit.locator.kind === "audio" &&
        unit.locator.endMs - unit.locator.startMs <= 180_000
      );
    }
    return (
      unit.locator.kind === "video" &&
      unit.locator.endMs - unit.locator.startMs <= 120_000
    );
  });
  if (filtered.length !== units.length) {
    throw new NonRetryableJobError("CORPUS_DERIVATIVE_LOCATOR_MISMATCH");
  }
  if (kind === "image" && filtered.length !== 1) {
    throw new NonRetryableJobError("CORPUS_IMAGE_DERIVATIVE_UNIT_INVALID");
  }
  return filtered;
}

function batch<T>(values: readonly T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function workerManifest(
  source: CorpusDerivativeSource,
  digest: `sha256:${string}`,
  kind: NonNullable<ReturnType<typeof sourceKind>>,
  units: readonly CorpusDerivativeUnit[],
): CorpusDerivativeWorkerManifestV1 {
  const common = {
    schemaVersion: 1 as const,
    worker: "corpus-derivatives.v1" as const,
    source: {
      path: "input/source" as const,
      digest,
      byteSize: source.byteSize,
      mimeType:
        source.mimeType as CorpusDerivativeWorkerManifestV1["source"]["mimeType"],
    },
  };
  if (kind === "pdf") {
    return {
      ...common,
      request: {
        kind,
        maximumDimension: 2_048,
        units: units.map((unit) => ({
          unitId: unit.chunkId,
          page: (unit.locator as Extract<SourceLocatorV1, { kind: "pdf" }>)
            .page,
        })),
      },
    };
  }
  if (kind === "image") {
    return {
      ...common,
      request: { kind, maximumDimension: 4_096, unitId: units[0]!.chunkId },
    };
  }
  return {
    ...common,
    request: {
      kind,
      ...(kind === "video" ? { maximumDimension: 1_280 } : {}),
      units: units.map((unit) => {
        const locator = unit.locator as Extract<
          SourceLocatorV1,
          { kind: "audio" | "video" }
        >;
        return {
          unitId: unit.chunkId,
          startMs: locator.startMs,
          endMs: locator.endMs,
        };
      }),
    },
  } as CorpusDerivativeWorkerManifestV1;
}

function exactOutput(
  output: CorpusDerivativeWorkerOutputV1,
  expectedKind: NonNullable<ReturnType<typeof sourceKind>>,
  units: readonly CorpusDerivativeUnit[],
) {
  if (output.kind === "media-probe") {
    throw new Error("CORPUS_DERIVATIVE_PROBE_CANNOT_BE_ADOPTED");
  }
  if (output.kind !== expectedKind) {
    throw new Error("CORPUS_DERIVATIVE_WORKER_KIND_MISMATCH");
  }
  const expected = new Map(units.map((unit) => [unit.chunkId, unit]));
  const returnedIds =
    output.kind === "image"
      ? [output.unitId]
      : output.units.map((unit) => unit.unitId);
  if (
    returnedIds.length !== expected.size ||
    new Set(returnedIds).size !== returnedIds.length ||
    returnedIds.some((id) => !expected.has(id))
  ) {
    throw new Error("CORPUS_DERIVATIVE_WORKER_UNIT_MISMATCH");
  }
  if (output.kind === "pdf") {
    for (const unit of output.units) {
      const locator = expected.get(unit.unitId)!.locator;
      if (locator.kind !== "pdf" || locator.page !== unit.page) {
        throw new Error("CORPUS_DERIVATIVE_WORKER_PAGE_MISMATCH");
      }
    }
  }
  if (output.kind === "audio" || output.kind === "video") {
    for (const unit of output.units) {
      const locator = expected.get(unit.unitId)!.locator;
      if (
        locator.kind !== output.kind ||
        locator.startMs !== unit.startMs ||
        locator.endMs !== unit.endMs
      ) {
        throw new Error("CORPUS_DERIVATIVE_WORKER_WINDOW_MISMATCH");
      }
    }
  }
  return expected;
}

async function storeAndRegister(input: {
  source: CorpusDerivativeSource;
  unit: CorpusDerivativeUnit;
  bytes: Uint8Array;
  output: {
    path: string;
    digest: string;
    byteSize: number;
    mimeType: string;
  };
  kind: "pdf-page" | "page-image" | "audio-segment" | "video-segment";
  execution: WorkerExecution;
  metadata: Record<string, unknown>;
  dependencies: CorpusDerivativeJobDependencies;
  signal?: AbortSignal;
}) {
  const purpose: FilePurpose =
    input.kind === "audio-segment" || input.kind === "video-segment"
      ? "course-media"
      : "course-material";
  const name = input.output.path.split("/").at(-1) ?? "derivative";
  let candidate: StoredDerivativeFile | null = null;
  try {
    input.signal?.throwIfAborted();
    candidate = await input.dependencies.store({
      userId: input.source.ownerId,
      purpose,
      nameHint: `${input.source.versionId}-${name}`,
      file: new File([exactArrayBuffer(input.bytes)], name, {
        type: input.output.mimeType,
      }),
    });
    input.signal?.throwIfAborted();
    const durationMs =
      input.unit.locator.kind === "audio" || input.unit.locator.kind === "video"
        ? input.unit.locator.endMs - input.unit.locator.startMs
        : null;
    const registered = await input.dependencies.register({
      ownerId: input.source.ownerId,
      versionId: input.source.versionId,
      chunkId: input.unit.chunkId,
      fileId: candidate.id,
      kind: input.kind,
      locator: input.unit.locator,
      contentHash: input.output.digest.replace(/^sha256:/u, ""),
      mimeType: input.output.mimeType,
      byteSize: input.output.byteSize,
      estimatedInputTokens: Math.max(
        1,
        Math.min(
          8_192,
          durationMs === null
            ? Math.ceil(input.output.byteSize / 1_024)
            : Math.ceil(durationMs / 1_000) * 8,
        ),
      ),
      durationMs,
      rendererProfile: input.execution.profileVersion,
      rendererImageDigest: input.execution.imageDigest,
      metadata: {
        ...input.metadata,
        sourceFileId: input.source.fileId,
        sourceStorageKeyHash: input.source.storageKeyHash,
        worker: "corpus-derivatives.v1",
        workerOutputPath: input.output.path,
        evidenceNonce: input.execution.evidenceNonce,
      },
    });
    if (registered.fileId !== candidate.id) {
      await input.dependencies.remove(input.source.ownerId, candidate.id);
    }
    candidate = null;
    return registered.id;
  } catch (error) {
    if (candidate) {
      await input.dependencies
        .remove(input.source.ownerId, candidate.id)
        .catch(() => undefined);
    }
    throw error;
  }
}

async function adoptOutput(input: {
  source: CorpusDerivativeSource;
  units: readonly CorpusDerivativeUnit[];
  output: CorpusDerivativeWorkerOutputV1;
  execution: WorkerExecution;
  readyKeys: ReadonlySet<string>;
  dependencies: CorpusDerivativeJobDependencies;
  signal?: AbortSignal;
}) {
  if (input.output.kind === "media-probe") {
    throw new Error("CORPUS_DERIVATIVE_PROBE_CANNOT_BE_ADOPTED");
  }
  const expected = exactOutput(input.output, input.output.kind, input.units);
  const ids: string[] = [];
  if (input.output.kind === "pdf") {
    for (const output of input.output.units) {
      const unit = expected.get(output.unitId)!;
      const geometry = {
        originalPage: output.page,
        rotationDegrees: output.rotationDegrees,
        widthPoints: output.widthPoints,
        heightPoints: output.heightPoints,
      };
      for (const descriptor of [
        { kind: "pdf-page" as const, file: output.pdf },
        { kind: "page-image" as const, file: output.image },
      ]) {
        if (input.readyKeys.has(derivativeKey(descriptor.kind, unit.locator))) {
          continue;
        }
        const bytes = input.execution.files.get(descriptor.file.path);
        if (!bytes) throw new Error("CORPUS_DERIVATIVE_OUTPUT_MISSING");
        ids.push(
          await storeAndRegister({
            source: input.source,
            unit,
            bytes,
            output: descriptor.file,
            kind: descriptor.kind,
            execution: input.execution,
            metadata: geometry,
            dependencies: input.dependencies,
            signal: input.signal,
          }),
        );
      }
    }
    return ids;
  }
  if (input.output.kind === "image") {
    const unit = expected.get(input.output.unitId)!;
    if (input.readyKeys.has(derivativeKey("page-image", unit.locator))) {
      return ids;
    }
    const bytes = input.execution.files.get(input.output.image.path);
    if (!bytes) throw new Error("CORPUS_DERIVATIVE_OUTPUT_MISSING");
    ids.push(
      await storeAndRegister({
        source: input.source,
        unit,
        bytes,
        output: input.output.image,
        kind: "page-image",
        execution: input.execution,
        metadata: {
          originalImage: true,
          widthPixels: input.output.width,
          heightPixels: input.output.height,
        },
        dependencies: input.dependencies,
        signal: input.signal,
      }),
    );
    return ids;
  }
  for (const output of input.output.units) {
    const unit = expected.get(output.unitId)!;
    const derivativeKind =
      input.output.kind === "audio" ? "audio-segment" : "video-segment";
    if (input.readyKeys.has(derivativeKey(derivativeKind, unit.locator))) {
      continue;
    }
    const bytes = input.execution.files.get(output.file.path);
    if (!bytes) throw new Error("CORPUS_DERIVATIVE_OUTPUT_MISSING");
    ids.push(
      await storeAndRegister({
        source: input.source,
        unit,
        bytes,
        output: output.file,
        kind: derivativeKind,
        execution: input.execution,
        metadata: {
          segmentIndex: output.index,
          startMs: output.startMs,
          endMs: output.endMs,
        },
        dependencies: input.dependencies,
        signal: input.signal,
      }),
    );
  }
  return ids;
}

export async function runCorpusDerivativeProductionJob(
  raw: unknown,
  options: {
    signal?: AbortSignal;
    operationId?: string;
    dependencies?: Partial<CorpusDerivativeJobDependencies>;
  } = {},
) {
  const payload = payloadSchema.parse(raw);
  options.signal?.throwIfAborted();
  const dependencies = {
    ...defaultDependencies,
    ...options.dependencies,
  } satisfies CorpusDerivativeJobDependencies;
  const source = await dependencies.loadSource(
    payload.ownerId,
    payload.versionId,
  );
  if (!source) {
    return {
      stage: "not-applicable" as const,
      derivatives: 0,
      embeddingJobId: await dependencies.enqueueEmbedding(
        payload.ownerId,
        payload.versionId,
      ),
    };
  }
  const kind = sourceKind(source);
  if (!kind) {
    return {
      stage: "unsupported" as const,
      derivatives: 0,
      embeddingJobId: await dependencies.enqueueEmbedding(
        payload.ownerId,
        payload.versionId,
      ),
    };
  }
  const units = validateUnitsForSource(
    kind,
    await dependencies.loadUnits(payload.ownerId, payload.versionId),
  );
  if (units.length === 0) {
    if (kind === "audio" || kind === "video") {
      const successor = await discoverMediaUnits({
        source,
        modality: kind,
        dependencies,
        operationId: options.operationId,
        signal: options.signal,
      });
      return {
        stage: "media-discovered" as const,
        derivatives: 0,
        successorVersionId: successor.versionId,
        derivativeJobId: successor.derivativeJobId,
        embeddingJobId: null,
      };
    }
    return {
      stage: "no-visual-units" as const,
      derivatives: 0,
      embeddingJobId: await dependencies.enqueueEmbedding(
        payload.ownerId,
        payload.versionId,
      ),
    };
  }
  const ready = await dependencies.readyKeys(
    payload.ownerId,
    payload.versionId,
  );
  const required = requiredDerivativeKeys(kind, units);
  if (required.every((key) => ready.has(key))) {
    return {
      stage: "reused" as const,
      derivatives: required.length,
      embeddingJobId: await dependencies.enqueueEmbedding(
        payload.ownerId,
        payload.versionId,
      ),
    };
  }
  const pendingUnits = units.filter((unit) =>
    requiredDerivativeKeys(kind, [unit]).some((key) => !ready.has(key)),
  );
  const verifiedSource = await readVerifiedSourceBytes(
    source,
    dependencies,
    options.signal,
  );
  const sourceBytes = verifiedSource.bytes;
  const digest = verifiedSource.digest;
  const batches =
    kind === "image"
      ? [pendingUnits]
      : batch(pendingUnits, kind === "pdf" ? PDF_BATCH_SIZE : MEDIA_BATCH_SIZE);
  const derivativeIds: string[] = [];
  for (const [batchIndex, selected] of batches.entries()) {
    options.signal?.throwIfAborted();
    const manifest = workerManifest(source, digest, kind, selected);
    const execution = await dependencies.executeWorker({
      workerId: "corpus-derivatives.v1",
      ownerId: source.ownerId,
      threadId: source.originId,
      branchId: `${source.versionId}-derivatives-v1`,
      operationId: `${options.operationId ?? source.versionId}:batch:${batchIndex}`,
      manifest,
      inputFiles: [
        {
          relativePath: "input/source",
          bytes: sourceBytes,
          digest,
          mimeType: source.mimeType,
        },
      ],
      maximumReturnBytes: 512 * 1024 * 1024,
      signal: options.signal,
    });
    const output = corpusDerivativeWorkerOutputV1Schema.parse(execution.output);
    exactOutput(output, kind, selected);
    derivativeIds.push(
      ...(await adoptOutput({
        source,
        units: selected,
        output,
        execution,
        readyKeys: ready,
        dependencies,
        signal: options.signal,
      })),
    );
  }
  options.signal?.throwIfAborted();
  return {
    stage: "ready" as const,
    derivatives: derivativeIds.length,
    derivativeIds,
    embeddingJobId: await dependencies.enqueueEmbedding(
      payload.ownerId,
      payload.versionId,
    ),
  };
}

export async function enqueueCorpusDerivativeProduction(input: {
  ownerId: string;
  versionId: string;
}) {
  return enqueueJob({
    kind: CORPUS_PRODUCE_DERIVATIVES_JOB_KIND,
    payload: input,
    userId: input.ownerId,
    idempotencyKey: input.versionId,
    maxAttempts: 4,
  });
}
