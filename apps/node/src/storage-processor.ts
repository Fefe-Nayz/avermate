import {
  multipartAbortInputSchema,
  multipartBeginInputSchema,
  multipartCompleteInputSchema,
  nodeStorageRequestEnvelopeSchema,
  objectStorageCopyInputSchema,
  objectStorageDeleteInputSchema,
  objectStorageGetInputSchema,
  objectStorageRangeInputSchema,
  objectStorageReconcileInputSchema,
  objectStorageStatInputSchema,
  objectTransferGrantInputSchema,
  ownedObjectRefSchema,
  type NodeStorageOperation,
  type NodeStorageTransport,
  type NodeStorageWireRequest,
  type NodeStorageWireResponse,
  type ObjectStorageProvider,
  type OwnedObjectRef,
} from "@avermate/agent-contracts";
import { createHash } from "node:crypto";
import { canonicalDigest, canonicalJson } from "./canonical-json";
import { verifyCanonical } from "./identity";
import { GrantReplayLedger } from "./protocol";

function safeError(error: unknown) {
  const raw =
    error instanceof Error ? error.message : "STORAGE_OPERATION_FAILED";
  const code = /^[A-Z0-9_:-]{3,128}$/u.test(raw)
    ? raw.slice(0, 128)
    : "STORAGE_OPERATION_FAILED";
  const retryable = /UNAVAILABLE|OFFLINE|TIMEOUT|LEASE/u.test(code);
  return { code, message: code, retryable };
}

function response(
  requestId: string,
  data: unknown,
  body?: ReadableStream<Uint8Array>,
  bodyByteSize: number | null = null,
  bodyDigest: string | null = null,
): NodeStorageWireResponse {
  return {
    envelope: {
      version: 1,
      requestId,
      ok: true,
      data,
      bodyByteSize,
      bodyDigest,
    },
    body,
  };
}

function refsFor(
  operation: NodeStorageOperation,
  input: unknown,
): OwnedObjectRef[] {
  if (operation === "reconcile") return [];
  if (operation === "copy") {
    const value = objectStorageCopyInputSchema.parse(input);
    return [value.source, value.destination];
  }
  const value = input as { ref?: unknown };
  return value.ref ? [ownedObjectRefSchema.parse(value.ref)] : [];
}

function ownerFor(operation: NodeStorageOperation, input: unknown) {
  const refs = refsFor(operation, input);
  if (refs.length > 0) return refs[0]!.ownerId;
  const ownerId = (input as { ownerId?: unknown }).ownerId;
  if (typeof ownerId !== "string" || ownerId.length === 0)
    throw new Error("STORAGE_OWNER_REQUIRED");
  return ownerId;
}

function exactRefs(left: OwnedObjectRef[], right: OwnedObjectRef[]) {
  return (
    canonicalJson(left.map((ref) => canonicalJson(ref)).sort()) ===
    canonicalJson(right.map((ref) => canonicalJson(ref)).sort())
  );
}

async function digestStream(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  const hash = createHash("sha256");
  let total = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    total += item.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("STORAGE_RESPONSE_BODY_OVERFLOW");
    }
    hash.update(item.value);
    chunks.push(item.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    bytes,
    digest: `sha256:${hash.digest("hex")}`,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  };
}

export class NodeStorageRequestProcessor {
  readonly #nodeId: string;
  readonly #corePublicKeyDer: string;
  readonly #storage: ObjectStorageProvider;
  readonly #replay: GrantReplayLedger;

  constructor(input: {
    nodeId: string;
    corePublicKeyDer: string;
    storage: ObjectStorageProvider;
    replayLedger: GrantReplayLedger;
  }) {
    this.#nodeId = input.nodeId;
    this.#corePublicKeyDer = input.corePublicKeyDer;
    this.#storage = input.storage;
    this.#replay = input.replayLedger;
  }

  async handle(
    raw: NodeStorageWireRequest,
    now = Date.now(),
  ): Promise<NodeStorageWireResponse> {
    let requestId = "unknown";
    try {
      const envelope = nodeStorageRequestEnvelopeSchema.parse(raw.envelope);
      requestId = envelope.requestId;
      if (envelope.nodeId !== this.#nodeId)
        throw new Error("STORAGE_WRONG_NODE");
      const { claims, signature } = envelope.grant;
      if (!verifyCanonical(this.#corePublicKeyDer, claims, signature)) {
        throw new Error("GRANT_SIGNATURE_INVALID");
      }
      if (claims.nodeId !== this.#nodeId || claims.audience !== this.#nodeId) {
        throw new Error("GRANT_WRONG_AUDIENCE");
      }
      if (claims.jobId !== envelope.requestId)
        throw new Error("GRANT_REQUEST_MISMATCH");
      if (Date.parse(claims.notBefore) > now)
        throw new Error("GRANT_NOT_YET_VALID");
      if (Date.parse(claims.expiresAt) <= now) throw new Error("GRANT_EXPIRED");
      if (!claims.capabilities.includes(`storage:${envelope.operation}`)) {
        throw new Error("GRANT_CAPABILITY_MISMATCH");
      }
      const ownerId = ownerFor(envelope.operation, envelope.input);
      if (claims.userId !== ownerId || claims.subject !== ownerId) {
        throw new Error("GRANT_OWNER_MISMATCH");
      }
      const resources = refsFor(envelope.operation, envelope.input);
      if (!exactRefs(claims.resources, resources))
        throw new Error("GRANT_RESOURCE_MISMATCH");
      const requestedBytes = envelope.bodyByteSize ?? 0;
      if (requestedBytes > claims.limits.byteLimit)
        throw new Error("GRANT_BYTE_LIMIT_EXCEEDED");
      const requestDigest = canonicalDigest({
        version: envelope.version,
        requestId: envelope.requestId,
        nodeId: envelope.nodeId,
        operation: envelope.operation,
        input: envelope.input,
        bodyByteSize: envelope.bodyByteSize,
        bodyDigest: envelope.bodyDigest,
      });
      await this.#replay.accept(claims, requestDigest, now);

      switch (envelope.operation) {
        case "stat": {
          return response(
            requestId,
            await this.#storage.stat(
              objectStorageStatInputSchema.parse(envelope.input),
            ),
          );
        }
        case "get": {
          const input = objectStorageGetInputSchema.parse(envelope.input);
          const metadata = await this.#storage.stat({ ref: input.ref });
          if (!metadata) throw new Error("OBJECT_NOT_FOUND");
          if (metadata.byteSize > claims.limits.byteLimit)
            throw new Error("GRANT_BYTE_LIMIT_EXCEEDED");
          const body = await this.#storage.get(input);
          return response(
            requestId,
            metadata,
            body,
            metadata.byteSize,
            metadata.digest,
          );
        }
        case "get-range": {
          const range = await this.#storage.getRange(
            objectStorageRangeInputSchema.parse(envelope.input),
          );
          const bodySize = range.endInclusive - range.start + 1;
          if (bodySize > claims.limits.byteLimit)
            throw new Error("GRANT_BYTE_LIMIT_EXCEEDED");
          const verified = await digestStream(range.body, bodySize);
          return response(
            requestId,
            {
              metadata: range.metadata,
              start: range.start,
              endInclusive: range.endInclusive,
              totalBytes: range.totalBytes,
            },
            verified.body,
            verified.bytes.byteLength,
            verified.digest,
          );
        }
        case "put": {
          const input = envelope.input as Omit<
            Parameters<ObjectStorageProvider["put"]>[0],
            "body"
          >;
          if (
            !raw.body ||
            envelope.bodyByteSize === null ||
            envelope.bodyDigest === null
          ) {
            throw new Error("STORAGE_REQUEST_BODY_REQUIRED");
          }
          if (
            input.byteSize !== envelope.bodyByteSize ||
            input.expectedDigest !== envelope.bodyDigest
          ) {
            throw new Error("STORAGE_REQUEST_BODY_METADATA_MISMATCH");
          }
          return response(
            requestId,
            await this.#storage.put({ ...input, body: raw.body }),
          );
        }
        case "delete":
          return response(
            requestId,
            await this.#storage.delete(
              objectStorageDeleteInputSchema.parse(envelope.input),
            ),
          );
        case "multipart-begin":
          return response(
            requestId,
            await this.#storage.beginMultipart(
              multipartBeginInputSchema.parse(envelope.input),
            ),
          );
        case "multipart-part": {
          const input = envelope.input as Omit<
            Parameters<ObjectStorageProvider["uploadPart"]>[0],
            "body"
          >;
          if (
            !raw.body ||
            envelope.bodyByteSize === null ||
            envelope.bodyDigest === null
          ) {
            throw new Error("STORAGE_REQUEST_BODY_REQUIRED");
          }
          if (
            input.byteSize !== envelope.bodyByteSize ||
            input.expectedDigest !== envelope.bodyDigest
          ) {
            throw new Error("STORAGE_REQUEST_BODY_METADATA_MISMATCH");
          }
          return response(
            requestId,
            await this.#storage.uploadPart({ ...input, body: raw.body }),
          );
        }
        case "multipart-complete":
          return response(
            requestId,
            await this.#storage.completeMultipart(
              multipartCompleteInputSchema.parse(envelope.input),
            ),
          );
        case "multipart-abort":
          await this.#storage.abortMultipart(
            multipartAbortInputSchema.parse(envelope.input),
          );
          return response(requestId, { aborted: true });
        case "copy": {
          if (!this.#storage.copy) throw new Error("STORAGE_COPY_UNAVAILABLE");
          return response(
            requestId,
            await this.#storage.copy(
              objectStorageCopyInputSchema.parse(envelope.input),
            ),
          );
        }
        case "reconcile": {
          const entries = [];
          for await (const entry of this.#storage.reconcile(
            objectStorageReconcileInputSchema.parse(envelope.input),
          )) {
            entries.push(entry);
          }
          return response(requestId, entries);
        }
        case "authorize-transfer":
          return response(
            requestId,
            await this.#storage.authorizeTransfer(
              objectTransferGrantInputSchema.parse(envelope.input),
            ),
          );
      }
    } catch (error) {
      return {
        envelope: {
          version: 1,
          requestId,
          ok: false,
          error: safeError(error),
          bodyByteSize: null,
          bodyDigest: null,
        },
      };
    }
  }
}

export class InProcessNodeStorageTransport implements NodeStorageTransport {
  readonly #nodeId: string;
  readonly #processor: NodeStorageRequestProcessor;
  #online = true;

  constructor(nodeId: string, processor: NodeStorageRequestProcessor) {
    this.#nodeId = nodeId;
    this.#processor = processor;
  }

  setOnline(value: boolean) {
    this.#online = value;
  }

  async online(nodeId: string) {
    return this.#online && nodeId === this.#nodeId;
  }

  async exchange(request: NodeStorageWireRequest) {
    if (!this.#online) throw new Error("NODE_STORAGE_UNAVAILABLE");
    return this.#processor.handle(request);
  }
}
