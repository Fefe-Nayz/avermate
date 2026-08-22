import { describe, expect, test } from "bun:test";
import type { Api } from "../../mcp/shared";
import type { McpPrincipal } from "../../mcp/auth";

// The first-party adapters reach the production router graph, which validates
// its environment while the module is evaluated. Keep this contract suite
// reproducible in a clean clone instead of relying on a developer's `.env`.
process.env.DATABASE_URL ||= "file::memory:";
process.env.BETTER_AUTH_URL ||= "http://localhost:3000";
process.env.BETTER_AUTH_SECRET ||=
  "tool-parity-test-secret-that-is-at-least-32-characters";
process.env.CLIENT_URL ||= "http://localhost:3001";
process.env.NODE_ENV = "test";
process.env.DISABLE_EMAIL = "true";
process.env.DISABLE_UPLOADS = "true";
process.env.DISABLE_JOBS = "true";

const { noOpActionLedger, noOpToolCapabilities, noOpToolEvents } =
  await import("../broker");
const { createFirstPartyToolBroker, firstPartyToolDescriptors } =
  await import("../first-party");
const { BROKERED_MCP_MUTATION_TOOL_IDS, BROKERED_MCP_READ_TOOL_IDS } =
  await import("../exposure-policy");
const { FileHandleService } = await import("../file-handles");
const { invokeBrokerFromEmbedded } = await import("./embedded");
const { invokeBrokerFromMcp } = await import("./mcp");

function apiFixture() {
  return {
    years: {
      list: async () => [
        {
          id: "year-1",
          name: "2026–2027",
          startsAt: new Date("2026-09-01T00:00:00.000Z"),
        },
      ],
      get: async ({ yearId }: { yearId: string }) => ({
        id: yearId,
        name: "2026–2027",
      }),
    },
    jobs: {
      get: async ({ jobId }: { jobId: string }) => ({
        id: jobId,
        kind: "ocr.document",
        status: "completed",
        attempts: 1,
        maxAttempts: 3,
        runAt: new Date("2026-08-22T00:00:00.000Z"),
        result: { pages: 2 },
        error: null,
        createdAt: new Date("2026-08-22T00:00:00.000Z"),
        updatedAt: new Date("2026-08-22T00:01:00.000Z"),
      }),
    },
    projects: {
      list: async () => [{ id: "project-1", title: "Révisions" }],
      get: async ({ projectId }: { projectId: string }) => ({
        project: { id: projectId, title: "Révisions", revision: 2 },
        items: [],
      }),
      create: async (input: { title: string }) => ({
        id: "project-created",
        title: input.title,
        revision: 1,
      }),
      update: async (input: { projectId: string; revision: number }) => ({
        id: input.projectId,
        revision: input.revision + 1,
      }),
      addItem: async (input: { projectId: string; referenceId: string }) => ({
        item: {
          id: "item-1",
          projectId: input.projectId,
          referenceId: input.referenceId,
        },
        indexJobId: "job-index-1",
      }),
      removeItem: async () => ({ ok: true }),
      search: async (input: { query: string }) => ({
        searchId: "search-1",
        evidence: [
          {
            citationId: "citation-1",
            snippet: `Résultat ${input.query}`,
            locator: { kind: "pdf", page: 2 },
          },
        ],
        nextCursor: null,
        lexicalOnly: true,
        retrievalMode: "lexical",
        vectorImplementation: null,
      }),
      readCitation: async () => ({
        citation: { referenceId: "citation-1" },
        text: "Passage exact de la page deux",
      }),
      indexStatus: async () => ({
        source: { status: "ready", coverage: "searchable-native-text" },
        lexical: { available: true },
      }),
    },
    materials: {
      documents: {
        get: async ({ documentId }: { documentId: string }) => ({
          document: { id: documentId, title: "Course" },
          file: {
            id: "file-1",
            mimeType: "application/pdf",
            byteSize: 42,
            status: "stored",
          },
        }),
        transcript: async () => ({
          status: "ready",
          content: "abcdefghijklmnopqrstuvwxyz",
          meta: null,
          error: null,
        }),
      },
    },
    grades: {
      attachments: async () => [
        {
          id: "attachment-1",
          label: "Copie",
          sortOrder: 0,
          createdAt: new Date("2026-08-22T00:00:00.000Z"),
          file: {
            id: "grade-file-1",
            mimeType: "application/pdf",
            byteSize: 128,
            url: "https://storage.invalid/copy.pdf?X-Amz-Signature=secret",
          },
        },
      ],
    },
    documents: {
      get: async ({ documentId }: { documentId: string }) => ({
        document: {
          id: documentId,
          title: "Long note",
          bodyMarkdown: "a".repeat(70_000),
          metaJson: null,
        },
        sources: [],
        renderedMarkdown: "b".repeat(70_000),
        transclusionDependencies: [],
      }),
    },
    recordings: {
      get: async ({ recordingId }: { recordingId: string }) => ({
        recording: { id: recordingId, title: "Cours" },
        segments: [
          {
            id: "segment-1",
            file: {
              id: "audio-file-1",
              url: "https://storage.invalid/audio?X-Amz-Signature=secret",
            },
          },
        ],
        transcript: {
          text: "c".repeat(70_000),
          segmentsVersion: 1,
          segments: [],
          language: "fr",
          provider: "test",
          createdAt: new Date("2026-08-22T00:00:00.000Z"),
          updatedAt: new Date("2026-08-22T00:00:00.000Z"),
        },
      }),
    },
    assistant: {
      conversations: {
        search: async (input: {
          query: string;
          mode: "terms" | "phrase" | "prefix" | "exact";
          limit: number;
          cursor: string | null;
        }) => ({
          query: input.query,
          mode: input.mode,
          matches: [
            {
              threadId: "thread-1",
              messageId: "message-1",
              snippet: `Conversation ${input.query}`,
            },
          ],
          nextCursor: input.cursor,
        }),
      },
    },
  } as unknown as Api;
}

function principal(scopes = ["avermate:read"]): McpPrincipal {
  return {
    userId: "user-1",
    clientId: "client-1",
    scopes: new Set(scopes),
    context: {} as McpPrincipal["context"],
  };
}

describe("tool adapter parity", () => {
  test("direct, MCP and embedded adapters expose the same model projection", async () => {
    const broker = createFirstPartyToolBroker(apiFixture());
    const invocation = {
      toolId: "years.get",
      toolVersion: 1,
      input: { yearId: "year-1" },
    } as const;
    const directContext = broker.createContext({
      principal: {
        userId: "user-1",
        clientId: "client-1",
        scopes: new Set(["avermate:read"]),
      },
      approvalMode: "auto",
      approvalProof: null,
      threadId: "thread-1",
      branchId: "branch-1",
      runId: "run-1",
      toolCallId: "call-1",
      signal: new AbortController().signal,
      deadline: new Date(Date.now() + 5_000),
      capabilities: noOpToolCapabilities,
      events: noOpToolEvents,
      actionLedger: noOpActionLedger,
    });
    const direct = (await broker.invoke(directContext, invocation)).model;
    const embeddedContext = broker.createContext({
      ...directContext,
      toolCallId: "call-2",
    });
    const embedded = await invokeBrokerFromEmbedded({
      broker,
      context: embeddedContext,
      invocation,
    });
    const mcp = await invokeBrokerFromMcp({
      broker,
      principal: principal(),
      invocation,
    });
    expect(embedded).toEqual(direct);
    expect(mcp.structuredContent).toEqual(direct);
  });

  test("authorization and cancellation stay structured at every adapter edge", async () => {
    const broker = createFirstPartyToolBroker(apiFixture());
    const denied = await invokeBrokerFromMcp({
      broker,
      principal: principal([]),
      invocation: { toolId: "years.list", toolVersion: 1, input: {} },
    });
    expect(denied.isError).toBe(true);
    expect(denied.structuredContent).toMatchObject({
      error: { code: "SCOPE_DENIED" },
    });

    const controller = new AbortController();
    controller.abort();
    const cancelled = await invokeBrokerFromMcp({
      broker,
      principal: principal(),
      signal: controller.signal,
      invocation: { toolId: "years.list", toolVersion: 1, input: {} },
    });
    expect(cancelled.structuredContent).toMatchObject({
      error: { code: "CANCELLED" },
    });
  });

  test("large transcript bodies are narrowed before reaching an audience", async () => {
    const broker = createFirstPartyToolBroker(apiFixture());
    const result = await invokeBrokerFromMcp({
      broker,
      principal: principal(["avermate:materials.read"]),
      invocation: {
        toolId: "materials.documents.transcript",
        toolVersion: 1,
        input: { documentId: "document-1", maxChars: 10 },
      },
    });
    expect(result.structuredContent).toMatchObject({
      ok: true,
      data: { content: "abcdefghij", truncated: true },
    });
  });

  test("new corpus search keeps direct, MCP and embedded projections identical", async () => {
    const broker = createFirstPartyToolBroker(apiFixture());
    const invocation = {
      toolId: "search.query",
      toolVersion: 1,
      input: {
        query: "Pythagore",
        mode: "terms",
        projectIds: ["project-1"],
        yearIds: [],
        subjectIds: [],
        originKinds: [],
        limit: 5,
        cursor: null,
      },
    } as const;
    const context = broker.createContext({
      principal: {
        userId: "user-1",
        clientId: "client-1",
        scopes: new Set(["avermate:read"]),
      },
      approvalMode: "auto",
      approvalProof: null,
      threadId: "thread-1",
      branchId: "branch-1",
      runId: "run-1",
      toolCallId: "search-direct",
      signal: new AbortController().signal,
      deadline: new Date(Date.now() + 5_000),
      capabilities: noOpToolCapabilities,
      events: noOpToolEvents,
      actionLedger: noOpActionLedger,
    });
    const direct = (await broker.invoke(context, invocation)).model;
    const embedded = await invokeBrokerFromEmbedded({
      broker,
      context: broker.createContext({
        ...context,
        toolCallId: "search-embedded",
      }),
      invocation,
    });
    const mcp = await invokeBrokerFromMcp({
      broker,
      principal: principal(),
      invocation,
    });
    expect(direct).toMatchObject({
      ok: true,
      data: { evidence: [{ citationId: "citation-1" }] },
    });
    expect(embedded).toEqual(direct);
    expect(mcp.structuredContent).toEqual(direct);
  });

  test("conversation search keeps direct, MCP and embedded projections identical", async () => {
    const broker = createFirstPartyToolBroker(apiFixture());
    const invocation = {
      toolId: "conversation.search",
      toolVersion: 1,
      input: {
        query: "Pythagore",
        mode: "terms",
        limit: 5,
        cursor: null,
      },
    } as const;
    const context = broker.createContext({
      principal: {
        userId: "user-1",
        clientId: "client-1",
        scopes: new Set(["avermate:read"]),
      },
      approvalMode: "auto",
      approvalProof: null,
      threadId: "thread-1",
      branchId: "branch-1",
      runId: "run-1",
      toolCallId: "conversation-search-direct",
      signal: new AbortController().signal,
      deadline: new Date(Date.now() + 5_000),
      capabilities: noOpToolCapabilities,
      events: noOpToolEvents,
      actionLedger: noOpActionLedger,
    });
    const direct = (await broker.invoke(context, invocation)).model;
    const embedded = await invokeBrokerFromEmbedded({
      broker,
      context: broker.createContext({
        ...context,
        toolCallId: "conversation-search-embedded",
      }),
      invocation,
    });
    const mcp = await invokeBrokerFromMcp({
      broker,
      principal: principal(),
      invocation,
    });

    expect(direct).toMatchObject({
      ok: true,
      data: { matches: [{ threadId: "thread-1" }] },
    });
    expect(embedded).toEqual(direct);
    expect(mcp.structuredContent).toEqual(direct);
  });

  test("material metadata projects audience-bound opaque handles", async () => {
    const handles = new FileHandleService(
      "test-only-first-party-handle-secret-0123456789-abcdefgh",
    );
    const broker = createFirstPartyToolBroker(apiFixture(), {
      fileHandles: handles,
      ownerId: "user-1",
    });
    const result = await invokeBrokerFromMcp({
      broker,
      principal: principal(["avermate:materials.read"]),
      invocation: {
        toolId: "materials.documents.get",
        toolVersion: 1,
        input: { documentId: "document-1" },
      },
    });
    const data = (result.structuredContent as { data: unknown }).data as {
      file: {
        handles: { preview: { handle: string }; download: { handle: string } };
      };
    };
    expect(data.file.handles.preview.handle).toStartWith("fh1.");
    expect(data.file.handles.preview.handle).not.toContain("file-1");
    expect(
      await handles.resolve({
        handle: data.file.handles.download.handle,
        userId: "user-1",
        audience: "download",
      }),
    ).toMatchObject({ fileId: "file-1" });
  });

  test("grade attachments replace signed URLs with owner-bound handles", async () => {
    const handles = new FileHandleService(
      "grade-attachment-handle-secret-that-is-long-enough",
    );
    const broker = createFirstPartyToolBroker(apiFixture(), {
      fileHandles: handles,
      ownerId: "user-1",
    });
    const result = await invokeBrokerFromMcp({
      broker,
      principal: principal(),
      invocation: {
        toolId: "grades.attachments",
        toolVersion: 1,
        input: { gradeId: "grade-1" },
      },
    });
    const serialized = JSON.stringify(result.structuredContent);
    expect(serialized).not.toContain("X-Amz-Signature");
    const data = (
      result.structuredContent as {
        data: Array<{
          file: { handles: { preview: { handle: string } } };
        }>;
      }
    ).data;
    expect(
      await handles.resolve({
        handle: data[0]!.file.handles.preview.handle,
        userId: "user-1",
        audience: "preview",
      }),
    ).toMatchObject({ fileId: "grade-file-1" });
  });

  test("document and recording reads narrow bodies before projection", async () => {
    const broker = createFirstPartyToolBroker(apiFixture());
    const document = await invokeBrokerFromMcp({
      broker,
      principal: principal(["avermate:documents.read"]),
      invocation: {
        toolId: "documents.get",
        toolVersion: 1,
        input: { documentId: "document-1" },
      },
    });
    expect(document.structuredContent).toMatchObject({
      ok: true,
      data: {
        document: { bodyTruncated: true },
        renderedTruncated: true,
      },
    });

    const transcript = await invokeBrokerFromMcp({
      broker,
      principal: principal(["avermate:materials.read"]),
      invocation: {
        toolId: "recordings.transcript",
        toolVersion: 1,
        input: { recordingId: "recording-1" },
      },
    });
    expect(transcript.structuredContent).toMatchObject({
      ok: true,
      data: { transcript: { textTruncated: true } },
    });
    expect(JSON.stringify(transcript.structuredContent)).not.toContain(
      "X-Amz-Signature",
    );
    expect(JSON.stringify(transcript.structuredContent)).not.toContain(
      "audio-file-1",
    );
  });

  test("the reviewed first-wave catalogue is unique and deterministic", () => {
    const descriptors = firstPartyToolDescriptors(apiFixture());
    const keys = descriptors.map(({ id, version }) => `${id}@${version}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(62);
    expect(keys.map((key) => key.replace(/@1$/, "")).sort()).toEqual(
      [...BROKERED_MCP_READ_TOOL_IDS, ...BROKERED_MCP_MUTATION_TOOL_IDS].sort(),
    );
    expect(
      firstPartyToolDescriptors(apiFixture()).map(
        ({ id, version }) => `${id}@${version}`,
      ),
    ).toEqual(keys);
  });
});
