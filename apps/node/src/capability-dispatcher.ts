import {
  contextBlockSchema,
  modelAccessContextSchema,
  nodeCapabilityOperationSchema,
  nodeDeletionManifestSchema,
  nodeOperationCapability,
  nodeOperationPayloadSchema,
  nodeMcpInspectRequestSchema,
  nodeMcpInvokeRequestSchema,
  nodeConversationDagGetInputSchema,
  nodeConversationDagListInputSchema,
  nodeConversationDagSnapshotSchema,
  nodeWireBytesSchema,
  objectSha256Schema,
  objectStorageCopyInputSchema,
  objectStorageDeleteInputSchema,
  objectStorageRangeInputSchema,
  objectStorageReconcileInputSchema,
  objectTransferGrantInputSchema,
  multipartAbortInputSchema,
  multipartBeginInputSchema,
  multipartCompleteInputSchema,
  ownedObjectRefSchema,
  sandboxHandleSchema,
  sandboxRuntimeCheckpointCompatibilityV1Schema,
  sandboxRuntimeCheckpointRefV1Schema,
  sandboxWorkspaceSnapshotRefSchema,
  type ModelGatewayEvent,
  type NodeCapabilityGrantClaims,
  type NodeCapabilityOperation,
  type NodeControlFrame,
  type NodeWireBytes,
  type SandboxCreateInput,
  type SandboxExecuteInput,
  type SandboxInputFile,
  type SignedNodeCapabilityGrant,
} from "@avermate/agent-contracts";
import { z } from "zod";
import { canonicalDigest } from "./canonical-json";
import type { LocalNodeProviderTransport } from "./provider-transport";
import { verifyCanonical } from "./identity";
import { GrantReplayLedger } from "./protocol";
import {
  NodeOperationResultLedger,
  type StoredOperationResult,
} from "./operation-ledger";

type OperationRequest = Extract<
  NodeControlFrame,
  { type: "operation-request" }
>;

const modelRequestWireSchema = z.strictObject({
  ownerId: z.string().min(1).max(256),
  runId: z.string().min(1).max(256),
  requestKey: z.string().min(1).max(512).optional(),
  modelId: z.string().min(1).max(256),
  messages: z.array(contextBlockSchema).max(10_000),
  tools: z
    .array(
      z.strictObject({
        name: z.string().min(1).max(256),
        description: z.string().max(16_384),
        inputSchema: z.unknown(),
      }),
    )
    .max(1_000),
  maximumOutputTokens: z.number().int().positive().max(10_000_000).optional(),
});

const embedRequestWireSchema = z.strictObject({
  ownerId: z.string().min(1).max(256),
  operationId: z.string().min(1).max(256).optional(),
  modelId: z.string().min(1).max(256),
  inputs: z.array(z.string().max(2_000_000)).max(10_000),
});

const transcriptionRequestWireSchema = z.strictObject({
  ownerId: z.string().min(1).max(256),
  operationId: z.string().min(1).max(256).optional(),
  maximumSeconds: z
    .number()
    .positive()
    .max(24 * 60 * 60)
    .optional(),
  modelId: z.string().min(1).max(256),
  media: nodeWireBytesSchema,
  mediaType: z.string().min(1).max(256),
  language: z.string().min(1).max(64).optional(),
});

const providerFetchRequestSchema = z.strictObject({
  purpose: z.enum(["embedding", "rerank"]),
  url: z.url().max(2_048),
  method: z.literal("POST"),
  headers: z.record(z.string().max(128), z.string().max(1_024)),
  body: nodeWireBytesSchema,
});

const lexicalChunkRequestSchema = z.strictObject({
  chunkIds: z.array(z.string().min(1).max(256)).min(1).max(64),
});

const nodeObjectReadSchema = z.strictObject({
  ref: ownedObjectRefSchema,
  maxBytes: z
    .number()
    .int()
    .positive()
    .max(32 * 1024 * 1024),
});

const nodeObjectPutWireSchema = z.strictObject({
  ref: ownedObjectRefSchema,
  byteSize: z
    .number()
    .int()
    .positive()
    .max(128 * 1024),
  mimeType: z.string().min(1).max(255),
  expectedDigest: objectSha256Schema,
  idempotencyKey: z.string().min(1).max(256),
  body: nodeWireBytesSchema,
});

const nodeMultipartPartWireSchema = z.strictObject({
  uploadId: z.string().min(1).max(256),
  ownerId: z.string().min(1).max(256),
  partNumber: z.number().int().positive().max(10_000),
  byteSize: z
    .number()
    .int()
    .positive()
    .max(128 * 1024),
  expectedDigest: objectSha256Schema,
  body: nodeWireBytesSchema,
});

const NODE_OBJECT_RELAY_CHUNK_BYTES = 96 * 1024;

function exactGrantedObject(
  claims: NodeCapabilityGrantClaims,
  ref: z.infer<typeof ownedObjectRefSchema>,
) {
  const granted = claims.resources[0];
  if (
    claims.resources.length !== 1 ||
    !granted ||
    granted.ownerId !== ref.ownerId ||
    granted.namespace !== ref.namespace ||
    granted.key !== ref.key
  ) {
    throw new Error("GRANT_RESOURCE_MISMATCH");
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("NODE_OPERATION_INPUT_INVALID");
  }
  return value as Record<string, unknown>;
}

function string(value: unknown) {
  if (typeof value !== "string" || !value || value.length > 1_024) {
    throw new Error("NODE_OPERATION_INPUT_INVALID");
  }
  return value;
}

function decodeBytes(raw: unknown, maximumBytes: number) {
  const wire = nodeWireBytesSchema.parse(raw);
  if (wire.byteLength > maximumBytes) {
    throw new Error("NODE_OPERATION_BYTE_LIMIT_EXCEEDED");
  }
  const bytes = Buffer.from(wire.data, "base64url");
  if (bytes.byteLength !== wire.byteLength) {
    throw new Error("NODE_OPERATION_BYTES_MISMATCH");
  }
  return new Uint8Array(bytes);
}

function encodeBytes(bytes: Uint8Array): NodeWireBytes {
  return nodeWireBytesSchema.parse({
    encoding: "base64url",
    byteLength: bytes.byteLength,
    data: Buffer.from(bytes).toString("base64url"),
  });
}

function streamBytes(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function safeErrorCode(error: unknown) {
  const candidate =
    error instanceof Error ? error.message : "NODE_OPERATION_FAILED";
  return /^[A-Z0-9_:-]{3,128}$/u.test(candidate)
    ? candidate
    : "NODE_OPERATION_FAILED";
}

function retryable(code: string) {
  return /OFFLINE|UNAVAILABLE|TIMEOUT|RATE_LIMIT|RESYNC|CAPACITY/u.test(code);
}

function operationRequestDigest(frame: OperationRequest, ownerId: string) {
  return canonicalDigest({
    nodeId: frame.nodeId,
    userId: ownerId,
    capability: frame.capability,
    capabilityVersion: frame.capabilityVersion,
    operationId: frame.operationId,
    operation: frame.operation,
    payload: frame.payload,
    configRevision: frame.configRevision,
    deadline: frame.deadline,
  });
}

function verifyGrant(input: {
  frame: OperationRequest;
  grant: SignedNodeCapabilityGrant;
  ownerId: string;
  corePublicKeyDer: string;
  coreKeyId: string;
  requestDigest: string;
  now: number;
}) {
  const { claims, signature, keyId } = input.grant;
  if (
    keyId !== input.coreKeyId ||
    !verifyCanonical(input.corePublicKeyDer, claims, signature)
  ) {
    throw new Error("GRANT_SIGNATURE_INVALID");
  }
  if (
    claims.audience !== input.frame.nodeId ||
    claims.nodeId !== input.frame.nodeId ||
    claims.userId !== input.ownerId ||
    claims.subject !== input.ownerId ||
    claims.jobId !== input.frame.operationId ||
    claims.operation !== input.frame.operation ||
    claims.requestDigest !== input.requestDigest ||
    claims.configRevision !== input.frame.configRevision ||
    !claims.capabilities.includes(
      `node:${input.frame.capability}:${input.frame.operation}`,
    ) ||
    claims.resources.some((resource) => resource.ownerId !== input.ownerId)
  ) {
    throw new Error("GRANT_OPERATION_BINDING_INVALID");
  }
  if (
    Date.parse(claims.notBefore) > input.now ||
    Date.parse(claims.expiresAt) <= input.now ||
    Date.parse(claims.limits.deadline) < Date.parse(input.frame.deadline)
  ) {
    throw new Error("GRANT_EXPIRED_OR_DEADLINE_INVALID");
  }
  const inputBytes = new TextEncoder().encode(
    JSON.stringify(input.frame.payload),
  ).byteLength;
  if (inputBytes > claims.limits.byteLimit) {
    throw new Error("GRANT_BYTE_LIMIT_EXCEEDED");
  }
  return claims;
}

type ActiveOperation = {
  controller: AbortController;
  deadlineTimer: ReturnType<typeof setTimeout>;
};

/**
 * Node-side dispatcher for the provider contracts carried over the control
 * relay. Every request is signed, exact-revision fenced and retained before a
 * result is published so reconnect can replay without a Core plaintext mirror.
 */
export class NodeCapabilityOperationDispatcher {
  readonly #nodeId: string;
  readonly #corePublicKeyDer: string;
  readonly #coreKeyId: string;
  readonly #configRevision: () => string;
  readonly #transport: LocalNodeProviderTransport;
  readonly #grantReplay: GrantReplayLedger;
  readonly #results: NodeOperationResultLedger;
  readonly #publish: (
    frame: Extract<NodeControlFrame, { type: "operation-result" }>,
  ) => Promise<void>;
  readonly #maximumConcurrent: number;
  readonly #active = new Map<string, ActiveOperation>();

  constructor(input: {
    nodeId: string;
    corePublicKeyDer: string;
    coreKeyId: string;
    configRevision: () => string;
    transport: LocalNodeProviderTransport;
    grantReplay: GrantReplayLedger;
    results: NodeOperationResultLedger;
    maximumConcurrent: number;
    publish(
      frame: Extract<NodeControlFrame, { type: "operation-result" }>,
    ): Promise<void>;
  }) {
    this.#nodeId = input.nodeId;
    this.#corePublicKeyDer = input.corePublicKeyDer;
    this.#coreKeyId = input.coreKeyId;
    this.#configRevision = input.configRevision;
    this.#transport = input.transport;
    this.#grantReplay = input.grantReplay;
    this.#results = input.results;
    this.#maximumConcurrent = input.maximumConcurrent;
    this.#publish = input.publish;
  }

  async initialize() {
    await this.#results.initialize();
    return this.#results.recoverInterrupted();
  }

  async accept(frame: OperationRequest, now = Date.now()) {
    const operation = nodeCapabilityOperationSchema.parse(frame.operation);
    const payload = nodeOperationPayloadSchema.parse(frame.payload);
    const requestDigest = operationRequestDigest(frame, payload.ownerId);
    if (
      frame.nodeId !== this.#nodeId ||
      frame.capabilityVersion !== 1 ||
      nodeOperationCapability(operation) !== frame.capability
    ) {
      throw new Error("NODE_OPERATION_CAPABILITY_MISMATCH");
    }
    if (frame.configRevision !== this.#configRevision()) {
      throw new Error("NODE_OPERATION_CONFIG_REVISION_MISMATCH");
    }
    if (Date.parse(frame.deadline) <= now) {
      throw new Error("NODE_OPERATION_DEADLINE_EXPIRED");
    }
    const claims = verifyGrant({
      frame,
      grant: frame.grant,
      ownerId: payload.ownerId,
      corePublicKeyDer: this.#corePublicKeyDer,
      coreKeyId: this.#coreKeyId,
      requestDigest,
      now,
    });
    await this.#grantReplay.accept(claims, requestDigest, now);
    const offered = await this.#results.offer({
      operationId: frame.operationId,
      requestDigest,
      expiresAt: claims.expiresAt,
      now: new Date(now),
    });
    if (offered.replayed) {
      for (const result of offered.record.results) {
        await this.#publishResult(frame, result);
      }
      if (offered.record.state !== "terminal") {
        throw new Error("NODE_OPERATION_REPLAY_IN_PROGRESS");
      }
      return { accepted: true, replayed: true };
    }
    if (this.#active.size >= this.#maximumConcurrent) {
      await this.#terminalFailure(frame, "NODE_OPERATION_CAPACITY_EXCEEDED", 1);
      return { accepted: false, replayed: false };
    }
    const controller = new AbortController();
    const deadlineTimer = setTimeout(
      () => controller.abort("deadline"),
      Math.max(1, Date.parse(frame.deadline) - now),
    );
    const timer = deadlineTimer as unknown as { unref?: () => void };
    timer.unref?.();
    this.#active.set(frame.operationId, { controller, deadlineTimer });
    void this.#execute(
      frame,
      operation,
      payload.ownerId,
      payload.input,
      claims,
    );
    return { accepted: true, replayed: false };
  }

  async cancel(operationId: string) {
    const active = this.#active.get(operationId);
    if (!active) return false;
    active.controller.abort("cancelled");
    return true;
  }

  async #execute(
    frame: OperationRequest,
    operation: NodeCapabilityOperation,
    ownerId: string,
    input: unknown,
    claims: NodeCapabilityGrantClaims,
  ) {
    const active = this.#active.get(frame.operationId)!;
    let sequence = 0;
    let emittedBytes = 0;
    let observedTokens = 0;
    const emit = async (payload: unknown, terminal: boolean) => {
      const bytes = new TextEncoder().encode(
        JSON.stringify(payload ?? null),
      ).byteLength;
      emittedBytes += bytes;
      if (emittedBytes > claims.limits.byteLimit) {
        throw new Error("GRANT_BYTE_LIMIT_EXCEEDED");
      }
      if (
        operation === "model.stream" &&
        payload !== undefined &&
        record(payload).type === "usage"
      ) {
        const usage = record(record(payload).usage);
        for (const field of [
          "inputTokens",
          "outputTokens",
          "reasoningTokens",
        ] as const) {
          const value = usage[field];
          if (typeof value === "number") observedTokens += value;
        }
        if (
          claims.limits.tokenLimit > 0 &&
          observedTokens > claims.limits.tokenLimit
        ) {
          throw new Error("GRANT_TOKEN_LIMIT_EXCEEDED");
        }
      }
      sequence += 1;
      const result: StoredOperationResult = {
        sequence,
        ok: true,
        payload,
        retryable: false,
        terminal,
      };
      await this.#results.append(frame.operationId, result);
      await this.#publishResult(frame, result);
    };
    try {
      let emitted = false;
      for await (const result of this.#invoke(
        operation,
        ownerId,
        input,
        active.controller.signal,
        claims,
      )) {
        if (active.controller.signal.aborted) {
          throw new Error("NODE_OPERATION_CANCELLED");
        }
        emitted = true;
        await emit(result, false);
      }
      // A separate terminal cursor avoids overloading the last provider event;
      // replay can therefore distinguish truncation from a completed stream.
      await emit(undefined, true);
      if (!emitted && !this.#isStreaming(operation)) {
        throw new Error("NODE_OPERATION_RESULT_MISSING");
      }
    } catch (error) {
      const code = active.controller.signal.aborted
        ? active.controller.signal.reason === "deadline"
          ? "NODE_OPERATION_DEADLINE_EXCEEDED"
          : "NODE_OPERATION_CANCELLED"
        : safeErrorCode(error);
      await this.#terminalFailure(frame, code, sequence + 1).catch(
        () => undefined,
      );
    } finally {
      clearTimeout(active.deadlineTimer);
      this.#active.delete(frame.operationId);
    }
  }

  async *#invoke(
    operation: NodeCapabilityOperation,
    ownerId: string,
    raw: unknown,
    signal: AbortSignal,
    claims: NodeCapabilityGrantClaims,
  ): AsyncIterable<unknown> {
    const base = { nodeId: this.#nodeId, ownerId };
    switch (operation) {
      case "conversation.provision":
        yield await this.#transport.provisionConversationRun({
          ...base,
          run: record(raw) as never,
        });
        return;
      case "conversation.append-event":
        yield await this.#transport.appendConversationEvent({
          ...base,
          event: record(raw) as never,
        });
        return;
      case "conversation.replay-events":
        for await (const event of this.#transport.replayConversationEvents({
          ...base,
          replay: record(raw) as never,
        }))
          yield event;
        return;
      case "conversation.get-run":
        yield await this.#transport.getConversationRun({
          ...base,
          run: record(raw) as never,
        });
        return;
      case "conversation.export-owner":
        yield await this.#transport.exportNodeConversations({ ...base });
        return;
      case "conversation.delete-owner":
        yield await this.#transport.deleteNodeConversations({ ...base });
        return;
      case "conversation.dag-create":
      case "conversation.dag-append":
      case "conversation.dag-branch":
        yield await this.#transport.importConversationDag({
          ...base,
          snapshot: nodeConversationDagSnapshotSchema.parse(raw),
        });
        return;
      case "conversation.dag-list":
        yield await this.#transport.listConversationDags({
          ...base,
          query: nodeConversationDagListInputSchema.parse(raw),
        });
        return;
      case "conversation.dag-get": {
        const value = nodeConversationDagGetInputSchema.parse(raw);
        yield await this.#transport.getConversationDag({
          ...base,
          threadId: value.threadId,
        });
        return;
      }
      case "conversation.dag-export": {
        const value = nodeConversationDagGetInputSchema.parse(raw);
        yield await this.#transport.exportConversationDag({
          ...base,
          threadId: value.threadId,
        });
        return;
      }
      case "conversation.dag-delete": {
        const value = nodeConversationDagGetInputSchema.parse(raw);
        yield await this.#transport.deleteConversationDag({
          ...base,
          threadId: value.threadId,
        });
        return;
      }
      case "storage.capabilities":
        yield await this.#transport.storageCapabilities(base);
        return;
      case "storage.stat": {
        const ref = ownedObjectRefSchema.parse(record(raw).ref);
        if (ref.ownerId !== ownerId) {
          throw new Error("NODE_OPERATION_OWNER_MISMATCH");
        }
        exactGrantedObject(claims, ref);
        yield await this.#transport.statNodeObject({ ...base, ref, signal });
        return;
      }
      case "storage.get": {
        const input = nodeObjectReadSchema.parse(raw);
        if (input.ref.ownerId !== ownerId) {
          throw new Error("NODE_OPERATION_OWNER_MISMATCH");
        }
        exactGrantedObject(claims, input.ref);
        for await (const chunk of this.#transport.readNodeObject({
          ...base,
          ...input,
          signal,
        })) {
          for (
            let offset = 0;
            offset < chunk.byteLength;
            offset += NODE_OBJECT_RELAY_CHUNK_BYTES
          ) {
            yield encodeBytes(
              chunk.subarray(
                offset,
                Math.min(
                  offset + NODE_OBJECT_RELAY_CHUNK_BYTES,
                  chunk.byteLength,
                ),
              ),
            );
          }
        }
        return;
      }
      case "storage.execute-deletion-manifest": {
        const manifest = nodeDeletionManifestSchema.parse(record(raw).manifest);
        if (manifest.userId !== ownerId || manifest.nodeId !== this.#nodeId) {
          throw new Error("NODE_OPERATION_OWNER_MISMATCH");
        }
        for (const artifact of manifest.refs) {
          exactGrantedObject(claims, artifact.object);
        }
        yield await this.#transport.executeStorageDeletionManifest({
          ...base,
          manifest,
        });
        return;
      }
      case "storage.get-range": {
        const range = objectStorageRangeInputSchema.parse(raw);
        if (range.ref.ownerId !== ownerId) {
          throw new Error("NODE_OPERATION_OWNER_MISMATCH");
        }
        exactGrantedObject(claims, range.ref);
        const result = await this.#transport.getNodeObjectRange({
          ...base,
          range,
        });
        const reader = result.body.getReader();
        try {
          while (true) {
            signal.throwIfAborted();
            const chunk = await reader.read();
            if (chunk.done) return;
            for (
              let offset = 0;
              offset < chunk.value.byteLength;
              offset += NODE_OBJECT_RELAY_CHUNK_BYTES
            ) {
              yield encodeBytes(
                chunk.value.subarray(
                  offset,
                  Math.min(
                    offset + NODE_OBJECT_RELAY_CHUNK_BYTES,
                    chunk.value.byteLength,
                  ),
                ),
              );
            }
          }
        } finally {
          await reader.cancel().catch(() => undefined);
        }
      }
      case "storage.put": {
        const value = nodeObjectPutWireSchema.parse(raw);
        if (value.ref.ownerId !== ownerId) {
          throw new Error("NODE_OPERATION_OWNER_MISMATCH");
        }
        exactGrantedObject(claims, value.ref);
        const bytes = decodeBytes(value.body, value.byteSize);
        if (bytes.byteLength !== value.byteSize) {
          throw new Error("NODE_OPERATION_BYTES_MISMATCH");
        }
        const { body: _body, ...metadata } = value;
        yield await this.#transport.putNodeObject({
          ...base,
          value: { ...metadata, body: streamBytes(bytes) },
        });
        return;
      }
      case "storage.delete": {
        const value = objectStorageDeleteInputSchema.parse(raw);
        if (value.ref.ownerId !== ownerId) {
          throw new Error("NODE_OPERATION_OWNER_MISMATCH");
        }
        exactGrantedObject(claims, value.ref);
        yield await this.#transport.deleteNodeObject({ ...base, value });
        return;
      }
      case "storage.multipart-begin": {
        const value = multipartBeginInputSchema.parse(raw);
        if (value.ref.ownerId !== ownerId) {
          throw new Error("NODE_OPERATION_OWNER_MISMATCH");
        }
        exactGrantedObject(claims, value.ref);
        yield await this.#transport.beginNodeMultipart({ ...base, value });
        return;
      }
      case "storage.multipart-part": {
        const value = nodeMultipartPartWireSchema.parse(raw);
        if (value.ownerId !== ownerId) {
          throw new Error("NODE_OPERATION_OWNER_MISMATCH");
        }
        const bytes = decodeBytes(value.body, value.byteSize);
        if (bytes.byteLength !== value.byteSize) {
          throw new Error("NODE_OPERATION_BYTES_MISMATCH");
        }
        const { body: _body, ...metadata } = value;
        yield await this.#transport.uploadNodeMultipartPart({
          ...base,
          value: { ...metadata, body: streamBytes(bytes) },
        });
        return;
      }
      case "storage.multipart-complete": {
        const value = multipartCompleteInputSchema.parse(raw);
        if (value.ownerId !== ownerId) {
          throw new Error("NODE_OPERATION_OWNER_MISMATCH");
        }
        yield await this.#transport.completeNodeMultipart({ ...base, value });
        return;
      }
      case "storage.multipart-abort": {
        const value = multipartAbortInputSchema.parse(raw);
        if (value.ownerId !== ownerId) {
          throw new Error("NODE_OPERATION_OWNER_MISMATCH");
        }
        await this.#transport.abortNodeMultipart({ ...base, value });
        yield null;
        return;
      }
      case "storage.copy": {
        const value = objectStorageCopyInputSchema.parse(raw);
        if (
          value.source.ownerId !== ownerId ||
          value.destination.ownerId !== ownerId
        ) {
          throw new Error("NODE_OPERATION_OWNER_MISMATCH");
        }
        if (
          claims.resources.length !== 2 ||
          !claims.resources.some(
            (resource) =>
              resource.ownerId === value.source.ownerId &&
              resource.namespace === value.source.namespace &&
              resource.key === value.source.key,
          ) ||
          !claims.resources.some(
            (resource) =>
              resource.ownerId === value.destination.ownerId &&
              resource.namespace === value.destination.namespace &&
              resource.key === value.destination.key,
          )
        ) {
          throw new Error("GRANT_RESOURCE_MISMATCH");
        }
        yield await this.#transport.copyNodeObject({ ...base, value });
        return;
      }
      case "storage.reconcile": {
        const value = objectStorageReconcileInputSchema.parse(raw);
        if (value.ownerId !== ownerId || claims.resources.length !== 0) {
          throw new Error("NODE_OPERATION_OWNER_MISMATCH");
        }
        for await (const entry of this.#transport.reconcileNodeObjects({
          ...base,
          value,
        })) {
          yield entry;
        }
        return;
      }
      case "storage.authorize-transfer": {
        const value = objectTransferGrantInputSchema.parse(raw);
        if (value.ref.ownerId !== ownerId) {
          throw new Error("NODE_OPERATION_OWNER_MISMATCH");
        }
        exactGrantedObject(claims, value.ref);
        yield await this.#transport.authorizeNodeObjectTransfer({
          ...base,
          value,
        });
        return;
      }
      case "lexical.capabilities":
        yield await this.#transport.lexicalCapabilities(base);
        return;
      case "lexical.upsert-version":
        await this.#transport.upsertLexicalVersion({
          ...base,
          version: record(raw) as never,
        });
        yield null;
        return;
      case "lexical.remove-version":
        await this.#transport.removeLexicalVersion({
          ...base,
          versionId: string(record(raw).versionId),
        });
        yield null;
        return;
      case "lexical.search":
        yield await this.#transport.searchLexical({
          ...base,
          query: record(raw) as never,
        });
        return;
      case "lexical.get-chunks":
        yield await this.#transport.getLexicalChunks({
          ...base,
          chunkIds: lexicalChunkRequestSchema.parse(raw).chunkIds,
        });
        return;
      case "lexical.verify":
        yield await this.#transport.verifyLexical(base);
        return;
      case "lexical.export-owner":
        yield await this.#transport.exportLexicalOwner(base);
        return;
      case "lexical.delete-owner":
        yield await this.#transport.deleteLexicalOwner(base);
        return;
      case "retrieval.provider-fetch":
        yield await this.#transport.fetchNodeProvider({
          ...base,
          request: providerFetchRequestSchema.parse(raw),
          signal,
        });
        return;
      case "mcp.inspect": {
        if (claims.resources.length !== 0) {
          throw new Error("GRANT_RESOURCE_MISMATCH");
        }
        yield await this.#transport.inspectNodeMcp({
          ...base,
          request: nodeMcpInspectRequestSchema.parse(raw),
          signal,
        });
        return;
      }
      case "mcp.invoke": {
        if (claims.resources.length !== 0) {
          throw new Error("GRANT_RESOURCE_MISMATCH");
        }
        yield await this.#transport.invokeNodeMcp({
          ...base,
          request: nodeMcpInvokeRequestSchema.parse(raw),
          signal,
        });
        return;
      }
      case "model.list": {
        const context = modelAccessContextSchema.parse(raw);
        if (context.ownerId !== ownerId)
          throw new Error("NODE_OPERATION_OWNER_MISMATCH");
        yield await this.#transport.listNodeModels({
          nodeId: this.#nodeId,
          context,
        });
        return;
      }
      case "model.stream": {
        const request = modelRequestWireSchema.parse(raw);
        if (request.ownerId !== ownerId)
          throw new Error("NODE_OPERATION_OWNER_MISMATCH");
        for await (const event of this.#transport.streamNodeModel({
          nodeId: this.#nodeId,
          request: { ...request, abortSignal: signal },
        }))
          yield event;
        return;
      }
      case "model.embed": {
        const request = embedRequestWireSchema.parse(raw);
        if (request.ownerId !== ownerId)
          throw new Error("NODE_OPERATION_OWNER_MISMATCH");
        yield await this.#transport.embedWithNodeModel({
          nodeId: this.#nodeId,
          request: { ...request, abortSignal: signal },
        });
        return;
      }
      case "model.transcribe": {
        const request = transcriptionRequestWireSchema.parse(raw);
        if (request.ownerId !== ownerId)
          throw new Error("NODE_OPERATION_OWNER_MISMATCH");
        yield await this.#transport.transcribeWithNodeModel({
          nodeId: this.#nodeId,
          request: {
            ownerId,
            modelId: request.modelId,
            ...(request.operationId
              ? { operationId: request.operationId }
              : {}),
            ...(request.maximumSeconds
              ? { maximumSeconds: request.maximumSeconds }
              : {}),
            ...(request.language ? { language: request.language } : {}),
            media: new Blob([decodeBytes(request.media, 64 * 1024 * 1024)], {
              type: request.mediaType,
            }),
            abortSignal: signal,
          },
        });
        return;
      }
      case "model.estimate": {
        const request = modelRequestWireSchema.parse(raw);
        if (request.ownerId !== ownerId)
          throw new Error("NODE_OPERATION_OWNER_MISMATCH");
        const estimate = await this.#transport.estimateNodeModel({
          nodeId: this.#nodeId,
          request: { ...request, abortSignal: signal },
        });
        yield estimate;
        return;
      }
      case "sandbox.capabilities": {
        const input = record(raw);
        yield await this.#transport.sandboxCapabilities({
          ...base,
          providerId: string(input.providerId) as never,
        });
        return;
      }
      case "sandbox.preflight": {
        const input = record(raw);
        yield await this.#transport.preflightSandbox({
          ...base,
          providerId: string(input.providerId) as never,
          preflight: record(input.preflight) as never,
        });
        return;
      }
      case "sandbox.create": {
        const input = record(raw);
        yield await this.#transport.createSandbox({
          ...base,
          providerId: string(input.providerId) as never,
          create: this.#sandboxCreate(input.create, ownerId),
        });
        return;
      }
      case "sandbox.execute": {
        const input = record(raw);
        const execute = record(input.execute);
        for await (const event of this.#transport.executeSandbox({
          ...base,
          providerId: string(input.providerId) as never,
          execute: {
            ...(execute as unknown as SandboxExecuteInput),
            handle: sandboxHandleSchema.parse(execute.handle),
            signal,
          },
        }))
          yield event;
        return;
      }
      case "sandbox.put-files": {
        const input = record(raw);
        const files = z
          .array(
            z.strictObject({
              relativePath: z.string().min(1).max(1_024),
              bytes: nodeWireBytesSchema,
              digest: z.string().min(1).max(128),
              mimeType: z.string().min(1).max(256),
            }),
          )
          .max(10_000)
          .parse(input.files)
          .map((file): SandboxInputFile => ({
            ...file,
            bytes: decodeBytes(file.bytes, 64 * 1024 * 1024),
          }));
        await this.#transport.putSandboxFiles({
          ...base,
          providerId: string(input.providerId) as never,
          handle: sandboxHandleSchema.parse(input.handle),
          files,
        });
        yield null;
        return;
      }
      case "sandbox.get-files": {
        const input = record(raw);
        yield await this.#transport.getSandboxFiles({
          ...base,
          providerId: string(input.providerId) as never,
          handle: sandboxHandleSchema.parse(input.handle),
          paths: z
            .array(z.string().min(1).max(1_024))
            .max(10_000)
            .parse(input.paths),
        });
        return;
      }
      case "sandbox.read-file": {
        const input = record(raw);
        for await (const bytes of this.#transport.readSandboxFile({
          ...base,
          providerId: string(input.providerId) as never,
          handle: sandboxHandleSchema.parse(input.handle),
          relativePath: string(input.relativePath),
        }))
          yield encodeBytes(bytes);
        return;
      }
      case "sandbox.snapshot-workspace": {
        const input = record(raw);
        yield await this.#transport.snapshotNodeWorkspace({
          ...base,
          providerId: string(input.providerId) as never,
          handle: sandboxHandleSchema.parse(input.handle),
        });
        return;
      }
      case "sandbox.fork-workspace": {
        const input = record(raw);
        const create = this.#sandboxCreate(input.create, ownerId);
        yield await this.#transport.forkNodeWorkspace({
          ...base,
          providerId: string(input.providerId) as never,
          create: {
            ...create,
            source: sandboxWorkspaceSnapshotRefSchema.parse(
              record(input.create).source,
            ),
          },
        });
        return;
      }
      case "sandbox.stop":
      case "sandbox.destroy": {
        const input = record(raw);
        const call =
          operation === "sandbox.stop"
            ? this.#transport.stopSandbox.bind(this.#transport)
            : this.#transport.destroySandbox.bind(this.#transport);
        await call({
          ...base,
          providerId: string(input.providerId) as never,
          handle: sandboxHandleSchema.parse(input.handle),
        });
        yield null;
        return;
      }
      case "sandbox.runtime-checkpoint-capabilities": {
        const input = record(raw);
        yield await this.#transport.sandboxRuntimeCheckpointCapabilities({
          ...base,
          providerId: string(input.providerId) as never,
        });
        return;
      }
      case "sandbox.capture-runtime-checkpoint": {
        const input = record(raw);
        yield await this.#transport.captureSandboxRuntimeCheckpoint({
          ...base,
          providerId: string(input.providerId) as never,
          handle: sandboxHandleSchema.parse(input.handle),
          sourceWorkspaceSnapshot: sandboxWorkspaceSnapshotRefSchema.parse(
            input.sourceWorkspaceSnapshot,
          ),
          compatibility: sandboxRuntimeCheckpointCompatibilityV1Schema.parse(
            input.compatibility,
          ),
          idempotencyKey: string(input.idempotencyKey),
          expiresAt: string(input.expiresAt),
        });
        return;
      }
      case "sandbox.restore-runtime-checkpoint": {
        const input = record(raw);
        yield await this.#transport.restoreSandboxRuntimeCheckpoint({
          ...base,
          providerId: string(input.providerId) as never,
          create: this.#sandboxCreate(input.create, ownerId),
          checkpoint: sandboxRuntimeCheckpointRefV1Schema.parse(
            input.checkpoint,
          ),
        });
        return;
      }
      case "sandbox.delete-runtime-checkpoint": {
        const input = record(raw);
        await this.#transport.deleteSandboxRuntimeCheckpoint({
          ...base,
          providerId: string(input.providerId) as never,
          checkpoint: sandboxRuntimeCheckpointRefV1Schema.parse(
            input.checkpoint,
          ),
        });
        yield null;
        return;
      }
    }
  }

  #sandboxCreate(raw: unknown, ownerId: string): SandboxCreateInput {
    const input = record(raw);
    if (input.ownerId !== ownerId)
      throw new Error("NODE_OPERATION_OWNER_MISMATCH");
    const expiresAt = new Date(string(input.expiresAt));
    if (!Number.isFinite(expiresAt.getTime())) {
      throw new Error("NODE_OPERATION_INPUT_INVALID");
    }
    return {
      ...(input as unknown as SandboxCreateInput),
      ownerId,
      expiresAt,
      ...(input.workspaceSnapshotRef
        ? {
            workspaceSnapshotRef: sandboxWorkspaceSnapshotRefSchema.parse(
              input.workspaceSnapshotRef,
            ),
          }
        : {}),
    };
  }

  async #terminalFailure(
    frame: OperationRequest,
    code: string,
    sequence: number,
  ) {
    const result: StoredOperationResult = {
      sequence,
      ok: false,
      safeErrorCode: code,
      retryable: retryable(code),
      terminal: true,
    };
    await this.#results.append(frame.operationId, result);
    await this.#publishResult(frame, result);
  }

  #publishResult(frame: OperationRequest, result: StoredOperationResult) {
    return this.#publish({
      type: "operation-result",
      frameId: `frame_${crypto.randomUUID()}`,
      nodeId: this.#nodeId,
      connectionEpoch: frame.connectionEpoch,
      operationId: frame.operationId,
      ...result,
    });
  }

  #isStreaming(operation: NodeCapabilityOperation) {
    return [
      "conversation.replay-events",
      "storage.get",
      "model.stream",
      "sandbox.execute",
      "sandbox.read-file",
    ].includes(operation);
  }
}
