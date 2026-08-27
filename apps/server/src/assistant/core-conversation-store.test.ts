import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Client } from "@libsql/client";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import sharp from "sharp";
import { newId } from "../lib/id";
import { CoreCorpusStore } from "../search/core-corpus-store";
import { CorpusIndexService } from "../search/index-service";
import { createCorpusTestDatabase, seedSource } from "../search/test-helpers";
import {
  canonicalJson,
  jsonValue,
  normalizeForSearch,
  sha256,
} from "../search/values";
import { AssistantContextManifestService } from "./context-manifest";
import type {
  CommittedVersionRef,
  ModelDescriptor,
  ModelGateway,
  ModelGatewayEvent,
  OwnedLexicalQuery,
  OwnedSourceIdentity,
  RerankProvider,
  StagedContentChunk,
} from "@avermate/agent-contracts";
import type { Api } from "../mcp/shared";
import { createFirstPartyToolBroker } from "../tools/first-party";
import {
  PRODUCTION_AGENT_POLICY_REVISION,
  PRODUCTION_AGENT_RUNTIME_ID,
  PRODUCTION_AGENT_RUNTIME_VERSION,
  ProductionAgentRuntime,
} from "../agent/production-runtime";
import { AiSdkDirectGateway } from "../agent/model-gateways";
import {
  ContextAssetHandleService,
  OwnedFileContextAssetResolver,
  type PreparedContextCitation,
} from "../agent/multimodal-context";
import type { OwnedStoredFile } from "../lib/owned-file-storage";
import {
  contextualRetrievalQuery,
  MockReadOnlyModelGateway,
  packConversationHistory,
  ReadOnlyAssistantRunService,
} from "./run-service";
import { hybridCorpusSearch, type HybridSearchResult } from "../search/hybrid";
import { SqliteFts5LexicalSearchBackend } from "../search/lexical";
import { RoutedCorpusStore } from "../search/routed-corpus-store";
import type { CorpusVectorRuntime } from "../search/vector-runtime";
import { MOCK_ASSISTANT_MODEL } from "./catalogue";
import {
  ConversationStoreError,
  CoreConversationStore,
  type AssistantSqlClient,
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

async function studyProject(input: {
  id: string;
  ownerId?: string;
  instructions?: string | null;
  advanced?: boolean;
}) {
  const ownerId = input.ownerId ?? "corpus-user-a";
  const now = Math.floor(Date.now() / 1_000);
  await client.execute({
    sql: `INSERT INTO study_projects
      (id, userId, title, description, instructionsMarkdown,
       contextPolicyVersion, contextPolicyJson, retrievalMode,
       retrievalFallbackPolicy, embeddingSpaceId, rerankSpaceId,
       createdAt, updatedAt)
      VALUES (?, ?, ?, '', ?, 1, ?, ?, 'lexical-only', ?, ?, ?, ?)`,
    args: [
      input.id,
      ownerId,
      `Projet ${input.id}`,
      input.instructions ?? null,
      JSON.stringify({
        sourceSelection: "project-items",
        extractedInstructionsTrusted: false,
      }),
      input.advanced ? "advanced-auto" : "lexical-only",
      input.advanced ? "test-embedding-space" : null,
      input.advanced ? "test-rerank-space" : null,
      now,
      now,
    ],
  });
  return input.id;
}

async function publishLexicalVersion(input: {
  corpus: CoreCorpusStore;
  identity: OwnedSourceIdentity;
  committed: CommittedVersionRef;
  chunks: readonly StagedContentChunk[];
}) {
  const source = await input.corpus.getSource(input.identity);
  if (!source) throw new Error("Test source missing after commit");
  await new SqliteFts5LexicalSearchBackend(client).upsertVersion({
    ownerId: input.identity.ownerId,
    source,
    version: await input.corpus.resolveVersion(input.committed),
    chunks: [...input.chunks],
  });
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

  test("keeps one immutable attachment snapshot when competing freezes observe different heads", async () => {
    const ownerId = "corpus-user-a";
    const subjectId = `subject-${newId("freeze-cas")}`;
    const sourceId = `source-${newId("freeze-cas")}`;
    const now = Math.floor(Date.now() / 1_000);
    await client.execute({
      sql: `INSERT INTO subjects (
          id, name, coefficient, kind, isMain, bonus, sortOrder,
          yearId, userId, createdAt, updatedAt
        ) VALUES (?, 'Freeze CAS', 1, 'subject', 1, 0, 0, ?, ?, ?, ?)`,
      args: [subjectId, "corpus-year-a", ownerId, now, now],
    });
    await seedSource(client, {
      id: sourceId,
      originId: subjectId,
      subjectId,
    });
    const created = await thread(ownerId);
    const reservation = await store.reserveTurn({
      ownerId,
      threadId: created.thread.id,
      branchId: created.branch.id,
      expectedHeadMessageId: null,
      clientRequestId: `freeze-cas-${newId("request")}`,
      markdown: "Fige cette source.",
      modelKey: "mock-readonly",
      attachments: [
        {
          kind: "subject",
          referenceId: subjectId,
          snapshotVersion: null,
          label: "Freeze CAS",
        },
      ],
    });
    const attachmentResult = await client.execute({
      sql: `SELECT id, snapshotVersion FROM assistant_attachments
        WHERE messageId = ? LIMIT 1`,
      args: [reservation.userMessageId],
    });
    const attachmentId = String(attachmentResult.rows[0]!.id);
    expect(attachmentResult.rows[0]?.snapshotVersion).toBeNull();

    const corpus = new CoreCorpusStore(client);
    const identity: OwnedSourceIdentity = {
      ownerId,
      originKind: "subject",
      originId: subjectId,
    };
    const commit = async (label: string, previous: string | null) => {
      const text = `Version ${label}`;
      const chunks: StagedContentChunk[] = [
        {
          ordinal: 0,
          text,
          normalizedText: normalizeForSearch(text),
          tokenEstimate: 3,
          contentHash: sha256(text),
          locator: { kind: "text", startOffset: 0, endOffset: text.length },
          headingPath: null,
          evidenceKind: "native-text",
        },
      ];
      const staged = await corpus.stageVersion({
        identity,
        sourceId,
        versionKey: `freeze-${label}-${newId("version")}`,
        contentHash: sha256(text),
        extractorId: "freeze-cas-test",
        extractorVersion: "1",
        mimeType: "text/plain",
        language: "fr",
        byteSize: text.length,
        locatorSchemaVersion: 1,
        metadata: {},
        chunks,
      });
      return corpus.commitVersion({
        ownerId,
        stagingId: staged.stagingId,
        expectedSourceId: sourceId,
        expectedPreviousVersionId: previous,
      });
    };
    const versionN = await commit("N", null);
    const versionN1 = await commit("N+1", versionN.versionId);

    const competing = await Promise.all([
      store.freezeAttachmentSnapshot({
        ownerId,
        attachmentId,
        expectedVersionId: versionN.versionId,
      }),
      store.freezeAttachmentSnapshot({
        ownerId,
        attachmentId,
        expectedVersionId: versionN1.versionId,
      }),
    ]);
    expect(competing).toEqual([versionN.versionId, versionN.versionId]);
    const frozen = await client.execute({
      sql: `SELECT snapshotVersion FROM assistant_attachments WHERE id = ?`,
      args: [attachmentId],
    });
    expect(frozen.rows[0]?.snapshotVersion).toBe(versionN.versionId);
    const references = await client.execute({
      sql: `SELECT sourceVersionId FROM content_version_references
        WHERE ownerKind = 'assistant-citation' AND ownerId = ?`,
      args: [attachmentId],
    });
    expect(references.rows.map((row) => row.sourceVersionId)).toEqual([
      versionN.versionId,
    ]);
  });

  test("validates project ownership at creation and lists threads by owned project", async () => {
    const projectA = await studyProject({
      id: `project-a-${newId("thread-scope")}`,
    });
    const projectB = await studyProject({
      id: `project-b-${newId("thread-scope")}`,
      ownerId: "corpus-user-b",
    });
    const scoped = await store.createThread({
      ownerId: "corpus-user-a",
      title: "Chat du projet",
      projectId: projectA,
    });
    await store.createThread({
      ownerId: "corpus-user-a",
      title: "Chat personnel",
    });

    await expect(
      store.createThread({
        ownerId: "corpus-user-a",
        title: "Projet étranger",
        projectId: projectB,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });

    const listed = await store.listThreads({
      ownerId: "corpus-user-a",
      projectId: projectA,
      includeArchived: true,
      limit: 100,
    });
    expect(listed.items.map((item) => item.thread.id)).toEqual([
      scoped.thread.id,
    ]);
    expect(listed.items[0]?.thread.projectId).toBe(projectA);

    await client.execute({
      sql: `UPDATE assistant_threads SET updatedAt = 1 WHERE id = ?`,
      args: [scoped.thread.id],
    });
    const now = Math.floor(Date.now() / 1_000);
    const newerThreadCount = 100;
    await client.batch(
      Array.from({ length: newerThreadCount }, (_, index) => ({
        sql: `INSERT INTO assistant_threads
          (id, userId, title, revision, projectId, placement, createdAt, updatedAt)
          VALUES (?, ?, ?, 1, ?, 'core', ?, ?)`,
        args: [
          `athr_project_scale_${String(index).padStart(3, "0")}`,
          "corpus-user-a",
          `Conversation ${index + 1}`,
          projectA,
          now + index,
          now + index,
        ],
      })),
      "write",
    );
    // The original conversation is now the oldest of 101. It must remain
    // directly addressable even though the presentation query returns 100.
    expect(newerThreadCount + 1).toBe(101);
    const bounded = await store.listThreads({
      ownerId: "corpus-user-a",
      projectId: projectA,
      includeArchived: true,
      limit: 100,
    });
    expect(bounded.items).toHaveLength(100);
    expect(
      bounded.items.some((item) => item.thread.id === scoped.thread.id),
    ).toBe(false);
    await expect(
      store.getThreadDetail(
        "corpus-user-a",
        scoped.thread.id,
        undefined,
        projectA,
      ),
    ).resolves.toMatchObject({ thread: { id: scoped.thread.id } });
    await expect(
      store.getThreadDetail(
        "corpus-user-a",
        scoped.thread.id,
        undefined,
        projectB,
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  test("revalidates purge eligibility atomically when restore wins after the maintenance scan", async () => {
    const ownerId = "corpus-user-a";
    const created = await thread(ownerId);
    const trashed = await store.trashThread({
      ownerId,
      threadId: created.thread.id,
      expectedRevision: created.thread.revision,
      retentionDays: 1,
    });
    await client.execute({
      sql: `UPDATE assistant_threads SET purgeAfter = 0 WHERE id = ?`,
      args: [created.thread.id],
    });
    let restoreInjected = false;
    const racingClient: AssistantSqlClient = {
      execute: async (input) => {
        const result = await client.execute(input);
        if (
          !restoreInjected &&
          typeof input !== "string" &&
          input.sql.includes(
            "SELECT id FROM assistant_threads WHERE deletedAt IS NOT NULL",
          )
        ) {
          restoreInjected = true;
          await store.restoreThread({
            ownerId,
            threadId: created.thread.id,
            expectedRevision: trashed.revision,
          });
        }
        return result;
      },
      batch: client.batch.bind(client),
      transaction: client.transaction.bind(client),
    };
    const racingStore = new CoreConversationStore(racingClient);

    expect(await racingStore.purgeExpired(ownerId)).toEqual([]);
    expect(restoreInjected).toBe(true);
    await expect(
      store.getThreadDetail(ownerId, created.thread.id),
    ).resolves.toMatchObject({
      thread: { id: created.thread.id, deletedAt: null },
    });
  });

  test("rejects corpus snapshot ids on attachment kinds without corpus snapshot semantics", async () => {
    const ownerId = "corpus-user-a";
    const created = await thread(ownerId);
    for (const kind of ["task", "project", "year"] as const) {
      await expect(
        store.reserveTurn({
          ownerId,
          threadId: created.thread.id,
          branchId: created.branch.id,
          expectedHeadMessageId: null,
          clientRequestId: `invalid-${kind}-${newId("request")}`,
          markdown: "Snapshot invalide",
          modelKey: "mock-readonly",
          attachments: [
            {
              kind,
              referenceId: `${kind}-${newId("foreign-reference")}`,
              snapshotVersion: `cver-${newId("foreign-snapshot")}`,
              label: "Snapshot mensonger",
            },
          ],
        }),
      ).rejects.toMatchObject({ code: "invalid_state" });
    }
    const detail = await store.getThreadDetail(ownerId, created.thread.id);
    expect(detail.messages).toHaveLength(0);
    expect(detail.attachments).toHaveLength(0);
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
        snapshots.set(
          input.snapshot.detail.thread.id,
          structuredClone(input.snapshot),
        );
        return input.snapshot;
      },
      list: async () => [],
      get: async ({ threadId }) => {
        const snapshot = snapshots.get(threadId);
        return snapshot
          ? {
              detail: structuredClone(snapshot.detail),
              events: structuredClone(snapshot.events),
            }
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
      await routed.cancelRun("corpus-user-a", String(pendingRun.rows[0].id));
    }
  });

  test("syncs a post-index attachment freeze to Node and reconciles an interrupted relay write", async () => {
    const ownerId = "corpus-user-a";
    const subjectId = `subject-${newId("node-freeze")}`;
    const sourceId = `source-${newId("node-freeze")}`;
    const now = Math.floor(Date.now() / 1_000);
    await client.execute({
      sql: `INSERT INTO subjects (
          id, name, coefficient, kind, isMain, bonus, sortOrder,
          yearId, userId, createdAt, updatedAt
        ) VALUES (?, 'Node freeze', 1, 'subject', 1, 0, 0, ?, ?, ?, ?)`,
      args: [subjectId, "corpus-year-a", ownerId, now, now],
    });
    await seedSource(client, {
      id: sourceId,
      originId: subjectId,
      subjectId,
    });
    const snapshots = new Map<string, NodeConversationDagSnapshot>();
    let rejectImports = false;
    const relay: ConversationDagRelay = {
      selectedNode: async () => "node-attachment-freeze",
      assertOnline: async () => undefined,
      import: async (input) => {
        if (rejectImports) throw new Error("INJECTED_FREEZE_SYNC_FAILURE");
        snapshots.set(
          input.snapshot.detail.thread.id,
          structuredClone(input.snapshot),
        );
        return input.snapshot;
      },
      list: async () => [],
      get: async ({ threadId }) => {
        const snapshot = snapshots.get(threadId);
        return snapshot ? structuredClone(snapshot) : null;
      },
      delete: async ({ threadId }) => ({
        deleted: snapshots.delete(threadId),
      }),
    };
    const routed = new RoutedConversationStore(
      client,
      relay,
      "test-only-node-attachment-freeze-secret-000001",
    );
    const created = await routed.createThread({
      ownerId,
      title: "Node attachment freeze",
      placement: "node",
    });
    const reservation = await routed.reserveTurn({
      ownerId,
      threadId: created.thread.id,
      branchId: created.branch.id,
      expectedHeadMessageId: null,
      clientRequestId: `node-freeze-${newId("request")}`,
      markdown: "Fige après indexation.",
      modelKey: "mock-readonly",
      attachments: [
        {
          kind: "subject",
          referenceId: subjectId,
          snapshotVersion: null,
          label: "Node freeze",
        },
      ],
    });
    const attachmentRow = await client.execute({
      sql: `SELECT id, snapshotVersion FROM assistant_attachments
        WHERE messageId = ? LIMIT 1`,
      args: [reservation.userMessageId],
    });
    const attachmentId = String(attachmentRow.rows[0]!.id);
    expect(attachmentRow.rows[0]?.snapshotVersion).toBeNull();

    const corpus = new CoreCorpusStore(client);
    const text = "Version figée après indexation Node";
    const chunks: StagedContentChunk[] = [
      {
        ordinal: 0,
        text,
        normalizedText: normalizeForSearch(text),
        tokenEstimate: Math.ceil(text.length / 4),
        contentHash: sha256(text),
        locator: { kind: "text", startOffset: 0, endOffset: text.length },
        headingPath: null,
        evidenceKind: "native-text",
      },
    ];
    const staged = await corpus.stageVersion({
      identity: { ownerId, originKind: "subject", originId: subjectId },
      sourceId,
      versionKey: `node-freeze-${newId("version")}`,
      contentHash: sha256(text),
      extractorId: "node-freeze-test",
      extractorVersion: "1",
      mimeType: "text/plain",
      language: "fr",
      byteSize: text.length,
      locatorSchemaVersion: 1,
      metadata: {},
      chunks,
    });
    const committed = await corpus.commitVersion({
      ownerId,
      stagingId: staged.stagingId,
      expectedSourceId: sourceId,
      expectedPreviousVersionId: null,
    });

    rejectImports = true;
    await expect(
      routed.freezeAttachmentSnapshot({
        ownerId,
        attachmentId,
        expectedVersionId: committed.versionId,
      }),
    ).rejects.toMatchObject({ code: "placement_unavailable" });
    const coreFrozen = await client.execute({
      sql: `SELECT snapshotVersion FROM assistant_attachments WHERE id = ?`,
      args: [attachmentId],
    });
    expect(coreFrozen.rows[0]?.snapshotVersion).toBe(committed.versionId);
    expect(
      snapshots
        .get(created.thread.id)
        ?.detail.attachments.find((item) => item.id === attachmentId)
        ?.snapshotVersion,
    ).toBeNull();

    rejectImports = false;
    expect(await routed.reconcileNode("node-attachment-freeze")).toContainEqual(
      {
        threadId: created.thread.id,
        outcome: "synced",
      },
    );
    expect(
      snapshots
        .get(created.thread.id)
        ?.detail.attachments.find((item) => item.id === attachmentId)
        ?.snapshotVersion,
    ).toBe(committed.versionId);
    await routed.cancelRun(ownerId, reservation.runId);
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
        snapshots.set(
          input.snapshot.detail.thread.id,
          structuredClone(input.snapshot),
        );
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
  test("rejects a manifest whose text and media breakdown understates used tokens", async () => {
    const created = await thread();
    const reservation = await store.reserveTurn({
      ownerId: "corpus-user-a",
      threadId: created.thread.id,
      branchId: created.branch.id,
      expectedHeadMessageId: null,
      clientRequestId: `bad-media-budget-${newId("request")}`,
      markdown: "Budget",
      modelKey: "mock-readonly",
    });
    await expect(
      new AssistantContextManifestService(client).commit({
        ownerId: "corpus-user-a",
        runId: reservation.runId,
        budget: {
          maxTokens: 16_000,
          usedTokens: 1_000,
          reservedOutputTokens: 2_000,
          textTokens: 600,
          mediaTokens: 8_192,
          estimationPolicy: "utf8-text-plus-conservative-media-v1",
        },
        items: [],
        evidence: [],
      }),
    ).rejects.toThrow("token breakdown is inconsistent");
  });

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
  test("inherits project policy, packs branch history and retrieves a far attached chunk through the hybrid kernel", async () => {
    const subjectId = `subject-${newId("far-context")}`;
    const sourceId = `source-${newId("far-context")}`;
    const projectId = await studyProject({
      id: `project-${newId("advanced-context")}`,
      instructions: "Réponds en français et distingue toujours les preuves.",
      advanced: true,
    });
    const now = Math.floor(Date.now() / 1_000);
    await client.execute({
      sql: `INSERT INTO subjects (
          id, name, coefficient, kind, isMain, bonus, sortOrder,
          yearId, userId, createdAt, updatedAt
        ) VALUES (?, 'Document lointain', 1, 'subject', 1, 0, 0, ?, ?, ?, ?)`,
      args: [subjectId, "corpus-year-a", "corpus-user-a", now, now],
    });
    await seedSource(client, {
      id: sourceId,
      originId: subjectId,
      subjectId,
    });
    const corpus = new CoreCorpusStore(client);
    const chunks = Array.from({ length: 31 }, (_, ordinal) => {
      const text =
        ordinal === 30
          ? "Le xylophore tardif désigne la preuve située après les vingt-quatre premiers passages."
          : `Passage ${ordinal} sans le terme cible du test.`;
      return {
        ordinal,
        text,
        normalizedText: normalizeForSearch(text),
        tokenEstimate: Math.ceil(text.length / 4),
        contentHash: sha256(text),
        locator:
          ordinal === 30
            ? { kind: "pdf" as const, page: 31 }
            : {
                kind: "text" as const,
                startOffset: ordinal * 100,
                endOffset: ordinal * 100 + text.length,
              },
        headingPath: null,
        evidenceKind:
          ordinal === 30 ? ("visual-only" as const) : ("native-text" as const),
      };
    });
    const identity = {
      ownerId: "corpus-user-a",
      originKind: "subject" as const,
      originId: subjectId,
    };
    const staged = await corpus.stageVersion({
      identity,
      sourceId,
      versionKey: `far-context-${newId("version")}`,
      contentHash: sha256(chunks.map((chunk) => chunk.text).join("\n")),
      extractorId: "far-context-test",
      extractorVersion: "1",
      mimeType: "application/pdf",
      language: "fr",
      byteSize: chunks.reduce((sum, chunk) => sum + chunk.text.length, 0),
      locatorSchemaVersion: 1,
      metadata: {},
      chunks,
    });
    const committed = await corpus.commitVersion({
      ownerId: identity.ownerId,
      stagingId: staged.stagingId,
      expectedSourceId: sourceId,
      expectedPreviousVersionId: null,
    });
    await publishLexicalVersion({ corpus, identity, committed, chunks });
    const farChunkId = String(
      (
        await client.execute({
          sql: `SELECT id FROM content_chunks
            WHERE versionId = ? AND ordinal = 30 LIMIT 1`,
          args: [committed.versionId],
        })
      ).rows[0]!.id,
    );
    const visualFileId = `file-${newId("visual-context")}`;
    const visualDerivativeId = `cder-${newId("visual-context")}`;
    const visualDigest = "a".repeat(64);
    await client.batch(
      [
        {
          sql: `INSERT INTO files
            (id, provider, storageKey, url, mimeType, byteSize, purpose,
             status, previewStatus, userId, createdAt, updatedAt)
            VALUES (?, 'local', ?, ?, 'image/png', 128, 'preview',
              'stored', 'ready', ?, ?, ?)`,
          args: [
            visualFileId,
            `visual-context/${visualFileId}`,
            `/files/${visualFileId}`,
            identity.ownerId,
            now,
            now,
          ],
        },
        {
          sql: `INSERT INTO content_derivatives
            (id, versionId, chunkId, fileId, kind, status,
             locatorSchemaVersion, locatorJson, contentHash, mimeType,
             byteSize, estimatedInputTokens, rendererProfile,
             rendererImageDigest, metadataJson, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, 'page-image', 'ready', 1, ?, ?,
              'image/png', 128, 32, 'test-page-renderer', ?, '{}', ?, ?)`,
          args: [
            visualDerivativeId,
            committed.versionId,
            farChunkId,
            visualFileId,
            canonicalJson({ kind: "pdf", page: 31 }),
            visualDigest,
            `sha256:${"b".repeat(64)}`,
            now,
            now,
          ],
        },
      ],
      "write",
    );

    const created = await store.createThread({
      ownerId: identity.ownerId,
      title: "Révision avancée",
      projectId,
    });
    const capturedRequests: Array<Parameters<ModelGateway["stream"]>[0]> = [];
    const baseGateway = new MockReadOnlyModelGateway();
    const multimodalDescriptor: ModelDescriptor = {
      ...baseGateway.descriptor,
      modalities: ["text", "image"],
    };
    const gateway: ModelGateway = {
      listModels: () => baseGateway.listModels(),
      stream: async function* (request) {
        capturedRequests.push(request);
        yield* baseGateway.stream(request);
      },
      embed: () => baseGateway.embed(),
      transcribe: () => baseGateway.transcribe(),
      estimate: () => baseGateway.estimate(),
    };
    const retrievalCalls: Array<{
      input: Parameters<typeof hybridCorpusSearch>[0];
      policyProjectIds: readonly string[];
    }> = [];
    const broker = createFirstPartyToolBroker({} as Api);
    const contextAssetCapture: { assetId: string | null } = { assetId: null };
    const service = new ReadOnlyAssistantRunService(
      client,
      store,
      {
        list: async () => [MOCK_ASSISTANT_MODEL],
        resolve: async () => ({
          capability: MOCK_ASSISTANT_MODEL,
          descriptor: multimodalDescriptor,
          gateway,
          contextMediaDelivery: "server-resolved",
        }),
      },
      () => broker.registry,
      undefined,
      undefined,
      new SqliteFts5LexicalSearchBackend(client),
      async (input, options) => {
        retrievalCalls.push({
          input,
          policyProjectIds: [...(options.policyProjectIds ?? [])],
        });
        return hybridCorpusSearch(input, {
          ...options,
          runtime: null,
          reranker: null,
          persistTrace: false,
        });
      },
      {
        mint: async ({ assetId }) => {
          contextAssetCapture.assetId = assetId;
          return `cah1.${"A".repeat(32)}` as import("@avermate/agent-contracts").ContextAssetHandle;
        },
      },
    );

    const first = await store.reserveTurn({
      ownerId: identity.ownerId,
      threadId: created.thread.id,
      branchId: created.branch.id,
      expectedHeadMessageId: null,
      clientRequestId: `history-first-${newId("request")}`,
      markdown: "Mémorise que mon repère de travail est BLEU-ALPHA.",
      modelKey: "mock-readonly",
    });
    await service.runNow(identity.ownerId, first.runId, broker);
    const second = await store.reserveTurn({
      ownerId: identity.ownerId,
      threadId: created.thread.id,
      branchId: created.branch.id,
      expectedHeadMessageId: first.reservedOutputMessageId,
      clientRequestId: `history-second-${newId("request")}`,
      markdown: "Que signifie xylophore tardif dans la source jointe ?",
      modelKey: "mock-readonly",
      attachments: [
        { kind: "subject", referenceId: subjectId, label: "Source longue" },
      ],
    });
    await service.runNow(identity.ownerId, second.runId, broker);

    expect(retrievalCalls).toHaveLength(3);
    expect(retrievalCalls[0]).toMatchObject({
      input: { projectIds: [projectId] },
      policyProjectIds: [projectId],
    });
    expect(retrievalCalls[1]).toMatchObject({
      input: {
        projectIds: [projectId],
        contextAccess: "automatic",
      },
      policyProjectIds: [projectId],
    });
    expect(retrievalCalls[2]).toMatchObject({
      input: {
        projectIds: [],
        sourceIds: [sourceId],
        versionIds: [committed.versionId],
        contextAccess: "explicit-attachment",
      },
      policyProjectIds: [projectId],
    });
    const secondRequest = capturedRequests[1]!;
    const policy = secondRequest.messages.find(
      (block) =>
        block.mediaType === "application/vnd.avermate.project-policy+json",
    );
    expect(policy?.content).toContain('"inheritedFromThread":true');
    expect(policy?.content).toContain('"mode":"advanced-auto"');
    expect(
      secondRequest.messages.some(
        (block) =>
          block.sourceRef === `project:${projectId}` &&
          block.content.includes("Réponds en français"),
      ),
    ).toBe(true);
    const history = secondRequest.messages.find(
      (block) =>
        block.mediaType ===
        "application/vnd.avermate.conversation-history+json",
    );
    expect(history?.content).toContain("BLEU-ALPHA");
    expect(history?.content).toContain('"role":"assistant"');
    expect(
      secondRequest.messages
        .filter((block) => block.trust === "retrieved-untrusted")
        .map((block) => block.sourceRef),
    ).toContain(farChunkId);
    const visualEvidence = secondRequest.messages.find(
      (block) => block.sourceRef === farChunkId,
    );
    expect(visualEvidence?.parts).toMatchObject([
      { type: "text", evidence: { chunkId: farChunkId } },
      {
        type: "image",
        mime: "image/png",
        evidence: {
          chunkId: farChunkId,
          locator: { kind: "pdf", page: 31 },
          digest: visualDigest,
        },
      },
    ]);
    expect(contextAssetCapture.assetId).toBe(visualDerivativeId);
    const retrievalMetadata = secondRequest.messages.find(
      (block) =>
        block.mediaType === "application/vnd.avermate.retrieval-run+json",
    );
    expect(retrievalMetadata?.content).toContain(
      '"fallbackReason":"dense:dense-provider-unavailable"',
    );

    const exactHistory = await store.historyBeforeMessage(
      identity.ownerId,
      created.thread.id,
      second.userMessageId,
    );
    const packedA = packConversationHistory(exactHistory, 700);
    const packedB = packConversationHistory(exactHistory, 700);
    expect(packedA).toEqual(packedB);
    expect(
      new TextEncoder().encode(packedA!.content).byteLength,
    ).toBeLessThanOrEqual(700);
    expect(packedA?.messageIds.at(-1)).toBe(first.reservedOutputMessageId);
    const followUp = contextualRetrievalQuery({
      question: "Et pourquoi la deuxième échoue ici ?",
      history: exactHistory,
      projectTitles: ["Révision avancée"],
    });
    expect(followUp.originalQuery).toBe("Et pourquoi la deuxième échoue ici ?");
    expect(followUp.resolvedQuery).toContain("BLEU-ALPHA");
    expect(followUp.resolvedQuery).toContain("Révision avancée");
    expect(followUp.previousUserMessageIds).toContain(first.userMessageId);
    expect(followUp.queryDigest).toBe(sha256(followUp.resolvedQuery));

    // A paired Node may advertise image input, but Core-issued context handles
    // are intentionally not relayable. A frozen Core fallback still causes the
    // exact visual evidence to be prepared once; per-attempt projection keeps
    // the primary Node request text-only and hides the handle.
    const nodeRequests: Array<Parameters<ModelGateway["stream"]>[0]> = [];
    let nodeHandleMinted = false;
    const nodeLikeService = new ReadOnlyAssistantRunService(
      client,
      store,
      {
        list: async () => [MOCK_ASSISTANT_MODEL],
        resolve: async () => ({
          capability: MOCK_ASSISTANT_MODEL,
          descriptor: multimodalDescriptor,
          gateway: {
            ...gateway,
            stream: async function* (request) {
              nodeRequests.push(request);
              yield* baseGateway.stream(request);
            },
          },
          modelPlacement: {
            kind: "node" as const,
            nodeId: "paired-node-1",
            capabilityRevision: "revision-1",
          },
          fallbackSelections: [
            {
              capability: MOCK_ASSISTANT_MODEL,
              descriptor: multimodalDescriptor,
              gateway,
              contextMediaDelivery: "server-resolved" as const,
              modelPlacement: {
                kind: "core" as const,
                instanceId: "core-fallback",
              },
            },
          ],
        }),
      },
      () => broker.registry,
      undefined,
      undefined,
      new SqliteFts5LexicalSearchBackend(client),
      (input, options) =>
        hybridCorpusSearch(input, {
          ...options,
          runtime: null,
          reranker: null,
          persistTrace: false,
        }),
      {
        async mint() {
          nodeHandleMinted = true;
          return `cah1.${"N".repeat(32)}` as import("@avermate/agent-contracts").ContextAssetHandle;
        },
      },
    );
    const nodeTurn = await store.reserveTurn({
      ownerId: identity.ownerId,
      threadId: created.thread.id,
      branchId: created.branch.id,
      expectedHeadMessageId: second.reservedOutputMessageId,
      clientRequestId: `history-node-${newId("request")}`,
      markdown: "Rappelle la définition de xylophore tardif.",
      modelKey: "mock-readonly",
      attachments: [
        { kind: "subject", referenceId: subjectId, label: "Source longue" },
      ],
    });
    await nodeLikeService.runNow(identity.ownerId, nodeTurn.runId, broker);
    const nodeEvidence = nodeRequests[0]?.messages.find(
      (block) => block.sourceRef === farChunkId,
    );
    expect(nodeHandleMinted).toBe(true);
    expect(nodeEvidence?.parts).toMatchObject([
      { type: "text", evidence: { chunkId: farChunkId } },
    ]);
    expect(JSON.stringify(nodeEvidence)).not.toContain("cah1.");
    expect(nodeEvidence?.content).toContain("xylophore tardif");

    const third = await store.reserveTurn({
      ownerId: identity.ownerId,
      threadId: created.thread.id,
      branchId: created.branch.id,
      expectedHeadMessageId: nodeTurn.reservedOutputMessageId,
      clientRequestId: `history-third-${newId("request")}`,
      markdown: "Et pourquoi la deuxième échoue ici ?",
      modelKey: "mock-readonly",
    });
    await service.runNow(identity.ownerId, third.runId, broker);
    expect(retrievalCalls).toHaveLength(4);
    const contextualInput = retrievalCalls[3]!.input;
    expect(contextualInput.query).toContain(
      "Rappelle la définition de xylophore tardif.",
    );
    expect(contextualInput.query).toContain(
      "Et pourquoi la deuxième échoue ici ?",
    );
    const thirdRetrievalMetadata = capturedRequests[2]!.messages.find(
      (block) =>
        block.mediaType === "application/vnd.avermate.retrieval-run+json",
    );
    expect(thirdRetrievalMetadata?.content).toContain(
      '\"original\":\"Et pourquoi la deuxième échoue ici ?\"',
    );
    expect(thirdRetrievalMetadata?.content).toContain(
      '\"policy\":\"deterministic-conversation-window-v1\"',
    );
    expect(thirdRetrievalMetadata?.content).toContain(
      `\"digest\":\"${sha256(contextualInput.query)}\"`,
    );
  });

  test("fails closed when a global attachment snapshot is unavailable and gives the model an unambiguous instruction", async () => {
    const ownerId = "corpus-user-a";
    const subjectId = `subject-${newId("unavailable-attachment")}`;
    const now = Math.floor(Date.now() / 1_000);
    await client.execute({
      sql: `INSERT INTO subjects (
          id, name, coefficient, kind, isMain, bonus, sortOrder,
          yearId, userId, createdAt, updatedAt
        ) VALUES (?, 'Pièce indisponible', 1, 'subject', 1, 0, 0, ?, ?, ?, ?)`,
      args: [subjectId, "corpus-year-a", ownerId, now, now],
    });
    const attachedSourceId = `source-${newId("attached-snapshot")}`;
    const foreignSourceId = `source-${newId("foreign-snapshot")}`;
    const foreignOriginId = `different-${newId("snapshot-origin")}`;
    await seedSource(client, {
      id: attachedSourceId,
      originId: subjectId,
      subjectId,
    });
    await seedSource(client, {
      id: foreignSourceId,
      originId: foreignOriginId,
    });
    const corpus = new CoreCorpusStore(client);
    const stageSingleChunk = async (input: {
      sourceId: string;
      originId: string;
      text: string;
    }) => {
      const identity: OwnedSourceIdentity = {
        ownerId,
        originKind: "subject",
        originId: input.originId,
      };
      const chunks: StagedContentChunk[] = [
        {
          ordinal: 0,
          text: input.text,
          normalizedText: normalizeForSearch(input.text),
          tokenEstimate: Math.ceil(input.text.length / 4),
          contentHash: sha256(input.text),
          locator: {
            kind: "text",
            startOffset: 0,
            endOffset: input.text.length,
          },
          headingPath: null,
          evidenceKind: "native-text",
        },
      ];
      const staged = await corpus.stageVersion({
        identity,
        sourceId: input.sourceId,
        versionKey: `attachment-scope-${newId("version")}`,
        contentHash: sha256(input.text),
        extractorId: "attachment-scope-test",
        extractorVersion: "1",
        mimeType: "text/plain",
        language: "fr",
        byteSize: input.text.length,
        locatorSchemaVersion: 1,
        metadata: {},
        chunks,
      });
      const committed = await corpus.commitVersion({
        ownerId,
        stagingId: staged.stagingId,
        expectedSourceId: input.sourceId,
        expectedPreviousVersionId: null,
      });
      await publishLexicalVersion({ corpus, identity, committed, chunks });
      return committed;
    };
    await stageSingleChunk({
      sourceId: attachedSourceId,
      originId: subjectId,
      text: "La tête courante de la pièce jointe ne doit jamais remplacer un snapshot invalide.",
    });
    const foreignSnapshot = await stageSingleChunk({
      sourceId: foreignSourceId,
      originId: foreignOriginId,
      text: "Cette version appartient à une autre source du même utilisateur.",
    });
    const created = await thread(ownerId);
    const reservation = await store.reserveTurn({
      ownerId,
      threadId: created.thread.id,
      branchId: created.branch.id,
      expectedHeadMessageId: null,
      clientRequestId: `unavailable-attachment-${newId("request")}`,
      markdown: "Réponds uniquement à partir de la pièce jointe.",
      modelKey: "mock-readonly",
      attachments: [
        {
          kind: "subject",
          referenceId: subjectId,
          snapshotVersion: null,
          label: "Pièce indisponible",
        },
      ],
    });
    // New writes reject this state. Corrupt the row directly to exercise the
    // runtime's defense-in-depth for legacy/imported metadata.
    const reservedAttachment = await client.execute({
      sql: `SELECT id FROM assistant_attachments WHERE messageId = ? LIMIT 1`,
      args: [reservation.userMessageId],
    });
    const reservedAttachmentId = String(reservedAttachment.rows[0]!.id);
    await client.batch(
      [
        {
          sql: `DELETE FROM content_version_references
            WHERE ownerKind = 'assistant-citation' AND ownerId = ?`,
          args: [reservedAttachmentId],
        },
        {
          sql: `UPDATE assistant_attachments SET snapshotVersion = ? WHERE id = ?`,
          args: [foreignSnapshot.versionId, reservedAttachmentId],
        },
      ],
      "write",
    );
    const capturedRequests: Array<Parameters<ModelGateway["stream"]>[0]> = [];
    const retrievalInputs: OwnedLexicalQuery[] = [];
    const baseGateway = new MockReadOnlyModelGateway();
    const gateway: ModelGateway = {
      listModels: () => baseGateway.listModels(),
      stream: async function* (request) {
        capturedRequests.push(request);
        yield* baseGateway.stream(request);
      },
      embed: () => baseGateway.embed(),
      transcribe: () => baseGateway.transcribe(),
      estimate: () => baseGateway.estimate(),
    };
    const service = new ReadOnlyAssistantRunService(
      client,
      store,
      {
        list: async () => [MOCK_ASSISTANT_MODEL],
        resolve: async () => ({
          capability: MOCK_ASSISTANT_MODEL,
          descriptor: baseGateway.descriptor,
          gateway,
        }),
      },
      () => createFirstPartyToolBroker({} as Api).registry,
      undefined,
      undefined,
      new SqliteFts5LexicalSearchBackend(client),
      async (input) => {
        retrievalInputs.push(input);
        // A buggy or malicious backend must not be able to turn the empty
        // explicit fence into broad user-corpus evidence.
        return {
          candidates: [
            {
              sourceId: "unexpected-broad-source",
              versionId: "unexpected-broad-version",
              chunkId: "unexpected-broad-chunk",
              ordinal: 0,
              score: 1,
              snippet: "Broad corpus content that must be discarded",
              locator: { kind: "text", startOffset: 0, endOffset: 10 },
              contentHash: "b".repeat(64),
              evidenceKind: "native-text",
              channels: ["lexical"],
              fusedScore: 1,
              text: "Broad corpus content that must be discarded",
              tokenEstimate: 10,
              headingPath: null,
            },
          ],
          vectorUsed: false,
          vectorImplementation: null,
          rerankUsed: false,
          rerankImplementation: null,
          retrievalMode: "lexical",
          fallbackReason: null,
          operationId: `retrieval-${newId("closed")}`,
          stages: [],
        } satisfies HybridSearchResult;
      },
    );

    await service.runNow(ownerId, reservation.runId);

    expect(retrievalInputs).toHaveLength(1);
    expect(retrievalInputs[0]).toMatchObject({
      projectIds: [],
      contextAccess: "explicit-attachment",
    });
    expect(retrievalInputs[0]?.sourceIds).toBeUndefined();
    expect(retrievalInputs[0]?.versionIds).toBeUndefined();
    const request = capturedRequests[0]!;
    expect(
      request.messages.filter((block) => block.trust === "retrieved-untrusted"),
    ).toHaveLength(0);
    const unavailable = request.messages.find(
      (block) =>
        block.mediaType ===
        "application/vnd.avermate.explicit-source-unavailable+json",
    );
    expect(unavailable?.trust).toBe("system-policy");
    expect(unavailable?.content).toContain(
      '"scopeBehavior":"closed-empty-when-no-searchable-attachment"',
    );
    expect(unavailable?.content).toContain(
      '"reason":"snapshot-version-unavailable"',
    );
    expect(unavailable?.content).toContain(
      "Do not claim to have read, searched, or cited",
    );
    const retrievalMetadata = request.messages.find(
      (block) =>
        block.mediaType === "application/vnd.avermate.retrieval-run+json",
    );
    expect(retrievalMetadata?.content).toContain(
      '"contextAccess":"explicit-attachment"',
    );
    expect(retrievalMetadata?.content).toContain(
      '"fallbackReason":"explicit-sources-unavailable; search closed empty"',
    );
  });

  test("loads an owned task as application data and rejects hostile broad retrieval", async () => {
    const ownerId = "corpus-user-a";
    const taskId = `ptask-${newId("assistant-task")}`;
    const now = Math.floor(Date.now() / 1_000);
    await client.execute({
      sql: `INSERT INTO planning_tasks (
          id, title, notes, localNote, status, sortOrder, revision,
          yearId, userId, syncState, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, 'doing', 0, 3, ?, ?, 'detached', ?, ?)`,
      args: [
        taskId,
        "Relire le chapitre 4",
        "Comparer les deux démonstrations.",
        "Insister sur le contre-exemple.",
        "corpus-year-a",
        ownerId,
        now,
        now,
      ],
    });
    const created = await thread(ownerId);
    const reservation = await store.reserveTurn({
      ownerId,
      threadId: created.thread.id,
      branchId: created.branch.id,
      expectedHeadMessageId: null,
      clientRequestId: `task-scope-${newId("request")}`,
      markdown: "Aide-moi à faire cette tâche.",
      modelKey: "mock-readonly",
      attachments: [
        {
          kind: "task",
          referenceId: taskId,
          snapshotVersion: null,
          label: "Relire le chapitre 4",
        },
      ],
    });
    const newlyFrozenTask = await client.execute({
      sql: `SELECT id, frozenPayloadVersion FROM assistant_attachments
        WHERE messageId = ? AND kind = 'task' LIMIT 1`,
      args: [reservation.userMessageId],
    });
    expect(newlyFrozenTask.rows[0]?.frozenPayloadVersion).toBe(1);
    // Simulate an attachment written by a pre-0068 server. First use must
    // backfill it once, after which retries remain immutable.
    await client.execute({
      sql: `UPDATE assistant_attachments
        SET frozenPayloadVersion = NULL, frozenPayloadJson = NULL,
          frozenPayloadDigest = NULL, frozenSourceRevision = NULL
        WHERE id = ?`,
      args: [newlyFrozenTask.rows[0]!.id],
    });
    const capturedRequests: Array<Parameters<ModelGateway["stream"]>[0]> = [];
    const retrievalInputs: OwnedLexicalQuery[] = [];
    const baseGateway = new MockReadOnlyModelGateway();
    const gateway: ModelGateway = {
      listModels: () => baseGateway.listModels(),
      stream: async function* (request) {
        capturedRequests.push(request);
        yield* baseGateway.stream(request);
      },
      embed: () => baseGateway.embed(),
      transcribe: () => baseGateway.transcribe(),
      estimate: () => baseGateway.estimate(),
    };
    const service = new ReadOnlyAssistantRunService(
      client,
      store,
      {
        list: async () => [MOCK_ASSISTANT_MODEL],
        resolve: async () => ({
          capability: MOCK_ASSISTANT_MODEL,
          descriptor: baseGateway.descriptor,
          gateway,
        }),
      },
      () => createFirstPartyToolBroker({} as Api).registry,
      undefined,
      undefined,
      new SqliteFts5LexicalSearchBackend(client),
      async (input) => {
        retrievalInputs.push(input);
        return {
          candidates: [
            {
              sourceId: "hostile-global-source",
              versionId: "hostile-global-version",
              chunkId: "hostile-global-chunk",
              ordinal: 0,
              score: 1,
              snippet: "Unrelated corpus evidence",
              locator: { kind: "text", startOffset: 0, endOffset: 10 },
              contentHash: "c".repeat(64),
              evidenceKind: "native-text",
              channels: ["lexical"],
              fusedScore: 1,
              text: "Unrelated corpus evidence",
              tokenEstimate: 10,
              headingPath: null,
            },
          ],
          vectorUsed: false,
          vectorImplementation: null,
          rerankUsed: false,
          rerankImplementation: null,
          retrievalMode: "lexical",
          fallbackReason: null,
          operationId: `retrieval-${newId("task-scope")}`,
          stages: [],
        } satisfies HybridSearchResult;
      },
    );

    await service.runNow(ownerId, reservation.runId);
    await client.execute({
      sql: `UPDATE planning_tasks SET title = ?, notes = ?, revision = revision + 1,
        updatedAt = ? WHERE id = ? AND userId = ?`,
      args: [
        "Titre modifié après envoi",
        "MUTATION_QUI_NE_DOIT_PAS_RETROAGIR",
        now + 1,
        taskId,
        ownerId,
      ],
    });
    const retry = await store.reserveRetry({
      ownerId,
      messageId: reservation.reservedOutputMessageId,
      clientRequestId: `task-retry-${newId("request")}`,
      modelKey: "mock-readonly",
    });
    await service.runNow(ownerId, retry.runId);

    expect(retrievalInputs).toHaveLength(2);
    for (const input of retrievalInputs) {
      expect(input).toMatchObject({
        projectIds: [],
        contextAccess: "explicit-attachment",
      });
      expect(input.sourceIds).toBeUndefined();
      expect(input.versionIds).toBeUndefined();
    }
    expect(capturedRequests).toHaveLength(2);
    for (const request of capturedRequests) {
      const taskBlock = request.messages.find(
        (block) =>
          block.mediaType === "application/vnd.avermate.planning-task+json",
      );
      expect(taskBlock?.trust).toBe("application-data");
      expect(taskBlock?.content).toContain("Relire le chapitre 4");
      expect(taskBlock?.content).toContain("contre-exemple");
      expect(taskBlock?.content).not.toContain(
        "MUTATION_QUI_NE_DOIT_PAS_RETROAGIR",
      );
      expect(
        request.messages.filter(
          (block) => block.trust === "retrieved-untrusted",
        ),
      ).toHaveLength(0);
    }
    const frozenTask = await client.execute({
      sql: `SELECT frozenPayloadVersion, frozenPayloadDigest,
          frozenSourceRevision, frozenPayloadJson
        FROM assistant_attachments WHERE messageId = ? AND kind = 'task'`,
      args: [reservation.userMessageId],
    });
    expect(frozenTask.rows[0]?.frozenPayloadVersion).toBe(1);
    expect(frozenTask.rows[0]?.frozenSourceRevision).toBe(3);
    expect(String(frozenTask.rows[0]?.frozenPayloadDigest)).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(String(frozenTask.rows[0]?.frozenPayloadJson)).not.toContain(
      "MUTATION_QUI_NE_DOIT_PAS_RETROAGIR",
    );
  });

  test("retries an attachment against its owned immutable snapshot after the source head advances", async () => {
    const ownerId = "corpus-user-a";
    const subjectId = `subject-${newId("snapshot-fence")}`;
    const sourceId = `source-${newId("snapshot-fence")}`;
    const now = Math.floor(Date.now() / 1_000);
    await client.execute({
      sql: `INSERT INTO subjects (
          id, name, coefficient, kind, isMain, bonus, sortOrder,
          yearId, userId, createdAt, updatedAt
        ) VALUES (?, 'Archive immuable', 1, 'subject', 1, 0, 0, ?, ?, ?, ?)`,
      args: [subjectId, "corpus-year-a", ownerId, now, now],
    });
    await seedSource(client, { id: sourceId, originId: subjectId, subjectId });
    const corpus = new CoreCorpusStore(client);
    const identity: OwnedSourceIdentity = {
      ownerId,
      originKind: "subject",
      originId: subjectId,
    };
    const commitTextVersion = async (
      versionLabel: string,
      texts: readonly string[],
      expectedPreviousVersionId: string | null,
    ) => {
      const chunks: StagedContentChunk[] = texts.map((text, ordinal) => ({
        ordinal,
        text,
        normalizedText: normalizeForSearch(text),
        tokenEstimate: Math.ceil(text.length / 4),
        contentHash: sha256(text),
        locator: {
          kind: "text",
          startOffset: ordinal * 1_000,
          endOffset: ordinal * 1_000 + text.length,
        },
        headingPath: null,
        evidenceKind: "native-text",
      }));
      const joinedText = texts.join("\n");
      const staged = await corpus.stageVersion({
        identity,
        sourceId,
        versionKey: `${versionLabel}-${newId("snapshot-version")}`,
        contentHash: sha256(joinedText),
        extractorId: "snapshot-fence-test",
        extractorVersion: "1",
        mimeType: "text/plain",
        language: "fr",
        byteSize: joinedText.length,
        locatorSchemaVersion: 1,
        metadata: {},
        chunks,
      });
      const committed = await corpus.commitVersion({
        ownerId,
        stagingId: staged.stagingId,
        expectedSourceId: sourceId,
        expectedPreviousVersionId,
      });
      await publishLexicalVersion({ corpus, identity, committed, chunks });
      return committed;
    };
    const snapshot = await commitTextVersion(
      "n",
      [
        "Préface historique sans le terme recherché.",
        "Deuxième passage historique sans réponse.",
        "Troisième passage historique sans réponse.",
        "Quatrième passage historique sans réponse.",
        "SNAPSHOT CIBLE : la valeur immuable est VERSION-N.",
      ],
      null,
    );
    const created = await thread(ownerId);
    const first = await store.reserveTurn({
      ownerId,
      threadId: created.thread.id,
      branchId: created.branch.id,
      expectedHeadMessageId: null,
      clientRequestId: `snapshot-first-${newId("request")}`,
      markdown: "Quelle est la valeur de SNAPSHOT CIBLE ?",
      modelKey: "mock-readonly",
      attachments: [
        {
          kind: "subject",
          referenceId: subjectId,
          // The real Web send path sends null. The server must resolve and
          // freeze the immutable head before the source can advance.
          snapshotVersion: null,
          label: "Archive N",
        },
      ],
    });
    const frozenBeforeAdvance = await store.getThreadDetail(
      ownerId,
      created.thread.id,
    );
    const frozenAttachment = frozenBeforeAdvance.attachments.find(
      (attachment) => attachment.messageId === first.userMessageId,
    );
    expect(frozenAttachment?.snapshotVersion).toBe(snapshot.versionId);
    const snapshotReachability = await client.execute({
      sql: `SELECT sourceVersionId FROM content_version_references
        WHERE ownerKind = 'assistant-citation' AND ownerId = ?`,
      args: [frozenAttachment!.id],
    });
    expect(snapshotReachability.rows.map((row) => row.sourceVersionId)).toEqual(
      [snapshot.versionId],
    );
    const next = await commitTextVersion(
      "n-plus-one",
      ["SNAPSHOT CIBLE : la valeur courante est VERSION-N-PLUS-UN."],
      snapshot.versionId,
    );
    const capturedRequests: Array<Parameters<ModelGateway["stream"]>[0]> = [];
    const retrievalInputs: OwnedLexicalQuery[] = [];
    const baseGateway = new MockReadOnlyModelGateway();
    const gateway: ModelGateway = {
      listModels: () => baseGateway.listModels(),
      stream: async function* (request) {
        capturedRequests.push(request);
        yield* baseGateway.stream(request);
      },
      embed: () => baseGateway.embed(),
      transcribe: () => baseGateway.transcribe(),
      estimate: () => baseGateway.estimate(),
    };
    const broker = createFirstPartyToolBroker({} as Api);
    const service = new ReadOnlyAssistantRunService(
      client,
      store,
      {
        list: async () => [MOCK_ASSISTANT_MODEL],
        resolve: async () => ({
          capability: MOCK_ASSISTANT_MODEL,
          descriptor: baseGateway.descriptor,
          gateway,
        }),
      },
      () => broker.registry,
      undefined,
      undefined,
      new SqliteFts5LexicalSearchBackend(client),
      async (input, options) => {
        retrievalInputs.push(input);
        return hybridCorpusSearch(input, {
          ...options,
          runtime: null,
          reranker: null,
          persistTrace: false,
        });
      },
    );

    await service.runNow(ownerId, first.runId, broker);
    const latest = await commitTextVersion(
      "n-plus-two",
      ["SNAPSHOT CIBLE : la valeur courante est VERSION-N-PLUS-DEUX."],
      next.versionId,
    );
    const retry = await store.reserveRetry({
      ownerId,
      messageId: first.reservedOutputMessageId,
      clientRequestId: `snapshot-retry-${newId("request")}`,
      modelKey: "mock-readonly",
    });
    await service.runNow(ownerId, retry.runId, broker);

    expect(retrievalInputs).toHaveLength(2);
    for (const input of retrievalInputs) {
      expect(input).toMatchObject({
        projectIds: [],
        sourceIds: [sourceId],
        versionIds: [snapshot.versionId],
        contextAccess: "explicit-attachment",
      });
    }
    expect(latest.versionId).not.toBe(snapshot.versionId);
    for (const request of capturedRequests) {
      const evidenceText = request.messages
        .filter((block) => block.trust === "retrieved-untrusted")
        .map((block) => block.content)
        .join("\n");
      expect(evidenceText).toContain("VERSION-N");
      expect(evidenceText).not.toContain("VERSION-N-PLUS-UN");
      expect(evidenceText).not.toContain("VERSION-N-PLUS-DEUX");
    }
    const detail = await store.getThreadDetail(ownerId, created.thread.id);
    const runIds = new Set([first.runId, retry.runId]);
    const proofs = detail.manifests
      .filter((manifest) => runIds.has(manifest.runId))
      .flatMap((manifest) => manifest.proofHandles);
    expect(proofs.length).toBeGreaterThanOrEqual(2);
    expect(
      proofs.every(
        (proof) =>
          proof.contentVersionReference.sourceVersionId === snapshot.versionId,
      ),
    ).toBe(true);

    await corpus.markVersionForGc(snapshot.versionId);
    expect((await corpus.collectGarbage()).deletedVersionIds).not.toContain(
      snapshot.versionId,
    );
    const trashed = await store.trashThread({
      ownerId,
      threadId: created.thread.id,
      expectedRevision: detail.thread.revision,
      retentionDays: 1,
    });
    await client.execute({
      sql: `UPDATE assistant_threads SET purgeAfter = 0 WHERE id = ?`,
      args: [trashed.id],
    });
    expect(await store.purgeExpired(ownerId)).toContain(created.thread.id);
    expect((await corpus.collectGarbage()).deletedVersionIds).toContain(
      snapshot.versionId,
    );
  });

  test("delivers a dense-selected visual-only PDF page as verified provider bytes and preserves its exact citation", async () => {
    const ownerId = "corpus-user-a";
    const subjectId = `subject-${newId("visual-rag")}`;
    const sourceId = `source-${newId("visual-rag")}`;
    const projectId = await studyProject({
      id: `project-${newId("visual-rag")}`,
      advanced: true,
    });
    const now = Math.floor(Date.now() / 1_000);
    await client.execute({
      sql: `INSERT INTO subjects (
          id, name, coefficient, kind, isMain, bonus, sortOrder,
          yearId, userId, createdAt, updatedAt
        ) VALUES (?, 'Page scannée', 1, 'subject', 1, 0, 0, ?, ?, ?, ?)`,
      args: [subjectId, "corpus-year-a", ownerId, now, now],
    });
    await seedSource(client, {
      id: sourceId,
      originId: subjectId,
      subjectId,
    });

    // The indexed chunk deliberately contains neither OCR nor native text.
    // Its answer exists only in the rendered PDF-page derivative.
    const pagePng = new Uint8Array(
      await sharp({
        create: {
          width: 8,
          height: 8,
          channels: 4,
          background: { r: 220, g: 24, b: 36, alpha: 1 },
        },
      })
        .png()
        .toBuffer(),
    );
    const visualDigest = createHash("sha256").update(pagePng).digest("hex");
    const emptyTextDigest = sha256("");
    const chunks: StagedContentChunk[] = [
      {
        ordinal: 0,
        text: "",
        normalizedText: "",
        tokenEstimate: 0,
        contentHash: emptyTextDigest,
        locator: { kind: "pdf", page: 7 },
        headingPath: null,
        evidenceKind: "visual-only",
      },
    ];
    const identity: OwnedSourceIdentity = {
      ownerId,
      originKind: "subject",
      originId: subjectId,
    };
    const corpus = new CoreCorpusStore(client);
    const staged = await corpus.stageVersion({
      identity,
      sourceId,
      versionKey: `visual-only-${newId("version")}`,
      contentHash: sha256("visual-only-pdf-page-7"),
      extractorId: "visual-only-test",
      extractorVersion: "1",
      mimeType: "application/pdf",
      language: "fr",
      byteSize: pagePng.byteLength,
      locatorSchemaVersion: 1,
      metadata: { testFixture: "no-machine-readable-text" },
      chunks,
    });
    const committed = await corpus.commitVersion({
      ownerId,
      stagingId: staged.stagingId,
      expectedSourceId: sourceId,
      expectedPreviousVersionId: null,
    });
    await client.execute({
      sql: `UPDATE content_sources
        SET coverage = 'metadata-and-locators-only', updatedAt = ?
        WHERE id = ? AND userId = ?`,
      args: [now, sourceId, ownerId],
    });
    await client.execute({
      sql: `INSERT INTO study_project_items
        (id, projectId, kind, referenceId, sourceVersionId, trackingMode,
         selectorReviewRequired, position, contextMode, addedAt)
        VALUES (?, ?, 'subject', ?, NULL, 'follow-head', 0, 0, 'include', ?)`,
      args: [`pitem-${newId("visual-rag")}`, projectId, subjectId, now],
    });
    const chunkId = String(
      (
        await client.execute({
          sql: `SELECT id FROM content_chunks
            WHERE versionId = ? AND ordinal = 0 LIMIT 1`,
          args: [committed.versionId],
        })
      ).rows[0]!.id,
    );
    const derivativeId = `cder-${newId("visual-rag")}`;
    const fileId = `file-${newId("visual-rag")}`;
    const storageKey = `visual-rag/${fileId}.png`;
    await client.batch(
      [
        {
          sql: `INSERT INTO files
            (id, provider, storageKey, url, mimeType, byteSize, purpose,
             status, previewStatus, userId, createdAt, updatedAt)
            VALUES (?, 'local', ?, ?, 'image/png', ?, 'preview',
              'stored', 'ready', ?, ?, ?)`,
          args: [
            fileId,
            storageKey,
            `/files/${fileId}`,
            pagePng.byteLength,
            ownerId,
            now,
            now,
          ],
        },
        {
          sql: `INSERT INTO content_derivatives
            (id, versionId, chunkId, fileId, kind, status,
             locatorSchemaVersion, locatorJson, contentHash, mimeType,
             byteSize, estimatedInputTokens, rendererProfile,
             rendererImageDigest, metadataJson, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, 'page-image', 'ready', 1, ?, ?,
              'image/png', ?, 16, 'test-page-renderer', ?, '{}', ?, ?)`,
          args: [
            derivativeId,
            committed.versionId,
            chunkId,
            fileId,
            canonicalJson({ kind: "pdf", page: 7 }),
            visualDigest,
            pagePng.byteLength,
            `sha256:${visualDigest}`,
            now,
            now,
          ],
        },
      ],
      "write",
    );

    const handles = new ContextAssetHandleService("v".repeat(32));
    const resolvedBindings: Array<{
      ownerId: string;
      derivativeId: string;
      versionId: string;
      chunkId: string;
      locator: unknown;
      digest: string;
    }> = [];
    const assetResolver = new OwnedFileContextAssetResolver({
      handles,
      async loadOwnedFile(requestOwnerId, requestedDerivativeId) {
        const result = await client.execute({
          sql: `SELECT files.id, files.userId, files.provider,
              files.storageKey, files.mimeType, files.byteSize, files.status,
              derivatives.id AS derivativeId,
              derivatives.versionId, derivatives.chunkId,
              derivatives.locatorJson, derivatives.contentHash
            FROM content_derivatives AS derivatives
            JOIN content_versions AS versions ON versions.id = derivatives.versionId
            JOIN content_chunks AS chunks ON chunks.id = derivatives.chunkId
              AND chunks.versionId = derivatives.versionId
            JOIN content_sources AS sources ON sources.id = versions.sourceId
            JOIN files ON files.id = derivatives.fileId
              AND files.userId = sources.userId
            WHERE derivatives.id = ? AND sources.userId = ?
              AND derivatives.status = 'ready' AND files.status = 'stored'
            LIMIT 1`,
          args: [requestedDerivativeId, requestOwnerId],
        });
        const row = result.rows[0];
        if (!row) return null;
        resolvedBindings.push({
          ownerId: String(row.userId),
          derivativeId: String(row.derivativeId),
          versionId: String(row.versionId),
          chunkId: String(row.chunkId),
          locator: jsonValue(row.locatorJson),
          digest: String(row.contentHash),
        });
        return {
          id: String(row.id),
          userId: String(row.userId),
          provider: String(row.provider),
          storageKey: String(row.storageKey),
          mimeType: String(row.mimeType),
          byteSize: Number(row.byteSize),
          status: String(row.status) as OwnedStoredFile["status"],
        };
      },
      async readOwnedFile(requestOwnerId, file, options) {
        expect(requestOwnerId).toBe(ownerId);
        expect(file).toMatchObject({
          id: fileId,
          userId: ownerId,
          storageKey,
          mimeType: "image/png",
          byteSize: pagePng.byteLength,
          status: "stored",
        });
        expect(options?.maxBytes ?? 0).toBeGreaterThanOrEqual(
          pagePng.byteLength,
        );
        return pagePng.buffer.slice(
          pagePng.byteOffset,
          pagePng.byteOffset + pagePng.byteLength,
        ) as ArrayBuffer;
      },
    });

    const descriptor: ModelDescriptor = {
      id: "visual-rag-test-model",
      provider: "mock",
      displayName: "Visual RAG test model",
      modalities: ["text", "image"],
      capabilities: {
        tools: true,
        reasoningSummary: false,
        cachedUsage: false,
        structuredOutput: false,
      },
      contextWindow: 16_384,
    };
    const preparedCitations: PreparedContextCitation[] = [];
    let providerImage: Uint8Array | null = null;
    let providerText = "";
    const gateway = new AiSdkDirectGateway({
      models: [descriptor],
      resolveModel: () => new MockLanguageModelV4({ modelId: descriptor.id }),
      contextAssetResolver: assetResolver,
      onContextPrepared(_request, prompt) {
        preparedCitations.push(...prompt.citations);
      },
      streamFactory(_request, _model, prompt) {
        for (const message of prompt.messages) {
          if (message.role !== "user" || typeof message.content === "string") {
            continue;
          }
          for (const part of message.content) {
            if (part.type === "text") providerText += `${part.text}\n`;
            if (part.type === "image") {
              providerImage = new Uint8Array(part.image as Uint8Array);
            }
          }
        }
        if (!providerImage || !Buffer.from(providerImage).equals(pagePng)) {
          throw new Error("The visual page did not reach the model payload");
        }
        return simulateReadableStream({
          chunks: [
            {
              type: "text-delta",
              id: "visual-answer",
              delta: "Le carré de la page est rouge. [[cite:E1]]",
            },
            { type: "finish", finishReason: "stop", totalUsage: {} },
          ],
        });
      },
    });
    const retrievalCalls: OwnedLexicalQuery[] = [];
    const retrievalResults: HybridSearchResult[] = [];
    const vectorRuntime = {
      embedding: {
        descriptor: () => ({
          id: "test-embedding-space",
          provider: "fixture",
          model: "visual-page-fixture",
          modelRevision: "visual-page-fixture@1",
          dimensions: 3,
          modalities: ["text" as const],
          normalization: "provider-unit" as const,
          preprocessingRevision: "visual-page-v1",
          placement: "node" as const,
        }),
        embedText: async (inputs: readonly { contentHash: string }[]) =>
          inputs.map((input) => ({
            contentHash: input.contentHash,
            values: [1, 0, 0],
          })),
      },
      vector: {
        forGeneration(requestOwnerId: string, generationId: string) {
          expect(requestOwnerId).toBe(ownerId);
          expect(generationId).toBe("visual-generation-fixture");
          return {
            capabilities: async () => ({
              available: true,
              implementation: "test-visual-vector",
              dimensions: [3],
            }),
            search: async (query: {
              ownerId: string;
              spaceId: string;
              limit: number;
            }) => {
              expect(query).toMatchObject({
                ownerId,
                spaceId: "test-embedding-space",
              });
              return [
                {
                  sourceId,
                  versionId: committed.versionId,
                  chunkId,
                  score: 0.99,
                },
              ];
            },
          };
        },
      },
    } as unknown as CorpusVectorRuntime;
    const visualReranker: RerankProvider = {
      descriptor: () => ({
        id: "test-rerank-space",
        provider: "fixture",
        model: "visual-page-reranker",
        modelRevision: "visual-page-reranker@1",
        languages: ["fr"],
        modalities: ["text"],
        maximumCandidates: 50,
        maximumTokensPerCandidate: 8_192,
        scoreSemantics: "sigmoid-relevance",
        placement: "node",
        costUnit: "compute-token",
      }),
      rerank: async ({ operationId, candidates }) =>
        candidates.map((candidate, rank) => ({
          operationId,
          candidateId: candidate.id,
          rank,
          score: 1 - rank / 10,
        })),
    };
    const broker = createFirstPartyToolBroker({} as Api);
    const service = new ReadOnlyAssistantRunService(
      client,
      store,
      {
        list: async () => [MOCK_ASSISTANT_MODEL],
        resolve: async () => ({
          capability: MOCK_ASSISTANT_MODEL,
          descriptor,
          gateway,
          contextMediaDelivery: "server-resolved",
          fallbackSelections: [
            {
              capability: MOCK_ASSISTANT_MODEL,
              descriptor: { ...descriptor, contextWindow: 12_000 },
              gateway,
              contextMediaDelivery: "server-resolved" as const,
            },
          ],
        }),
      },
      () => broker.registry,
      undefined,
      undefined,
      new SqliteFts5LexicalSearchBackend(client),
      async (input, options) => {
        retrievalCalls.push(input);
        const result = await hybridCorpusSearch(input, {
          ...options,
          runtime: vectorRuntime,
          reranker: visualReranker,
          corpusGenerationId: "visual-generation-fixture",
          persistTrace: false,
        });
        retrievalResults.push(result);
        return result;
      },
      handles,
    );

    const created = await store.createThread({
      ownerId,
      title: "Analyse visuelle",
      projectId,
    });
    const reservation = await store.reserveTurn({
      ownerId,
      threadId: created.thread.id,
      branchId: created.branch.id,
      expectedHeadMessageId: null,
      clientRequestId: `visual-rag-${newId("request")}`,
      markdown: "Quelle couleur remplit le carré sur la page 7 ?",
      modelKey: "mock-readonly",
    });
    await service.runNow(ownerId, reservation.runId, broker);

    expect(retrievalCalls).toHaveLength(1);
    expect(retrievalCalls[0]).toMatchObject({
      ownerId,
      projectIds: [projectId],
      subjectIds: [],
      contextAccess: "automatic",
    });
    expect(retrievalResults[0]).toMatchObject({
      vectorUsed: true,
      vectorImplementation: "test-visual-vector",
      rerankUsed: false,
      rerankImplementation: null,
      retrievalMode: "hybrid",
      fallbackReason: null,
    });
    expect(retrievalResults[0]?.candidates[0]).toMatchObject({
      sourceId,
      versionId: committed.versionId,
      chunkId,
      text: "",
      snippet: "",
      evidenceKind: "visual-only",
      channels: ["dense"],
      locator: { kind: "pdf", page: 7 },
    });
    expect(Buffer.from(providerImage ?? new Uint8Array())).toEqual(
      Buffer.from(pagePng),
    );
    expect(providerText.toLocaleLowerCase("fr")).not.toContain("rouge");
    expect(resolvedBindings).toEqual([
      {
        ownerId,
        derivativeId,
        versionId: committed.versionId,
        chunkId,
        locator: { kind: "pdf", page: 7 },
        digest: visualDigest,
      },
    ]);
    expect(
      preparedCitations.find((citation) => citation.delivery === "media"),
    ).toMatchObject({
      sourceRef: chunkId,
      chunkId,
      page: 7,
      locator: { kind: "pdf", page: 7 },
      digest: visualDigest,
      delivery: "media",
    });

    const detail = await store.getThreadDetail(ownerId, created.thread.id);
    const manifest = detail.manifests.find(
      (candidate) => candidate.runId === reservation.runId,
    )!;
    const proof = manifest.proofHandles[0]!;
    expect(manifest.budget).toMatchObject({
      maxTokens: 12_000,
      mediaTokens: 8_192,
      estimationPolicy: "utf8-text-plus-conservative-media-v1",
    });
    expect(manifest.budget.usedTokens).toBe(
      manifest.budget.textTokens! + manifest.budget.mediaTokens!,
    );
    expect(
      manifest.items.find((item) => item.referenceId === chunkId)
        ?.tokenEstimate,
    ).toBeGreaterThanOrEqual(8_192);
    expect(proof).toMatchObject({
      runId: reservation.runId,
      locator: { kind: "pdf", page: 7 },
      evidenceDigest: visualDigest,
      quotedContentHash: emptyTextDigest,
      contentVersionReference: {
        ownerId,
        sourceVersionId: committed.versionId,
        chunkId,
        locator: { kind: "pdf", page: 7 },
        quotedContentHash: emptyTextDigest,
      },
    });
    const citation = detail.citations.find(
      (candidate) => candidate.runId === reservation.runId,
    );
    expect(citation?.proofHandleId).toBe(proof.id);
    const output = detail.messages.find(
      (message) => message.id === reservation.reservedOutputMessageId,
    );
    expect(output?.parts).toContainEqual(
      expect.objectContaining({
        type: "text",
        markdown: "Le carré de la page est rouge.",
      }),
    );

    const constrainedRequests: Array<Parameters<ModelGateway["stream"]>[0]> =
      [];
    const constrainedDescriptor: ModelDescriptor = {
      ...descriptor,
      id: "visual-rag-constrained-model",
      contextWindow: 9_000,
    };
    const constrainedGateway: ModelGateway = {
      listModels: async () => [constrainedDescriptor],
      stream: async function* (request) {
        constrainedRequests.push(request);
        yield {
          type: "content-delta",
          delta:
            "La preuve visuelle dépasse le budget de cette route. [[abstain]]",
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
        estimatedCostMinor: 0,
        currency: "EUR",
      }),
    };
    const constrainedService = new ReadOnlyAssistantRunService(
      client,
      store,
      {
        list: async () => [MOCK_ASSISTANT_MODEL],
        resolve: async () => ({
          capability: MOCK_ASSISTANT_MODEL,
          descriptor: constrainedDescriptor,
          gateway: constrainedGateway,
          contextMediaDelivery: "server-resolved",
        }),
      },
      () => broker.registry,
      undefined,
      undefined,
      new SqliteFts5LexicalSearchBackend(client),
      async (input, options) =>
        hybridCorpusSearch(input, {
          ...options,
          runtime: vectorRuntime,
          reranker: visualReranker,
          corpusGenerationId: "visual-generation-fixture",
          persistTrace: false,
        }),
      handles,
    );
    const constrainedTurn = await store.reserveTurn({
      ownerId,
      threadId: created.thread.id,
      branchId: created.branch.id,
      expectedHeadMessageId: reservation.reservedOutputMessageId,
      clientRequestId: `visual-budget-${newId("request")}`,
      markdown: "Relis la page 7 dans la fenêtre la plus petite.",
      modelKey: "mock-readonly",
    });
    await constrainedService.runNow(ownerId, constrainedTurn.runId, broker);
    const constrainedEvidence = constrainedRequests[0]?.messages.find(
      (block) => block.sourceRef === chunkId,
    );
    expect(constrainedEvidence?.parts).toMatchObject([{ type: "text" }]);
    expect(
      constrainedEvidence?.parts?.some((part) => part.type !== "text"),
    ).toBe(false);
    const constrainedDetail = await store.getThreadDetail(
      ownerId,
      created.thread.id,
    );
    const constrainedManifest = constrainedDetail.manifests.find(
      (candidate) => candidate.runId === constrainedTurn.runId,
    )!;
    expect(constrainedManifest.budget).toMatchObject({
      maxTokens: 9_000,
      mediaTokens: 0,
      estimationPolicy: "utf8-text-plus-conservative-media-v1",
    });
  });

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
    await seedSource(client, {
      id: sourceId,
      originId: subjectId,
      subjectId,
    });
    const corpus = new CoreCorpusStore(client);
    const passages = [
      "La mitochondrie produit une grande partie de l’ATP cellulaire.",
      "Le noyau contient la majeure partie du génome de la cellule.",
    ];
    const chunks = passages.map((text, ordinal) => ({
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
    }));
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
      chunks,
    });
    const committed = await corpus.commitVersion({
      ownerId: "corpus-user-a",
      stagingId: staged.stagingId,
      expectedSourceId: sourceId,
      expectedPreviousVersionId: null,
    });
    await publishLexicalVersion({
      corpus,
      identity: {
        ownerId: "corpus-user-a",
        originKind: "subject",
        originId: subjectId,
      },
      committed,
      chunks,
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
      new CorpusIndexService(client, new RoutedCorpusStore(client)),
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
    const attachment = detail.attachments.find(
      (candidate) => candidate.messageId === reservation.userMessageId,
    );
    expect(attachment?.snapshotVersion).toBe(
      String(indexed.rows[0]?.currentVersionId),
    );
    const attachmentReference = await client.execute({
      sql: `SELECT sourceVersionId FROM content_version_references
        WHERE ownerKind = 'assistant-citation' AND ownerId = ?`,
      args: [attachment!.id],
    });
    expect(attachmentReference.rows.map((row) => row.sourceVersionId)).toEqual([
      indexed.rows[0]?.currentVersionId,
    ]);
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
