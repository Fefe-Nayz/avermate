import { afterEach, describe, expect, test } from "bun:test";
import type { NodeArtifactRef } from "@avermate/agent-contracts";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeArtifactRetentionReaper } from "./artifact-retention";
import { FilesystemObjectStorageProvider } from "./filesystem-storage";
import type { NodeJobRecord } from "./job-ledger";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("terminal artifact retention", () => {
  test("reaps acknowledged/expired artifacts and protects retryable/shared data", async () => {
    const root = await mkdtemp(join(tmpdir(), "avermate-retention-"));
    roots.push(root);
    const storage = new FilesystemObjectStorageProvider({
      root: join(root, "objects"),
      maxObjectBytes: 1024 * 1024,
      quotaBytes: 16 * 1024 * 1024,
    });
    await storage.initialize();
    const oldInput = await put(storage, "sandbox-inputs", "old-input");
    const protectedInput = await put(
      storage,
      "sandbox-inputs",
      "protected-input",
    );
    const unackedOutput = await put(
      storage,
      "artifact-worker-results",
      `${jobPrefix("job-unacked")}/result`,
    );
    const acknowledgedOutput = await put(
      storage,
      "artifact-worker-results",
      `${jobPrefix("job-acknowledged")}/result`,
    );
    const orphanedFailedOutput = await put(
      storage,
      "artifact-worker-results",
      `${jobPrefix("job-failed")}/late-result`,
    );
    const now = Date.parse("2026-08-22T12:00:00.000Z");
    const old = new Date(now - 120_000).toISOString();
    const fresh = new Date(now).toISOString();
    const records = [
      record("job-failed", "failed", old, [oldInput]),
      record("job-retryable", "failed", fresh, [protectedInput]),
      record("job-unacked", "completed", old, [], [unackedOutput], null),
      record(
        "job-acknowledged",
        "completed",
        old,
        [],
        [acknowledgedOutput],
        old,
      ),
    ];
    const reaper = new NodeArtifactRetentionReaper({
      ledger: { list: async () => records },
      storage,
      retentionMs: 60_000,
    });
    expect(await reaper.reap(now)).toEqual({
      examined: 5,
      deleted: 3,
      failed: 0,
    });
    expect(await storage.stat({ ref: oldInput.object })).toBeNull();
    expect(await storage.stat({ ref: orphanedFailedOutput.object })).toBeNull();
    expect(await storage.stat({ ref: acknowledgedOutput.object })).toBeNull();
    expect(await storage.stat({ ref: protectedInput.object })).not.toBeNull();
    expect(await storage.stat({ ref: unackedOutput.object })).not.toBeNull();
  });

  test("rechecks the durable ledger immediately before deleting a candidate", async () => {
    const root = await mkdtemp(join(tmpdir(), "avermate-retention-race-"));
    roots.push(root);
    const storage = new FilesystemObjectStorageProvider({
      root: join(root, "objects"),
      maxObjectBytes: 1024 * 1024,
      quotaBytes: 16 * 1024 * 1024,
    });
    await storage.initialize();
    const sharedInput = await put(storage, "sandbox-inputs", "shared-input");
    const now = Date.parse("2026-08-22T12:00:00.000Z");
    const old = new Date(now - 120_000).toISOString();
    const fresh = new Date(now).toISOString();
    const expired = record("job-expired", "failed", old, [sharedInput]);
    const retryable = record("job-retryable", "failed", fresh, [sharedInput]);
    let reads = 0;
    const reaper = new NodeArtifactRetentionReaper({
      ledger: {
        list: async () => {
          reads += 1;
          return reads === 1 ? [expired] : [expired, retryable];
        },
      },
      storage,
      retentionMs: 60_000,
    });

    expect(await reaper.reap(now)).toEqual({
      examined: 1,
      deleted: 0,
      failed: 0,
    });
    expect(reads).toBe(2);
    expect(await storage.stat({ ref: sharedInput.object })).not.toBeNull();
  });
});

function record(
  id: string,
  stage: "failed" | "completed",
  updatedAt: string,
  inputs: NodeArtifactRef[],
  results: NodeArtifactRef[] = [],
  commitAcknowledgedAt: string | null = null,
) {
  return {
    version: 1,
    job: {
      id,
      principalRef: {
        userId: "owner-a",
        nodeId: "node-a",
        actorKind: "system",
      },
      inputRefs: inputs,
      resourceRefs: inputs.map((input) => input.object),
    },
    principalFingerprint: "principal",
    idempotencyKey: id,
    envelopeDigest: `sha256:${"1".repeat(64)}`,
    stage,
    lease: null,
    cancelRequested: false,
    commitAcknowledgedAt,
    events: results.length > 0 ? [{ resultManifest: results }] : [],
    createdAt: updatedAt,
    updatedAt,
  } as unknown as NodeJobRecord;
}

async function put(
  storage: FilesystemObjectStorageProvider,
  namespace: string,
  key: string,
) {
  const bytes = new TextEncoder().encode(`${namespace}:${key}`);
  const digest =
    `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
  const ref = { ownerId: "owner-a", namespace, key };
  const commit = await storage.put({
    ref,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    byteSize: bytes.byteLength,
    mimeType: "application/octet-stream",
    expectedDigest: digest,
    idempotencyKey: `put-${key}`,
  });
  return {
    object: commit.ref,
    digest: commit.digest,
    byteSize: commit.byteSize,
    mimeType: commit.mimeType,
  };
}

function jobPrefix(jobId: string) {
  return createHash("sha256").update(jobId).digest("hex");
}
