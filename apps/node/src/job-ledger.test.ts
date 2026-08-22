import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadOrCreateNodeIdentity } from "./identity";
import { NodeJobLedger } from "./job-ledger";
import { nodeJobEnvelopeDigest, signCapabilityGrant } from "./protocol";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function createJobFixture() {
  const root = await mkdtemp(join(tmpdir(), "avermate-node-jobs-"));
  roots.push(root);
  const core = await loadOrCreateNodeIdentity(join(root, "core.json"));
  const now = Date.parse("2026-08-22T10:00:00.000Z");
  const unsigned = {
    id: "job-1",
    principalRef: {
      userId: "user-1",
      nodeId: "node-1",
      actorKind: "user" as const,
    },
    kind: "render",
    capabilityVersion: 1,
    inputRefs: [],
    policyRef: "policy-1",
    limits: {
      cpuMillis: 1_000,
      memoryBytes: 1_024,
      inputBytes: 0,
      outputBytes: 0,
      deadline: new Date(now + 60_000).toISOString(),
    },
    idempotencyKey: "idem-1",
  };
  const claims = {
    version: 1 as const,
    issuer: "core",
    audience: "node-1",
    subject: "user-1",
    nodeId: "node-1",
    userId: "user-1",
    actorKind: "user" as const,
    jobId: "job-1",
    jti: "jti-1",
    capabilities: ["jobs:render"],
    resources: [],
    limits: {
      byteLimit: 0,
      tokenLimit: 0,
      costMinorLimit: 0,
      deadline: unsigned.limits.deadline,
    },
    notBefore: new Date(now - 1_000).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
    issuedAt: new Date(now - 1_000).toISOString(),
  };
  const job = {
    ...unsigned,
    envelopeDigest: nodeJobEnvelopeDigest(unsigned),
    grant: signCapabilityGrant(core, claims),
  };
  return { root, now, job };
}

describe("durable node job ledger", () => {
  test("deduplicates exact offers and rejects changed envelopes", async () => {
    const { root, now, job } = await createJobFixture();
    const ledger = new NodeJobLedger(join(root, "jobs.json"));
    expect((await ledger.offer(job, now)).replayed).toBe(false);
    expect((await ledger.offer(job, now)).replayed).toBe(true);
    await expect(
      ledger.offer({ ...job, envelopeDigest: `sha256:${"f".repeat(64)}` }, now),
    ).rejects.toThrow("IDEMPOTENCY_PAYLOAD_MISMATCH");
  });

  test("fences lost leases, orders events and persists terminal adoption", async () => {
    const { root, now, job } = await createJobFixture();
    const path = join(root, "jobs.json");
    const ledger = new NodeJobLedger(path);
    await ledger.offer(job, now);
    const leased = await ledger.lease({
      jobId: job.id,
      workerId: "worker-a",
      ttlMs: 1_000,
      now,
    });
    const token = leased.lease!.token;
    await expect(
      ledger.appendEvent({
        event: {
          jobId: job.id,
          sequence: 4,
          eventId: "event-bad-order",
          stage: "running",
          emittedAt: new Date(now + 1).toISOString(),
          terminal: false,
        },
        leaseToken: token,
        now: now + 1,
      }),
    ).rejects.toThrow("JOB_EVENT_OUT_OF_ORDER");
    await ledger.appendEvent({
      event: {
        jobId: job.id,
        sequence: 3,
        eventId: "event-running",
        stage: "running",
        emittedAt: new Date(now + 1).toISOString(),
        terminal: false,
      },
      leaseToken: token,
      now: now + 1,
    });
    await expect(
      ledger.appendEvent({
        event: {
          jobId: job.id,
          sequence: 4,
          eventId: "event-late",
          stage: "completed",
          emittedAt: new Date(now + 2_000).toISOString(),
          terminal: true,
          resultManifest: [],
        },
        leaseToken: token,
        now: now + 2_000,
      }),
    ).rejects.toThrow("JOB_LEASE_EXPIRED");
    const released = await ledger.lease({
      jobId: job.id,
      workerId: "worker-b",
      ttlMs: 1_000,
      now: now + 2_000,
    });
    const completed = await ledger.appendEvent({
      event: {
        jobId: job.id,
        sequence: 4,
        eventId: "event-complete",
        stage: "completed",
        emittedAt: new Date(now + 2_001).toISOString(),
        terminal: true,
        resultManifest: [],
      },
      leaseToken: released.lease!.token,
      now: now + 2_001,
    });
    expect(completed.record.stage).toBe("completed");
    await ledger.acknowledgeCommit(job.id, now + 2_002);
    const reopened = new NodeJobLedger(path);
    expect((await reopened.get(job.id))?.commitAcknowledgedAt).not.toBeNull();
  });

  test("makes cancellation durable and replayable", async () => {
    const { root, now, job } = await createJobFixture();
    const ledger = new NodeJobLedger(join(root, "jobs.json"));
    await ledger.offer(job, now);
    await ledger.lease({
      jobId: job.id,
      workerId: "worker-a",
      ttlMs: 5_000,
      now,
    });
    const cancelled = await ledger.requestCancellation(job.id, now + 1);
    expect(cancelled.cancelRequested).toBe(true);
    expect(
      (await ledger.requestCancellation(job.id, now + 2)).events,
    ).toHaveLength(cancelled.events.length);
  });
});
