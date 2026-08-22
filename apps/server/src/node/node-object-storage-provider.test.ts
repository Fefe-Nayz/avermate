import { afterEach, describe, expect, test } from "bun:test";
import { runObjectStorageConformance } from "@avermate/agent-contracts/storage-conformance";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FilesystemObjectStorageProvider } from "../../../node/src/filesystem-storage";
import { loadOrCreateNodeIdentity } from "../../../node/src/identity";
import {
  GrantReplayLedger,
  signCapabilityGrant,
} from "../../../node/src/protocol";
import {
  InProcessNodeStorageTransport,
  NodeStorageRequestProcessor,
} from "../../../node/src/storage-processor";
import {
  NodeObjectStorageProvider,
  type NodeStorageGrantIssuer,
} from "./node-object-storage-provider";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "avermate-node-storage-e2e-"));
  roots.push(root);
  const nodeIdentity = await loadOrCreateNodeIdentity(
    join(root, "node-identity.json"),
  );
  const coreIdentity = await loadOrCreateNodeIdentity(
    join(root, "core-identity.json"),
  );
  const storage = new FilesystemObjectStorageProvider({
    root: join(root, "objects"),
    maxObjectBytes: 1024 * 1024,
    quotaBytes: 10 * 1024 * 1024,
    transferSecret: new Uint8Array(32).fill(9),
  });
  await storage.initialize();
  const processor = new NodeStorageRequestProcessor({
    nodeId: nodeIdentity.nodeId,
    corePublicKeyDer: coreIdentity.publicKeyDer,
    storage,
    replayLedger: new GrantReplayLedger(join(root, "grant-replay.json")),
  });
  const transport = new InProcessNodeStorageTransport(
    nodeIdentity.nodeId,
    processor,
  );
  const issuer: NodeStorageGrantIssuer = {
    async issue(input) {
      const now = Date.now();
      return signCapabilityGrant(coreIdentity, {
        version: 1,
        issuer: "avermate-core-test",
        audience: input.nodeId,
        subject: input.userId,
        nodeId: input.nodeId,
        userId: input.userId,
        actorKind: "system",
        jobId: input.requestId,
        jti: `jti_${crypto.randomUUID()}`,
        capabilities: [`storage:${input.operation}`],
        resources: input.resources,
        limits: {
          byteLimit: input.byteLimit,
          tokenLimit: 0,
          costMinorLimit: 0,
          deadline: new Date(now + 60_000).toISOString(),
        },
        notBefore: new Date(now - 1_000).toISOString(),
        expiresAt: new Date(now + 60_000).toISOString(),
        issuedAt: new Date(now).toISOString(),
      });
    },
  };
  const provider = new NodeObjectStorageProvider({
    nodeId: nodeIdentity.nodeId,
    transport,
    grantIssuer: issuer,
    capabilities: await storage.capabilities(),
  });
  return { provider, transport };
}

describe("Core to Node object storage adapter", () => {
  test("passes the same storage conformance suite over signed node grants", async () => {
    const { provider } = await fixture();
    const report = await runObjectStorageConformance(provider);
    expect(report.providerId).toStartWith("node:");
    expect(report.passed).toContain("checksum-failure-atomicity");
    expect(report.passed).toContain("transfer-grant");
  });

  test("reports an offline node explicitly instead of returning a fake 404", async () => {
    const { provider, transport } = await fixture();
    transport.setOnline(false);
    await expect(
      provider.stat({
        ref: { ownerId: "user-1", namespace: "files", key: "object" },
      }),
    ).rejects.toThrow("NODE_STORAGE_UNAVAILABLE");
  });
});
