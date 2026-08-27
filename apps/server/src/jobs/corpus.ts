import { z } from "zod";
import {
  sourceLocatorV1Schema,
  type EmbeddingSpaceDescriptor,
  type MediaEmbeddingInput,
  type SourceLocatorV1,
} from "@avermate/agent-contracts";
import { db } from "../db";
import { enqueueJob, NonRetryableJobError } from "../lib/jobs";
import { newId } from "../lib/id";
import {
  RoutedCorpusContentReader,
  type AuthorizedCorpusChunkRow,
} from "../search/corpus-content-reader";
import { coreCorpusIndexService } from "../search/index-service";
import { SqliteFts5LexicalSearchBackend } from "../search/lexical";
import { assertEmbeddingPublicationFence } from "../search/embedding-publication-fence";
import {
  createOwnedCorpusVectorRuntime,
  type ContentHashedVector,
  type CorpusVectorRuntime,
} from "../search/vector-runtime";
import { canonicalJson, jsonValue, sha256 } from "../search/values";
import {
  evaluateFrenchSchoolFixture,
  FRENCH_SCHOOL_FIXTURE_REVISION,
  retrievalEvaluationConfigurationSchema,
} from "../search/eval/evaluation";

export const CORPUS_INDEX_SOURCE_JOB_KIND = "corpus.indexSource";
export const CORPUS_REMOVE_VERSION_JOB_KIND = "corpus.removeVersion";
export const CORPUS_EMBED_CHUNKS_JOB_KIND = "corpus.embedChunks";
export const CORPUS_REBUILD_FTS_JOB_KIND = "corpus.rebuildFts";
export const CORPUS_REEMBED_SPACE_JOB_KIND = "corpus.reembedSpace";
export const CORPUS_VERIFY_JOB_KIND = "corpus.verify";
export const CORPUS_REPAIR_JOB_KIND = "corpus.repair";
export const CORPUS_EVALUATE_JOB_KIND = "corpus.evaluateRetrieval";
export const CORPUS_PRODUCE_DERIVATIVES_JOB_KIND = "corpus.produceDerivatives";

const identitySchema = z
  .object({
    ownerId: z.string().min(1).max(256),
    originKind: z.enum([
      "material",
      "study-document",
      "recording",
      "grade",
      "subject",
      "conversation",
      "artifact",
    ]),
    originId: z.string().min(1).max(256),
    selector: z
      .strictObject({
        conversationBranchId: z.string().min(1).max(256),
        conversationHeadMessageId: z.string().min(1).max(256),
      })
      .optional(),
    projectItemId: z.string().min(1).max(256).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.selector && input.originKind !== "conversation") {
      context.addIssue({
        code: "custom",
        message: "Only conversation jobs accept branch selectors",
      });
    }
    if (
      input.originKind === "conversation" &&
      Boolean(input.selector) !== Boolean(input.projectItemId)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Pinned conversation jobs require both selector and project item",
      });
    }
  });

const versionPayloadSchema = z
  .object({ ownerId: z.string().min(1), versionId: z.string().min(1) })
  .strict();
const ownerPayloadSchema = z
  .object({ ownerId: z.string().min(1).optional() })
  .strict();

export async function enqueueCorpusSourceIndex(
  identity: z.infer<typeof identitySchema>,
) {
  return enqueueJob({
    kind: CORPUS_INDEX_SOURCE_JOB_KIND,
    payload: identity,
    userId: identity.ownerId,
    idempotencyKey: `${identity.originKind}:${identity.originId}:${identity.selector?.conversationHeadMessageId ?? "head"}:${identity.projectItemId ?? "current"}`,
    newAttemptAfterTerminal: true,
    maxAttempts: 3,
  });
}
const embedVersionPayloadSchema = z
  .object({ ownerId: z.string().min(1), versionId: z.string().min(1) })
  .strict();

export async function runCorpusIndexSourceJob(
  payload: unknown,
  options: { signal?: AbortSignal } = {},
) {
  const parsed = identitySchema.parse(payload);
  const { selector, projectItemId, ...identity } = parsed;
  const version = await coreCorpusIndexService.indexSource(identity, {
    ...options,
    selector,
    projectItemId,
  });
  // Derivative production is a separate durable job. Lexical publication above
  // is already committed, while the embedding generation cannot race ahead of
  // exact one-page/media files required by multimodal spaces.
  const derivativeJob = await enqueueJob({
    kind: CORPUS_PRODUCE_DERIVATIVES_JOB_KIND,
    payload: { ownerId: identity.ownerId, versionId: version.versionId },
    userId: identity.ownerId,
    idempotencyKey: version.versionId,
    maxAttempts: 4,
  });
  return {
    stage: "committed" as const,
    sourceId: version.sourceId,
    versionId: version.versionId,
    contentHash: version.contentHash,
    derivativeJobId: derivativeJob.id,
    embeddingJobId: null,
  };
}

export async function runCorpusRemoveVersionJob(payload: unknown) {
  const input = versionPayloadSchema.parse(payload);
  if (
    !(await coreCorpusIndexService.store.ownsVersion(
      input.ownerId,
      input.versionId,
    ))
  ) {
    throw new NonRetryableJobError("Owned corpus version not found");
  }
  await coreCorpusIndexService.store.markVersionForGc(input.versionId);
  const collected = await coreCorpusIndexService.store.collectGarbage();
  let runtime: CorpusVectorRuntime | null = null;
  try {
    runtime = await createOwnedCorpusVectorRuntime(input.ownerId);
  } catch {
    // A stale/unsafe optional embedding configuration must not block core GC.
  }
  if (runtime && collected.deletedVersionIds.length > 0) {
    await runtime.vector.remove(collected.deletedVersionIds);
  }
  return {
    stage: "garbage-collected" as const,
    ...collected,
  };
}

export async function runCorpusRebuildFtsJob(
  payload: unknown,
  options: { signal?: AbortSignal } = {},
) {
  ownerPayloadSchema.parse(payload ?? {});
  options.signal?.throwIfAborted();
  const backend = new SqliteFts5LexicalSearchBackend();
  const capabilities = await backend.capabilities();
  if (!capabilities.available) {
    throw new NonRetryableJobError("SQLite FTS5 is unavailable");
  }
  options.signal?.throwIfAborted();
  return { stage: "rebuilt" as const, report: await backend.rebuild() };
}

export async function runCorpusVerifyJob(payload: unknown) {
  ownerPayloadSchema.parse(payload ?? {});
  return {
    stage: "verified" as const,
    report: await new SqliteFts5LexicalSearchBackend().verify(),
  };
}

export async function runCorpusRepairJob(
  payload: unknown,
  options: { signal?: AbortSignal } = {},
) {
  const input = ownerPayloadSchema.parse(payload ?? {});
  return {
    stage: "repaired" as const,
    ...(await coreCorpusIndexService.repair({
      ownerId: input.ownerId,
      signal: options.signal,
    })),
  };
}

const evaluationPayloadSchema = z
  .object({
    ownerId: z.string().min(1).max(256),
    fixtureRevision: z.literal(FRENCH_SCHOOL_FIXTURE_REVISION),
    configurations: z
      .array(retrievalEvaluationConfigurationSchema)
      .min(1)
      .max(retrievalEvaluationConfigurationSchema.options.length),
  })
  .strict();

export async function runCorpusEvaluationJob(
  payload: unknown,
  options: { signal?: AbortSignal } = {},
) {
  const input = evaluationPayloadSchema.parse(payload);
  options.signal?.throwIfAborted();
  const evaluationId = newId("reval");
  const placeholderDigest = sha256("pending");
  const now = Math.floor(Date.now() / 1_000);
  await db.$client.execute({
    sql: `INSERT INTO retrieval_evaluations (
        id, userId, fixtureRevision, corpusDigest, configurationDigest,
        status, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, 'running', ?, ?)`,
    args: [
      evaluationId,
      input.ownerId,
      input.fixtureRevision,
      placeholderDigest,
      sha256(canonicalJson(input.configurations)),
      now,
      now,
    ],
  });
  try {
    const report = evaluateFrenchSchoolFixture(input.configurations);
    options.signal?.throwIfAborted();
    await db.$client.execute({
      sql: `UPDATE retrieval_evaluations SET corpusDigest = ?,
          configurationDigest = ?, status = 'succeeded', metricsJson = ?,
          ablationsJson = ?, evaluatedAt = ?, errorCode = NULL, updatedAt = ?
        WHERE id = ? AND userId = ? AND status = 'running'`,
      args: [
        report.corpusDigest,
        report.configurationDigest,
        JSON.stringify(report.metrics),
        JSON.stringify(report.ablations),
        Math.floor(Date.now() / 1_000),
        Math.floor(Date.now() / 1_000),
        evaluationId,
        input.ownerId,
      ],
    });
    return { evaluationId, ...report };
  } catch (error) {
    await db.$client.execute({
      sql: `UPDATE retrieval_evaluations SET status = 'failed',
          errorCode = ?, evaluatedAt = ?, updatedAt = ?
        WHERE id = ? AND userId = ? AND status = 'running'`,
      args: [
        safeGenerationError(error),
        Math.floor(Date.now() / 1_000),
        Math.floor(Date.now() / 1_000),
        evaluationId,
        input.ownerId,
      ],
    });
    throw error;
  }
}

type CorpusEmbeddingRow = {
  ownerId: string;
  sourceId: string;
  versionId: string;
  chunkId: string;
  contentHash: string;
  text: string;
};

type CorpusMediaEmbeddingRow = Omit<CorpusEmbeddingRow, "text"> & {
  input: MediaEmbeddingInput;
};

const scopedReembedPayloadSchema = z.discriminatedUnion("scope", [
  z.strictObject({
    ownerId: z.string().min(1).max(256),
    scope: z.literal("all"),
    publicationEpoch: z.number().int().nonnegative().optional(),
  }),
  z.strictObject({
    ownerId: z.string().min(1).max(256),
    scope: z.literal("advanced-projects"),
    requestedProjectId: z.string().min(1).max(256).optional(),
    triggerVersionId: z.string().min(1).max(256).optional(),
    publicationEpoch: z.number().int().nonnegative().optional(),
  }),
]);

const legacyReembedPayloadSchema = z
  .object({
    ownerId: z.string().min(1).max(256),
    projectId: z.string().min(1).max(256).optional(),
  })
  .strict();

type ScopedReembedPayload = z.infer<typeof scopedReembedPayloadSchema>;

function scopedReembedPayload(payload: unknown): ScopedReembedPayload {
  const legacyVersion = embedVersionPayloadSchema.safeParse(payload);
  if (legacyVersion.success) {
    return {
      ownerId: legacyVersion.data.ownerId,
      scope: "advanced-projects",
      triggerVersionId: legacyVersion.data.versionId,
    };
  }
  const scoped = scopedReembedPayloadSchema.safeParse(payload);
  if (scoped.success) return scoped.data;
  const legacy = legacyReembedPayloadSchema.parse(payload);
  return {
    ownerId: legacy.ownerId,
    scope: "advanced-projects",
    ...(legacy.projectId ? { requestedProjectId: legacy.projectId } : {}),
  };
}

function operationSignal(signal?: AbortSignal) {
  return signal ?? new AbortController().signal;
}

async function recordEmbeddingUsage(input: {
  operationId: string;
  ownerId: string;
  descriptor: EmbeddingSpaceDescriptor;
  versionId: string;
  inputCount: number;
  inputTokens: number | null;
  providerRequestId: string | null;
}) {
  await db.$client.execute({
    sql: `INSERT INTO corpus_embedding_usage (
        id, operationId, userId, spaceId, versionId, inputCount,
        inputTokens, providerRequestId, createdAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      newId("eusage"),
      input.operationId,
      input.ownerId,
      input.descriptor.id,
      input.versionId,
      input.inputCount,
      input.inputTokens,
      input.providerRequestId,
      Math.floor(Date.now() / 1_000),
    ],
  });
}

async function embedTextRows(
  rows: readonly CorpusEmbeddingRow[],
  runtime: CorpusVectorRuntime,
  options: { signal?: AbortSignal; assertFence?: () => Promise<void> } = {},
) {
  if (rows.length === 0) return { vectors: 0, embedded: 0, reused: 0 };
  const descriptor = runtime.embedding.descriptor();
  const ownerId = rows[0]!.ownerId;
  if (rows.some((row) => row.ownerId !== ownerId)) {
    throw new Error("Embedding batches cannot cross owner boundaries");
  }
  const signal = operationSignal(options.signal);
  let reused = 0;
  let embedded = 0;
  for (let offset = 0; offset < rows.length; offset += 100) {
    signal.throwIfAborted();
    await options.assertFence?.();
    const batch = rows.slice(offset, offset + 100);
    const reusable = await runtime.vector.reusable(
      [...new Set(batch.map((row) => row.contentHash))],
      ownerId,
    );
    const missingByHash = new Map<
      string,
      { contentHash: string; text: string; purpose: "document" }
    >();
    for (const row of batch) {
      if (!reusable.has(row.contentHash)) {
        missingByHash.set(row.contentHash, {
          contentHash: row.contentHash,
          text: row.text,
          purpose: "document",
        });
      }
    }
    const missing = [...missingByHash.values()];
    const operationId = newId("embedop");
    if (missing.length > 0) await options.assertFence?.();
    const generated = missing.length
      ? await runtime.embedding.embedText(
          missing,
          runtime.consent
            ? {
                operationId,
                signal,
                consent: runtime.consent,
                authorize: async () => {
                  await options.assertFence?.();
                  await runtime.authorizeEmbedding?.();
                },
              }
            : undefined,
        )
      : [];
    if (generated.length !== missing.length) {
      throw new Error("Embedding provider returned a partial text batch");
    }
    if (generated.length > 0) {
      const usage = generated[0]?.usage;
      await recordEmbeddingUsage({
        operationId,
        ownerId,
        descriptor,
        versionId: batch[0]!.versionId,
        inputCount: missing.length,
        inputTokens: usage?.inputTokens ?? null,
        providerRequestId: usage?.providerRequestId ?? null,
      });
    }
    await options.assertFence?.();
    const valuesByHash = new Map(
      generated.map((entry) => [entry.contentHash, entry.values]),
    );
    const vectors: ContentHashedVector[] = batch.map((row) => {
      const values =
        reusable.get(row.contentHash) ?? valuesByHash.get(row.contentHash);
      if (!values) throw new Error("Embedding provider omitted a corpus chunk");
      if (reusable.has(row.contentHash)) reused += 1;
      else embedded += 1;
      return {
        ownerId: row.ownerId,
        spaceId: descriptor.id,
        sourceId: row.sourceId,
        versionId: row.versionId,
        chunkId: row.chunkId,
        contentHash: row.contentHash,
        values,
      };
    });
    await runtime.vector.upsertContent(vectors);
    await options.assertFence?.();
  }
  return { vectors: rows.length, embedded, reused };
}

async function embedMediaRows(
  rows: readonly CorpusMediaEmbeddingRow[],
  runtime: CorpusVectorRuntime,
  options: { signal?: AbortSignal; assertFence?: () => Promise<void> } = {},
) {
  if (rows.length === 0) return { vectors: 0, embedded: 0, reused: 0 };
  const descriptor = runtime.embedding.descriptor();
  if (!runtime.embedding.embedMedia) {
    if (descriptor.modalities.some((modality) => modality !== "text")) {
      throw new Error("Multimodal space does not implement media embedding");
    }
    return { vectors: 0, embedded: 0, reused: 0 };
  }
  const ownerId = rows[0]!.ownerId;
  const signal = operationSignal(options.signal);
  let reused = 0;
  let embedded = 0;
  for (let offset = 0; offset < rows.length; offset += 16) {
    signal.throwIfAborted();
    await options.assertFence?.();
    const batch = rows.slice(offset, offset + 16);
    const reusable = await runtime.vector.reusable(
      [...new Set(batch.map((row) => row.contentHash))],
      ownerId,
    );
    const missingByHash = new Map<string, MediaEmbeddingInput>();
    for (const row of batch) {
      if (!reusable.has(row.contentHash)) {
        missingByHash.set(row.contentHash, row.input);
      }
    }
    // Identical pages/media segments share provider work but retain distinct
    // visual chunk identities, so no lexical or neighbouring vector is lost.
    const missing = [...missingByHash.values()];
    const operationId = newId("embedop");
    if (missing.length > 0) await options.assertFence?.();
    const generated = missing.length
      ? await runtime.embedding.embedMedia(missing, {
          operationId,
          signal,
          consent:
            runtime.consent ??
            (() => {
              throw new Error(
                "Cloud media embedding requires provider consent",
              );
            })(),
          authorize: async () => {
            await options.assertFence?.();
            await runtime.authorizeEmbedding?.();
          },
        })
      : [];
    if (generated.length !== missing.length) {
      throw new Error("Embedding provider returned a partial media batch");
    }
    if (generated.length > 0) {
      const usage = generated[0]?.usage;
      await recordEmbeddingUsage({
        operationId,
        ownerId,
        descriptor,
        versionId: batch[0]!.versionId,
        inputCount: missing.length,
        inputTokens: usage?.inputTokens ?? null,
        providerRequestId: usage?.providerRequestId ?? null,
      });
    }
    await options.assertFence?.();
    const valuesByHash = new Map(
      generated.map((entry) => [entry.contentHash, entry.values]),
    );
    const vectors: ContentHashedVector[] = batch.map((row) => {
      const values =
        reusable.get(row.contentHash) ?? valuesByHash.get(row.contentHash);
      if (!values) throw new Error("Embedding provider omitted a media unit");
      if (reusable.has(row.contentHash)) reused += 1;
      else embedded += 1;
      return {
        ownerId: row.ownerId,
        spaceId: descriptor.id,
        sourceId: row.sourceId,
        versionId: row.versionId,
        chunkId: row.chunkId,
        contentHash: row.contentHash,
        values,
      };
    });
    await runtime.vector.upsertContent(vectors);
    await options.assertFence?.();
  }
  return { vectors: rows.length, embedded, reused };
}

async function rowsForVersion(ownerId: string, versionId: string) {
  const result = await db.$client.execute({
    sql: `SELECT sources.userId AS ownerId, sources.id AS sourceId,
        versions.id AS versionId, chunks.id AS chunkId,
        chunks.contentHash, chunks.text, chunks.normalizedText,
        chunks.headingPathJson, sources.userId, sources.placement,
        sources.placementRef
      FROM content_versions AS versions
      JOIN content_sources AS sources ON sources.id = versions.sourceId
      JOIN content_chunks AS chunks ON chunks.versionId = versions.id
      WHERE versions.id = ? AND sources.userId = ?
        AND chunks.evidenceKind != 'visual-only'
      ORDER BY chunks.ordinal`,
    args: [versionId, ownerId],
  });
  const hydrated = await new RoutedCorpusContentReader(db.$client).hydrate(
    result.rows as unknown as AuthorizedCorpusChunkRow[],
  );
  return result.rows.flatMap<CorpusEmbeddingRow>((row) => {
    const body = hydrated.get(String(row.chunkId));
    return body
      ? [
          {
            ownerId: String(row.ownerId),
            sourceId: String(row.sourceId),
            versionId: String(row.versionId),
            chunkId: String(row.chunkId),
            contentHash: String(row.contentHash),
            text: body.text,
          },
        ]
      : [];
  });
}

function derivativeModality(
  kind: string,
): MediaEmbeddingInput["modality"] | null {
  if (kind === "pdf-page") return "pdf-page";
  if (["page-image", "slide-image", "sheet-image"].includes(kind))
    return "image";
  if (kind === "audio-segment") return "audio";
  if (kind === "video-segment") return "video";
  return null;
}

async function mediaRowsForVersion(
  ownerId: string,
  versionId: string,
  descriptor: EmbeddingSpaceDescriptor,
) {
  const result = await db.$client.execute({
    sql: `SELECT sources.userId AS ownerId, sources.id AS sourceId,
        derivatives.versionId, derivatives.chunkId, derivatives.fileId,
        derivatives.kind, derivatives.locatorJson, derivatives.contentHash,
        derivatives.mimeType, derivatives.byteSize,
        derivatives.estimatedInputTokens, derivatives.durationMs,
        derivatives.metadataJson
      FROM content_derivatives AS derivatives
      JOIN content_versions AS versions ON versions.id = derivatives.versionId
      JOIN content_sources AS sources ON sources.id = versions.sourceId
      JOIN content_chunks AS chunks ON chunks.id = derivatives.chunkId
        AND chunks.versionId = derivatives.versionId
      JOIN files ON files.id = derivatives.fileId AND files.userId = sources.userId
      WHERE derivatives.versionId = ? AND sources.userId = ?
        AND derivatives.status = 'ready' AND files.status = 'stored'
        AND chunks.evidenceKind = 'visual-only'
      ORDER BY chunks.ordinal,
        CASE derivatives.kind
          WHEN 'pdf-page' THEN 0 WHEN 'page-image' THEN 1 ELSE 2 END,
        derivatives.id`,
    args: [versionId, ownerId],
  });
  const selected = new Map<string, CorpusMediaEmbeddingRow>();
  for (const row of result.rows) {
    const modality = derivativeModality(String(row.kind));
    const chunkId = String(row.chunkId);
    if (
      !modality ||
      !descriptor.modalities.includes(modality) ||
      selected.has(chunkId)
    ) {
      continue;
    }
    const estimatedInputTokens = Number(row.estimatedInputTokens);
    selected.set(chunkId, {
      ownerId: String(row.ownerId),
      sourceId: String(row.sourceId),
      versionId: String(row.versionId),
      chunkId,
      contentHash: String(row.contentHash),
      input: {
        contentHash: String(row.contentHash),
        modality,
        mediaType: String(row.mimeType),
        opaqueFileHandle: `file:${String(row.fileId)}`,
        locator: sourceLocatorV1Schema.parse(
          jsonValue<SourceLocatorV1>(row.locatorJson),
        ),
        byteLength: Number(row.byteSize),
        estimatedInputTokens:
          Number.isSafeInteger(estimatedInputTokens) &&
          estimatedInputTokens >= 0
            ? estimatedInputTokens
            : 0,
        ...(row.durationMs === null
          ? {}
          : { durationMs: Number(row.durationMs) }),
      },
    });
  }
  return [...selected.values()];
}

async function generationVersionIds(
  input: ScopedReembedPayload,
  spaceId: string,
) {
  if (input.scope === "all") {
    const result = await db.$client.execute({
      sql: `SELECT id FROM (
          SELECT versions.id
          FROM content_sources AS sources
          JOIN content_versions AS versions
            ON versions.id = sources.currentVersionId
            AND versions.sourceId = sources.id
          WHERE sources.userId = ? AND sources.placement = 'core'
          UNION
          SELECT versions.id
          FROM study_project_items AS items
          JOIN study_projects AS projects ON projects.id = items.projectId
          JOIN content_versions AS versions ON versions.id = items.sourceVersionId
          JOIN content_sources AS sources
            ON sources.id = versions.sourceId
            AND sources.userId = projects.userId
            AND sources.originKind = items.kind
            AND sources.originId = items.referenceId
          WHERE projects.userId = ? AND projects.deletedAt IS NULL
            AND items.trackingMode = 'pinned'
            AND items.sourceVersionId IS NOT NULL
            AND sources.placement = 'core'
        ) ORDER BY id`,
      args: [input.ownerId, input.ownerId],
    });
    return result.rows.map((row) => String(row.id));
  }

  if (input.requestedProjectId) {
    const requested = await db.$client.execute({
      sql: `SELECT 1 FROM study_projects
        WHERE id = ? AND userId = ? AND deletedAt IS NULL
          AND retrievalMode = 'advanced-auto' AND embeddingSpaceId = ?
        LIMIT 1`,
      args: [input.requestedProjectId, input.ownerId, spaceId],
    });
    if (requested.rows.length !== 1) {
      throw new NonRetryableJobError("CORPUS_REINDEX_PROJECT_POLICY_CHANGED");
    }
  }

  // One owner/space alias can only point at one immutable generation. Rebuild
  // the union of every project that explicitly opted into this exact space so
  // refreshing one project never evicts another advanced project's vectors.
  // Lexical-only projects, excluded items and selectors awaiting review never
  // cross the embedding-provider boundary.
  const result = await db.$client.execute({
    sql: `SELECT DISTINCT versions.id
      FROM study_project_items AS items
      JOIN study_projects AS projects ON projects.id = items.projectId
      JOIN content_sources AS sources
        ON sources.userId = projects.userId
        AND sources.originKind = items.kind
        AND sources.originId = items.referenceId
      JOIN content_versions AS versions
        ON versions.sourceId = sources.id
        AND versions.id = CASE
          WHEN items.trackingMode = 'pinned' THEN items.sourceVersionId
          ELSE sources.currentVersionId
        END
      WHERE projects.userId = ? AND projects.deletedAt IS NULL
        AND projects.retrievalMode = 'advanced-auto'
        AND projects.embeddingSpaceId = ?
        AND items.contextMode != 'exclude'
        AND items.selectorReviewRequired = 0
        AND sources.placement = 'core'
      ORDER BY versions.id`,
    args: [input.ownerId, spaceId],
  });
  return result.rows.map((row) => String(row.id));
}

async function registerEmbeddingSpace(descriptor: EmbeddingSpaceDescriptor) {
  const descriptorJson = canonicalJson(descriptor);
  const digest = sha256(descriptorJson);
  await db.$client.execute({
    sql: `INSERT INTO corpus_embedding_spaces (
        id, descriptorJson, descriptorDigest, createdAt
      ) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
    args: [
      descriptor.id,
      descriptorJson,
      digest,
      Math.floor(Date.now() / 1_000),
    ],
  });
  const existing = await db.$client.execute({
    sql: `SELECT descriptorDigest FROM corpus_embedding_spaces WHERE id = ? LIMIT 1`,
    args: [descriptor.id],
  });
  if (String(existing.rows[0]?.descriptorDigest) !== digest) {
    throw new Error("Embedding space id collides with another descriptor");
  }
}

async function createGeneration(
  ownerId: string,
  descriptor: EmbeddingSpaceDescriptor,
  versionIds: readonly string[],
  publicationEpoch: number,
) {
  const generationId = newId("egen");
  const versionSetDigest = sha256(canonicalJson([...versionIds].sort()));
  const now = Math.floor(Date.now() / 1_000);
  const transaction = await db.$client.transaction("write");
  try {
    await transaction.execute({
      sql: `INSERT INTO corpus_embedding_generations (
          id, userId, spaceId, state, publicationEpoch, versionSetDigest,
          expectedVersionCount, indexedVersionCount, createdAt, updatedAt
        ) VALUES (?, ?, ?, 'staging', ?, ?, ?, 0, ?, ?)`,
      args: [
        generationId,
        ownerId,
        descriptor.id,
        publicationEpoch,
        versionSetDigest,
        versionIds.length,
        now,
        now,
      ],
    });
    for (const versionId of versionIds) {
      await transaction.execute({
        sql: `INSERT INTO corpus_embedding_generation_versions (
            generationId, versionId, vectorCount
          ) VALUES (?, ?, 0)`,
        args: [generationId, versionId],
      });
    }
    await transaction.commit();
    return { generationId, versionSetDigest };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

function safeGenerationError(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError")
    return "cancelled";
  const message = error instanceof Error ? error.message : "unknown";
  return /^[A-Z0-9_:-]{1,128}$/u.test(message)
    ? message.slice(0, 128)
    : "embedding-generation-failed";
}

/**
 * Compatibility entry point for both embedding job kinds. Every invocation now
 * creates a complete owned generation; an individual-version job is promoted
 * to an owner rebuild so partial results can never become searchable.
 */
export async function runCorpusEmbeddingUnavailableJob(
  payload: unknown,
  options: { signal?: AbortSignal; runtime?: CorpusVectorRuntime | null } = {},
) {
  options.signal?.throwIfAborted();
  const rebuild = scopedReembedPayload(payload);
  const assertFence = () =>
    assertEmbeddingPublicationFence(
      rebuild.ownerId,
      rebuild.publicationEpoch,
    ).then(() => undefined);
  await assertFence();
  const runtime =
    options.runtime === undefined
      ? await createOwnedCorpusVectorRuntime(rebuild.ownerId)
      : options.runtime;
  if (!runtime) {
    throw new NonRetryableJobError(
      "No consented, explicitly enabled embedding space is ready; lexical search remains available",
    );
  }
  const descriptor = runtime.embedding.descriptor();
  const versionIds = await generationVersionIds(rebuild, descriptor.id);
  if (
    rebuild.scope === "advanced-projects" &&
    rebuild.triggerVersionId &&
    !versionIds.includes(rebuild.triggerVersionId)
  ) {
    return {
      stage: "skipped" as const,
      reason: "trigger-version-not-in-advanced-project-scope" as const,
      versions: versionIds.length,
      vectors: 0,
      chunks: 0,
      spaceId: descriptor.id,
    };
  }
  if (
    rebuild.scope === "advanced-projects" &&
    !rebuild.requestedProjectId &&
    versionIds.length === 0
  ) {
    return {
      stage: "skipped" as const,
      reason: "advanced-project-scope-empty" as const,
      versions: 0,
      vectors: 0,
      chunks: 0,
      spaceId: descriptor.id,
    };
  }
  await assertFence();
  await registerEmbeddingSpace(descriptor);
  const { generationId, versionSetDigest } = await createGeneration(
    rebuild.ownerId,
    descriptor,
    versionIds,
    rebuild.publicationEpoch ?? 0,
  );
  const generationRuntime: CorpusVectorRuntime = {
    ...runtime,
    vector: runtime.vector.forGeneration(rebuild.ownerId, generationId),
  };
  let vectorCount = 0;
  try {
    for (const versionId of versionIds) {
      options.signal?.throwIfAborted();
      const [textRows, mediaRows] = await Promise.all([
        rowsForVersion(rebuild.ownerId, versionId),
        mediaRowsForVersion(rebuild.ownerId, versionId, descriptor),
      ]);
      const [textReport, mediaReport] = await Promise.all([
        embedTextRows(textRows, generationRuntime, {
          ...options,
          assertFence,
        }),
        embedMediaRows(mediaRows, generationRuntime, {
          ...options,
          assertFence,
        }),
      ]);
      const versionVectorCount = textReport.vectors + mediaReport.vectors;
      vectorCount += versionVectorCount;
      const updated = await db.$client.execute({
        sql: `UPDATE corpus_embedding_generation_versions
          SET vectorCount = ?, indexedAt = ?
          WHERE generationId = ? AND versionId = ? AND indexedAt IS NULL`,
        args: [
          versionVectorCount,
          Math.floor(Date.now() / 1_000),
          generationId,
          versionId,
        ],
      });
      if (Number(updated.rowsAffected) !== 1) {
        throw new Error("EMBEDDING_GENERATION_VERSION_PUBLICATION_CONFLICT");
      }
      await db.$client.execute({
        sql: `UPDATE corpus_embedding_generations
          SET indexedVersionCount = indexedVersionCount + 1, updatedAt = ?
          WHERE id = ? AND state = 'staging'
            AND indexedVersionCount < expectedVersionCount`,
        args: [Math.floor(Date.now() / 1_000), generationId],
      });
    }
    const complete = await db.$client.execute({
      sql: `SELECT expectedVersionCount, indexedVersionCount
        FROM corpus_embedding_generations
        WHERE id = ? AND userId = ? AND state = 'staging' LIMIT 1`,
      args: [generationId, rebuild.ownerId],
    });
    if (
      !complete.rows[0] ||
      Number(complete.rows[0].expectedVersionCount) !==
        Number(complete.rows[0].indexedVersionCount)
    ) {
      throw new Error("EMBEDDING_GENERATION_INCOMPLETE");
    }
    options.signal?.throwIfAborted();
    const now = Math.floor(Date.now() / 1_000);
    const transaction = await db.$client.transaction("write");
    try {
      await assertEmbeddingPublicationFence(
        rebuild.ownerId,
        rebuild.publicationEpoch,
        transaction,
      );
      await transaction.execute({
        sql: `UPDATE corpus_embedding_generations
          SET state = 'superseded', updatedAt = ?
          WHERE userId = ? AND spaceId = ? AND state = 'active' AND id != ?`,
        args: [now, rebuild.ownerId, descriptor.id, generationId],
      });
      const activated = await transaction.execute({
        sql: `UPDATE corpus_embedding_generations
          SET state = 'active', activatedAt = ?, updatedAt = ?
          WHERE id = ? AND userId = ? AND state = 'staging'
            AND indexedVersionCount = expectedVersionCount`,
        args: [now, now, generationId, rebuild.ownerId],
      });
      if (Number(activated.rowsAffected) !== 1) {
        throw new Error("EMBEDDING_GENERATION_ACTIVATION_CONFLICT");
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    // The durable generation row is the sole search pointer. The Qdrant alias
    // remains a compatibility optimization only: concurrent jobs may activate
    // aliases out of order, so search must always address the DB-selected
    // immutable generation collection directly.
    let compatibilityAliasActivated = false;
    try {
      await generationRuntime.vector.activate();
      compatibilityAliasActivated = true;
    } catch {
      // A failed alias switch cannot invalidate the already-published immutable
      // generation. Generation-fenced search remains available.
    }
    return {
      stage: "activated" as const,
      generationId,
      versionSetDigest,
      versions: versionIds.length,
      vectors: vectorCount,
      chunks: vectorCount,
      spaceId: descriptor.id,
      compatibilityAliasActivated,
    };
  } catch (error) {
    try {
      await generationRuntime.vector.remove(versionIds);
    } catch {
      // The immutable generation stays non-active below. Provider-side cleanup
      // is best effort and can be retried operationally without authorizing it.
    }
    await db.$client.execute({
      sql: `UPDATE corpus_embedding_generations
        SET state = 'failed', errorCode = ?, updatedAt = ?
        WHERE id = ? AND userId = ? AND state = 'staging'`,
      args: [
        safeGenerationError(error),
        Math.floor(Date.now() / 1_000),
        generationId,
        rebuild.ownerId,
      ],
    });
    throw error;
  }
}
