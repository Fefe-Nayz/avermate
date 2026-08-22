import { describe, expect, test } from "bun:test";
import {
  AVERMATE_NODE_PROTOCOL,
  capabilityRequestSchema,
  nodeCapabilityFeaturesSchema,
  nodeJobV1Schema,
} from "./node";

const digest = `sha256:${"a".repeat(64)}`;
const now = "2026-08-22T00:00:00.000Z";

describe("node protocol contracts", () => {
  test("requires lexical search for retrieval placement", () => {
    expect(
      nodeCapabilityFeaturesSchema.safeParse({
        retrieval: { version: 1, lexical: true, vectorSpaces: [] },
      }).success,
    ).toBe(true);
    expect(
      nodeCapabilityFeaturesSchema.safeParse({
        retrieval: { version: 1, lexical: false, vectorSpaces: [] },
      }).success,
    ).toBe(false);
    const additive = nodeCapabilityFeaturesSchema.parse({
      retrieval: { version: 1, lexical: true, vectorSpaces: [] },
      futureCapability: { version: 1, enabled: true },
    });
    expect(additive.futureCapability).toEqual({ version: 1, enabled: true });
  });

  test("binds signed job execution profiles to advertised kinds", () => {
    const jobs = {
      version: 1,
      kinds: ["artifact.video-audio-extract@1"],
      maxConcurrent: 2,
      executionProfiles: [
        {
          kind: "artifact.video-audio-extract@1",
          sandboxProfileId: "media",
          profileVersion: "node-v1-media-aabbcc",
          imageDigest: digest,
          egressPolicyDigest: digest,
        },
      ],
    } as const;
    expect(nodeCapabilityFeaturesSchema.safeParse({ jobs }).success).toBe(true);
    expect(
      nodeCapabilityFeaturesSchema.safeParse({
        jobs: {
          ...jobs,
          executionProfiles: [
            { ...jobs.executionProfiles[0], kind: "artifact.unadvertised@1" },
          ],
        },
      }).success,
    ).toBe(false);
  });

  test("rejects job envelopes with unexpected or malformed fields", () => {
    const claims = {
      version: 1,
      issuer: "core",
      audience: "node-1",
      subject: "user-1",
      nodeId: "node-1",
      userId: "user-1",
      actorKind: "user",
      jobId: "job-1",
      jti: "jti-1",
      capabilities: ["jobs.render"],
      resources: [],
      limits: {
        byteLimit: 0,
        tokenLimit: 0,
        costMinorLimit: 0,
        deadline: now,
      },
      notBefore: now,
      expiresAt: now,
      issuedAt: now,
    };
    const job = {
      id: "job-1",
      principalRef: {
        userId: "user-1",
        nodeId: "node-1",
        actorKind: "user",
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
        deadline: now,
      },
      idempotencyKey: "idem-1",
      envelopeDigest: digest,
      grant: { claims, keyId: "key-1", signature: "a".repeat(64) },
    };
    expect(nodeJobV1Schema.safeParse(job).success).toBe(true);
    expect(
      nodeJobV1Schema.safeParse({ ...job, protocol: AVERMATE_NODE_PROTOCOL })
        .success,
    ).toBe(false);
  });

  test("makes fallback an explicit ordered choice", () => {
    const parsed = capabilityRequestSchema.parse({
      userId: "user-1",
      capability: "models",
      selected: { kind: "node", nodeId: "node-1", providerId: "ollama" },
      requiredCapabilityVersion: 1,
      fallbackChain: [{ kind: "byok", providerId: "openai" }],
    });
    expect(parsed.fallbackChain).toHaveLength(1);
    expect(parsed.allowDataTransfer).toBe(false);
  });
});
