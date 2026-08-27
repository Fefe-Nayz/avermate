import type { Transaction } from "@libsql/client";
import { newId } from "../lib/id";
import {
  cancelOwnedEmbeddingJobs,
  rotateEmbeddingPublicationFence,
} from "./embedding-publication-fence";

const REEMBED_JOB_KIND = "corpus.reembedSpace";

/**
 * Linearize a project-policy change which alters the owner's advanced corpus.
 *
 * The epoch is rotated even when another advanced project remains enabled.
 * That makes every already-captured provider batch and immutable generation
 * stale before the policy transaction commits. A replacement rebuild for the
 * exact post-change project union is inserted in the same transaction, so a
 * crash cannot leave the remaining projects silently stranded on an old
 * generation.
 */
export async function rotateAdvancedCorpusAfterPolicyChange(input: {
  ownerId: string;
  transaction: Transaction;
}) {
  const remaining = await input.transaction.execute({
    sql: `SELECT 1 FROM study_projects
      WHERE userId = ? AND deletedAt IS NULL
        AND retrievalMode = 'advanced-auto' LIMIT 1`,
    args: [input.ownerId],
  });
  const enabled = remaining.rows.length > 0;
  const fence = await rotateEmbeddingPublicationFence(
    input.ownerId,
    enabled,
    input.transaction,
  );
  const cancellation = await cancelOwnedEmbeddingJobs(
    input.ownerId,
    input.transaction,
  );

  let rebuildJobId: string | null = null;
  if (enabled) {
    const idempotencyKey = `retrieval-auto-reindex:epoch:${fence.publicationEpoch}`;
    const proposedJobId = newId("job");
    const now = Math.floor(Date.now() / 1_000);
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
          ownerId: input.ownerId,
          scope: "advanced-projects",
          publicationEpoch: fence.publicationEpoch,
        }),
        now,
        idempotencyKey,
        input.ownerId,
        now,
        now,
      ],
    });
    const queued = await input.transaction.execute({
      sql: `SELECT id FROM jobs
        WHERE userId = ? AND kind = ? AND idempotencyKey = ? LIMIT 1`,
      args: [input.ownerId, REEMBED_JOB_KIND, idempotencyKey],
    });
    const row = queued.rows[0];
    if (!row) throw new Error("ADVANCED_CORPUS_REBUILD_ENQUEUE_FAILED");
    rebuildJobId = String(row.id);
  }

  return {
    fence,
    rebuildJobId,
    ...cancellation,
  };
}
