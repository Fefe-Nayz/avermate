import {
  multipartHandleSchema,
  multipartPartReceiptSchema,
  nodeStorageResponseEnvelopeSchema,
  nodeStorageRangeDataSchema,
  objectStorageCommitSchema,
  objectStorageDeleteResultSchema,
  objectStorageMetadataSchema,
  objectStorageReconcileInputSchema,
  objectStorageRangeInputSchema,
  objectTransferGrantSchema,
  type MultipartAbortInput,
  type MultipartBeginInput,
  type MultipartCompleteInput,
  type MultipartHandle,
  type MultipartPartInput,
  type MultipartPartReceipt,
  type NodeStorageOperation,
  type NodeStorageTransport,
  type ObjectStorageCapabilities,
  type ObjectStorageCommit,
  type ObjectStorageCopyInput,
  type ObjectStorageDeleteInput,
  type ObjectStorageDeleteResult,
  type ObjectStorageEntry,
  type ObjectStorageGetInput,
  type ObjectStorageMetadata,
  type ObjectStorageProvider,
  type ObjectStoragePutInput,
  type ObjectStorageRange,
  type ObjectStorageRangeInput,
  type ObjectStorageReconcileInput,
  type ObjectStorageStatInput,
  type ObjectTransferGrant,
  type ObjectTransferGrantInput,
  type OwnedObjectRef,
  type SignedNodeCapabilityGrant,
} from "@avermate/agent-contracts";
import { createHash } from "node:crypto";

export interface NodeStorageGrantIssuer {
  issue(input: {
    requestId: string;
    nodeId: string;
    operation: NodeStorageOperation;
    userId: string;
    resources: OwnedObjectRef[];
    byteLimit: number;
    bodyDigest?: string;
  }): Promise<SignedNodeCapabilityGrant>;
}

function resourcesFor(
  operation: NodeStorageOperation,
  input: unknown,
): OwnedObjectRef[] {
  if (operation === "reconcile") return [];
  if (operation === "copy") {
    const copy = input as ObjectStorageCopyInput;
    return [copy.source, copy.destination];
  }
  const record = input as { ref?: OwnedObjectRef };
  return record.ref ? [record.ref] : [];
}

function ownerFor(input: unknown) {
  const record = input as {
    ref?: OwnedObjectRef;
    source?: OwnedObjectRef;
    ownerId?: string;
  };
  return record.ref?.ownerId ?? record.source?.ownerId ?? record.ownerId;
}

function sameRef(left: OwnedObjectRef, right: OwnedObjectRef) {
  return (
    left.ownerId === right.ownerId &&
    left.namespace === right.namespace &&
    left.key === right.key
  );
}

function errorFromResponse(error: {
  code: string;
  message: string;
  retryable: boolean;
}) {
  const result = new Error(error.code);
  Object.assign(result, {
    code: error.code,
    retryable: error.retryable,
    safeMessage: error.message,
  });
  return result;
}

function verifyBodyStream(input: {
  body: ReadableStream<Uint8Array>;
  expectedBytes: number;
  expectedDigest: string | null;
  maximumBytes: number;
}) {
  const source = input.body.getReader();
  const hash = createHash("sha256");
  let total = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await source.read();
        if (next.done) {
          if (total !== input.expectedBytes)
            throw new Error("NODE_STORAGE_BODY_TRUNCATED");
          if (input.expectedDigest) {
            const digest = `sha256:${hash.digest("hex")}`;
            if (digest !== input.expectedDigest)
              throw new Error("NODE_STORAGE_BODY_DIGEST_MISMATCH");
          }
          controller.close();
          return;
        }
        total += next.value.byteLength;
        if (total > input.expectedBytes || total > input.maximumBytes) {
          throw new Error("NODE_STORAGE_BODY_OVERFLOW");
        }
        hash.update(next.value);
        controller.enqueue(next.value);
      } catch (error) {
        await source.cancel(error).catch(() => undefined);
        controller.error(error);
      }
    },
    cancel(reason) {
      return source.cancel(reason);
    },
  });
}

export class NodeObjectStorageProvider implements ObjectStorageProvider {
  readonly id: string;
  readonly #nodeId: string;
  readonly #transport: NodeStorageTransport;
  readonly #grantIssuer: NodeStorageGrantIssuer;
  readonly #capabilities: ObjectStorageCapabilities;

  constructor(input: {
    nodeId: string;
    transport: NodeStorageTransport;
    grantIssuer: NodeStorageGrantIssuer;
    capabilities: ObjectStorageCapabilities;
  }) {
    this.#nodeId = input.nodeId;
    this.id = `node:${input.nodeId}:${input.capabilities.providerId}`;
    this.#transport = input.transport;
    this.#grantIssuer = input.grantIssuer;
    this.#capabilities = { ...input.capabilities, providerId: this.id };
  }

  async capabilities() {
    if (!(await this.#transport.online(this.#nodeId))) {
      return { ...this.#capabilities, directTransfer: false };
    }
    return this.#capabilities;
  }

  async #exchange(input: {
    operation: NodeStorageOperation;
    payload: unknown;
    body?: ReadableStream<Uint8Array>;
    bodyByteSize?: number;
    bodyDigest?: string;
    byteLimit?: number;
  }) {
    if (!(await this.#transport.online(this.#nodeId))) {
      throw Object.assign(new Error("NODE_STORAGE_UNAVAILABLE"), {
        retryable: true,
      });
    }
    const userId = ownerFor(input.payload);
    if (!userId) throw new Error("NODE_STORAGE_OWNER_REQUIRED");
    const requestId = `nodestore_${crypto.randomUUID()}`;
    const grant = await this.#grantIssuer.issue({
      requestId,
      nodeId: this.#nodeId,
      operation: input.operation,
      userId,
      resources: resourcesFor(input.operation, input.payload),
      byteLimit: input.byteLimit ?? input.bodyByteSize ?? 0,
      bodyDigest: input.bodyDigest,
    });
    const response = await this.#transport.exchange({
      envelope: {
        version: 1,
        requestId,
        nodeId: this.#nodeId,
        operation: input.operation,
        input: input.payload,
        bodyByteSize: input.bodyByteSize ?? null,
        bodyDigest: input.bodyDigest ?? null,
        grant,
      },
      body: input.body,
    });
    const envelope = nodeStorageResponseEnvelopeSchema.parse(response.envelope);
    if (envelope.requestId !== requestId)
      throw new Error("NODE_STORAGE_RESPONSE_MISMATCH");
    if (!envelope.ok) throw errorFromResponse(envelope.error);
    return { envelope, body: response.body };
  }

  async stat(
    input: ObjectStorageStatInput,
  ): Promise<ObjectStorageMetadata | null> {
    const response = await this.#exchange({
      operation: "stat",
      payload: input,
    });
    if (response.envelope.data === null) return null;
    const metadata = objectStorageMetadataSchema.parse(response.envelope.data);
    if (!sameRef(metadata.ref, input.ref))
      throw new Error("NODE_STORAGE_RESPONSE_REF_MISMATCH");
    return metadata;
  }

  async get(input: ObjectStorageGetInput): Promise<ReadableStream<Uint8Array>> {
    const response = await this.#exchange({
      operation: "get",
      payload: input,
      byteLimit: input.maxBytes ?? this.#capabilities.maxObjectBytes,
    });
    if (!response.body || response.envelope.bodyByteSize === null) {
      throw new Error("NODE_STORAGE_BODY_MISSING");
    }
    const metadata = objectStorageMetadataSchema.parse(response.envelope.data);
    if (!sameRef(metadata.ref, input.ref))
      throw new Error("NODE_STORAGE_RESPONSE_REF_MISMATCH");
    if (
      response.envelope.bodyByteSize !== metadata.byteSize ||
      response.envelope.bodyDigest !== metadata.digest
    ) {
      throw new Error("NODE_STORAGE_BODY_METADATA_MISMATCH");
    }
    return verifyBodyStream({
      body: response.body,
      expectedBytes: response.envelope.bodyByteSize,
      expectedDigest: response.envelope.bodyDigest,
      maximumBytes: input.maxBytes ?? this.#capabilities.maxObjectBytes,
    });
  }

  async getRange(input: ObjectStorageRangeInput): Promise<ObjectStorageRange> {
    const parsed = objectStorageRangeInputSchema.parse(input);
    const response = await this.#exchange({
      operation: "get-range",
      payload: parsed,
      byteLimit: parsed.endInclusive - parsed.start + 1,
    });
    if (!response.body || response.envelope.bodyByteSize === null) {
      throw new Error("NODE_STORAGE_BODY_MISSING");
    }
    const data = nodeStorageRangeDataSchema.parse(response.envelope.data);
    if (
      !sameRef(data.metadata.ref, parsed.ref) ||
      data.start !== parsed.start ||
      data.endInclusive !== parsed.endInclusive ||
      response.envelope.bodyByteSize !==
        parsed.endInclusive - parsed.start + 1 ||
      response.envelope.bodyDigest === null
    ) {
      throw new Error("NODE_STORAGE_RANGE_RESPONSE_MISMATCH");
    }
    return {
      metadata: objectStorageMetadataSchema.parse(data.metadata),
      start: data.start,
      endInclusive: data.endInclusive,
      totalBytes: data.totalBytes,
      body: verifyBodyStream({
        body: response.body,
        expectedBytes: response.envelope.bodyByteSize,
        expectedDigest: response.envelope.bodyDigest,
        maximumBytes: parsed.endInclusive - parsed.start + 1,
      }),
    };
  }

  async put(input: ObjectStoragePutInput): Promise<ObjectStorageCommit> {
    const { body, ...payload } = input;
    const response = await this.#exchange({
      operation: "put",
      payload,
      body,
      bodyByteSize: input.byteSize,
      bodyDigest: input.expectedDigest,
      byteLimit: input.byteSize,
    });
    const commit = objectStorageCommitSchema.parse(response.envelope.data);
    if (
      !sameRef(commit.ref, input.ref) ||
      commit.byteSize !== input.byteSize ||
      commit.mimeType !== input.mimeType ||
      commit.digest !== input.expectedDigest
    ) {
      throw new Error("NODE_STORAGE_COMMIT_MISMATCH");
    }
    return commit;
  }

  async delete(
    input: ObjectStorageDeleteInput,
  ): Promise<ObjectStorageDeleteResult> {
    const response = await this.#exchange({
      operation: "delete",
      payload: input,
    });
    const result = objectStorageDeleteResultSchema.parse(
      response.envelope.data,
    );
    if (!sameRef(result.ref, input.ref))
      throw new Error("NODE_STORAGE_RESPONSE_REF_MISMATCH");
    return result;
  }

  async beginMultipart(input: MultipartBeginInput): Promise<MultipartHandle> {
    const response = await this.#exchange({
      operation: "multipart-begin",
      payload: input,
      byteLimit: input.byteSize,
    });
    const handle = multipartHandleSchema.parse(response.envelope.data);
    if (!sameRef(handle.ref, input.ref))
      throw new Error("NODE_STORAGE_RESPONSE_REF_MISMATCH");
    return handle;
  }

  async uploadPart(input: MultipartPartInput): Promise<MultipartPartReceipt> {
    const { body, ...payload } = input;
    const response = await this.#exchange({
      operation: "multipart-part",
      payload,
      body,
      bodyByteSize: input.byteSize,
      bodyDigest: input.expectedDigest,
      byteLimit: input.byteSize,
    });
    return multipartPartReceiptSchema.parse(response.envelope.data);
  }

  async completeMultipart(
    input: MultipartCompleteInput,
  ): Promise<ObjectStorageCommit> {
    const response = await this.#exchange({
      operation: "multipart-complete",
      payload: input,
    });
    return objectStorageCommitSchema.parse(response.envelope.data);
  }

  async abortMultipart(input: MultipartAbortInput) {
    await this.#exchange({ operation: "multipart-abort", payload: input });
  }

  async copy(input: ObjectStorageCopyInput): Promise<ObjectStorageCommit> {
    const response = await this.#exchange({
      operation: "copy",
      payload: input,
    });
    return objectStorageCommitSchema.parse(response.envelope.data);
  }

  async *reconcile(
    input: ObjectStorageReconcileInput,
  ): AsyncIterable<ObjectStorageEntry> {
    const parsed = objectStorageReconcileInputSchema.parse(input);
    const response = await this.#exchange({
      operation: "reconcile",
      payload: parsed,
    });
    const entries = Array.isArray(response.envelope.data)
      ? response.envelope.data
      : [];
    if (entries.length > parsed.limit)
      throw new Error("NODE_STORAGE_RECONCILE_OVERFLOW");
    for (const entry of entries) {
      const metadata = objectStorageMetadataSchema.parse(entry);
      if (
        metadata.ref.ownerId !== parsed.ownerId ||
        metadata.ref.namespace !== parsed.namespace
      ) {
        throw new Error("NODE_STORAGE_RECONCILE_SCOPE_MISMATCH");
      }
      yield metadata;
    }
  }

  async authorizeTransfer(
    input: ObjectTransferGrantInput,
  ): Promise<ObjectTransferGrant> {
    const response = await this.#exchange({
      operation: "authorize-transfer",
      payload: input,
      byteLimit: input.byteLimit,
    });
    const grant = objectTransferGrantSchema.parse(response.envelope.data);
    if (
      !sameRef(grant.ref, input.ref) ||
      grant.operation !== input.operation ||
      grant.mode !== input.mode ||
      grant.audience !== input.audience ||
      grant.byteLimit > input.byteLimit ||
      grant.expectedDigest !== input.expectedDigest
    ) {
      throw new Error("NODE_STORAGE_TRANSFER_GRANT_MISMATCH");
    }
    return grant;
  }
}
