import { describe, expect, test } from "bun:test";
import {
  agentCheckpointRefSchema,
  agentRunLeaseSchema,
  agentRunRequestSchema,
  providerDispatchClaimSchema,
} from "./runtime";
import { normalizedUsageSnapshotSchema } from "./model-gateway";

const now = "2026-08-22T12:00:00.000Z";
const hash = "a".repeat(64);
const placement = {
  kind: "direct-byok" as const,
  origin: "https://api.example.test",
  credentialOwner: "user" as const,
};

describe("production agent runtime contracts", () => {
  test("freezes owner, branch, revisions, placement and catalogue identity", () => {
    const request = agentRunRequestSchema.parse({
      protocolVersion: 1,
      ownerId: "owner-1",
      threadId: "thread-1",
      branchId: "branch-1",
      runId: "run-1",
      inputMessageId: "message-1",
      reservedOutputMessageId: "message-2",
      conversationPlacement: { kind: "core" },
      modelKey: "model-1",
      modelRevision: "model-1/2026-08-22",
      providerKey: "provider-1",
      providerRevision: "provider-1/1",
      modelPlacement: placement,
      policyRevision: "assistant-policy/1",
      toolCatalogRevision: "sha256:catalogue",
      contextManifestDigest: hash,
      branchIdentityDigest: hash,
      graphSchemaVersion: 1,
      approvalMode: "confirm-writes",
    });
    expect(request.modelPlacement.kind).toBe("direct-byok");
    expect(() =>
      agentRunRequestSchema.parse({ ...request, protocolVersion: 2 }),
    ).toThrow();
    expect(() =>
      agentRunRequestSchema.parse({ ...request, unknownAuthority: true }),
    ).toThrow();
  });

  test("keeps leases and checkpoint references owner/run bound", () => {
    expect(
      agentRunLeaseSchema.parse({
        protocolVersion: 1,
        id: "lease-1",
        ownerId: "owner-1",
        runId: "run-1",
        workerId: "worker-1",
        fencingToken: 2,
        state: "active",
        acquiredAt: now,
        heartbeatAt: now,
        expiresAt: now,
      }).fencingToken,
    ).toBe(2);
    expect(
      agentCheckpointRefSchema.parse({
        protocolVersion: 1,
        ownerId: "owner-1",
        threadId: "thread-1",
        branchId: "branch-1",
        runId: "run-1",
        conversationCheckpointRef: "checkpoint-1",
        afterEventSequence: 4,
        runtimeId: "avermate-agent-runtime",
        runtimeVersion: "1",
        graphSchemaVersion: 1,
        stateDigest: hash,
      }).afterEventSequence,
    ).toBe(4);
  });

  test("represents uncertain provider windows and unknown usage honestly", () => {
    const claim = providerDispatchClaimSchema.parse({
      protocolVersion: 1,
      id: "dispatch-1",
      ownerId: "owner-1",
      threadId: "thread-1",
      branchId: "branch-1",
      runId: "run-1",
      dispatchKey: "round-1",
      requestDigest: hash,
      providerKey: "provider-1",
      providerRevision: "provider-1/1",
      modelKey: "model-1",
      modelRevision: "model-1/1",
      placement,
      providerSupportsStableRequestKey: false,
      stableRequestKey: null,
      state: "inspect-required",
      claimedAt: now,
      updatedAt: now,
      inspectReason: "Process stopped after dispatch began",
    });
    expect(claim.state).toBe("inspect-required");

    const usage = normalizedUsageSnapshotSchema.parse({
      version: 1,
      ownerId: "owner-1",
      runId: "run-1",
      providerKey: "provider-1",
      providerRevision: "provider-1/1",
      modelKey: "model-1",
      modelRevision: "model-1/1",
      source: "unknown",
      usage: {
        inputTokens: "unknown",
        outputTokens: "unknown",
        reasoningTokens: "unknown",
        cachedReadTokens: "unknown",
        cachedWriteTokens: "unknown",
      },
      final: true,
      observedAt: now,
    });
    expect(usage.usage.inputTokens).toBe("unknown");
  });
});
