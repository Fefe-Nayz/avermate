import type {
  ConversationRunRecord,
  EmbedRequest,
  EmbedResult,
  LexicalCandidate,
  LexicalConsistencyReport,
  LexicalSearchCapabilities,
  ModelAccessContext,
  ModelDescriptor,
  ModelGatewayEvent,
  ModelRequest,
  NodeCapabilityId,
  NodeCapabilityOperation,
  NodeDeletionManifest,
  NodeDeletionReceipt,
  NodeConversationTransport,
  NodeLexicalSearchTransport,
  NodeModelGatewayTransport,
  NodeObjectReadTransport,
  NodeProviderFetchPurpose,
  NodeProviderFetchResponse,
  NodeProviderHttpTransport,
  NodeSandboxTransport,
  NodeWireBytes,
  MultipartAbortInput,
  MultipartBeginInput,
  MultipartCompleteInput,
  MultipartHandle,
  MultipartPartInput,
  MultipartPartReceipt,
  ObjectStorageCapabilities,
  ObjectStorageCommit,
  ObjectStorageCopyInput,
  ObjectStorageDeleteInput,
  ObjectStorageDeleteResult,
  ObjectStorageRangeInput,
  ObjectStorageReconcileInput,
  ObjectTransferGrant,
  ObjectTransferGrantInput,
  OwnedObjectRef,
  ObjectStorageMetadata,
  SandboxCapabilities,
  SandboxExecutionEvent,
  SandboxFileManifestEntry,
  SandboxHandle,
  SandboxInputFile,
  SandboxPreflightResult,
  SandboxRuntimeCheckpointCapabilities,
  SandboxRuntimeCheckpointRefV1,
  SandboxWorkspaceSnapshotRef,
  StoredConversationEvent,
  StagedContentChunk,
  TranscriptionRequest,
  TranscriptionResult,
  UsageEstimate,
  NodeMcpConnection,
  NodeMcpRemoteTool,
  NodeMcpInvokeResult,
} from "@avermate/agent-contracts";
import {
  conversationRunRecordSchema,
  lexicalCandidateSchema,
  lexicalVersionInputSchema,
  modelDescriptorSchema,
  nodeDeletionManifestSchema,
  nodeDeletionReceiptSchema,
  objectStorageMetadataSchema,
  objectStorageCapabilitiesSchema,
  objectStorageCommitSchema,
  objectStorageDeleteResultSchema,
  objectTransferGrantSchema,
  multipartHandleSchema,
  multipartPartReceiptSchema,
  ownedObjectRefSchema,
  sandboxCapabilitiesSchema,
  sandboxFileManifestEntrySchema,
  sandboxHandleSchema,
  sandboxPreflightResultSchema,
  sandboxRuntimeCheckpointCapabilitiesSchema,
  sandboxRuntimeCheckpointRefV1Schema,
  sandboxWorkspaceSnapshotRefSchema,
  storedConversationEventSchema,
  stagedContentChunkSchema,
  nodeMcpInspectRequestSchema,
  nodeMcpInspectResultSchema,
  nodeMcpInvokeRequestSchema,
  nodeMcpInvokeResultSchema,
  nodeConversationDagSnapshotSchema,
  nodeConversationDagListResultSchema,
  nodeConversationDagGetResultSchema,
  nodeConversationDagExportResultSchema,
  nodeConversationDagDeleteResultSchema,
} from "@avermate/agent-contracts";
import type { CoreNodeGrantIssuer } from "./core-grant-issuer";
import {
  CoreNodeRelay,
  coreNodeOperationRequestDigest,
  type DispatchNodeOperationInput,
} from "./node-relay";

const MAX_INLINE_BYTES = 128 * 1024;

function jsonWire(value: unknown) {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("NODE_OPERATION_PAYLOAD_INVALID");
  return JSON.parse(encoded) as unknown;
}

function wireBytes(bytes: Uint8Array): NodeWireBytes {
  if (bytes.byteLength > MAX_INLINE_BYTES) {
    throw new Error("NODE_OPERATION_REQUIRES_OBJECT_TRANSFER");
  }
  return {
    encoding: "base64url",
    byteLength: bytes.byteLength,
    data: Buffer.from(bytes).toString("base64url"),
  };
}

function decodeWireBytes(raw: unknown) {
  const value = raw as Partial<NodeWireBytes>;
  if (
    value.encoding !== "base64url" ||
    !Number.isSafeInteger(value.byteLength) ||
    typeof value.data !== "string"
  ) {
    throw new Error("NODE_OPERATION_BYTES_INVALID");
  }
  const bytes = Buffer.from(value.data, "base64url");
  if (
    bytes.byteLength !== value.byteLength ||
    bytes.byteLength > MAX_INLINE_BYTES
  ) {
    throw new Error("NODE_OPERATION_BYTES_INVALID");
  }
  return new Uint8Array(bytes);
}

function withoutSignal<T extends { abortSignal?: AbortSignal }>(input: T) {
  const { abortSignal: _signal, ...wire } = input;
  return wire;
}

function sandboxCreateWire<T extends { expiresAt: Date }>(input: T) {
  const { expiresAt, ...withoutExpiry } = input;
  const { now: _now, ...wire } = withoutExpiry as typeof withoutExpiry & {
    now?: Date;
  };
  return { ...wire, expiresAt: expiresAt.toISOString() };
}

export type RelayActorContext = {
  actorKind: "embedded-agent" | "mcp" | "system" | "user";
  actorClientId?: string;
};

export type NodeProviderFetcher = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

/** Adapter consumed by provider SDKs without exposing the relay protocol. */
export function createRelayNodeProviderFetcher(input: {
  transport: NodeProviderHttpTransport;
  nodeId: string;
  ownerId: string;
  purpose: NodeProviderFetchPurpose;
}): NodeProviderFetcher {
  return async (url, init = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    if (method !== "POST" || typeof init.body !== "string") {
      throw new Error("NODE_PROVIDER_REQUEST_INVALID");
    }
    const headers = new Headers(init.headers);
    const allowedHeaders: Record<string, string> = {};
    for (const [name, value] of headers.entries()) {
      if (!["accept", "content-type"].includes(name.toLowerCase())) {
        throw new Error("NODE_PROVIDER_HEADERS_DENIED");
      }
      allowedHeaders[name.toLowerCase()] = value;
    }
    const response = await input.transport.fetchNodeProvider({
      nodeId: input.nodeId,
      ownerId: input.ownerId,
      request: {
        purpose: input.purpose,
        url: url.toString(),
        method: "POST",
        headers: allowedHeaders,
        body: wireBytes(new TextEncoder().encode(init.body)),
      },
      signal: init.signal ?? undefined,
    });
    const body = decodeWireBytes(response.body);
    return new Response(body.byteLength > 0 ? body : null, {
      status: response.status,
      headers: response.headers,
    });
  };
}

/** All provider contracts over the authenticated Core→Node relay. */
export class RelayNodeProviderTransport
  implements
    NodeConversationTransport,
    NodeLexicalSearchTransport,
    NodeModelGatewayTransport,
    NodeObjectReadTransport,
    NodeProviderHttpTransport,
    NodeSandboxTransport
{
  constructor(
    private readonly input: {
      relay: CoreNodeRelay;
      issuer: CoreNodeGrantIssuer;
      actor?: (ownerId: string) => RelayActorContext;
      deadlineMs?: number;
      byteLimit?: number;
      tokenLimit?: number;
      costMinorLimit?: number;
    },
  ) {}

  async online(nodeId: string) {
    return this.input.relay.online(nodeId);
  }

  async executeNodeDeletionManifest(input: {
    nodeId: string;
    ownerId: string;
    manifest: NodeDeletionManifest;
    signal?: AbortSignal;
  }): Promise<NodeDeletionReceipt> {
    const manifest = nodeDeletionManifestSchema.parse(input.manifest);
    if (
      manifest.nodeId !== input.nodeId ||
      manifest.userId !== input.ownerId ||
      manifest.refs.some(
        (artifact) => artifact.object.ownerId !== input.ownerId,
      )
    ) {
      throw new Error("NODE_DELETION_MANIFEST_OWNER_MISMATCH");
    }
    return nodeDeletionReceiptSchema.parse(
      await this.#single({
        nodeId: input.nodeId,
        ownerId: input.ownerId,
        capability: "storage",
        operation: "storage.execute-deletion-manifest",
        value: { manifest },
        resources: manifest.refs.map((artifact) => artifact.object),
        ...(input.signal ? { signal: input.signal } : {}),
      }),
    );
  }

  async #single(input: {
    nodeId: string;
    ownerId: string;
    capability: NodeCapabilityId;
    operation: NodeCapabilityOperation;
    value: unknown;
    signal?: AbortSignal;
    resources?: OwnedObjectRef[];
    byteLimit?: number;
  }) {
    return this.input.relay.requestOperation(await this.#request(input));
  }

  async #stream(input: {
    nodeId: string;
    ownerId: string;
    capability: NodeCapabilityId;
    operation: NodeCapabilityOperation;
    value: unknown;
    signal?: AbortSignal;
    resources?: OwnedObjectRef[];
    byteLimit?: number;
  }) {
    return this.input.relay.dispatchOperation(await this.#request(input));
  }

  async #request(input: {
    nodeId: string;
    ownerId: string;
    capability: NodeCapabilityId;
    operation: NodeCapabilityOperation;
    value: unknown;
    signal?: AbortSignal;
    resources?: OwnedObjectRef[];
    byteLimit?: number;
  }): Promise<DispatchNodeOperationInput> {
    const state = this.input.relay.inspect(input.nodeId);
    if (!state) throw new Error("NODE_CAPABILITY_OFFLINE");
    if (state.userId !== input.ownerId) {
      throw new Error("NODE_CAPABILITY_OWNER_MISMATCH");
    }
    if (!/^sha256:[a-f0-9]{64}$/u.test(state.configRevision)) {
      throw new Error("NODE_CAPABILITY_REVISION_INVALID");
    }
    const operationId = `nodeop_${crypto.randomUUID()}`;
    const deadline = new Date(
      Date.now() + (this.input.deadlineMs ?? 4 * 60_000),
    ).toISOString();
    const payload = { ownerId: input.ownerId, input: jsonWire(input.value) };
    const base = {
      userId: input.ownerId,
      nodeId: input.nodeId,
      capability: input.capability,
      capabilityVersion: 1,
      operationId,
      operation: input.operation,
      payload,
      configRevision: state.configRevision,
      deadline,
    };
    const requestDigest = coreNodeOperationRequestDigest(base);
    const actor = this.input.actor?.(input.ownerId) ?? {
      actorKind: "system" as const,
    };
    const grant = this.input.issuer.issueOperation({
      nodeId: input.nodeId,
      userId: input.ownerId,
      ...actor,
      operationId,
      operation: input.operation,
      requestDigest,
      configRevision: state.configRevision as `sha256:${string}`,
      capability: `node:${input.capability}:${input.operation}`,
      resources: input.resources,
      byteLimit: input.byteLimit ?? this.input.byteLimit ?? 2 * 1024 * 1024,
      tokenLimit: this.input.tokenLimit ?? 2_000_000,
      costMinorLimit: this.input.costMinorLimit ?? 1_000_000,
      deadline,
    });
    return { ...base, grant, signal: input.signal };
  }

  async provisionConversationRun(
    input: Parameters<
      NonNullable<NodeConversationTransport["provisionConversationRun"]>
    >[0],
  ): Promise<ConversationRunRecord> {
    return conversationRunRecordSchema.parse(
      await this.#single({
        ...input,
        capability: "conversations",
        operation: "conversation.provision",
        value: input.run,
      }),
    );
  }

  async appendConversationEvent(
    input: Parameters<NodeConversationTransport["appendConversationEvent"]>[0],
  ): Promise<StoredConversationEvent> {
    return storedConversationEventSchema.parse(
      await this.#single({
        ...input,
        capability: "conversations",
        operation: "conversation.append-event",
        value: input.event,
      }),
    );
  }

  async *replayConversationEvents(
    input: Parameters<NodeConversationTransport["replayConversationEvents"]>[0],
  ): AsyncIterable<StoredConversationEvent> {
    const stream = await this.#stream({
      ...input,
      capability: "conversations",
      operation: "conversation.replay-events",
      value: input.replay,
    });
    for await (const event of stream) {
      yield storedConversationEventSchema.parse(event);
    }
  }

  async getConversationRun(
    input: Parameters<NodeConversationTransport["getConversationRun"]>[0],
  ): Promise<ConversationRunRecord | null> {
    const result = await this.#single({
      ...input,
      capability: "conversations",
      operation: "conversation.get-run",
      value: input.run,
    });
    return result === null ? null : conversationRunRecordSchema.parse(result);
  }

  exportNodeConversations(
    input: Parameters<
      NonNullable<NodeConversationTransport["exportNodeConversations"]>
    >[0],
  ) {
    return this.#single({
      ...input,
      capability: "conversations",
      operation: "conversation.export-owner",
      value: {},
    });
  }

  async deleteNodeConversations(
    input: Parameters<
      NonNullable<NodeConversationTransport["deleteNodeConversations"]>
    >[0],
  ) {
    const result = (await this.#single({
      ...input,
      capability: "conversations",
      operation: "conversation.delete-owner",
      value: {},
    })) as { deletedRuns?: unknown; deletedEvents?: unknown };
    if (
      !Number.isSafeInteger(result.deletedRuns) ||
      !Number.isSafeInteger(result.deletedEvents)
    ) {
      throw new Error("NODE_CONVERSATION_DELETE_RESULT_INVALID");
    }
    return result as { deletedRuns: number; deletedEvents: number };
  }

  async importConversationDag(input: {
    nodeId: string;
    ownerId: string;
    operation: "create" | "append" | "branch";
    snapshot: import("@avermate/agent-contracts").NodeConversationDagSnapshot;
  }) {
    return nodeConversationDagSnapshotSchema.parse(
      await this.#single({
        nodeId: input.nodeId,
        ownerId: input.ownerId,
        capability: "conversations",
        operation: `conversation.dag-${input.operation}`,
        value: input.snapshot,
        byteLimit: 32 * 1024 * 1024,
      }),
    );
  }

  async listConversationDags(input: {
    nodeId: string;
    ownerId: string;
    query: import("@avermate/agent-contracts").NodeConversationDagListInput;
  }) {
    return nodeConversationDagListResultSchema.parse({
      items: await this.#single({
        nodeId: input.nodeId,
        ownerId: input.ownerId,
        capability: "conversations",
        operation: "conversation.dag-list",
        value: input.query,
        byteLimit: 8 * 1024 * 1024,
      }),
    }).items;
  }

  async getConversationDag(input: {
    nodeId: string;
    ownerId: string;
    threadId: string;
  }) {
    const result = await this.#single({
      ...input,
      capability: "conversations",
      operation: "conversation.dag-get",
      value: { threadId: input.threadId },
      byteLimit: 32 * 1024 * 1024,
    });
    return result === null
      ? null
      : nodeConversationDagGetResultSchema.parse(result);
  }

  async exportConversationDag(input: {
    nodeId: string;
    ownerId: string;
    threadId: string;
  }) {
    return nodeConversationDagExportResultSchema.parse(
      await this.#single({
        ...input,
        capability: "conversations",
        operation: "conversation.dag-export",
        value: { threadId: input.threadId },
        byteLimit: 32 * 1024 * 1024,
      }),
    );
  }

  async deleteConversationDag(input: {
    nodeId: string;
    ownerId: string;
    threadId: string;
  }) {
    return nodeConversationDagDeleteResultSchema.parse(
      await this.#single({
        ...input,
        capability: "conversations",
        operation: "conversation.dag-delete",
        value: { threadId: input.threadId },
      }),
    );
  }

  async lexicalCapabilities(
    input: Parameters<NodeLexicalSearchTransport["lexicalCapabilities"]>[0],
  ): Promise<LexicalSearchCapabilities> {
    return (await this.#single({
      ...input,
      capability: "retrieval",
      operation: "lexical.capabilities",
      value: {},
    })) as LexicalSearchCapabilities;
  }

  async upsertLexicalVersion(
    input: Parameters<NodeLexicalSearchTransport["upsertLexicalVersion"]>[0],
  ) {
    await this.#single({
      ...input,
      capability: "retrieval",
      operation: "lexical.upsert-version",
      value: input.version,
    });
  }

  async removeLexicalVersion(
    input: Parameters<NodeLexicalSearchTransport["removeLexicalVersion"]>[0],
  ) {
    await this.#single({
      ...input,
      capability: "retrieval",
      operation: "lexical.remove-version",
      value: { versionId: input.versionId },
    });
  }

  async searchLexical(
    input: Parameters<NodeLexicalSearchTransport["searchLexical"]>[0],
  ): Promise<LexicalCandidate[]> {
    const result = await this.#single({
      ...input,
      capability: "retrieval",
      operation: "lexical.search",
      value: input.query,
    });
    if (!Array.isArray(result)) throw new Error("NODE_LEXICAL_RESULT_INVALID");
    return result.map((candidate) => lexicalCandidateSchema.parse(candidate));
  }

  async getLexicalChunks(
    input: Parameters<NodeLexicalSearchTransport["getLexicalChunks"]>[0],
  ): Promise<StagedContentChunk[]> {
    const chunkIds = [...new Set(input.chunkIds)];
    if (chunkIds.length === 0 || chunkIds.length > 64) {
      throw new Error("NODE_LEXICAL_CHUNK_REQUEST_INVALID");
    }
    const result = await this.#single({
      ...input,
      capability: "retrieval",
      operation: "lexical.get-chunks",
      value: { chunkIds },
      byteLimit: 16 * 1024 * 1024,
    });
    const chunks = stagedContentChunkSchema.array().max(64).parse(result);
    const returnedIds = chunks.map((chunk) => chunk.chunkId);
    if (
      chunks.length !== chunkIds.length ||
      returnedIds.some((id) => !id) ||
      new Set(returnedIds).size !== chunkIds.length ||
      chunkIds.some((id) => !returnedIds.includes(id))
    ) {
      throw new Error("NODE_LEXICAL_CHUNK_RESULT_INCOMPLETE");
    }
    return chunks;
  }

  async verifyLexical(
    input: Parameters<NodeLexicalSearchTransport["verifyLexical"]>[0],
  ): Promise<LexicalConsistencyReport> {
    return (await this.#single({
      ...input,
      capability: "retrieval",
      operation: "lexical.verify",
      value: {},
    })) as LexicalConsistencyReport;
  }

  async exportLexicalOwner(
    input: Parameters<NodeLexicalSearchTransport["exportLexicalOwner"]>[0],
  ) {
    const result = await this.#single({
      ...input,
      capability: "retrieval",
      operation: "lexical.export-owner",
      value: {},
      byteLimit: 32 * 1024 * 1024,
    });
    return lexicalVersionInputSchema.array().max(100_000).parse(result);
  }

  async deleteLexicalOwner(
    input: Parameters<NodeLexicalSearchTransport["deleteLexicalOwner"]>[0],
  ) {
    const result = (await this.#single({
      ...input,
      capability: "retrieval",
      operation: "lexical.delete-owner",
      value: {},
    })) as { deletedVersions?: unknown };
    if (!Number.isSafeInteger(result.deletedVersions)) {
      throw new Error("NODE_LEXICAL_DELETE_RESULT_INVALID");
    }
    return result as { deletedVersions: number };
  }

  async statNodeObject(
    input: Parameters<NodeObjectReadTransport["statNodeObject"]>[0],
  ): Promise<ObjectStorageMetadata | null> {
    const ref = ownedObjectRefSchema.parse(input.ref);
    const result = await this.#single({
      ...input,
      capability: "storage",
      operation: "storage.stat",
      value: { ref },
      resources: [ref],
    });
    return result === null ? null : objectStorageMetadataSchema.parse(result);
  }

  async nodeStorageCapabilities(input: {
    nodeId: string;
    ownerId: string;
  }): Promise<ObjectStorageCapabilities> {
    return objectStorageCapabilitiesSchema.parse(
      await this.#single({
        ...input,
        capability: "storage",
        operation: "storage.capabilities",
        value: {},
      }),
    );
  }

  async *readNodeObject(
    input: Parameters<NodeObjectReadTransport["readNodeObject"]>[0],
  ): AsyncIterable<Uint8Array> {
    const ref = ownedObjectRefSchema.parse(input.ref);
    if (
      !Number.isSafeInteger(input.maxBytes) ||
      input.maxBytes <= 0 ||
      input.maxBytes > 32 * 1024 * 1024
    ) {
      throw new Error("NODE_OBJECT_READ_LIMIT_INVALID");
    }
    const stream = await this.#stream({
      ...input,
      capability: "storage",
      operation: "storage.get",
      value: { ref, maxBytes: input.maxBytes },
      resources: [ref],
      // Base64url plus the bounded result envelope stays below this fence.
      byteLimit: Math.ceil(input.maxBytes * 1.5) + 1024 * 1024,
    });
    for await (const chunk of stream) yield decodeWireBytes(chunk);
  }

  async *readNodeObjectRange(input: {
    nodeId: string;
    ownerId: string;
    range: ObjectStorageRangeInput;
    signal?: AbortSignal;
  }): AsyncIterable<Uint8Array> {
    const ref = ownedObjectRefSchema.parse(input.range.ref);
    const byteLimit = input.range.endInclusive - input.range.start + 1;
    const stream = await this.#stream({
      nodeId: input.nodeId,
      ownerId: input.ownerId,
      capability: "storage",
      operation: "storage.get-range",
      value: input.range,
      resources: [ref],
      byteLimit: Math.ceil(byteLimit * 1.5) + 1024 * 1024,
      signal: input.signal,
    });
    for await (const chunk of stream) yield decodeWireBytes(chunk);
  }

  async putNodeObject(input: {
    nodeId: string;
    ownerId: string;
    ref: OwnedObjectRef;
    body: Uint8Array;
    mimeType: string;
    expectedDigest: `sha256:${string}`;
    idempotencyKey: string;
    signal?: AbortSignal;
  }): Promise<ObjectStorageCommit> {
    if (input.body.byteLength > MAX_INLINE_BYTES) {
      throw new Error("NODE_STORAGE_MULTIPART_REQUIRED");
    }
    return objectStorageCommitSchema.parse(
      await this.#single({
        nodeId: input.nodeId,
        ownerId: input.ownerId,
        capability: "storage",
        operation: "storage.put",
        value: {
          ref: input.ref,
          byteSize: input.body.byteLength,
          mimeType: input.mimeType,
          expectedDigest: input.expectedDigest,
          idempotencyKey: input.idempotencyKey,
          body: wireBytes(input.body),
        },
        resources: [input.ref],
        byteLimit: Math.ceil(input.body.byteLength * 1.5) + 64 * 1024,
        signal: input.signal,
      }),
    );
  }

  async deleteNodeObject(input: {
    nodeId: string;
    ownerId: string;
    value: ObjectStorageDeleteInput;
  }): Promise<ObjectStorageDeleteResult> {
    return objectStorageDeleteResultSchema.parse(
      await this.#single({
        nodeId: input.nodeId,
        ownerId: input.ownerId,
        capability: "storage",
        operation: "storage.delete",
        value: input.value,
        resources: [input.value.ref],
      }),
    );
  }

  async beginNodeMultipart(input: {
    nodeId: string;
    ownerId: string;
    value: MultipartBeginInput;
  }): Promise<MultipartHandle> {
    return multipartHandleSchema.parse(
      await this.#single({
        nodeId: input.nodeId,
        ownerId: input.ownerId,
        capability: "storage",
        operation: "storage.multipart-begin",
        value: input.value,
        resources: [input.value.ref],
      }),
    );
  }

  async uploadNodeMultipartPart(input: {
    nodeId: string;
    ownerId: string;
    uploadId: string;
    partNumber: number;
    body: Uint8Array;
    expectedDigest: `sha256:${string}`;
  }): Promise<MultipartPartReceipt> {
    if (input.body.byteLength > MAX_INLINE_BYTES) {
      throw new Error("NODE_STORAGE_PART_TOO_LARGE_FOR_RELAY");
    }
    return multipartPartReceiptSchema.parse(
      await this.#single({
        nodeId: input.nodeId,
        ownerId: input.ownerId,
        capability: "storage",
        operation: "storage.multipart-part",
        value: {
          uploadId: input.uploadId,
          ownerId: input.ownerId,
          partNumber: input.partNumber,
          byteSize: input.body.byteLength,
          expectedDigest: input.expectedDigest,
          body: wireBytes(input.body),
        },
        byteLimit: Math.ceil(input.body.byteLength * 1.5) + 64 * 1024,
      }),
    );
  }

  async completeNodeMultipart(input: {
    nodeId: string;
    ownerId: string;
    value: MultipartCompleteInput;
  }): Promise<ObjectStorageCommit> {
    return objectStorageCommitSchema.parse(
      await this.#single({
        nodeId: input.nodeId,
        ownerId: input.ownerId,
        capability: "storage",
        operation: "storage.multipart-complete",
        value: input.value,
      }),
    );
  }

  async abortNodeMultipart(input: {
    nodeId: string;
    ownerId: string;
    value: MultipartAbortInput;
  }) {
    await this.#single({
      nodeId: input.nodeId,
      ownerId: input.ownerId,
      capability: "storage",
      operation: "storage.multipart-abort",
      value: input.value,
    });
  }

  async copyNodeObject(input: {
    nodeId: string;
    ownerId: string;
    value: ObjectStorageCopyInput;
  }): Promise<ObjectStorageCommit> {
    return objectStorageCommitSchema.parse(
      await this.#single({
        nodeId: input.nodeId,
        ownerId: input.ownerId,
        capability: "storage",
        operation: "storage.copy",
        value: input.value,
        resources: [input.value.source, input.value.destination],
      }),
    );
  }

  async *reconcileNodeObjects(input: {
    nodeId: string;
    ownerId: string;
    value: ObjectStorageReconcileInput;
  }): AsyncIterable<ObjectStorageMetadata> {
    const stream = await this.#stream({
      nodeId: input.nodeId,
      ownerId: input.ownerId,
      capability: "storage",
      operation: "storage.reconcile",
      value: input.value,
    });
    for await (const entry of stream) {
      yield objectStorageMetadataSchema.parse(entry);
    }
  }

  async authorizeNodeObjectTransfer(input: {
    nodeId: string;
    ownerId: string;
    value: ObjectTransferGrantInput;
  }): Promise<ObjectTransferGrant> {
    return objectTransferGrantSchema.parse(
      await this.#single({
        nodeId: input.nodeId,
        ownerId: input.ownerId,
        capability: "storage",
        operation: "storage.authorize-transfer",
        value: input.value,
        resources: [input.value.ref],
      }),
    );
  }

  async fetchNodeProvider(
    input: Parameters<NodeProviderHttpTransport["fetchNodeProvider"]>[0],
  ): Promise<NodeProviderFetchResponse> {
    const result = (await this.#single({
      ...input,
      capability: "retrieval",
      operation: "retrieval.provider-fetch",
      value: input.request,
      signal: input.signal,
    })) as Partial<NodeProviderFetchResponse>;
    if (
      !Number.isSafeInteger(result.status) ||
      (result.status as number) < 100 ||
      (result.status as number) > 599 ||
      !result.headers ||
      !result.body
    ) {
      throw new Error("NODE_PROVIDER_RESPONSE_INVALID");
    }
    decodeWireBytes(result.body);
    return result as NodeProviderFetchResponse;
  }

  async inspectNodeMcp(input: {
    nodeId: string;
    ownerId: string;
    connection: NodeMcpConnection;
    signal?: AbortSignal;
  }): Promise<readonly NodeMcpRemoteTool[]> {
    const request = nodeMcpInspectRequestSchema.parse({
      connection: input.connection,
    });
    const result = nodeMcpInspectResultSchema.parse(
      await this.#single({
        nodeId: input.nodeId,
        ownerId: input.ownerId,
        capability: "mcp",
        operation: "mcp.inspect",
        value: request,
        byteLimit: 2 * 1024 * 1024,
        ...(input.signal ? { signal: input.signal } : {}),
      }),
    );
    return result.tools;
  }

  async invokeNodeMcp(input: {
    nodeId: string;
    ownerId: string;
    connection: NodeMcpConnection;
    remoteToolId: string;
    arguments: Record<string, unknown>;
    signal?: AbortSignal;
  }): Promise<NodeMcpInvokeResult> {
    const request = nodeMcpInvokeRequestSchema.parse({
      connection: input.connection,
      remoteToolId: input.remoteToolId,
      arguments: input.arguments,
    });
    return nodeMcpInvokeResultSchema.parse(
      await this.#single({
        nodeId: input.nodeId,
        ownerId: input.ownerId,
        capability: "mcp",
        operation: "mcp.invoke",
        value: request,
        byteLimit: 512 * 1024,
        ...(input.signal ? { signal: input.signal } : {}),
      }),
    );
  }

  async listNodeModels(
    input: Parameters<NodeModelGatewayTransport["listNodeModels"]>[0],
  ): Promise<ModelDescriptor[]> {
    const result = await this.#single({
      nodeId: input.nodeId,
      ownerId: input.context.ownerId,
      capability: "models",
      operation: "model.list",
      value: input.context,
    });
    if (!Array.isArray(result)) throw new Error("NODE_MODEL_LIST_INVALID");
    return result.map((model) => modelDescriptorSchema.parse(model));
  }

  async *streamNodeModel(
    input: Parameters<NodeModelGatewayTransport["streamNodeModel"]>[0],
  ): AsyncIterable<ModelGatewayEvent> {
    const stream = await this.#stream({
      nodeId: input.nodeId,
      ownerId: input.request.ownerId,
      capability: "models",
      operation: "model.stream",
      value: withoutSignal(input.request),
      signal: input.request.abortSignal,
    });
    for await (const event of stream) yield event as ModelGatewayEvent;
  }

  async embedWithNodeModel(
    input: Parameters<NodeModelGatewayTransport["embedWithNodeModel"]>[0],
  ): Promise<EmbedResult> {
    return (await this.#single({
      nodeId: input.nodeId,
      ownerId: input.request.ownerId,
      capability: "models",
      operation: "model.embed",
      value: withoutSignal(input.request),
      signal: input.request.abortSignal,
    })) as EmbedResult;
  }

  async transcribeWithNodeModel(
    input: Parameters<NodeModelGatewayTransport["transcribeWithNodeModel"]>[0],
  ): Promise<TranscriptionResult> {
    const media = new Uint8Array(await input.request.media.arrayBuffer());
    return (await this.#single({
      nodeId: input.nodeId,
      ownerId: input.request.ownerId,
      capability: "models",
      operation: "model.transcribe",
      value: {
        ...withoutSignal(input.request),
        media: wireBytes(media),
        mediaType: input.request.media.type || "application/octet-stream",
      },
      signal: input.request.abortSignal,
    })) as TranscriptionResult;
  }

  async estimateNodeModel(
    input: Parameters<NodeModelGatewayTransport["estimateNodeModel"]>[0],
  ): Promise<UsageEstimate> {
    return (await this.#single({
      nodeId: input.nodeId,
      ownerId: input.request.ownerId,
      capability: "models",
      operation: "model.estimate",
      value: withoutSignal(input.request),
      signal: input.request.abortSignal,
    })) as UsageEstimate;
  }

  async sandboxCapabilities(
    input: Parameters<NodeSandboxTransport["sandboxCapabilities"]>[0],
  ): Promise<SandboxCapabilities> {
    return sandboxCapabilitiesSchema.parse(
      await this.#single({
        ...input,
        capability: "sandbox",
        operation: "sandbox.capabilities",
        value: { providerId: input.providerId },
      }),
    );
  }

  async preflightSandbox(
    input: Parameters<NodeSandboxTransport["preflightSandbox"]>[0],
  ): Promise<SandboxPreflightResult> {
    const { now: _now, ...preflight } = input.preflight;
    return sandboxPreflightResultSchema.parse(
      await this.#single({
        ...input,
        capability: "sandbox",
        operation: "sandbox.preflight",
        value: {
          providerId: input.providerId,
          preflight,
        },
      }),
    );
  }

  async createSandbox(
    input: Parameters<NodeSandboxTransport["createSandbox"]>[0],
  ): Promise<SandboxHandle> {
    return sandboxHandleSchema.parse(
      await this.#single({
        ...input,
        capability: "sandbox",
        operation: "sandbox.create",
        value: {
          providerId: input.providerId,
          create: sandboxCreateWire(input.create),
        },
      }),
    );
  }

  async *executeSandbox(
    input: Parameters<NodeSandboxTransport["executeSandbox"]>[0],
  ): AsyncIterable<SandboxExecutionEvent> {
    const { signal, ...execute } = input.execute;
    const stream = await this.#stream({
      ...input,
      capability: "sandbox",
      operation: "sandbox.execute",
      value: { providerId: input.providerId, execute },
      signal,
    });
    for await (const event of stream) yield event as SandboxExecutionEvent;
  }

  async putSandboxFiles(
    input: Parameters<NodeSandboxTransport["putSandboxFiles"]>[0],
  ) {
    await this.#single({
      ...input,
      capability: "sandbox",
      operation: "sandbox.put-files",
      value: {
        providerId: input.providerId,
        handle: input.handle,
        files: input.files.map((file) => ({
          ...file,
          bytes: wireBytes(file.bytes),
        })),
      },
    });
  }

  async getSandboxFiles(
    input: Parameters<NodeSandboxTransport["getSandboxFiles"]>[0],
  ): Promise<readonly SandboxFileManifestEntry[]> {
    const result = await this.#single({
      ...input,
      capability: "sandbox",
      operation: "sandbox.get-files",
      value: {
        providerId: input.providerId,
        handle: input.handle,
        paths: input.paths,
      },
    });
    if (!Array.isArray(result)) throw new Error("NODE_SANDBOX_FILES_INVALID");
    return result.map((entry) => sandboxFileManifestEntrySchema.parse(entry));
  }

  async *readSandboxFile(
    input: Parameters<NodeSandboxTransport["readSandboxFile"]>[0],
  ): AsyncIterable<Uint8Array> {
    const stream = await this.#stream({
      ...input,
      capability: "sandbox",
      operation: "sandbox.read-file",
      value: {
        providerId: input.providerId,
        handle: input.handle,
        relativePath: input.relativePath,
      },
    });
    for await (const chunk of stream) yield decodeWireBytes(chunk);
  }

  async snapshotNodeWorkspace(
    input: Parameters<NodeSandboxTransport["snapshotNodeWorkspace"]>[0],
  ): Promise<SandboxWorkspaceSnapshotRef> {
    return sandboxWorkspaceSnapshotRefSchema.parse(
      await this.#single({
        ...input,
        capability: "sandbox",
        operation: "sandbox.snapshot-workspace",
        value: { providerId: input.providerId, handle: input.handle },
      }),
    );
  }

  async forkNodeWorkspace(
    input: Parameters<NodeSandboxTransport["forkNodeWorkspace"]>[0],
  ): Promise<SandboxHandle> {
    return sandboxHandleSchema.parse(
      await this.#single({
        ...input,
        capability: "sandbox",
        operation: "sandbox.fork-workspace",
        value: {
          providerId: input.providerId,
          create: {
            ...sandboxCreateWire(input.create),
            source: input.create.source,
          },
        },
      }),
    );
  }

  async stopSandbox(input: Parameters<NodeSandboxTransport["stopSandbox"]>[0]) {
    await this.#single({
      ...input,
      capability: "sandbox",
      operation: "sandbox.stop",
      value: { providerId: input.providerId, handle: input.handle },
    });
  }

  async destroySandbox(
    input: Parameters<NodeSandboxTransport["destroySandbox"]>[0],
  ) {
    await this.#single({
      ...input,
      capability: "sandbox",
      operation: "sandbox.destroy",
      value: { providerId: input.providerId, handle: input.handle },
    });
  }

  async sandboxRuntimeCheckpointCapabilities(
    input: Parameters<
      NodeSandboxTransport["sandboxRuntimeCheckpointCapabilities"]
    >[0],
  ): Promise<SandboxRuntimeCheckpointCapabilities> {
    return sandboxRuntimeCheckpointCapabilitiesSchema.parse(
      await this.#single({
        ...input,
        capability: "sandbox",
        operation: "sandbox.runtime-checkpoint-capabilities",
        value: { providerId: input.providerId },
      }),
    );
  }

  async captureSandboxRuntimeCheckpoint(
    input: Parameters<
      NodeSandboxTransport["captureSandboxRuntimeCheckpoint"]
    >[0],
  ): Promise<SandboxRuntimeCheckpointRefV1> {
    return sandboxRuntimeCheckpointRefV1Schema.parse(
      await this.#single({
        ...input,
        capability: "sandbox",
        operation: "sandbox.capture-runtime-checkpoint",
        value: {
          providerId: input.providerId,
          handle: input.handle,
          sourceWorkspaceSnapshot: input.sourceWorkspaceSnapshot,
          compatibility: input.compatibility,
          idempotencyKey: input.idempotencyKey,
          expiresAt: input.expiresAt,
        },
      }),
    );
  }

  async restoreSandboxRuntimeCheckpoint(
    input: Parameters<
      NodeSandboxTransport["restoreSandboxRuntimeCheckpoint"]
    >[0],
  ): Promise<SandboxHandle> {
    return sandboxHandleSchema.parse(
      await this.#single({
        ...input,
        capability: "sandbox",
        operation: "sandbox.restore-runtime-checkpoint",
        value: {
          providerId: input.providerId,
          create: sandboxCreateWire(input.create),
          checkpoint: input.checkpoint,
        },
      }),
    );
  }

  async deleteSandboxRuntimeCheckpoint(
    input: Parameters<
      NodeSandboxTransport["deleteSandboxRuntimeCheckpoint"]
    >[0],
  ) {
    await this.#single({
      ...input,
      capability: "sandbox",
      operation: "sandbox.delete-runtime-checkpoint",
      value: { providerId: input.providerId, checkpoint: input.checkpoint },
    });
  }
}
