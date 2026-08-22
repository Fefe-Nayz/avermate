import { describe, expect, test } from "bun:test";

import {
  assertAssistantDag,
  assistantContextManifestSchema,
  assistantDagExportSchema,
  assistantMessageSchema,
  assistantPartV1Schema,
  reserveAssistantTurnSchema,
  type AssistantBranch,
  type AssistantMessage,
  type AssistantThread,
} from "./assistant";

const now = "2026-08-22T10:00:00.000+00:00";
const digest = "a".repeat(64);

const thread: AssistantThread = {
  id: "thread-1",
  userId: "user-1",
  title: "Réviser les intégrales",
  activeBranchId: "branch-main",
  projectId: null,
  placement: { kind: "core" },
  revision: 1,
  starredAt: null,
  archivedAt: null,
  deletedAt: null,
  purgeAfter: null,
  createdAt: now,
  updatedAt: now,
};

const messages: AssistantMessage[] = [
  {
    id: "message-user",
    threadId: thread.id,
    parentMessageId: null,
    role: "user",
    authorship: "user",
    status: "complete",
    partsVersion: 1,
    parts: [{ type: "text", id: "part-user", markdown: "Explique le cours." }],
    createdByRunId: null,
    replacesMessageId: null,
    createdAt: now,
  },
  {
    id: "message-answer-a",
    threadId: thread.id,
    parentMessageId: "message-user",
    role: "assistant",
    authorship: "model",
    status: "complete",
    partsVersion: 1,
    parts: [{ type: "text", id: "part-answer-a", markdown: "Réponse A" }],
    createdByRunId: "run-a",
    replacesMessageId: null,
    createdAt: now,
  },
  {
    id: "message-answer-b",
    threadId: thread.id,
    parentMessageId: "message-user",
    role: "assistant",
    authorship: "model",
    status: "complete",
    partsVersion: 1,
    parts: [{ type: "text", id: "part-answer-b", markdown: "Réponse B" }],
    createdByRunId: "run-b",
    replacesMessageId: "message-answer-a",
    createdAt: now,
  },
];

const branches: AssistantBranch[] = [
  {
    id: "branch-main",
    threadId: thread.id,
    name: "Principale",
    forkedFromMessageId: null,
    headMessageId: "message-answer-a",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "branch-retry",
    threadId: thread.id,
    name: "Nouvelle réponse",
    forkedFromMessageId: "message-user",
    headMessageId: "message-answer-b",
    createdAt: now,
    updatedAt: now,
  },
];

describe("assistant v1 contracts", () => {
  test("accepts immutable sibling branches and rejects cycles or cross-thread parents", () => {
    expect(() => assertAssistantDag(thread, branches, messages)).not.toThrow();

    expect(() =>
      assertAssistantDag(thread, branches, [
        ...messages,
        { ...messages[0]!, id: "foreign", threadId: "other-thread" },
      ]),
    ).toThrow();

    expect(() =>
      assertAssistantDag(thread, branches, [
        { ...messages[0]!, parentMessageId: "message-answer-a" },
        messages[1]!,
        messages[2]!,
      ]),
    ).toThrow("cyclic");
  });

  test("keeps rendered parts in a closed registry and rejects arbitrary widgets or HTML", () => {
    expect(
      assistantPartV1Schema.parse({
        type: "tool",
        id: "part-tool",
        toolCallId: "call-1",
        toolId: "corpus.search",
        state: "complete",
        safeResult: { count: 2 },
      }),
    ).toMatchObject({ type: "tool", toolId: "corpus.search" });

    expect(() =>
      assistantPartV1Schema.parse({
        type: "custom-widget",
        component: "script",
        html: "<script>alert(1)</script>",
      }),
    ).toThrow();
    expect(() =>
      assistantMessageSchema.parse({
        ...messages[1],
        parts: [{ type: "text", id: "part", markdown: "ok", html: "<iframe>" }],
      }),
    ).toThrow();
  });

  test("binds evidence handles to one run, manifest and immutable content reference", () => {
    const manifest = assistantContextManifestSchema.parse({
      id: "manifest-1",
      runId: "run-a",
      version: 1,
      revision: 1,
      budget: {
        maxTokens: 8_000,
        usedTokens: 1_000,
        reservedOutputTokens: 2_000,
      },
      items: [
        {
          id: "context-1",
          trust: "retrieved-untrusted",
          kind: "corpus-chunk",
          referenceId: "reference-1",
          byteLength: 40,
          tokenEstimate: 10,
          digest,
        },
      ],
      proofHandles: [
        {
          id: "proof-1",
          contextManifestId: "manifest-1",
          runId: "run-a",
          ordinal: 0,
          contentVersionReference: {
            id: "reference-1",
            ownerId: "user-1",
            ownerKind: "assistant-citation",
            ownerIdWithinKind: "run-a",
            sourceVersionId: "version-1",
            chunkId: "chunk-1",
            locatorSchemaVersion: 1,
            locator: { kind: "pdf", page: 2 },
            quotedContentHash: digest,
            referenceKey: digest,
            createdAt: now,
          },
          locator: { kind: "pdf", page: 2 },
          evidenceDigest: digest,
          quotedContentHash: digest,
          createdAt: now,
        },
      ],
      digest,
      committedAt: now,
    });

    expect(manifest.proofHandles[0]?.runId).toBe("run-a");
    expect(() =>
      assistantContextManifestSchema.parse({
        ...manifest,
        proofHandles: [
          { ...manifest.proofHandles[0], locator: { kind: "pdf", page: 0 } },
        ],
      }),
    ).toThrow();
  });

  test("requires idempotent turn reservations and round-trips a versioned DAG export", () => {
    expect(
      reserveAssistantTurnSchema.parse({
        threadId: thread.id,
        branchId: "branch-main",
        expectedHeadMessageId: "message-answer-a",
        clientRequestId: "request-1",
        markdown: "Une autre explication",
        modelKey: "mock/read-only",
      }),
    ).toMatchObject({ attachmentIds: [], forkOnConflict: false });

    const exported = assistantDagExportSchema.parse({
      exportVersion: 1,
      exportedAt: now,
      mode: "whole-dag",
      thread,
      branches,
      messages,
      runs: [],
      attachments: [],
      citations: [],
      manifests: [],
      usage: [],
    });
    assertAssistantDag(exported.thread, exported.branches, exported.messages);
    expect(JSON.parse(JSON.stringify(exported))).toEqual(exported);
  });
});
