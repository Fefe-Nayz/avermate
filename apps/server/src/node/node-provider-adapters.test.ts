import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  runConversationStoreConformance,
  type LexicalSearchBackend,
  type ModelDescriptor,
  type ModelGateway,
  type NormalizedUsage,
} from "@avermate/agent-contracts";
import { LocalNodeProviderTransport } from "../../../node/src/provider-transport";
import { SqliteConversationStore } from "../agent/conversation-store";
import { MockSandboxProvider } from "../sandbox/mock-provider";
import { runSandboxConformance } from "../sandbox/conformance";
import { enableSandboxProfile, SANDBOX_PROFILES_V1 } from "../sandbox/profiles";
import {
  NodeConversationStore,
  NodeLexicalSearchBackend,
  NodeModelGateway,
  NodeSandboxProvider,
} from "./node-provider-adapters";

const nodeId = "node-provider-test";
const ownerId = "owner-provider-test";
const hostPolicyDigest = `sha256:${"e".repeat(64)}`;
const now = new Date("2026-08-22T12:00:00.000Z");
const usage: NormalizedUsage = {
  inputTokens: 2,
  outputTokens: 1,
  reasoningTokens: 0,
  cachedReadTokens: 0,
  cachedWriteTokens: 0,
};
const model: ModelDescriptor = {
  id: "local-test-model",
  provider: "local-fixture",
  displayName: "Local fixture",
  modalities: ["text", "embedding", "audio"],
  capabilities: {
    tools: false,
    reasoningSummary: false,
    cachedUsage: false,
    structuredOutput: false,
  },
  contextWindow: 4_096,
};

const databases: Database[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function lexicalFixture(): LexicalSearchBackend {
  return {
    async capabilities() {
      return {
        available: true,
        implementation: "node-fixture-lexical-v1",
        modes: ["terms", "phrase", "prefix", "exact"] as const,
      };
    },
    async upsertVersion() {},
    async removeVersion() {},
    async search(input) {
      return [
        {
          sourceId: "source-1",
          versionId: "version-1",
          chunkId: "chunk-1",
          ordinal: 0,
          score: 1,
          snippet: input.query,
          locator: { kind: "text" as const, startOffset: 0, endOffset: 5 },
          contentHash: "a".repeat(64),
          evidenceKind: "native-text" as const,
        },
      ];
    },
    async verify() {
      return {
        consistent: true,
        indexedVersions: 1,
        missingVersionIds: [],
        orphanedVersionIds: [],
      };
    },
  };
}

function modelFixture(): ModelGateway {
  return {
    async listModels() {
      return [model];
    },
    async *stream() {
      yield { type: "content-delta" as const, delta: "local" };
      yield { type: "usage" as const, usage };
      yield { type: "finish" as const, reason: "stop" as const };
    },
    async embed(request) {
      return {
        vectors: request.inputs.map(() => [0.25, 0.75]),
        usage,
      };
    },
    async transcribe() {
      return {
        text: "local transcript",
        language: "fr",
        durationSeconds: 1,
        usage,
      };
    },
    async estimate() {
      return { usage, estimatedCostMinor: 0, currency: "EUR" };
    },
  };
}

function fixture() {
  const database = new Database(":memory:");
  databases.push(database);
  const conversations = new SqliteConversationStore(database);
  const lexical = lexicalFixture();
  const models = modelFixture();
  const profiles = Object.values(SANDBOX_PROFILES_V1).map((candidate, index) =>
    enableSandboxProfile(candidate.id, {
      version: "node-fixture-v1",
      imageDigest: `sha256:${(index + 1).toString(16).repeat(64)}`,
    }),
  );
  const profile = profiles[0]!;
  const sandbox = new MockSandboxProvider({
    allowMock: true,
    hostPolicyDigest,
    profiles,
    now: () => now,
  });
  const transport = new LocalNodeProviderTransport(nodeId, {
    conversations: (requestedOwner) =>
      requestedOwner === ownerId ? conversations : null,
    lexical: (requestedOwner) => (requestedOwner === ownerId ? lexical : null),
    models: (requestedOwner) => (requestedOwner === ownerId ? models : null),
    sandboxes: (requestedOwner, providerId) =>
      [ownerId, "conformance-owner"].includes(requestedOwner) &&
      providerId === sandbox.id
        ? sandbox
        : null,
  });
  return {
    conversations,
    lexical,
    models,
    profile,
    profiles,
    sandbox,
    transport,
  };
}

describe("Core to Node provider adapters", () => {
  test("passes the reusable conversation-store suite through node transport", async () => {
    const { conversations, transport } = fixture();
    const store = new NodeConversationStore(nodeId, ownerId, transport);
    const report = await runConversationStoreConformance({
      store,
      placement: { kind: "node", nodeId },
      ownerId,
      provisionRun: (identity) => {
        conversations.ensureRun({
          ...identity,
          placement: identity.placement,
        });
      },
      now,
    });
    expect(report.passed).toContain("persistence-before-return");
    expect(report.passed).toContain("owner-isolation");
  });

  test("persists conversation events on the node before replaying them", async () => {
    const { conversations, transport } = fixture();
    conversations.ensureRun({
      ownerId,
      threadId: "thread-1",
      branchId: "branch-1",
      runId: "run-1",
      placement: { kind: "node", nodeId },
    });
    const store = new NodeConversationStore(nodeId, ownerId, transport);
    const event = {
      protocolVersion: 1 as const,
      eventId: "event-1",
      sequence: 1,
      threadId: "thread-1",
      branchId: "branch-1",
      runId: "run-1",
      emittedAt: now.toISOString(),
      type: "run.started",
      payload: { safe: true },
      terminal: false,
    };
    const stored = await store.appendEvent({
      event,
      expectedPreviousSequence: 0,
    });
    expect(stored.eventId).toBe(event.eventId);
    const replayed = [];
    for await (const item of store.replayEvents({
      ownerId,
      threadId: event.threadId,
      branchId: event.branchId,
      runId: event.runId,
      afterSequence: 0,
      limit: 10,
    })) {
      replayed.push(item);
    }
    expect(replayed.map((item) => item.eventId)).toEqual([event.eventId]);
    expect(
      await store.getRun({
        ownerId,
        threadId: event.threadId,
        branchId: event.branchId,
        runId: event.runId,
      }),
    ).toMatchObject({ lastSequence: 1, placement: { kind: "node", nodeId } });

    conversations.ensureRun({
      ownerId: "other-owner",
      threadId: "other-thread",
      branchId: "other-branch",
      runId: "other-run",
      placement: { kind: "node", nodeId },
    });
    await expect(
      store.appendEvent({
        expectedPreviousSequence: 0,
        event: {
          ...event,
          eventId: "cross-owner-event",
          threadId: "other-thread",
          branchId: "other-branch",
          runId: "other-run",
        },
      }),
    ).rejects.toThrow("NODE_CONVERSATION_OWNER_MISMATCH");
  });

  test("routes owner-bound lexical and model operations without widening scope", async () => {
    const { transport } = fixture();
    const lexical = new NodeLexicalSearchBackend(nodeId, ownerId, transport);
    expect((await lexical.capabilities()).available).toBe(true);
    const matches = await lexical.search({
      ownerId,
      query: "local",
      mode: "terms",
      projectIds: [],
      yearIds: [],
      subjectIds: [],
      originKinds: [],
      limit: 5,
      cursor: null,
    });
    expect(matches[0]?.snippet).toBe("local");
    await expect(
      lexical.search({
        ownerId: "other-owner",
        query: "local",
        mode: "exact",
        projectIds: [],
        yearIds: [],
        subjectIds: [],
        originKinds: [],
        limit: 5,
        cursor: null,
      }),
    ).rejects.toThrow("NODE_CAPABILITY_OWNER_MISMATCH");

    const gateway = new NodeModelGateway(nodeId, ownerId, [model], transport);
    expect(
      await gateway.listModels({
        ownerId,
        placement: "node",
        allowedOrigins: [],
      }),
    ).toEqual([model]);
    const events = [];
    for await (const event of gateway.stream({
      ownerId,
      runId: "run-model",
      modelId: model.id,
      messages: [],
      tools: [],
    })) {
      events.push(event.type);
    }
    expect(events).toEqual(["content-delta", "usage", "finish"]);
    expect(
      await gateway.embed({ ownerId, modelId: model.id, inputs: ["one"] }),
    ).toMatchObject({ vectors: [[0.25, 0.75]] });
  });

  test("routes sandbox lifecycle and fails closed when the node goes offline", async () => {
    const { profile, transport } = fixture();
    const provider = new NodeSandboxProvider(
      nodeId,
      ownerId,
      "mock",
      transport,
    );
    expect((await provider.capabilities()).available).toBe(true);
    const create = {
      ownerId,
      threadId: "thread-sandbox",
      branchId: "branch-sandbox",
      expiresAt: new Date(now.getTime() + 60_000),
      profile,
      expectedHostPolicyDigest: hostPolicyDigest,
      maxEvidenceAgeMs: 60_000,
      now,
    };
    const handle = await provider.create(create);
    const events = [];
    for await (const event of provider.execute({
      handle,
      executable: profile.entrypoints[0]!,
      argv: ["--avermate-conformance-v1"],
    })) {
      events.push(event.type);
    }
    expect(events).toContain("exited");
    await provider.destroy(handle);

    transport.setOnline(false);
    expect(await provider.capabilities()).toEqual({
      providerId: "mock",
      available: false,
      profiles: [],
    });
    expect(await provider.preflight(create)).toMatchObject({
      ok: false,
      reason: "TRANSPORT_UNAVAILABLE",
    });
  });

  test("passes sandbox conformance through the Core-to-Node adapter", async () => {
    const { profiles, transport } = fixture();
    const provider = new NodeSandboxProvider(
      nodeId,
      "conformance-owner",
      "mock",
      transport,
    );
    const report = await runSandboxConformance({
      provider,
      profiles,
      hostPolicyDigest,
      requireAvailable: true,
      mockEvidence: true,
      now,
    });
    expect(report.passed).toBe(true);
    expect(report.cells).toHaveLength(profiles.length);
    expect(report.cells.every((cell) => cell.status === "pass")).toBe(true);
  });
});
