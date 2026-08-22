import {
  objectStorageDeleteInputSchema,
  objectStorageGetInputSchema,
  objectStorageStatInputSchema,
  ownedObjectRefSchema,
  type MultipartAbortInput,
  type MultipartBeginInput,
  type MultipartCompleteInput,
  type MultipartHandle,
  type MultipartPartInput,
  type MultipartPartReceipt,
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
  type ObjectTransferGrant,
  type ObjectTransferGrantInput,
} from "@avermate/agent-contracts";
import { createHash } from "node:crypto";
import {
  deleteStorageObject,
  headStorageObject,
  putStorageObject,
  readStorageObject,
  type ManagedStorageProvider,
} from "../lib/storage-backend";
import { DOCUMENT_ARTIFACT_FILE_CONSTRAINT } from "../lib/document-artifact-policy";

const PURPOSE = "document-artifact" as const;
const MAX_BYTES = DOCUMENT_ARTIFACT_FILE_CONSTRAINT.maxBytes;

function sha256(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function stream(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function readBounded(body: ReadableStream<Uint8Array>, maximum: number) {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > maximum) {
      await reader.cancel().catch(() => undefined);
      throw new Error("OBJECT_SIZE_LIMIT_EXCEEDED");
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Bounded facade used only while adopting a verified Node output into the
 * existing managed Core storage. Its deterministic storage key is the owned
 * object key; durable metadata lives in libSQL, never in an in-memory journal.
 */
export class ManagedAdoptionStorageProvider implements ObjectStorageProvider {
  readonly id: string;

  constructor(readonly managedProvider: ManagedStorageProvider) {
    this.id = `core-managed-storage-v1:${managedProvider}`;
  }

  capabilities(): Promise<ObjectStorageCapabilities> {
    return Promise.resolve({
      providerId: this.id,
      maxObjectBytes: MAX_BYTES,
      maxPartBytes: MAX_BYTES,
      minPartBytes: 1,
      multipart: false,
      range: false,
      copy: false,
      reconcile: false,
      directTransfer: false,
      checksumAlgorithms: ["sha256"],
    });
  }

  async stat(input: Parameters<ObjectStorageProvider["stat"]>[0]) {
    const { ref } = objectStorageStatInputSchema.parse(input);
    this.assertRef(ref);
    let head: Awaited<ReturnType<typeof headStorageObject>>;
    try {
      head = await headStorageObject(this.managedProvider, ref.key);
    } catch {
      return null;
    }
    if (head.byteSize > MAX_BYTES)
      throw new Error("OBJECT_SIZE_LIMIT_EXCEEDED");
    const bytes = new Uint8Array(
      await readStorageObject(this.managedProvider, ref.key, {
        maxBytes: MAX_BYTES,
      }),
    );
    if (bytes.byteLength !== head.byteSize) {
      throw new Error("OBJECT_STREAM_TRUNCATED");
    }
    const now = new Date().toISOString();
    return {
      ref,
      byteSize: bytes.byteLength,
      mimeType: head.mimeType ?? "application/octet-stream",
      digest: sha256(bytes),
      etag: sha256(bytes),
      createdAt: now,
      updatedAt: now,
    } satisfies ObjectStorageMetadata;
  }

  async get(input: ObjectStorageGetInput) {
    const parsed = objectStorageGetInputSchema.parse(input);
    this.assertRef(parsed.ref);
    const bytes = new Uint8Array(
      await readStorageObject(this.managedProvider, parsed.ref.key, {
        maxBytes: Math.min(parsed.maxBytes ?? MAX_BYTES, MAX_BYTES),
      }),
    );
    return stream(bytes);
  }

  async put(input: ObjectStoragePutInput): Promise<ObjectStorageCommit> {
    const ref = ownedObjectRefSchema.parse(input.ref);
    this.assertRef(ref);
    if (
      input.byteSize > MAX_BYTES ||
      !(
        DOCUMENT_ARTIFACT_FILE_CONSTRAINT.mimeTypes as readonly string[]
      ).includes(input.mimeType)
    ) {
      throw new Error("ADOPTION_OBJECT_POLICY_DENIED");
    }
    const bytes = await readBounded(input.body, MAX_BYTES);
    if (bytes.byteLength !== input.byteSize) {
      throw new Error("OBJECT_STREAM_TRUNCATED");
    }
    if (sha256(bytes) !== input.expectedDigest) {
      throw new Error("OBJECT_DIGEST_MISMATCH");
    }
    const existing = await this.stat({ ref });
    if (existing) {
      if (
        existing.byteSize !== input.byteSize ||
        existing.mimeType !== input.mimeType ||
        existing.digest !== input.expectedDigest
      ) {
        throw new Error("OBJECT_ALREADY_EXISTS_DIFFERENT_CONTENT");
      }
      return { ...existing, replayed: true };
    }
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    await putStorageObject({
      provider: this.managedProvider,
      storageKey: ref.key,
      purpose: PURPOSE,
      file: new File([copy.buffer], ref.key.split("/").at(-1) ?? "artifact", {
        type: input.mimeType,
      }),
      mimeType: input.mimeType,
    });
    const committed = await this.stat({ ref });
    if (
      !committed ||
      committed.byteSize !== input.byteSize ||
      committed.mimeType !== input.mimeType ||
      committed.digest !== input.expectedDigest
    ) {
      throw new Error("OBJECT_COMMIT_VERIFICATION_FAILED");
    }
    return { ...committed, replayed: false };
  }

  async delete(
    input: ObjectStorageDeleteInput,
  ): Promise<ObjectStorageDeleteResult> {
    const parsed = objectStorageDeleteInputSchema.parse(input);
    this.assertRef(parsed.ref);
    const existing = await this.stat({ ref: parsed.ref });
    if (!existing) {
      return { ref: parsed.ref, deleted: false, alreadyAbsent: true };
    }
    if (parsed.expectedDigest && parsed.expectedDigest !== existing.digest) {
      throw new Error("OBJECT_DELETE_DIGEST_MISMATCH");
    }
    await deleteStorageObject(this.managedProvider, parsed.ref.key);
    return { ref: parsed.ref, deleted: true, alreadyAbsent: false };
  }

  getRange(_input: ObjectStorageRangeInput): Promise<ObjectStorageRange> {
    return Promise.reject(new Error("ADOPTION_RANGE_UNAVAILABLE"));
  }
  beginMultipart(_input: MultipartBeginInput): Promise<MultipartHandle> {
    return Promise.reject(new Error("ADOPTION_MULTIPART_UNAVAILABLE"));
  }
  uploadPart(_input: MultipartPartInput): Promise<MultipartPartReceipt> {
    return Promise.reject(new Error("ADOPTION_MULTIPART_UNAVAILABLE"));
  }
  completeMultipart(
    _input: MultipartCompleteInput,
  ): Promise<ObjectStorageCommit> {
    return Promise.reject(new Error("ADOPTION_MULTIPART_UNAVAILABLE"));
  }
  abortMultipart(_input: MultipartAbortInput): Promise<void> {
    return Promise.reject(new Error("ADOPTION_MULTIPART_UNAVAILABLE"));
  }
  copy(_input: ObjectStorageCopyInput): Promise<ObjectStorageCommit> {
    return Promise.reject(new Error("ADOPTION_COPY_UNAVAILABLE"));
  }
  async *reconcile(
    _input: ObjectStorageReconcileInput,
  ): AsyncIterable<ObjectStorageEntry> {
    throw new Error("ADOPTION_RECONCILE_ENUMERATION_UNAVAILABLE");
  }
  authorizeTransfer(
    _input: ObjectTransferGrantInput,
  ): Promise<ObjectTransferGrant> {
    return Promise.reject(new Error("ADOPTION_TRANSFER_UNAVAILABLE"));
  }

  private assertRef(ref: { ownerId: string; namespace: string; key: string }) {
    if (
      ref.namespace !== PURPOSE ||
      !/^node-adoptions\/v1\/[a-f0-9]{32}\/[^/]{1,180}$/u.test(ref.key)
    ) {
      throw new Error("ADOPTION_OBJECT_REF_INVALID");
    }
  }
}
