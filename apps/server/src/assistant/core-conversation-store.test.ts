import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Client } from "@libsql/client";
import { newId } from "../lib/id";
import { CoreCorpusStore } from "../search/core-corpus-store";
import { CorpusIndexService } from "../search/index-service";
import { createCorpusTestDatabase, seedSource } from "../search/test-helpers";
import { canonicalJson, normalizeForSearch, sha256 } from "../search/values";
import { AssistantContextManifestService } from "./context-manifest";
import type {
  ModelDescriptor,
  ModelGateway,
  ModelGatewayEvent,
} from "@avermate/agent-contracts";
import type { Api } from "../mcp/shared";
import { createFirstPartyToolBroker } from "../tools/first-party";
import {
  PRODUCTION_AGENT_POLICY_REVISION,
  PRODUCTION_AGENT_RUNTIME_ID,
  PRODUCTION_AGENT_RUNTIME_VERSION,
  ProductionAgentRuntime,
} from "../agent/production-runtime";
import {
  MockReadOnlyModelGateway,
  ReadOnlyAssistantRunService,
} from "./run-service";
import { MOCK_ASSISTANT_MODEL } from "./catalogue";
import {
  ConversationStoreError,
  CoreConversationStore,
} from "./core-conversation-store";
import {
  RoutedConversationStore,
  type ConversationDagRelay,
} from "./routed-conversation-store";
import type {
  CapabilityPlacement,
  NodeConversationDagSnapshot,
} from "@avermate/agent-contracts";
import {
  CoreConversationCheckpointStore,
  InMemoryCheckpointBlobStore,
} from "./checkpoint-store";

let client: Client;
let store: CoreConversationStore;
// Applying the complete migration history through 0061 and releasing its
// relational fixtures can take about 90s on slower Windows/libSQL runners.
const databaseHookTimeout = 120_000;

beforeAll(async () => {
  client = await createCorpusTestDatabase();
  store = new CoreConversationStore(client);
}, databaseHookTimeout);

afterAll(() => client.close(), databaseHookTimeout);

async function thread(ownerId = "corpus-user-a") {
  return store.createThread({ ownerId, title: "Algèbre" });
}

function usage() {
  return {
    providerKey: "mock",
    modelKey: "mock-readonly",
    inputTokens: 4,
    outputTokens: 8,
    reasoningTokens: null,
    cachedReadTokens: null,
    cachedWriteTokens: null,
    estimatedCost: "0",
    currency: "EUR",
  };
}

async function authorizeConversationMigration(
  ownerId: string,
  source: CapabilityPlacement,
  destination: CapabilityPlacement,
) {
  const id = `pmig_test_${crypto.randomUUID()}`;
  const now = Math.floor(Date.now() / 1_000);
  await client.execute({
    sql: `INSERT INTO placement_migrations
      (id, accountId, resourceKind, resourceId, sourcePlacementJson,
       destinationPlacementJson, state, copiedBytes, idempotencyKey,
       createdAt, updatedAt)
      VALUES (?, ?, 'conversations', ?, ?, ?, 'copying', '0', ?, ?, ?)`,
    args: [
      id,
      ownerId,
      `placement-test-${id}`,
      JSON.stringify(source),
      JSON.stringify(destination),
      `placement-test-${id}`,
      now,
      now,
    ],
  });
  return id;
}

async function closeConversationMigration(id: string) {
  await client.execute({
    sql: `UPDATE placement_migrations SET state = 'completed' WHERE id = ?`,
    args: [id],
  });
}

describe("CoreConversationStore DAG, CAS and idempotency", () => {
  test("snapshots the owned domain-action cursor when reserving a run", async () => {
    const created = await thread();
    const now = Math.floor(Date.now() / 1_000);
    await client.execute({
      sql: `INSERT INTO agent_action_sequences (userId, nextSequence, updatedAt)
            VALUES (?, 7, ?)
            ON CONFLICT(userId) DO UPDATE SET nextSequence = 7, updatedAt = excluded.updatedAt`,
      args: ["corpus-user-a", now],
    });
    const reservation = await store.reserveTurn({
      ownerId: "corpus-user-a",
      threadId: created.thread.id,
      branchId: created.branch.id,
      expectedHeadMessageId: null,
      clientRequestId: `domain-cursor-${crypto.randomUUID()}`,
      markdown: "Snapshot cursor",
      modelKey: "mock-readonly",
    });
    const row = await client.execute({
      sql: "SELECT domainCursorRef FROM assistant_runs WHERE id = ? LIMIT 1",
      args: [reservation.runId],
    });
    expect(row.rows[0]?.domainCursorRef).toBe("domain:corpus-user-a:7");
  });

  test("reserves H -> U once and rejects a stale concurrent append", async () => {
    const created = await thread();
    const first = await store.reserveTurn({
      ownerId: "corpus-user-a",
      threadId: created.thread.id,
      branchId: created.branch.id,
      expectedHeadMessageId: null,
      clientRequestId: "send-one",
      markdown: "Explique x²",
      modelKey: "mock-readonly",
    });
    const replay = await store.reserveTurn({
      ownerId: "corpus-user-a",
      threadId: created.thread.id,
      branchId: created.branch.id,
      expectedHeadMessageId: null,
      clientRequestId: "send-one",
      markdown: "payload ignored by identical request id",
      modelKey: "mock-readonly",
    });
    expect(replay).toEqual({ ...first, idempotent: true });

    await expect(
      store.reserveTurn({
        ownerId: "corpus-user-a",
        threadId: created.thread.id,
        branchId: created.branch.id,
        expectedHeadMessageId: null,
        clientRequestId: "send-two",
        markdown: "Concurrent",
        modelKey: "mock-readonly",
      }),
    ).rejects.toMatchObject({ code: "head_conflict" });

    const fork = await store.reserveTurn({
      ownerId: "corpus-user-a",
      threadId: created.thread.id,
      branchId: created.branch.id,
      expectedHeadMessageId: null,
      clientRequestId: "send-three",
      markdown: "Explicit sibling",
      modelKey: "mock-readonly",
      forkOnConflict: true,
    });
    expect(fork.branchId).not.toBe(created.branch.id);
  });

  test("finalizes output, usage, branch and terminal event atomically", async () => {
    const created = await thread();
    const reservation = await store.reserveTurn({
      ownerId: "corpus-user-a",
      threadId: created.thread.id,
      branchId: created.branch.id,
      expectedHeadMessageId: null,
      clientRequestId: "atomic-finalize",
      markdown: "Question",
      modelKey: "mock-readonly",
    });
    await store.startRun("corpus-user-a", reservation.runId);
    await store.appendRunEvent({
      ownerId: "corpus-user-a",
      runId: reservation.runId,
      type: "text.message.delta",
      payload: { delta: "Réponse" },
    });
    const final = await store.finalizeRun({
      ownerId: "corpus-user-a",
      runId: reservation.runId,
      expectedInputHeadId: reservation.userMessageId,
      outputMessageId: reservation.reservedOutputMessageId,
      finalParts: [{ type: "text", id: "part-final", markdown: "Réponse" }],
      citations: [],
      usage: usage(),
      terminal: "complete",
      siblingPolicy: "create-explicit-sibling-on-head-conflict",
    });
    expect(final.run.outputMessageId).toBe(final.output.id);
    expect(final.terminalEvent.type).toBe("run.finished");
    const events = await store.replayEvents({
      ownerId: "corpus-user-a",
      runId: reservation.runId,
    });
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(events.at(-1)?.terminal).toBe(true);
    await expect(
      store.appendRunEvent({
        ownerId: "corpus-user-a",
        runId: reservation.runId,
        type: "text.message.delta",
        payload: { delta: "late" },
      }),
    ).rejects.toMatchObject({ code: "invalid_state" });

    const replay = await store.finalizeRun({
      ownerId: "corpus-user-a",
      runId: reservation.runId,
      expectedInputHeadId: reservation.userMessageId,
      outputMessageId: reservation.reservedOutputMessageId,
      finalParts: [{ type: "text", id: "part-final", markdown: "Réponse" }],
      citations: [],
      usage: usage(),
      terminal: "complete",
      siblingPolicy: "create-explicit-sibling-on-head-conflict",
    });
    expect(replay.output.id).toBe(final.output.id);
    await expect(
      store.finalizeRun({
        ownerId: "corpus-user-a",
        runId: reservation.runId,
        expectedInputHeadId: reservation.userMessageId,
        outputMessageId: reservation.reservedOutputMessageId,
        finalParts: [{ type: "text", id: "part-final", markdown: "different" }],
        citations: [],
        usage: usage(),
        terminal: "complete",
        siblingPolicy: "create-explicit-sibling-on-head-conflict",
      }),
    ).rejects.toMatchObject({ code: "divergent_replay" });
  });

  test("edit and retry create siblings without changing historical bytes", async () => {
    const created = await thread();
    const initial = await store.reserveTurn({
      ownerId: "corpus-user-a",
      threadId: created.thread.id,
      branchId: created.branch.id,
      expectedHeadMessageId: null,
      clientRequestId: "initial-edit",
      markdown: "Original",
      modelKey: "mock-readonly",
    });
    await store.finalizeRun({
      ownerId: "corpus-user-a",
      runId: initial.runId,
      expectedInputHeadId: initial.userMessageId,
      outputMessageId: initial.reservedOutputMessageId,
      finalParts: [{ type: "text", id: "answer", markdown: "Original answer" }],
      citations: [],
      usage: usage(),
      terminal: "complete",
      siblingPolicy: "create-explicit-sibling-on-head-conflict",
    });
    const edited = await store.editMessage({
      ownerId: "corpus-user-a",
      messageId: initial.userMessageId,
      clientRequestId: "edited-user",
      markdown: "Edited",
      modelKey: "mock-readonly",
    });
    expect(edited.kind).toBe("run-reserved");
    const retry = await store.reserveRetry({
      ownerId: "corpus-user-a",
      messageId: initial.reservedOutputMessageId,
      clientRequestId: "retry-output",
    });
    expect(retry.branchId).not.toBe(created.branch.id);
    const detail = await store.getThreadDetail(
      "corpus-user-a",
      created.thread.id,
    );
    const original = detail.messages.find(
      (message) => message.id === initial.userMessageId,
    );
    expect(original?.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text", markdown: "Original" }),
      ]),
    );
    expect(detail.branches.length).toBe(3);
  });

  test("isolates owners and validates attachment ownership in the transaction", async () => {
    const created = await thread();
    await expect(
      store.getThreadDetail("corpus-user-b", created.thread.id),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      store.reserveTurn({
        ownerId: "corpus-user-a",
        threadId: created.thread.id,
        branchId: created.branch.id,
        expectedHeadMessageId: null,
        clientRequestId: "bad-attachment",
        markdown: "Private ref",
        modelKey: "mock-readonly",
        attachments: [
          {
            kind: "subject",
            referenceId: "corpus-subject-b",
            label: "not owned",
          },
        ],
      }),
    ).rejects.toThrow("not owned");
    const detail = await store.getThreadDetail(
      "corpus-user-a",
      created.thread.id,
    );
    expect(detail.messages).toHaveLength(0);
    expect(detail.runs).toHaveLength(0);
  });
});

describe("RoutedConversationStore crash recovery", () => {
  test("never commits Node plaintext to Core and reconciles a failed relay import", async () => {
    const snapshots = new Map<string, NodeConversationDagSnapshot>();
    let rejectImports = false;
    const relay: ConversationDagRelay = {
      selectedNode: async () => "node-crash-window",
      assertOnline: async () => undefined,
      import: async (input) => {
        if (rejectImports) throw new Error("INJECTED_IMPORT_FAILURE");
        snapshots.set(input.snapshot.detail.thread.id, structuredClone(input.snapshot));
        return input.snapshot;
      },
      list: async () => [],
      get: async ({ threadId }) => {
        const snapshot = snapshots.get(threadId);
        return snapshot
          ? { detail: structuredClone(snapshot.detail), events: structuredClone(snapshot.events) }
          : null;
      },
      delete: async ({ threadId }) => {
        snapshots.delete(threadId);
        return { deleted: true };
      },
    };
    const routed = new RoutedConversationStore(
      client,
      relay,
      "test-only-crash-window-envelope-secret-0000001",
    );
    const created = await routed.createThread({
      ownerId: "corpus-user-a",
      title: "Crash window",
      placement: "node",
    });
    rejectImports = true;
    await expect(
      routed.reserveTurn({
        ownerId: "corpus-user-a",
        threadId: created.thread.id,
        branchId: created.branch.id,
        expectedHeadMessageId: null,
        clientRequestId: "crash-window-request",
        markdown: "PLAINTEXT_MUST_NEVER_REACH_CORE",
        modelKey: "mock-readonly",
      }),
    ).rejects.toMatchObject({ code: "placement_unavailable" });

    const durable = await client.execute({
      sql: `SELECT partsJson FROM assistant_messages WHERE threadId = ? ORDER BY id`,
      args: [created.thread.id],
    });
    expect(durable.rows).toHaveLength(1);
    const stored = String(durable.rows[0]!.partsJson);
    expect(stored).not.toContain("PLAINTEXT_MUST_NEVER_REACH_CORE");
    expect(stored).toContain('"type":"node-sealed"');

    rejectImports = false;
    expect(await routed.reconcileNode("node-crash-window")).toContainEqual({
      threadId: created.thread.id,
      outcome: "synced",
    });
    const recovered = snapshots.get(created.thread.id);
    expect(
      recovered?.detail.messages.some((message) =>
        message.parts.some(
          (part) =>
            part.type === "text" &&
            part.markdown === "PLAINTEXT_MUST_NEVER_REACH_CORE",
        ),
      ),
    ).toBe(true);
    const pendingRun = await client.execute({
      sql: `SELECT id FROM assistant_runs WHERE threadId = ?
        AND status NOT IN ('complete', 'failed', 'cancelled') LIMIT 1`,
      args: [created.thread.id],
    });
    if (pendingRun.rows[0]) {
      await routed.cancelRun(
        "corpus-user-a",
        String(pendingRun.rows[0].id),
      );
    }
  });

  test("verifies destination readback in both directions before switching", async () => {
    const snapshots = new Map<string, NodeConversationDagSnapshot>();
    const relay: ConversationDagRelay = {
      selectedNode: async () => "node-migration",
      assertOnline: async () => undefined,
      import: async (input) => {
        snapshots.set(
          `${input.nodeId}:${input.snapshot.detail.thread.id}`,
          structuredClone(input.snapshot),
        );
        return input.snapshot;
      },
      list: async () => [],
      get: async ({ nodeId, threadId }) => {
        const snapshot = snapshots.get(`${nodeId}:${threadId}`);
        return snapshot
          ? {
              detail: structuredClone(snapshot.detail),
              events: structuredClone(snapshot.events),
            }
          : null;
      },
      delete: async ({ nodeId, threadId }) => ({
        deleted: snapshots.delete(`${nodeId}:${threadId}`),
      }),
    };
    const routed = new RoutedConversationStore(
      client,
      relay,
      "test-only-placement-migration-envelope-secret-0001",
    );
    const created = await routed.createThread({
      ownerId: "corpus-user-b",
      title: "Placement round trip",
      placement: "core",
    });
    await routed.reserveTurn({
      ownerId: "corpus-user-b",
      threadId: created.thread.id,
      branchId: created.branch.id,
      expectedHeadMessageId: null,
      clientRequestId: `migration-${crypto.randomUUID()}`,
      markdown: "ROUND_TRIP_PRIVATE_MESSAGE",
      modelKey: "mock-readonly",
    });

    const toNodeLease = await authorizeConversationMigration(
      "corpus-user-b",
      { kind: "core", providerId: "core-conversations-v1" },
      {
        kind: "node",
        nodeId: "node-migration",
        providerId: "node-conversations-v1",
      },
    );
    const toNode = await routed.migratePlacement({
      ownerId: "corpus-user-b",
      source: { kind: "core", providerId: "core-conversations-v1" },
      destination: {
        kind: "node",
        nodeId: "node-migration",
        providerId: "node-conversations-v1",
      },
    });
    await closeConversationMigration(toNodeLease);
    expect(toNode.destinationDigest).toBe(toNode.sourceDigest);
    const sealed = await client.execute({
      sql: `SELECT partsJson FROM assistant_messages WHERE threadId = ? LIMIT 1`,
      args: [created.thread.id],
    });
    expect(String(sealed.rows[0]?.partsJson)).not.toContain(
      "ROUND_TRIP_PRIVATE_MESSAGE",
    );
    expect(String(sealed.rows[0]?.partsJson)).toContain('"type":"node-sealed"');

    const toCoreLease = await authorizeConversationMigration(
      "corpus-user-b",
      {
        kind: "node",
        nodeId: "node-migration",
        providerId: "node-conversations-v1",
      },
      { kind: "core", providerId: "core-conversations-v1" },
    );
    const toCore = await routed.migratePlacement({
      ownerId: "corpus-user-b",
      source: {
        kind: "node",
        nodeId: "node-migration",
        providerId: "node-conversations-v1",
      },
      destination: { kind: "core", providerId: "core-conversations-v1" },
    });
    await closeConversationMigration(toCoreLease);
    expect(toCore.destinationDigest).toBe(toCore.sourceDigest);
    const restored = await routed.getThreadDetail(
      "corpus-user-b",
      created.thread.id,
    );
    expect(
      restored.messages.some((message) =>
        message.parts.some(
          (part) =>
            part.type === "text" &&
            part.markdown === "ROUND_TRIP_PRIVATE_MESSAGE",
        ),
      ),
    ).toBe(true);
    const placement = await client.execute({
      sql: `SELECT placement, placementRef FROM assistant_threads WHERE id = ?`,
      args: [created.thread.id],
    });
    expect(placement.rows[0]?.placement).toBe("core");
    expect(placement.rows[0]?.placementRef).toBeNull();
  });

  test("rejects a corrupted Node readback without switching the Core source", async () => {
    const snapshots = new Map<string, NodeConversationDagSnapshot>();
    const relay: ConversationDagRelay = {
      selectedNode: async () => "node-corrupt",
      assertOnline: async () => undefined,
      import: async (input) => {
        snapshots.set(input.snapshot.detail.thread.id, structuredClone(input.snapshot));
        return input.snapshot;
      },
      list: async () => [],
      get: async ({ threadId }) => {
        const snapshot = snapshots.get(threadId);
        if (!snapshot) return null;
        const corrupt = structuredClone(snapshot);
        const first = corrupt.detail.messages[0];
        if (first) {
          first.parts = [
            { type: "text", id: "corrupt-readback", markdown: "CORRUPTED" },
          ];
        }
        return { detail: corrupt.detail, events: corrupt.events };
      },
      delete: async ({ threadId }) => ({
        deleted: snapshots.delete(threadId),
      }),
    };
    const routed = new RoutedConversationStore(
      client,
      relay,
      "test-only-corrupt-readback-envelope-secret-0001",
    );
    const created = await routed.createThread({
      ownerId: "corpus-user-b",
      title: "Corrupt destination",
      placement: "core",
    });
    await routed.reserveTurn({
      ownerId: "corpus-user-b",
      threadId: created.thread.id,
      branchId: created.branch.id,
      expectedHeadMessageId: null,
      clientRequestId: `corrupt-${crypto.randomUUID()}`,
      markdown: "CORE_SOURCE_MUST_SURVIVE",
      modelKey: "mock-readonly",
    });
    const corruptLease = await authorizeConversationMigration(
      "corpus-user-b",
      { kind: "core", providerId: "core-conversations-v1" },
      {
        kind: "node",
        nodeId: "node-corrupt",
        providerId: "node-conversations-v1",
      },
    );
    await expect(
      routed.migratePlacement({
        ownerId: "corpus-user-b",
        source: { kind: "core", providerId: "core-conversations-v1" },
        destination: {
          kind: "node",
          nodeId: "node-corrupt",
          providerId: "node-conversations-v1",
        },
      }),
    ).rejects.toThrow("MIGRATION_DIGEST_MISMATCH");
    await closeConversationMigration(corruptLease);
    const durable = await client.execute({
      sql: `SELECT t.placement, m.partsJson
        FROM assistant_threads AS t
        JOIN assistant_messages AS m ON m.threadId = t.id
        WHERE t.id = ? LIMIT 1`,
      args: [created.thread.id],
    });
    expect(durable.rows[0]?.placement).toBe("core");
    expect(String(durable.rows[0]?.partsJson)).toContain(
      "CORE_SOURCE_MUST_SURVIVE",
    );
  });
});

describe("context proof handles and exports", () => {
  test("allows citations only through the same run committed manifest", async () => {
    const created = await thread();
    const reservation = await store.reserveTurn({
      ownerId: "corpus-user-a",
      threadId: created.thread.id,
      branchId: created.branch.id,
      expectedHeadMessageId: null,
      clientRequestId: "proof-run",
      markdown: "Pythagore",
      modelKey: "mock-readonly",
    });
    await seedSource(client, {
      id: `source-${newId("test")}`,
      originId: "corpus-subject-a",
    });
    const source = (
      await client.execute({
        sql: `SELECT id FROM content_sources WHERE userId = 'corpus-user-a'
          AND originKind = 'subject' AND originId = 'corpus-subject-a'
          ORDER BY createdAt DESC LIMIT 1`,
      })
    ).rows[0]!;
    const text = "Le carré de l’hypoténuse égale la somme des carrés.";
    const corpus = new CoreCorpusStore(client);
    const staged = await corpus.stageVersion({
      identity: {
        ownerId: "corpus-user-a",
        originKind: "subject",
        originId: "corpus-subject-a",
      },
      sourceId: String(source.id),
      versionKey: `proof-${newId("v")}`,
      contentHash: sha256(text),
      extractorId: "test",
      extractorVersion: "1",
      mimeType: "text/plain",
      language: "fr",
      byteSize: text.length,
      locatorSchemaVersion: 1,
      metadata: {},
      chunks: [
        {
          ordinal: 0,
          text,
          normalizedText: normalizeForSearch(text),
          tokenEstimate: 12,
          contentHash: sha256(text),
          locator: { kind: "text", startOffset: 0, endOffset: text.length },
          headingPath: null,
          evidenceKind: "native-text",
        },
      ],
    });
    const committed = await corpus.commitVersion({
      ownerId: "corpus-user-a",
      stagingId: staged.stagingId,
      expectedSourceId: String(source.id),
      expectedPreviousVersionId: null,
    });
    const chunk = (
      await client.execute({
        sql: `SELECT id FROM content_chunks WHERE versionId = ? LIMIT 1`,
        args: [committed.versionId],
      })
    ).rows[0]!;
    const manifest = await new AssistantContextManifestService(client).commit({
      ownerId: "corpus-user-a",
      runId: reservation.runId,
      budget: { maxTokens: 1000, usedTokens: 20, reservedOutputTokens: 100 },
      items: [],
      evidence: [
        {
          sourceVersionId: committed.versionId,
          chunkId: String(chunk.id),
          locator: { kind: "text", startOffset: 0, endOffset: text.length },
          evidenceDigest: sha256(text),
          quotedContentHash: sha256(text),
        },
      ],
    });
    const finalized = await store.finalizeRun({
      ownerId: "corpus-user-a",
      runId: reservation.runId,
      expectedInputHeadId: reservation.userMessageId,
      outputMessageId: reservation.reservedOutputMessageId,
      finalParts: [
        { type: "text", id: "proof-text", markdown: "Théorème cité." },
        {
          type: "citation",
          id: "proof-citation",
          citationId: "citation-0",
          ordinal: 0,
          claimPartId: "proof-text",
        },
      ],
      citations: [
        {
          ordinal: 0,
          proofHandleId: manifest.proofHandles[0]!.id,
          claimPartId: "proof-text",
        },
      ],
      usage: usage(),
      terminal: "complete",
      siblingPolicy: "create-explicit-sibling-on-head-conflict",
    });
    expect(finalized.citations).toHaveLength(1);
    const exported = await store.exportThread({
      ownerId: "corpus-user-a",
      threadId: created.thread.id,
      mode: "whole-dag",
    });
    expect(exported.manifests[0]?.proofHandles[0]?.evidenceDigest).toBe(
      sha256(text),
    );
    expect(canonicalJson(exported)).not.toContain("signedUrl");
  });

  test("rejects a citation that is not linked to an exact text claim part", async () => {
    const created = await thread();
    const reservation = await store.reserveTurn({
      ownerId: "corpus-user-a",
      threadId: created.thread.id,
      branchId: created.branch.id,
      expectedHeadMessageId: null,
      clientRequestId: `unbound-citation-${newId("request")}`,
      markdown: "Question",
      modelKey: "mock-readonly",
    });
    await expect(
      store.finalizeRun({
        ownerId: "corpus-user-a",
        runId: reservation.runId,
        expectedInputHeadId: reservation.userMessageId,
        outputMessageId: reservation.reservedOutputMessageId,
        finalParts: [
          { type: "text", id: "actual-claim", markdown: "Réponse" },
          {
            type: "citation",
            id: "unbound-citation-part",
            citationId: "unbound-citation",
            ordinal: 0,
            claimPartId: "missing-claim",
          },
        ],
        citations: [
          {
            ordinal: 0,
            proofHandleId: "missing-proof",
            claimPartId: "missing-claim",
          },
        ],
        usage: usage(),
        terminal: "complete",
        siblingPolicy: "create-explicit-sibling-on-head-conflict",
      }),
    ).rejects.toMatchObject({ code: "invalid_state" });
  });
});

describe("read-only runtime integration", () => {
  test("persists only explicitly selected proof handles and binds them to text claims", async () => {
    const subjectId = `subject-${newId("citation")}`;
    const sourceId = `source-${newId("citation")}`;
    const now = Math.floor(Date.now() / 1_000);
    await client.execute({
      sql: `INSERT INTO subjects (
          id, name, coefficient, kind, isMain, bonus, sortOrder,
          yearId, userId, createdAt, updatedAt
        ) VALUES (?, 'Biologie citée', 1, 'subject', 1, 0, 0, ?, ?, ?, ?)`,
      args: [subjectId, "corpus-year-a", "corpus-user-a", now, now],
    });
    await seedSource(client, { id: sourceId, originId: subjectId });
    const corpus = new CoreCorpusStore(client);
    const passages = [
      "La mitochondrie produit une grande partie de l’ATP cellulaire.",
      "Le noyau contient la majeure partie du génome de la cellule.",
    ];
    const staged = await corpus.stageVersion({
      identity: {
        ownerId: "corpus-user-a",
        originKind: "subject",
        originId: subjectId,
      },
      sourceId,
      versionKey: `citation-${newId("version")}`,
      contentHash: sha256(passages.join("\n")),
      extractorId: "citation-test",
      extractorVersion: "1",
      mimeType: "text/plain",
      language: "fr",
      byteSize: passages.join("\n").length,
      locatorSchemaVersion: 1,
      metadata: {},
      chunks: passages.map((text, ordinal) => ({
        ordinal,
        text,
        normalizedText: normalizeForSearch(text),
        tokenEstimate: Math.ceil(text.length / 4),
        contentHash: sha256(text),
        locator: {
          kind: "text" as const,
          startOffset: 0,
          endOffset: text.length,
        },
        headingPath: null,
        evidenceKind: "native-text" as const,
      })),
    });
    await corpus.commitVersion({
      ownerId: "corpus-user-a",
      stagingId: staged.stagingId,
      expectedSourceId: sourceId,
      expectedPreviousVersionId: null,
    });

    const created = await thread();
    const reservation = await store.reserveTurn({
      ownerId: "corpus-user-a",
      threadId: created.thread.id,
      branchId: created.branch.id,
      expectedHeadMessageId: null,
      clientRequestId: `explicit-citation-${newId("request")}`,
      markdown: "Que produit la mitochondrie ?",
      modelKey: "mock-readonly",
      attachments: [
        { kind: "subject", referenceId: subjectId, label: "Biologie citée" },
      ],
    });
    const gateway = new MockReadOnlyModelGateway();
    // SAFETY: this fixture's mock gateway emits no tool call, so the broker's
    // oRPC facade is never read or invoked during the citation-only run.
    const broker = createFirstPartyToolBroker({} as Api);
    const service = new ReadOnlyAssistantRunService(
      client,
      store,
      {
        list: async () => [MOCK_ASSISTANT_MODEL],
        resolve: async () => ({
          capability: MOCK_ASSISTANT_MODEL,
          descriptor: gateway.descriptor,
          gateway,
        }),
      },
      () => broker.registry,
    );
    await service.runNow("corpus-user-a", reservation.runId, broker);

    const detail = await store.getThreadDetail(
      "corpus-user-a",
      created.thread.id,
    );
    const manifest = detail.manifests.at(-1)!;
    expect(manifest.proofHandles).toHaveLength(2);
    const citations = detail.citations.filter(
      (citation) => citation.runId === reservation.runId,
    );
    expect(citations).toHaveLength(1);
    expect(citations[0]?.proofHandleId).toBe(manifest.proofHandles[0]?.id);
    expect(citations[0]?.proofHandleId).not.toBe(manifest.proofHandles[1]?.id);
    const output = detail.messages.find(
      (message) => message.id === reservation.reservedOutputMessageId,
    )!;
    const claim = output.parts.find(
      (part) => part.type === "text" && part.id === citations[0]?.claimPartId,
    );
    expect(claim).toMatchObject({ type: "text", markdown: passages[0] });
    expect(JSON.stringify(output.parts)).not.toContain("[[cite:");
  });

  test("reconciles restart-safe checkpoints and never replays an ambiguous provider call", async () => {
    const created = await thread();
    const reservation = await store.reserveTurn({
      ownerId: "corpus-user-a",
      threadId: created.thread.id,
      branchId: created.branch.id,
      expectedHeadMessageId: null,
      clientRequestId: `restart-ready-${newId("request")}`,
      markdown: "Recover me",
      modelKey: "mock-readonly",
    });
    const run = await store.startRun("corpus-user-a", reservation.runId);
    const boundary = await store.appendRunEvent({
      ownerId: "corpus-user-a",
      runId: run.id,
      type: "avermate.status",
      payload: { phase: "ready-to-finalize" },
    });
    const checkpointBlobs = new InMemoryCheckpointBlobStore();
    const checkpointStore = new CoreConversationCheckpointStore(
      client,
      checkpointBlobs,
    );
    const checkpoint = await checkpointStore.append({
      ownerId: "corpus-user-a",
      threadId: run.threadId,
      branchId: run.branchId,
      runId: run.id,
      inputMessageId: run.inputMessageId,
      appendKey: `restart-ready-${run.id}`,
      afterEventSequence: boundary.sequence,
      runtimeId: run.runtimeId,
      runtimeVersion: run.runtimeVersion,
      graphSchemaVersion: run.graphSchemaVersion,
      state: new TextEncoder().encode(
        canonicalJson({
          schemaVersion: 1,
          phase: "ready-to-finalize",
          finalParts: [
            {
              type: "text",
              id: newId("apart"),
              markdown: "Recovered without a second provider request.",
            },
          ],
          citations: [],
          finalUsage: {
            providerKey: "mock",
            modelKey: "mock-readonly",
            inputTokens: 1,
            outputTokens: 2,
            reasoningTokens: null,
            cachedReadTokens: null,
            cachedWriteTokens: null,
            estimatedCost: null,
            currency: null,
          },
        }),
      ),
    });
    await store.bindConversationCheckpoint({
      ownerId: "corpus-user-a",
      runId: run.id,
      checkpointId: checkpoint.id,
    });
    const gateway = new MockReadOnlyModelGateway();
    const service = new ReadOnlyAssistantRunService(
      client,
      store,
      {
        list: async () => [MOCK_ASSISTANT_MODEL],
        resolve: async () => ({
          capability: MOCK_ASSISTANT_MODEL,
          descriptor: gateway.descriptor,
          gateway,
        }),
      },
      () => createFirstPartyToolBroker({} as Api).registry,
      undefined,
      checkpointStore,
    );
    const recovered = await service.recoverInterrupted(async () => {
      throw new Error("A final checkpoint must not call a provider");
    });
    expect(recovered.finalizedFromCheckpoint).toContain(run.id);
    expect((await store.run("corpus-user-a", run.id)).status).toBe("complete");

    const ambiguousThread = await thread();
    const ambiguousReservation = await store.reserveTurn({
      ownerId: "corpus-user-a",
      threadId: ambiguousThread.thread.id,
      branchId: ambiguousThread.branch.id,
      expectedHeadMessageId: null,
      clientRequestId: `restart-ambiguous-${newId("request")}`,
      markdown: "Do not send twice",
      modelKey: "mock-readonly",
    });
    await store.startRun("corpus-user-a", ambiguousReservation.runId);
    await store.markProviderDispatch({
      ownerId: "corpus-user-a",
      runId: ambiguousReservation.runId,
      state: "dispatching",
      providerRequestKey: `assistant:${ambiguousReservation.runId}:model-stream`,
    });
    const failed = await service.recoverInterrupted(async () => {
      throw new Error("An ambiguous dispatch must not call a provider");
    });
    expect(failed.failedClosed).toContain(ambiguousReservation.runId);
    expect(
      (await store.run("corpus-user-a", ambiguousReservation.runId)).status,
    ).toBe("failed");
  });

  test("indexes a newly attached owned source before building context", async () => {
    const subjectId = `subject-${newId("lazy-index")}`;
    const now = Math.floor(Date.now() / 1_000);
    await client.execute({
      sql: `INSERT INTO subjects (
          id, name, coefficient, kind, isMain, bonus, sortOrder,
          yearId, userId, createdAt, updatedAt
        ) VALUES (?, ?, 1, 'subject', 1, 0, 0, ?, ?, ?, ?)`,
      args: [
        subjectId,
        "Physique attachée",
        "corpus-year-a",
        "corpus-user-a",
        now,
        now,
      ],
    });
    const created = await thread();
    const reservation = await store.reserveTurn({
      ownerId: "corpus-user-a",
      threadId: created.thread.id,
      branchId: created.branch.id,
      expectedHeadMessageId: null,
      clientRequestId: `lazy-index-${subjectId}`,
      markdown: "Lis la matière jointe",
      modelKey: "mock-readonly",
      attachments: [
        {
          kind: "subject",
          referenceId: subjectId,
          label: "Physique attachée",
        },
      ],
    });
    const gateway = new MockReadOnlyModelGateway();
    const broker = createFirstPartyToolBroker({} as Api);
    const service = new ReadOnlyAssistantRunService(
      client,
      store,
      {
        list: async () => [MOCK_ASSISTANT_MODEL],
        resolve: async () => ({
          capability: MOCK_ASSISTANT_MODEL,
          descriptor: gateway.descriptor,
          gateway,
        }),
      },
      () => broker.registry,
      new CorpusIndexService(client),
    );

    await service.runNow("corpus-user-a", reservation.runId, broker);

    const indexed = await client.execute({
      sql: `SELECT currentVersionId, status FROM content_sources
        WHERE userId = ? AND originKind = 'subject' AND originId = ? LIMIT 1`,
      args: ["corpus-user-a", subjectId],
    });
    expect(indexed.rows[0]?.currentVersionId).toBeTruthy();
    expect(indexed.rows[0]?.status).toBe("ready");
    const detail = await store.getThreadDetail(
      "corpus-user-a",
      created.thread.id,
    );
    expect(detail.manifests.at(-1)?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          trust: "retrieved-untrusted",
          referenceId: expect.stringMatching(/^chk_/),
        }),
      ]),
    );
    const chunks = await client.execute({
      sql: `SELECT text FROM content_chunks WHERE versionId = ?`,
      args: [String(indexed.rows[0]?.currentVersionId)],
    });
    expect(chunks.rows.map((row) => String(row.text)).join("\n")).toContain(
      "Physique attachée",
    );
  });

  test("runs the persisted tool loop through the fenced production runtime", async () => {
    const created = await thread();
    const reservation = await store.reserveTurn({
      ownerId: "corpus-user-a",
      threadId: created.thread.id,
      branchId: created.branch.id,
      expectedHeadMessageId: null,
      clientRequestId: "runtime-tool-loop",
      markdown: "Liste mes années et utilise la source jointe",
      modelKey: "mock-readonly",
      skillId: "explain-lesson",
      planMode: true,
      attachments: [
        {
          kind: "subject",
          referenceId: "corpus-subject-a",
          label: "Mathématiques",
        },
      ],
    });
    const descriptor: ModelDescriptor = {
      id: "tool-fixture",
      provider: "fixture",
      displayName: "Tool fixture",
      modalities: ["text"],
      capabilities: {
        tools: true,
        reasoningSummary: false,
        cachedUsage: false,
        structuredOutput: false,
      },
      contextWindow: 32_000,
    };
    let round = 0;
    const gateway: ModelGateway = {
      listModels: async () => [descriptor],
      stream: async function* () {
        round += 1;
        if (round === 1) {
          yield {
            type: "tool-call-start",
            callId: "call-years",
            toolName: "years.list",
          } satisfies ModelGatewayEvent;
          yield {
            type: "tool-arguments-delta",
            callId: "call-years",
            delta: "{}",
          } satisfies ModelGatewayEvent;
          yield {
            type: "tool-call-end",
            callId: "call-years",
          } satisfies ModelGatewayEvent;
          yield {
            type: "finish",
            reason: "tool-calls",
          } satisfies ModelGatewayEvent;
          return;
        }
        yield {
          type: "content-delta",
          delta: "Votre année 2026 est disponible.",
        } satisfies ModelGatewayEvent;
        yield {
          type: "usage",
          usage: {
            inputTokens: 12,
            outputTokens: 7,
            reasoningTokens: "unknown",
            cachedReadTokens: "unknown",
            cachedWriteTokens: "unknown",
          },
        } satisfies ModelGatewayEvent;
        yield { type: "finish", reason: "stop" } satisfies ModelGatewayEvent;
      },
      embed: async () => {
        throw new Error("unused");
      },
      transcribe: async () => {
        throw new Error("unused");
      },
      estimate: async () => ({
        usage: {
          inputTokens: "unknown",
          outputTokens: "unknown",
          reasoningTokens: "unknown",
          cachedReadTokens: "unknown",
          cachedWriteTokens: "unknown",
        },
        estimatedCostMinor: "unknown",
        currency: "unknown",
      }),
    };
    const api = {
      years: {
        list: async () => [
          {
            id: "corpus-year-a",
            name: "2026 A",
          },
        ],
      },
    } as unknown as Api;
    const broker = createFirstPartyToolBroker(api);
    const checkpointBlobs = new InMemoryCheckpointBlobStore();
    const checkpointStore = new CoreConversationCheckpointStore(
      client,
      checkpointBlobs,
    );
    const service = new ProductionAgentRuntime({
      client,
      conversations: store,
      gateways: {
        list: async () => [MOCK_ASSISTANT_MODEL],
        resolve: async () => ({
          capability: MOCK_ASSISTANT_MODEL,
          descriptor,
          gateway,
        }),
      },
      registryFactory: () => broker.registry,
      checkpoints: checkpointStore,
      workerId: "agent-runtime:test-tool-loop",
      leaseTtlMs: 5_000,
    });
    await service.runNow("corpus-user-a", reservation.runId, broker);
    const detail = await store.getThreadDetail(
      "corpus-user-a",
      created.thread.id,
    );
    const output = detail.messages.find(
      (message) => message.id === reservation.reservedOutputMessageId,
    );
    expect(output?.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool",
          toolId: "years.list",
          state: "complete",
        }),
        expect.objectContaining({
          type: "text",
          markdown: expect.stringContaining("2026"),
        }),
      ]),
    );
    expect(detail.manifests.length).toBeGreaterThanOrEqual(2);
    expect(detail.manifests.at(-1)?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ referenceId: "skill:explain-lesson@1" }),
        expect.objectContaining({ trust: "tool-result" }),
      ]),
    );
    const events = await store.replayEvents({
      ownerId: "corpus-user-a",
      runId: reservation.runId,
    });
    expect(
      events.some((event) => event.type === "avermate.todo.snapshot"),
    ).toBe(true);
    expect(events.some((event) => event.type === "tool.result")).toBe(true);
    const completedRun = detail.runs.find(
      (run) => run.id === reservation.runId,
    );
    expect(completedRun?.providerDispatchState).toBe("completed");
    expect(completedRun?.conversationCheckpointRef).toMatch(/^ackp_/);
    const frozen = await client.execute({
      sql: `SELECT runtimeId, runtimeVersion, policyRevision,
          toolCatalogRevision, contextManifestDigest, branchIdentityDigest
        FROM assistant_runs WHERE id = ? AND userId = ? LIMIT 1`,
      args: [reservation.runId, "corpus-user-a"],
    });
    expect(frozen.rows[0]).toMatchObject({
      runtimeId: PRODUCTION_AGENT_RUNTIME_ID,
      runtimeVersion: PRODUCTION_AGENT_RUNTIME_VERSION,
      policyRevision: PRODUCTION_AGENT_POLICY_REVISION,
      toolCatalogRevision: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      contextManifestDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      branchIdentityDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    const dispatchClaims = await client.execute({
      sql: `SELECT dispatchKey, providerKey, modelKey, state
        FROM assistant_provider_dispatch_claims
        WHERE runId = ? AND userId = ? ORDER BY dispatchKey`,
      args: [reservation.runId, "corpus-user-a"],
    });
    expect(dispatchClaims.rows).toHaveLength(2);
    expect(dispatchClaims.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dispatchKey: "model-round:0:attempt:0",
          state: "completed",
        }),
        expect.objectContaining({
          dispatchKey: "model-round:1:attempt:0",
          state: "completed",
        }),
      ]),
    );
    expect(
      dispatchClaims.rows.every(
        (claim) =>
          claim.providerKey === MOCK_ASSISTANT_MODEL.providerKey &&
          claim.modelKey === MOCK_ASSISTANT_MODEL.modelKey,
      ),
    ).toBe(true);
    const leases = await client.execute({
      sql: `SELECT state, releasedAt FROM assistant_run_leases
        WHERE runId = ? AND userId = ?`,
      args: [reservation.runId, "corpus-user-a"],
    });
    expect(leases.rows).toHaveLength(1);
    expect(leases.rows[0]).toMatchObject({
      state: "released",
      releasedAt: expect.any(Number),
    });
    const checkpoints = await checkpointStore.listForBranch({
      ownerId: "corpus-user-a",
      branchId: created.branch.id,
    });
    expect(checkpoints.length).toBeGreaterThanOrEqual(3);
    expect(
      new TextDecoder().decode(
        await checkpointStore.readState({
          ownerId: "corpus-user-a",
          checkpointId: completedRun!.conversationCheckpointRef!,
        }),
      ),
    ).toContain('"phase":"ready-to-finalize"');
  });
});
