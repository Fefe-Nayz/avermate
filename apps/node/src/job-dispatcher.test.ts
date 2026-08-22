import { afterEach, describe, expect, test } from "bun:test";
import type { NodeJobV1 } from "@avermate/agent-contracts";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadOrCreateNodeIdentity } from "./identity";
import {
  NodeJobDispatcher,
  NodeJobHandlerRegistry,
  type NodeJobHandler,
} from "./job-dispatcher";
import { NodeJobLedger } from "./job-ledger";
import {
  GrantReplayLedger,
  nodeJobEnvelopeDigest,
  signCapabilityGrant,
} from "./protocol";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(handler: NodeJobHandler) {
  const root = await mkdtemp(join(tmpdir(), "avermate-dispatcher-"));
  roots.push(root);
  const core = await loadOrCreateNodeIdentity(join(root, "core.json"));
  const node = await loadOrCreateNodeIdentity(join(root, "node.json"));
  const ledger = new NodeJobLedger(join(root, "jobs.json"));
  const registry = new NodeJobHandlerRegistry().register(handler);
  const events: string[] = [];
  const dispatcher = new NodeJobDispatcher({
    nodeId: node.nodeId,
    corePublicKeyDer: core.publicKeyDer,
    expectedPolicyRef: () => "node-config:revision-1",
    ledger,
    grantReplay: new GrantReplayLedger(join(root, "grants.json")),
    registry,
    maximumConcurrent: 1,
    leaseTtlMs: 5_000,
    publish: async (event) => {
      events.push(event.stage);
    },
  });
  const now = Date.now();
  const unsigned = {
    id: "job-1",
    principalRef: {
      userId: "owner-1",
      nodeId: node.nodeId,
      actorKind: "user" as const,
    },
    kind: handler.kind,
    capabilityVersion: handler.capabilityVersion,
    inputRefs: [],
    policyRef: "node-config:revision-1",
    limits: {
      cpuMillis: 10_000,
      memoryBytes: 128 * 1024 ** 2,
      inputBytes: 0,
      outputBytes: 1_000,
      deadline: new Date(now + 60_000).toISOString(),
    },
    idempotencyKey: "idem-1",
  };
  const claims = {
    version: 1 as const,
    issuer: "core",
    audience: node.nodeId,
    subject: "owner-1",
    nodeId: node.nodeId,
    userId: "owner-1",
    actorKind: "user" as const,
    jobId: unsigned.id,
    jti: "grant-1",
    capabilities: [handler.requiredCapability],
    resources: [],
    limits: {
      byteLimit: unsigned.limits.outputBytes,
      tokenLimit: 0,
      costMinorLimit: 0,
      deadline: unsigned.limits.deadline,
    },
    notBefore: new Date(now - 1_000).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
    issuedAt: new Date(now - 1_000).toISOString(),
  };
  const job: NodeJobV1 = {
    ...unsigned,
    envelopeDigest: nodeJobEnvelopeDigest(unsigned),
    grant: signCapabilityGrant(core, claims),
  };
  return { dispatcher, ledger, events, job, now };
}

async function terminal(ledger: NodeJobLedger, jobId: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const record = await ledger.get(jobId);
    if (["completed", "failed", "cancelled"].includes(record?.stage ?? "")) {
      return record!;
    }
    await Bun.sleep(5);
  }
  throw new Error("TEST_JOB_DID_NOT_TERMINATE");
}

describe("NodeJobDispatcher", () => {
  test("runs only a registered version under a signed grant and durable lease", async () => {
    const handler: NodeJobHandler = {
      kind: "fixture.render",
      capabilityVersion: 1,
      requiredCapability: "jobs:fixture.render",
      async execute(context) {
        await context.progress({
          numerator: 1,
          denominator: 2,
          unit: "step",
          message: "reviewed",
        });
        return [
          {
            object: { ownerId: "owner-1", namespace: "jobs", key: "result" },
            digest: `sha256:${"a".repeat(64)}`,
            byteSize: 10,
            mimeType: "text/plain",
          },
        ];
      },
    };
    const { dispatcher, ledger, events, job, now } = await fixture(handler);
    expect(await dispatcher.accept(job, now)).toEqual({
      accepted: true,
      replayed: false,
    });
    const record = await terminal(ledger, job.id);
    expect(record.stage).toBe("completed");
    for (
      let attempt = 0;
      events.length < record.events.length && attempt < 100;
      attempt += 1
    ) {
      await Bun.sleep(2);
    }
    expect(events).toEqual([
      "offered",
      "leased",
      "provisioning",
      "running",
      "running",
      "adopting",
      "completed",
    ]);
    await dispatcher.acknowledge(job.id, record.events.at(-1)!.sequence);
    expect((await ledger.pendingRelayEvents()).length).toBe(0);
  });

  test("cancels the active runner and rejects unregistered versions before offer", async () => {
    const handler: NodeJobHandler = {
      kind: "fixture.long",
      capabilityVersion: 1,
      requiredCapability: "jobs:fixture.long",
      async execute(context) {
        await new Promise<void>((resolve) => {
          context.signal.addEventListener("abort", () => resolve(), {
            once: true,
          });
        });
        return [];
      },
    };
    const { dispatcher, ledger, job, now } = await fixture(handler);
    await expect(
      dispatcher.accept({ ...job, capabilityVersion: 2 }, now),
    ).rejects.toThrow("NODE_JOB_HANDLER_NOT_REGISTERED");
    expect(await ledger.get(job.id)).toBeNull();
    await dispatcher.accept(job, now);
    for (let attempt = 0; dispatcher.activeCount === 0 && attempt < 50; attempt += 1) {
      await Bun.sleep(2);
    }
    await dispatcher.cancel(job.id, now + 1);
    expect((await terminal(ledger, job.id)).stage).toBe("cancelled");
  });

  test("cleans outputs produced after cancellation fenced the durable commit", async () => {
    const artifact = {
      object: {
        ownerId: "owner-1",
        namespace: "artifact-worker-results",
        key: "late-result",
      },
      digest: `sha256:${"b".repeat(64)}`,
      byteSize: 12,
      mimeType: "text/plain",
    } as const;
    let requestCancellation!: () => Promise<unknown>;
    const cleaned: string[] = [];
    const handler: NodeJobHandler = {
      kind: "fixture.cancelled-adoption",
      capabilityVersion: 1,
      requiredCapability: "jobs:fixture.cancelled-adoption",
      async execute() {
        await requestCancellation();
        return [artifact];
      },
      async cleanupResults(job, results) {
        expect(job.id).toBe("job-1");
        cleaned.push(...results.map((result) => result.object.key));
      },
    };
    const { dispatcher, ledger, job, now } = await fixture(handler);
    requestCancellation = () => dispatcher.cancel(job.id, now + 1);

    await dispatcher.accept(job, now);
    expect((await terminal(ledger, job.id)).stage).toBe("cancelled");
    expect(cleaned).toEqual(["late-result"]);
  });
});
