import type { Client, Transaction } from "@libsql/client";
import { newId } from "../lib/id";
import { canonicalJson, sha256 } from "./values";

const REEMBED_JOB_KIND = "corpus.reembedSpace";

type Executor = Client | Transaction;

export class EmbeddingGenerationProjectPolicyChangedError extends Error {
  constructor() {
    super("CORPUS_REINDEX_PROJECT_POLICY_CHANGED");
    this.name = "EmbeddingGenerationProjectPolicyChangedError";
  }
}

export class EmbeddingGenerationPublicationFenceChangedError extends Error {
  constructor() {
    super("CORPUS_EMBEDDING_PUBLICATION_FENCE_CHANGED");
    this.name = "EmbeddingGenerationPublicationFenceChangedError";
  }
}

export type EmbeddingGenerationScope =
  | {
      ownerId: string;
      scope: "all";
      publicationEpoch?: number;
    }
  | {
      ownerId: string;
      scope: "advanced-projects";
      requestedProjectId?: string;
      triggerVersionId?: string;
      publicationEpoch?: number;
    };

export function embeddingVersionSetDigest(versionIds: readonly string[]) {
  return sha256(canonicalJson([...versionIds].sort()));
}

/**
 * Resolve the corpus that is authorized right now for one owner and space.
 *
 * Callers that publish a generation must execute this query inside the same
 * write transaction as the active-pointer swap. Otherwise a slower rebuild can
 * publish a version set captured before a newer project/source change.
 */
export async function desiredEmbeddingGenerationVersionIds(
  executor: Executor,
  input: EmbeddingGenerationScope,
  spaceId: string,
) {
  if (input.scope === "all") {
    const result = await executor.execute({
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
    const requested = await executor.execute({
      sql: `SELECT 1 FROM study_projects
        WHERE id = ? AND userId = ? AND deletedAt IS NULL
          AND retrievalMode = 'advanced-auto' AND embeddingSpaceId = ?
        LIMIT 1`,
      args: [input.requestedProjectId, input.ownerId, spaceId],
    });
    if (requested.rows.length !== 1) {
      throw new EmbeddingGenerationProjectPolicyChangedError();
    }
  }

  // One owner/space pointer represents the union of every project that opted
  // into this exact space. A project-triggered rebuild must never evict another
  // advanced project's vectors.
  const result = await executor.execute({
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

async function ensureDigestRebuild(input: {
  transaction: Transaction;
  scope: EmbeddingGenerationScope;
  spaceId: string;
  publicationEpoch: number;
  versionSetDigest: string;
  now: number;
}) {
  const idempotencyKey =
    `corpus-current-digest:${input.spaceId}:epoch:` +
    `${input.publicationEpoch}:${input.versionSetDigest}`;
  const lookup = async () =>
    input.transaction.execute({
      sql: `SELECT id, status FROM jobs
        WHERE userId = ? AND kind = ? AND idempotencyKey = ? LIMIT 1`,
      args: [input.scope.ownerId, REEMBED_JOB_KIND, idempotencyKey],
    });

  const existing = await lookup();
  const existingRow = existing.rows[0];
  if (
    existingRow &&
    !["succeeded", "failed", "cancelled"].includes(String(existingRow.status))
  ) {
    return String(existingRow.id);
  }
  if (existingRow) {
    await input.transaction.execute({
      sql: `UPDATE jobs SET idempotencyKey = ?, updatedAt = ?
        WHERE id = ? AND userId = ? AND kind = ? AND idempotencyKey = ?
          AND status IN ('succeeded', 'failed', 'cancelled')`,
      args: [
        `${idempotencyKey}:terminal:${String(existingRow.id)}`,
        input.now,
        String(existingRow.id),
        input.scope.ownerId,
        REEMBED_JOB_KIND,
        idempotencyKey,
      ],
    });
  }

  const proposedJobId = newId("job");
  await input.transaction.execute({
    sql: `INSERT INTO jobs
        (id, kind, payload, payloadVersion, status, attempts, maxAttempts,
         runAt, idempotencyKey, userId, createdAt, updatedAt)
      VALUES (?, ?, ?, 1, 'queued', 0, 3, ?, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING`,
    args: [
      proposedJobId,
      REEMBED_JOB_KIND,
      JSON.stringify({
        ownerId: input.scope.ownerId,
        scope: input.scope.scope,
        publicationEpoch: input.publicationEpoch,
      }),
      input.now,
      idempotencyKey,
      input.scope.ownerId,
      input.now,
      input.now,
    ],
  });
  const queued = await lookup();
  const queuedRow = queued.rows[0];
  if (!queuedRow) throw new Error("CURRENT_CORPUS_REBUILD_ENQUEUE_FAILED");
  return String(queuedRow.id);
}

export type EmbeddingGenerationPublicationResult =
  | {
      status: "activated";
      desiredVersionSetDigest: string;
      desiredVersionCount: number;
    }
  | {
      status: "superseded";
      reason: "version-set-changed";
      desiredVersionSetDigest: string;
      desiredVersionCount: number;
      activeGenerationId: string | null;
      rebuildJobId: string | null;
    };

/**
 * Atomically validate and publish a fully indexed immutable generation.
 *
 * The generation's captured digest is compared with a fresh owner/space view
 * in this same write transaction. A stale producer is retained as immutable
 * history but never receives `activatedAt` and never moves the active pointer.
 */
export async function publishCompletedEmbeddingGeneration(input: {
  transaction: Transaction;
  scope: EmbeddingGenerationScope;
  generationId: string;
  spaceId: string;
  publicationEpoch: number;
  now: number;
}): Promise<EmbeddingGenerationPublicationResult> {
  const fence = await input.transaction.execute({
    sql: `SELECT enabled, publicationEpoch
      FROM corpus_embedding_owner_states WHERE userId = ? LIMIT 1`,
    args: [input.scope.ownerId],
  });
  const fenceRow = fence.rows[0];
  const enabled = fenceRow ? Number(fenceRow.enabled) === 1 : true;
  const currentEpoch = fenceRow ? Number(fenceRow.publicationEpoch) : 0;
  if (
    !enabled ||
    (input.scope.publicationEpoch === undefined
      ? currentEpoch !== 0
      : currentEpoch !== input.scope.publicationEpoch)
  ) {
    throw new EmbeddingGenerationPublicationFenceChangedError();
  }
  const generation = await input.transaction.execute({
    sql: `SELECT versionSetDigest FROM corpus_embedding_generations
      WHERE id = ? AND userId = ? AND spaceId = ? AND state = 'staging'
        AND publicationEpoch = ?
        AND indexedVersionCount = expectedVersionCount
      LIMIT 1`,
    args: [
      input.generationId,
      input.scope.ownerId,
      input.spaceId,
      input.publicationEpoch,
    ],
  });
  const generationRow = generation.rows[0];
  if (!generationRow) {
    throw new Error("EMBEDDING_GENERATION_ACTIVATION_CONFLICT");
  }

  const desiredVersionIds = await desiredEmbeddingGenerationVersionIds(
    input.transaction,
    input.scope,
    input.spaceId,
  );
  const desiredVersionSetDigest = embeddingVersionSetDigest(desiredVersionIds);
  if (String(generationRow.versionSetDigest) !== desiredVersionSetDigest) {
    const superseded = await input.transaction.execute({
      sql: `UPDATE corpus_embedding_generations
        SET state = 'superseded', updatedAt = ?
        WHERE id = ? AND userId = ? AND spaceId = ? AND state = 'staging'
          AND publicationEpoch = ?
          AND indexedVersionCount = expectedVersionCount`,
      args: [
        input.now,
        input.generationId,
        input.scope.ownerId,
        input.spaceId,
        input.publicationEpoch,
      ],
    });
    if (Number(superseded.rowsAffected) !== 1) {
      throw new Error("EMBEDDING_GENERATION_ACTIVATION_CONFLICT");
    }

    const current = await input.transaction.execute({
      sql: `SELECT id FROM corpus_embedding_generations
        WHERE userId = ? AND spaceId = ? AND state = 'active'
          AND publicationEpoch = ? AND versionSetDigest = ?
          AND indexedVersionCount = expectedVersionCount
          AND activatedAt IS NOT NULL
        LIMIT 1`,
      args: [
        input.scope.ownerId,
        input.spaceId,
        input.publicationEpoch,
        desiredVersionSetDigest,
      ],
    });
    const activeGenerationId = current.rows[0]
      ? String(current.rows[0].id)
      : null;
    const rebuildJobId = activeGenerationId
      ? null
      : await ensureDigestRebuild({
          transaction: input.transaction,
          scope: input.scope,
          spaceId: input.spaceId,
          publicationEpoch: input.publicationEpoch,
          versionSetDigest: desiredVersionSetDigest,
          now: input.now,
        });
    return {
      status: "superseded",
      reason: "version-set-changed",
      desiredVersionSetDigest,
      desiredVersionCount: desiredVersionIds.length,
      activeGenerationId,
      rebuildJobId,
    };
  }

  await input.transaction.execute({
    sql: `UPDATE corpus_embedding_generations
      SET state = 'superseded', updatedAt = ?
      WHERE userId = ? AND spaceId = ? AND state = 'active' AND id != ?`,
    args: [input.now, input.scope.ownerId, input.spaceId, input.generationId],
  });
  const activated = await input.transaction.execute({
    sql: `UPDATE corpus_embedding_generations
      SET state = 'active', activatedAt = ?, updatedAt = ?
      WHERE id = ? AND userId = ? AND spaceId = ? AND state = 'staging'
        AND publicationEpoch = ?
        AND indexedVersionCount = expectedVersionCount`,
    args: [
      input.now,
      input.now,
      input.generationId,
      input.scope.ownerId,
      input.spaceId,
      input.publicationEpoch,
    ],
  });
  if (Number(activated.rowsAffected) !== 1) {
    throw new Error("EMBEDDING_GENERATION_ACTIVATION_CONFLICT");
  }
  return {
    status: "activated",
    desiredVersionSetDigest,
    desiredVersionCount: desiredVersionIds.length,
  };
}
