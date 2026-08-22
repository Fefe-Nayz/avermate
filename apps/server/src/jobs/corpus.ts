import { z } from "zod";
import { db } from "../db";
import { enqueueJob, NonRetryableJobError } from "../lib/jobs";
import { coreCorpusIndexService } from "../search/index-service";
import { SqliteFts5LexicalSearchBackend } from "../search/lexical";
import {
  createConfiguredCorpusVectorRuntime,
  type ContentHashedVector,
  type CorpusVectorRuntime,
} from "../search/vector-runtime";

export const CORPUS_INDEX_SOURCE_JOB_KIND = "corpus.indexSource";
export const CORPUS_REMOVE_VERSION_JOB_KIND = "corpus.removeVersion";
export const CORPUS_EMBED_CHUNKS_JOB_KIND = "corpus.embedChunks";
export const CORPUS_REBUILD_FTS_JOB_KIND = "corpus.rebuildFts";
export const CORPUS_REEMBED_SPACE_JOB_KIND = "corpus.reembedSpace";
export const CORPUS_VERIFY_JOB_KIND = "corpus.verify";
export const CORPUS_REPAIR_JOB_KIND = "corpus.repair";

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
  })
  .strict();

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
    idempotencyKey: `${identity.originKind}:${identity.originId}`,
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
  const identity = identitySchema.parse(payload);
  const version = await coreCorpusIndexService.indexSource(identity, options);
  let embeddingJobId: string | null = null;
  try {
    const runtime = createConfiguredCorpusVectorRuntime();
    if (runtime) {
      const embeddingJob = await enqueueJob({
        kind: CORPUS_EMBED_CHUNKS_JOB_KIND,
        payload: { ownerId: identity.ownerId, versionId: version.versionId },
        userId: identity.ownerId,
        idempotencyKey: `${runtime.embedding.descriptor().id}:${version.versionId}`,
        newAttemptAfterTerminal: true,
        maxAttempts: 4,
      });
      embeddingJobId = embeddingJob.id;
    }
  } catch {
    // Optional semantic search must never make the committed lexical index
    // unavailable. The privacy/status endpoint exposes incomplete config.
  }
  return {
    stage: "committed" as const,
    sourceId: version.sourceId,
    versionId: version.versionId,
    contentHash: version.contentHash,
    embeddingJobId,
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
    runtime = createConfiguredCorpusVectorRuntime();
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

type CorpusEmbeddingRow = {
  ownerId: string;
  sourceId: string;
  versionId: string;
  chunkId: string;
  contentHash: string;
  text: string;
};

async function embedRows(
  rows: readonly CorpusEmbeddingRow[],
  runtime: CorpusVectorRuntime,
  options: { signal?: AbortSignal } = {},
) {
  const descriptor = runtime.embedding.descriptor();
  let reused = 0;
  let embedded = 0;
  for (let offset = 0; offset < rows.length; offset += 128) {
    options.signal?.throwIfAborted();
    const batch = rows.slice(offset, offset + 128);
    const ownerGroups = new Map<string, CorpusEmbeddingRow[]>();
    for (const row of batch) {
      const group = ownerGroups.get(row.ownerId) ?? [];
      group.push(row);
      ownerGroups.set(row.ownerId, group);
    }
    const reusable = new Map<string, readonly number[]>();
    for (const [ownerId, ownerRows] of ownerGroups) {
      const found = await runtime.vector.reusable(
        [...new Set(ownerRows.map((row) => row.contentHash))],
        ownerId,
      );
      for (const [hash, values] of found)
        reusable.set(`${ownerId}:${hash}`, values);
    }
    const missingByHash = new Map<
      string,
      { contentHash: string; text: string }
    >();
    for (const row of batch) {
      if (!reusable.has(`${row.ownerId}:${row.contentHash}`)) {
        // Providers receive unchanged content once per batch, even if it occurs
        // in multiple chunks. Cross-owner reuse is intentionally forbidden.
        missingByHash.set(`${row.ownerId}:${row.contentHash}`, {
          contentHash: `${row.ownerId}:${row.contentHash}`,
          text: row.text,
        });
      }
    }
    const missing = [...missingByHash.values()];
    const generated = missing.length
      ? await runtime.embedding.embedText(missing)
      : [];
    const valuesByOwnerHash = new Map(
      generated.map((entry) => [entry.contentHash, entry.values]),
    );
    const vectors: ContentHashedVector[] = batch.map((row) => {
      const key = `${row.ownerId}:${row.contentHash}`;
      const values = reusable.get(key) ?? valuesByOwnerHash.get(key);
      if (!values) throw new Error("Embedding provider omitted a corpus chunk");
      if (reusable.has(key)) reused += 1;
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
  }
  return { chunks: rows.length, embedded, reused, spaceId: descriptor.id };
}

async function rowsForVersion(ownerId: string, versionId: string) {
  const result = await db.$client.execute({
    sql: `
      SELECT sources.userId AS ownerId, sources.id AS sourceId,
        versions.id AS versionId, chunks.id AS chunkId,
        chunks.contentHash, chunks.text
      FROM content_versions AS versions
      JOIN content_sources AS sources ON sources.id = versions.sourceId
      JOIN content_chunks AS chunks ON chunks.versionId = versions.id
      WHERE versions.id = ? AND sources.userId = ?
        AND chunks.evidenceKind != 'visual-only'
      ORDER BY chunks.ordinal
    `,
    args: [versionId, ownerId],
  });
  return result.rows.map((row) => ({
    ownerId: String(row.ownerId),
    sourceId: String(row.sourceId),
    versionId: String(row.versionId),
    chunkId: String(row.chunkId),
    contentHash: String(row.contentHash),
    text: String(row.text),
  }));
}

async function rowsForCurrentCorpus(ownerId?: string) {
  const result = await db.$client.execute({
    sql: `
      SELECT sources.userId AS ownerId, sources.id AS sourceId,
        versions.id AS versionId, chunks.id AS chunkId,
        chunks.contentHash, chunks.text
      FROM content_sources AS sources
      JOIN content_versions AS versions ON versions.id = sources.currentVersionId
      JOIN content_chunks AS chunks ON chunks.versionId = versions.id
      WHERE sources.placement = 'core'
        AND chunks.evidenceKind != 'visual-only'
        ${ownerId ? "AND sources.userId = ?" : ""}
      ORDER BY sources.userId, versions.id, chunks.ordinal
    `,
    args: ownerId ? [ownerId] : [],
  });
  return result.rows.map((row) => ({
    ownerId: String(row.ownerId),
    sourceId: String(row.sourceId),
    versionId: String(row.versionId),
    chunkId: String(row.chunkId),
    contentHash: String(row.contentHash),
    text: String(row.text),
  }));
}

/**
 * Compatibility entry point used by both registered embedding job kinds.
 * A version payload embeds one immutable version. An owner/empty payload
 * rebuilds the configured space; only a full-instance rebuild may atomically
 * activate a new global alias so another owner's active vectors never vanish.
 */
export async function runCorpusEmbeddingUnavailableJob(
  payload: unknown,
  options: { signal?: AbortSignal; runtime?: CorpusVectorRuntime | null } = {},
) {
  options.signal?.throwIfAborted();
  const runtime =
    options.runtime === undefined
      ? createConfiguredCorpusVectorRuntime()
      : options.runtime;
  if (!runtime) {
    throw new NonRetryableJobError(
      "No explicitly enabled embedding space is configured; lexical search remains available",
    );
  }
  const version = embedVersionPayloadSchema.safeParse(payload);
  if (version.success) {
    const rows = await rowsForVersion(
      version.data.ownerId,
      version.data.versionId,
    );
    if (rows.length === 0) {
      throw new NonRetryableJobError("Owned textual corpus version not found");
    }
    options.signal?.throwIfAborted();
    return {
      stage: "embedded" as const,
      ...(await embedRows(rows, runtime, options)),
    };
  }
  const rebuild = ownerPayloadSchema.parse(payload ?? {});
  const rows = await rowsForCurrentCorpus(rebuild.ownerId);
  options.signal?.throwIfAborted();
  const report = await embedRows(rows, runtime, options);
  if (!rebuild.ownerId) {
    options.signal?.throwIfAborted();
    await runtime.vector.activate();
  }
  return {
    stage: rebuild.ownerId ? ("staged" as const) : ("activated" as const),
    ...report,
  };
}
