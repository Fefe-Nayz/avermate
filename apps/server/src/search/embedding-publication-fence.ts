import type { Client, Transaction } from "@libsql/client";
import { db } from "../db";
import { NonRetryableJobError } from "../lib/jobs";

type Executor = Client | Transaction;

export type EmbeddingPublicationFence = {
  enabled: boolean;
  publicationEpoch: number;
};

function fenceRow(row: Record<string, unknown> | undefined) {
  return row
    ? {
        enabled: Number(row.enabled) === 1,
        publicationEpoch: Number(row.publicationEpoch),
      }
    : { enabled: true, publicationEpoch: 0 };
}

export async function readEmbeddingPublicationFence(
  ownerId: string,
  executor: Executor = db.$client,
): Promise<EmbeddingPublicationFence> {
  const result = await executor.execute({
    sql: `SELECT enabled, publicationEpoch
      FROM corpus_embedding_owner_states WHERE userId = ? LIMIT 1`,
    args: [ownerId],
  });
  return fenceRow(result.rows[0]);
}

/** Rotate the monotonic fence whenever an explicit policy decision is made. */
export async function rotateEmbeddingPublicationFence(
  ownerId: string,
  enabled: boolean,
  executor: Executor = db.$client,
): Promise<EmbeddingPublicationFence> {
  const result = await executor.execute({
    sql: `INSERT INTO corpus_embedding_owner_states
        (userId, publicationEpoch, enabled, updatedAt)
      VALUES (?, 1, ?, ?)
      ON CONFLICT(userId) DO UPDATE SET
        publicationEpoch = corpus_embedding_owner_states.publicationEpoch + 1,
        enabled = excluded.enabled,
        updatedAt = excluded.updatedAt
      RETURNING enabled, publicationEpoch`,
    args: [ownerId, enabled ? 1 : 0, Math.floor(Date.now() / 1_000)],
  });
  const row = result.rows[0];
  if (!row) throw new Error("EMBEDDING_PUBLICATION_FENCE_UPDATE_FAILED");
  return fenceRow(row);
}

/**
 * Make the owner-wide publication state match a policy without invalidating
 * already-authorized work when the global state did not actually change.
 *
 * A missing row is the backwards-compatible enabled/epoch-0 state. Persisting
 * that state is harmless, while the first disable starts at epoch 1 so legacy
 * jobs without a fence can no longer publish.
 */
export async function ensureEmbeddingPublicationFence(
  ownerId: string,
  enabled: boolean,
  executor: Executor = db.$client,
): Promise<EmbeddingPublicationFence> {
  const result = await executor.execute({
    sql: `INSERT INTO corpus_embedding_owner_states
        (userId, publicationEpoch, enabled, updatedAt)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(userId) DO UPDATE SET
        publicationEpoch = CASE
          WHEN corpus_embedding_owner_states.enabled = excluded.enabled
            THEN corpus_embedding_owner_states.publicationEpoch
          ELSE corpus_embedding_owner_states.publicationEpoch + 1
        END,
        enabled = excluded.enabled,
        updatedAt = CASE
          WHEN corpus_embedding_owner_states.enabled = excluded.enabled
            THEN corpus_embedding_owner_states.updatedAt
          ELSE excluded.updatedAt
        END
      RETURNING enabled, publicationEpoch`,
    args: [
      ownerId,
      enabled ? 0 : 1,
      enabled ? 1 : 0,
      Math.floor(Date.now() / 1_000),
    ],
  });
  const row = result.rows[0];
  if (!row) throw new Error("EMBEDDING_PUBLICATION_FENCE_UPDATE_FAILED");
  return fenceRow(row);
}

/** Cancel work that can dispatch embedding-provider batches for one owner. */
export async function cancelOwnedEmbeddingJobs(
  ownerId: string,
  executor: Executor = db.$client,
) {
  const now = Math.floor(Date.now() / 1_000);
  const queued = await executor.execute({
    sql: `UPDATE jobs SET status = 'cancelled', lockedBy = NULL,
        lockedUntil = NULL, updatedAt = ?
      WHERE userId = ? AND status = 'queued'
        AND kind IN ('corpus.reembedSpace', 'corpus.embedChunks')`,
    args: [now, ownerId],
  });
  const running = await executor.execute({
    sql: `SELECT id FROM jobs WHERE userId = ? AND status = 'running'
      AND kind IN ('corpus.reembedSpace', 'corpus.embedChunks')`,
    args: [ownerId],
  });
  for (const row of running.rows) {
    await executor.execute({
      sql: `INSERT INTO job_runtime_metadata
          (jobId, stage, cancellation, createdAt, updatedAt)
        VALUES (?, 'running', 'requested', ?, ?)
        ON CONFLICT(jobId) DO UPDATE SET
          cancellation = 'requested', updatedAt = excluded.updatedAt`,
      args: [String(row.id), now, now],
    });
  }
  return {
    queuedJobsCancelled: Number(queued.rowsAffected),
    runningJobsCancellationRequested: running.rows.length,
  };
}

/**
 * Legacy jobs are accepted only while no owner fence has ever been written.
 * Once a user disables or re-enables vector publication, every job must carry
 * the exact current epoch.
 */
export async function assertEmbeddingPublicationFence(
  ownerId: string,
  expectedEpoch: number | undefined,
  executor: Executor = db.$client,
) {
  const current = await readEmbeddingPublicationFence(ownerId, executor);
  if (
    !current.enabled ||
    (expectedEpoch === undefined
      ? current.publicationEpoch !== 0
      : current.publicationEpoch !== expectedEpoch)
  ) {
    throw new NonRetryableJobError(
      "CORPUS_EMBEDDING_PUBLICATION_FENCE_CHANGED",
    );
  }
  return current;
}
