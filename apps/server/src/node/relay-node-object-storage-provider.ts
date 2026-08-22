import {
  objectStorageCommitSchema,
  objectStorageMetadataSchema,
  type MultipartAbortInput,
  type MultipartBeginInput,
  type MultipartCompleteInput,
  type MultipartPartInput,
  type ObjectStorageCopyInput,
  type ObjectStorageDeleteInput,
  type ObjectStorageGetInput,
  type ObjectStorageProvider,
  type ObjectStoragePutInput,
  type ObjectStorageRangeInput,
  type ObjectStorageReconcileInput,
  type ObjectStorageStatInput,
  type ObjectTransferGrantInput,
} from "@avermate/agent-contracts";
import { createHash } from "node:crypto";
import type { RelayNodeProviderTransport } from "./relay-provider-transport";

const RELAY_PART_BYTES = 96 * 1024;
const RELAY_READ_BYTES = 8 * 1024 * 1024;

async function readBounded(
  body: ReadableStream<Uint8Array>,
  expectedBytes: number,
) {
  const reader = body.getReader();
  const bytes = new Uint8Array(expectedBytes);
  let offset = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (offset + next.value.byteLength > expectedBytes) {
        throw new Error("NODE_STORAGE_BODY_OVERFLOW");
      }
      bytes.set(next.value, offset);
      offset += next.value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  if (offset !== expectedBytes) throw new Error("NODE_STORAGE_BODY_TRUNCATED");
  return bytes;
}

function iterableStream(iterable: AsyncIterable<Uint8Array>) {
  const iterator = iterable[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      await iterator.return?.(reason);
    },
  });
}

async function* boundedRangeStream(input: {
  transport: RelayNodeProviderTransport;
  nodeId: string;
  ownerId: string;
  ref: ObjectStorageRangeInput["ref"];
  start: number;
  endInclusive: number;
}) {
  let cursor = input.start;
  while (cursor <= input.endInclusive) {
    const boundedEnd = Math.min(
      input.endInclusive,
      cursor + RELAY_READ_BYTES - 1,
    );
    for await (const chunk of input.transport.readNodeObjectRange({
      nodeId: input.nodeId,
      ownerId: input.ownerId,
      range: {
        ref: input.ref,
        start: cursor,
        endInclusive: boundedEnd,
      },
    })) {
      yield chunk;
    }
    cursor = boundedEnd + 1;
  }
}

function sha256(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/** Full ObjectStorageProvider carried over the authenticated outbound relay. */
export class RelayNodeObjectStorageProvider implements ObjectStorageProvider {
  readonly id: string;

  constructor(
    readonly nodeId: string,
    readonly ownerId: string,
    private readonly transport: RelayNodeProviderTransport,
  ) {
    this.id = `node:${nodeId}:relay-storage-v1`;
  }

  async capabilities() {
    const capabilities = await this.transport.nodeStorageCapabilities({
      nodeId: this.nodeId,
      ownerId: this.ownerId,
    });
    return { ...capabilities, providerId: this.id, directTransfer: false };
  }

  stat(input: ObjectStorageStatInput) {
    return this.transport.statNodeObject({
      nodeId: this.nodeId,
      ownerId: this.ownerId,
      ref: input.ref,
    });
  }

  async get(input: ObjectStorageGetInput) {
    const metadata = await this.stat({ ref: input.ref });
    if (!metadata) throw new Error("OBJECT_NOT_FOUND");
    const maximum = input.maxBytes ?? metadata.byteSize;
    if (metadata.byteSize > maximum) throw new Error("OBJECT_READ_LIMIT_EXCEEDED");
    if (metadata.byteSize === 0) return iterableStream((async function* () {})());
    return iterableStream(
      boundedRangeStream({
        transport: this.transport,
        nodeId: this.nodeId,
        ownerId: this.ownerId,
        ref: input.ref,
        start: 0,
        endInclusive: metadata.byteSize - 1,
      }),
    );
  }

  async getRange(input: ObjectStorageRangeInput) {
    const metadata = await this.stat({ ref: input.ref });
    if (!metadata) throw new Error("OBJECT_NOT_FOUND");
    if (input.endInclusive >= metadata.byteSize) {
      throw new Error("OBJECT_RANGE_INVALID");
    }
    return {
      metadata: objectStorageMetadataSchema.parse(metadata),
      start: input.start,
      endInclusive: input.endInclusive,
      totalBytes: metadata.byteSize,
      body: iterableStream(
        boundedRangeStream({
          transport: this.transport,
          nodeId: this.nodeId,
          ownerId: this.ownerId,
          ref: input.ref,
          start: input.start,
          endInclusive: input.endInclusive,
        }),
      ),
    };
  }

  async put(input: ObjectStoragePutInput) {
    if (input.ref.ownerId !== this.ownerId) {
      throw new Error("NODE_STORAGE_OWNER_MISMATCH");
    }
    if (input.byteSize <= RELAY_PART_BYTES) {
      const body = await readBounded(input.body, input.byteSize);
      if (sha256(body) !== input.expectedDigest) {
        throw new Error("NODE_STORAGE_BODY_DIGEST_MISMATCH");
      }
      return this.transport.putNodeObject({
        nodeId: this.nodeId,
        ownerId: this.ownerId,
        ref: input.ref,
        body,
        mimeType: input.mimeType,
        expectedDigest: input.expectedDigest,
        idempotencyKey: input.idempotencyKey,
      });
    }

    const handle = await this.beginMultipart(input);
    const reader = input.body.getReader();
    const parts: Array<{ partNumber: number; etag: string }> = [];
    const totalHash = createHash("sha256");
    let total = 0;
    let partNumber = 0;
    let carry = new Uint8Array(0);
    const upload = async (body: Uint8Array) => {
      partNumber += 1;
      total += body.byteLength;
      totalHash.update(body);
      const receipt = await this.transport.uploadNodeMultipartPart({
        nodeId: this.nodeId,
        ownerId: this.ownerId,
        uploadId: handle.uploadId,
        partNumber,
        body,
        expectedDigest: sha256(body),
      });
      parts.push({ partNumber, etag: receipt.etag });
    };
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        const combined = new Uint8Array(carry.byteLength + next.value.byteLength);
        combined.set(carry);
        combined.set(next.value, carry.byteLength);
        let offset = 0;
        while (combined.byteLength - offset >= RELAY_PART_BYTES) {
          await upload(combined.slice(offset, offset + RELAY_PART_BYTES));
          offset += RELAY_PART_BYTES;
        }
        carry = combined.slice(offset);
      }
      if (carry.byteLength > 0) await upload(carry);
      if (
        total !== input.byteSize ||
        `sha256:${totalHash.digest("hex")}` !== input.expectedDigest
      ) {
        throw new Error("NODE_STORAGE_BODY_DIGEST_MISMATCH");
      }
      return objectStorageCommitSchema.parse(
        await this.completeMultipart({
          uploadId: handle.uploadId,
          ownerId: this.ownerId,
          parts,
        }),
      );
    } catch (error) {
      await this.abortMultipart({
        uploadId: handle.uploadId,
        ownerId: this.ownerId,
      }).catch(() => undefined);
      throw error;
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }

  delete(input: ObjectStorageDeleteInput) {
    return this.transport.deleteNodeObject({
      nodeId: this.nodeId,
      ownerId: this.ownerId,
      value: input,
    });
  }

  beginMultipart(input: MultipartBeginInput) {
    return this.transport.beginNodeMultipart({
      nodeId: this.nodeId,
      ownerId: this.ownerId,
      value: input,
    });
  }

  async uploadPart(input: MultipartPartInput) {
    const body = await readBounded(input.body, input.byteSize);
    if (sha256(body) !== input.expectedDigest) {
      throw new Error("NODE_STORAGE_BODY_DIGEST_MISMATCH");
    }
    return this.transport.uploadNodeMultipartPart({
      nodeId: this.nodeId,
      ownerId: this.ownerId,
      uploadId: input.uploadId,
      partNumber: input.partNumber,
      body,
      expectedDigest: input.expectedDigest,
    });
  }

  completeMultipart(input: MultipartCompleteInput) {
    return this.transport.completeNodeMultipart({
      nodeId: this.nodeId,
      ownerId: this.ownerId,
      value: input,
    });
  }

  abortMultipart(input: MultipartAbortInput) {
    return this.transport.abortNodeMultipart({
      nodeId: this.nodeId,
      ownerId: this.ownerId,
      value: input,
    });
  }

  copy(input: ObjectStorageCopyInput) {
    return this.transport.copyNodeObject({
      nodeId: this.nodeId,
      ownerId: this.ownerId,
      value: input,
    });
  }

  reconcile(input: ObjectStorageReconcileInput) {
    return this.transport.reconcileNodeObjects({
      nodeId: this.nodeId,
      ownerId: this.ownerId,
      value: input,
    });
  }

  authorizeTransfer(input: ObjectTransferGrantInput) {
    return this.transport.authorizeNodeObjectTransfer({
      nodeId: this.nodeId,
      ownerId: this.ownerId,
      value: input,
    });
  }
}
