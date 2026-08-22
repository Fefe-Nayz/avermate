import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defaultDevZeroConfig } from "./config";
import { loadOrCreateNodeIdentity } from "./identity";
import {
  GrantReplayLedger,
  PairingManager,
  buildManifest,
  nodeJobEnvelopeDigest,
  signCapabilityGrant,
  unsignedNodeJob,
  verifyJobGrant,
  verifyNodeManifest,
} from "./protocol";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "avermate-node-protocol-"));
  roots.push(root);
  const nodeIdentity = await loadOrCreateNodeIdentity(join(root, "node.json"));
  const coreIdentity = await loadOrCreateNodeIdentity(join(root, "core.json"));
  return { root, nodeIdentity, coreIdentity };
}

describe("node identity, manifests and grants", () => {
  test("signs a short-lived versioned capability manifest", async () => {
    const { nodeIdentity } = await fixture();
    const now = new Date("2026-08-22T10:00:00.000Z");
    const manifest = buildManifest({
      identity: nodeIdentity,
      config: defaultDevZeroConfig(),
      features: {
        storage: {
          version: 1,
          maxObjectBytes: 1024,
          multipart: true,
          directTransfer: false,
          encryptionModes: ["transport-tls"],
        },
        futureCapability: { version: 1, enabled: true },
      },
      storageUsedBytes: 0,
      now,
    });
    expect(
      verifyNodeManifest(manifest, nodeIdentity.publicKeyDer, now.getTime()),
    ).toBe(true);
    expect(
      verifyNodeManifest(
        { ...manifest, build: "tampered" },
        nodeIdentity.publicKeyDer,
        now.getTime(),
      ),
    ).toBe(false);
    expect(
      verifyNodeManifest(
        {
          ...manifest,
          features: {
            ...manifest.features,
            futureCapability: { version: 1, enabled: false },
          },
        },
        nodeIdentity.publicKeyDer,
        now.getTime(),
      ),
    ).toBe(false);
  });

  test("pairing codes are fingerprint-bound, expiring and single-use", async () => {
    const { nodeIdentity } = await fixture();
    const manager = new PairingManager(nodeIdentity);
    const pending = manager.create(1_000, 1_000);
    expect(() =>
      manager.consume({
        pairingAttemptId: pending.offer.pairingAttemptId,
        code: pending.code,
        userId: "user-1",
        expectedFingerprint: "AAAAAAAAAAAAAAAA",
        now: 1_500,
      }),
    ).toThrow("PAIRING_FINGERPRINT_MISMATCH");

    const valid = manager.create(1_000, 1_000);
    const first = manager.consume({
      pairingAttemptId: valid.offer.pairingAttemptId,
      code: valid.code,
      userId: "user-1",
      expectedFingerprint: valid.offer.fingerprint,
      now: 1_500,
    });
    expect(first.binding.nodeId).toBe(nodeIdentity.nodeId);
    expect(first.channelCredential.length).toBeGreaterThan(32);
    expect(() =>
      manager.consume({
        pairingAttemptId: valid.offer.pairingAttemptId,
        code: valid.code,
        userId: "user-1",
        expectedFingerprint: valid.offer.fingerprint,
        now: 1_500,
      }),
    ).toThrow("PAIRING_CODE_REPLAYED");

    const expired = manager.create(1, 1_000);
    expect(() =>
      manager.consume({
        pairingAttemptId: expired.offer.pairingAttemptId,
        code: expired.code,
        userId: "user-1",
        expectedFingerprint: expired.offer.fingerprint,
        now: 1_002,
      }),
    ).toThrow("PAIRING_CODE_EXPIRED");
  });

  test("binds signed grants and jti replay to the exact principal and envelope", async () => {
    const { root, nodeIdentity, coreIdentity } = await fixture();
    const now = Date.parse("2026-08-22T10:00:00.000Z");
    const unsigned = {
      id: "job-1",
      principalRef: {
        userId: "user-1",
        nodeId: nodeIdentity.nodeId,
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
        deadline: new Date(now + 30_000).toISOString(),
      },
      idempotencyKey: "idem-1",
    };
    const envelopeDigest = nodeJobEnvelopeDigest(unsigned);
    const claims = {
      version: 1 as const,
      issuer: "core",
      audience: nodeIdentity.nodeId,
      subject: "user-1",
      nodeId: nodeIdentity.nodeId,
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
        deadline: new Date(now + 30_000).toISOString(),
      },
      notBefore: new Date(now - 1_000).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
      issuedAt: new Date(now - 1_000).toISOString(),
    };
    const job = {
      ...unsigned,
      envelopeDigest,
      grant: signCapabilityGrant(coreIdentity, claims),
    };
    const verified = verifyJobGrant({
      job,
      issuerPublicKeyDer: coreIdentity.publicKeyDer,
      expectedAudience: nodeIdentity.nodeId,
      now,
    });
    expect(() =>
      verifyJobGrant({
        job,
        issuerPublicKeyDer: coreIdentity.publicKeyDer,
        expectedAudience: "another-node",
        now,
      }),
    ).toThrow("GRANT_WRONG_AUDIENCE");
    expect(() =>
      verifyJobGrant({
        job: {
          ...job,
          grant: {
            ...job.grant,
            claims: { ...job.grant.claims, capabilities: ["jobs:other"] },
          },
        },
        issuerPublicKeyDer: coreIdentity.publicKeyDer,
        expectedAudience: nodeIdentity.nodeId,
        now,
      }),
    ).toThrow("GRANT_SIGNATURE_INVALID");
    const ledger = new GrantReplayLedger(join(root, "replay.json"));
    expect(await ledger.accept(verified, envelopeDigest, now)).toEqual({
      replayed: false,
    });
    expect(await ledger.accept(verified, envelopeDigest, now)).toEqual({
      replayed: true,
    });
    await expect(
      ledger.accept(verified, `sha256:${"f".repeat(64)}`, now),
    ).rejects.toThrow("GRANT_JTI_REPLAY_MISMATCH");
    await expect(
      ledger.accept(
        { ...verified, userId: "user-2", subject: "user-2" },
        envelopeDigest,
        now,
      ),
    ).rejects.toThrow("GRANT_JTI_REPLAY_MISMATCH");
    expect(nodeJobEnvelopeDigest(unsignedNodeJob(job))).toBe(envelopeDigest);
    expect(() =>
      verifyJobGrant({
        job: { ...job, idempotencyKey: "tampered" },
        issuerPublicKeyDer: coreIdentity.publicKeyDer,
        expectedAudience: nodeIdentity.nodeId,
        now,
      }),
    ).toThrow("JOB_ENVELOPE_DIGEST_MISMATCH");
  });
});
