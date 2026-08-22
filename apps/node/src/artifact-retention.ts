import type {
  ObjectStorageEntry,
  ObjectStorageProvider,
  OwnedObjectRef,
} from "@avermate/agent-contracts";
import { createHash } from "node:crypto";
import type { NodeJobLedger, NodeJobRecord } from "./job-ledger";

export const ARTIFACT_TERMINAL_RETENTION_MS = 24 * 60 * 60 * 1_000;
export const ARTIFACT_REAPER_INTERVAL_MS = 15 * 60 * 1_000;
const REAP_NAMESPACES = ["sandbox-inputs", "artifact-worker-results"] as const;

type LedgerReader = Pick<NodeJobLedger, "list">;

function refKey(ref: OwnedObjectRef) {
  return `${ref.ownerId}\0${ref.namespace}\0${ref.key}`;
}

function resultPrefix(jobId: string) {
  return createHash("sha256").update(jobId).digest("hex");
}

function jobRefs(record: NodeJobRecord) {
  return [
    ...record.job.inputRefs.map((artifact) => artifact.object),
    ...(record.job.resourceRefs ?? []),
    ...record.events.flatMap((event) =>
      (event.resultManifest ?? []).map((artifact) => artifact.object),
    ),
  ].filter((ref) =>
    REAP_NAMESPACES.includes(ref.namespace as (typeof REAP_NAMESPACES)[number]),
  );
}

function eligible(record: NodeJobRecord, cutoff: number) {
  if (!["completed", "failed", "cancelled"].includes(record.stage))
    return false;
  if (Date.parse(record.updatedAt) > cutoff) return false;
  return record.stage !== "completed" || record.commitAcknowledgedAt !== null;
}

function recordReferencesEntry(
  record: NodeJobRecord,
  entry: ObjectStorageEntry,
) {
  if (record.job.principalRef.userId !== entry.ref.ownerId) return false;
  if (jobRefs(record).some((ref) => refKey(ref) === refKey(entry.ref))) {
    return true;
  }
  return (
    entry.ref.namespace === "artifact-worker-results" &&
    entry.ref.key.startsWith(`${resultPrefix(record.job.id)}/`)
  );
}

/**
 * Durable terminal retention is derived exclusively from the persisted job
 * ledger. Young/retryable and unacknowledged jobs protect all shared objects;
 * failed deletes remain discoverable and are retried on the next pass.
 */
export class NodeArtifactRetentionReaper {
  readonly #ledger: LedgerReader;
  readonly #storage: ObjectStorageProvider;
  readonly #retentionMs: number;

  constructor(input: {
    ledger: LedgerReader;
    storage: ObjectStorageProvider;
    retentionMs?: number;
  }) {
    this.#ledger = input.ledger;
    this.#storage = input.storage;
    this.#retentionMs = input.retentionMs ?? ARTIFACT_TERMINAL_RETENTION_MS;
    if (
      !Number.isSafeInteger(this.#retentionMs) ||
      this.#retentionMs < 60_000 ||
      this.#retentionMs > 30 * 24 * 60 * 60 * 1_000
    ) {
      throw new Error("ARTIFACT_RETENTION_TTL_INVALID");
    }
  }

  async reap(now = Date.now()) {
    const records = await this.#ledger.list();
    const cutoff = now - this.#retentionMs;
    const protectedRefs = new Set<string>();
    const eligibleRefs = new Set<string>();
    const protectedOutputPrefixes = new Set<string>();
    const eligibleOutputPrefixes = new Set<string>();
    const owners = new Set<string>();
    for (const record of records) {
      const isEligible = eligible(record, cutoff);
      owners.add(record.job.principalRef.userId);
      const targetRefs = isEligible ? eligibleRefs : protectedRefs;
      for (const ref of jobRefs(record)) targetRefs.add(refKey(ref));
      const prefix = resultPrefix(record.job.id);
      (isEligible ? eligibleOutputPrefixes : protectedOutputPrefixes).add(
        prefix,
      );
    }

    let examined = 0;
    let deleted = 0;
    let failed = 0;
    for (const ownerId of owners) {
      for (const namespace of REAP_NAMESPACES) {
        for await (const entry of this.#entries(ownerId, namespace)) {
          examined += 1;
          const key = refKey(entry.ref);
          const protectedByPrefix =
            namespace === "artifact-worker-results" &&
            [...protectedOutputPrefixes].some((prefix) =>
              entry.ref.key.startsWith(`${prefix}/`),
            );
          const eligibleByPrefix =
            namespace === "artifact-worker-results" &&
            [...eligibleOutputPrefixes].some((prefix) =>
              entry.ref.key.startsWith(`${prefix}/`),
            );
          if (
            protectedRefs.has(key) ||
            protectedByPrefix ||
            (!eligibleRefs.has(key) && !eligibleByPrefix)
          )
            continue;
          try {
            // The scan above is only a candidate snapshot. Re-read the durable
            // ledger immediately before the destructive operation so a retry,
            // replay, or newly-created job can protect the same immutable ref.
            const currentRecords = await this.#ledger.list();
            const protectedNow = currentRecords.some(
              (record) =>
                !eligible(record, cutoff) &&
                recordReferencesEntry(record, entry),
            );
            const eligibleNow = currentRecords.some(
              (record) =>
                eligible(record, cutoff) &&
                recordReferencesEntry(record, entry),
            );
            if (protectedNow || !eligibleNow) continue;
            const result = await this.#storage.delete({
              ref: entry.ref,
              expectedDigest: entry.digest,
              idempotencyKey: `retention-${createHash("sha256")
                .update(`${key}\0${entry.digest}`)
                .digest("hex")}`,
            });
            if (result.deleted || result.alreadyAbsent) deleted += 1;
          } catch {
            failed += 1;
          }
        }
      }
    }
    return { examined, deleted, failed };
  }

  async *#entries(ownerId: string, namespace: string) {
    let afterKey: string | undefined;
    for (let page = 0; page < 10_000; page += 1) {
      const entries: ObjectStorageEntry[] = [];
      for await (const entry of this.#storage.reconcile({
        ownerId,
        namespace,
        ...(afterKey ? { afterKey } : {}),
        limit: 250,
      }))
        entries.push(entry);
      for (const entry of entries) yield entry;
      if (entries.length < 250) return;
      const next = entries.at(-1)!.ref.key;
      if (next === afterKey) throw new Error("ARTIFACT_REAPER_CURSOR_STALLED");
      afterKey = next;
    }
    throw new Error("ARTIFACT_REAPER_PAGE_LIMIT_EXCEEDED");
  }
}
