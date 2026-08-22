import {
  objectStorageDeleteInputSchema,
  objectStorageGetInputSchema,
  objectStorageRangeInputSchema,
  objectStorageReconcileInputSchema,
  objectStorageStatInputSchema,
  objectTransferGrantInputSchema,
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
  type ObjectStorageStatInput,
  type ObjectTransferGrant,
  type ObjectTransferGrantInput,
  type OwnedObjectRef,
} from "@avermate/agent-contracts";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { FilePurpose } from "../db/schema";
import {
  deleteStorageObject,
  headStorageObject,
  putStorageObject,
  readStorageObject,
  type ManagedStorageProvider,
} from "../lib/storage-backend";

export interface CoreStorageByteBackend {
  put(input: {
    key: string;
    bytes: Uint8Array;
    mimeType: string;
    namespace: string;
  }): Promise<void>;
  get(key: string, maxBytes: number): Promise<Uint8Array>;
  stat(
    key: string,
  ): Promise<{ byteSize: number; mimeType: string | null } | null>;
  delete(key: string): Promise<void>;
}

type JournalEntry = ObjectStorageMetadata & { idempotencyKey: string };
type Journal = { version: 1; entries: Record<string, JournalEntry> };

function refKey(ref: OwnedObjectRef) {
  return createHash("sha256").update(JSON.stringify(ref)).digest("hex");
}

/** Physical keys are always owner/namespace scoped even when callers reuse a name. */
export function coreStorageBackendKey(ref: OwnedObjectRef) {
  const ownerScope = createHash("sha256")
    .update(`${ref.ownerId}\0${ref.namespace}`)
    .digest("base64url");
  return `avermate-objects/v1/${ownerScope}/${ref.key}`;
}

function digest(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function bytesStream(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function readBounded(
  stream: ReadableStream<Uint8Array>,
  maximum: number,
) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    total += item.value.byteLength;
    if (total > maximum) {
      await reader.cancel().catch(() => undefined);
      throw new Error("OBJECT_SIZE_LIMIT_EXCEEDED");
    }
    chunks.push(item.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export class LegacyManagedStorageByteBackend implements CoreStorageByteBackend {
  readonly #provider: ManagedStorageProvider;
  readonly #purpose: (namespace: string) => FilePurpose;

  constructor(
    provider: ManagedStorageProvider,
    purpose: (namespace: string) => FilePurpose,
  ) {
    this.#provider = provider;
    this.#purpose = purpose;
  }

  async put(input: {
    key: string;
    bytes: Uint8Array;
    mimeType: string;
    namespace: string;
  }) {
    const blobBytes = new Uint8Array(input.bytes.byteLength);
    blobBytes.set(input.bytes);
    await putStorageObject({
      provider: this.#provider,
      storageKey: input.key,
      purpose: this.#purpose(input.namespace),
      file: new File(
        [blobBytes.buffer],
        input.key.split("/").at(-1) ?? "object",
        {
          type: input.mimeType,
        },
      ),
      mimeType: input.mimeType,
    });
  }

  async get(key: string, maxBytes: number) {
    return new Uint8Array(
      await readStorageObject(this.#provider, key, { maxBytes }),
    );
  }

  async stat(key: string) {
    try {
      return await headStorageObject(this.#provider, key);
    } catch {
      return null;
    }
  }

  async delete(key: string) {
    await deleteStorageObject(this.#provider, key);
  }
}

export class CoreObjectStorageProvider implements ObjectStorageProvider {
  readonly id: string;
  readonly #backend: CoreStorageByteBackend;
  readonly #journalPath: string;
  readonly #maxObjectBytes: number;
  readonly #transferSecret: Uint8Array;
  #journal: Journal | null = null;
  #mutex = Promise.resolve();

  constructor(input: {
    id: string;
    backend: CoreStorageByteBackend;
    journalPath: string;
    maxObjectBytes: number;
    transferSecret?: Uint8Array;
  }) {
    this.id = input.id;
    this.#backend = input.backend;
    this.#journalPath = input.journalPath;
    this.#maxObjectBytes = input.maxObjectBytes;
    this.#transferSecret = input.transferSecret ?? randomBytes(32);
  }

  async capabilities(): Promise<ObjectStorageCapabilities> {
    return {
      providerId: this.id,
      maxObjectBytes: this.#maxObjectBytes,
      maxPartBytes: this.#maxObjectBytes,
      minPartBytes: 1,
      multipart: false,
      range: true,
      copy: false,
      reconcile: true,
      directTransfer: false,
      checksumAlgorithms: ["sha256"],
    };
  }

  async #load() {
    if (this.#journal) return this.#journal;
    try {
      this.#journal = JSON.parse(
        await readFile(this.#journalPath, "utf8"),
      ) as Journal;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.#journal = { version: 1, entries: {} };
    }
    return this.#journal;
  }

  async #save(journal: Journal) {
    await mkdir(dirname(this.#journalPath), { recursive: true, mode: 0o700 });
    const temporary = `${this.#journalPath}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(journal)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, this.#journalPath);
  }

  async #exclusive<T>(operation: (journal: Journal) => Promise<T>) {
    const previous = this.#mutex;
    let release!: () => void;
    this.#mutex = new Promise<void>((resolve) => (release = resolve));
    await previous;
    try {
      const journal = structuredClone(await this.#load());
      const result = await operation(journal);
      await this.#save(journal);
      this.#journal = journal;
      return result;
    } finally {
      release();
    }
  }

  async stat(
    input: ObjectStorageStatInput,
  ): Promise<ObjectStorageMetadata | null> {
    const { ref } = objectStorageStatInputSchema.parse(input);
    const journal = await this.#load();
    const entry = journal.entries[refKey(ref)];
    if (!entry) return null;
    const backend = await this.#backend.stat(coreStorageBackendKey(ref));
    if (!backend) throw new Error("OBJECT_LEDGER_MISSING_BYTES");
    if (backend.byteSize !== entry.byteSize)
      throw new Error("OBJECT_LEDGER_SIZE_MISMATCH");
    if (backend.mimeType !== null && backend.mimeType !== entry.mimeType) {
      throw new Error("OBJECT_LEDGER_MIME_MISMATCH");
    }
    const { idempotencyKey: _key, ...metadata } = entry;
    return metadata;
  }

  async get(input: ObjectStorageGetInput) {
    const parsed = objectStorageGetInputSchema.parse(input);
    const metadata = await this.stat({ ref: parsed.ref });
    if (!metadata) throw new Error("OBJECT_NOT_FOUND");
    const maximum = parsed.maxBytes ?? this.#maxObjectBytes;
    if (metadata.byteSize > maximum)
      throw new Error("OBJECT_READ_LIMIT_EXCEEDED");
    const bytes = await this.#backend.get(
      coreStorageBackendKey(parsed.ref),
      maximum,
    );
    if (digest(bytes) !== metadata.digest)
      throw new Error("OBJECT_DIGEST_MISMATCH");
    return bytesStream(bytes);
  }

  async getRange(input: ObjectStorageRangeInput): Promise<ObjectStorageRange> {
    const parsed = objectStorageRangeInputSchema.parse(input);
    const metadata = await this.stat({ ref: parsed.ref });
    if (!metadata) throw new Error("OBJECT_NOT_FOUND");
    if (parsed.endInclusive >= metadata.byteSize)
      throw new Error("OBJECT_RANGE_NOT_SATISFIABLE");
    const bytes = await this.#backend.get(
      coreStorageBackendKey(parsed.ref),
      this.#maxObjectBytes,
    );
    if (digest(bytes) !== metadata.digest)
      throw new Error("OBJECT_DIGEST_MISMATCH");
    return {
      metadata,
      start: parsed.start,
      endInclusive: parsed.endInclusive,
      totalBytes: metadata.byteSize,
      body: bytesStream(bytes.slice(parsed.start, parsed.endInclusive + 1)),
    };
  }

  async put(input: ObjectStoragePutInput): Promise<ObjectStorageCommit> {
    const ref = ownedObjectRefSchema.parse(input.ref);
    const bytes = await readBounded(input.body, this.#maxObjectBytes);
    if (bytes.byteLength !== input.byteSize)
      throw new Error("OBJECT_STREAM_TRUNCATED");
    if (digest(bytes) !== input.expectedDigest)
      throw new Error("OBJECT_DIGEST_MISMATCH");
    return this.#exclusive(async (journal) => {
      const previous = journal.entries[refKey(ref)];
      if (previous) {
        if (
          previous.digest !== input.expectedDigest ||
          previous.byteSize !== input.byteSize ||
          previous.mimeType !== input.mimeType
        ) {
          throw new Error("OBJECT_ALREADY_EXISTS_DIFFERENT_CONTENT");
        }
        const { idempotencyKey: _key, ...metadata } = previous;
        return { ...metadata, replayed: true };
      }
      const backendKey = coreStorageBackendKey(ref);
      const orphan = await this.#backend.stat(backendKey);
      let replayed = false;
      if (orphan) {
        if (orphan.byteSize !== input.byteSize) {
          throw new Error("ORPHAN_OBJECT_CONFLICT");
        }
        const orphanBytes = await this.#backend.get(
          backendKey,
          this.#maxObjectBytes,
        );
        if (digest(orphanBytes) !== input.expectedDigest) {
          throw new Error("ORPHAN_OBJECT_CONFLICT");
        }
        replayed = true;
      } else {
        await this.#backend.put({
          key: backendKey,
          bytes,
          mimeType: input.mimeType,
          namespace: ref.namespace,
        });
      }
      const now = new Date().toISOString();
      const entry: JournalEntry = {
        ref,
        byteSize: bytes.byteLength,
        mimeType: input.mimeType,
        digest: input.expectedDigest,
        etag: input.expectedDigest,
        createdAt: now,
        updatedAt: now,
        idempotencyKey: input.idempotencyKey,
      };
      journal.entries[refKey(ref)] = entry;
      const { idempotencyKey: _key, ...metadata } = entry;
      return { ...metadata, replayed };
    });
  }

  async delete(
    input: ObjectStorageDeleteInput,
  ): Promise<ObjectStorageDeleteResult> {
    const parsed = objectStorageDeleteInputSchema.parse(input);
    return this.#exclusive(async (journal) => {
      const key = refKey(parsed.ref);
      const entry = journal.entries[key];
      if (!entry)
        return { ref: parsed.ref, deleted: false, alreadyAbsent: true };
      if (parsed.expectedDigest && parsed.expectedDigest !== entry.digest) {
        throw new Error("OBJECT_DELETE_DIGEST_MISMATCH");
      }
      await this.#backend.delete(coreStorageBackendKey(parsed.ref));
      delete journal.entries[key];
      return { ref: parsed.ref, deleted: true, alreadyAbsent: false };
    });
  }

  beginMultipart(_input: MultipartBeginInput): Promise<MultipartHandle> {
    return Promise.reject(new Error("CORE_MULTIPART_UNAVAILABLE"));
  }
  uploadPart(_input: MultipartPartInput): Promise<MultipartPartReceipt> {
    return Promise.reject(new Error("CORE_MULTIPART_UNAVAILABLE"));
  }
  completeMultipart(
    _input: MultipartCompleteInput,
  ): Promise<ObjectStorageCommit> {
    return Promise.reject(new Error("CORE_MULTIPART_UNAVAILABLE"));
  }
  abortMultipart(_input: MultipartAbortInput): Promise<void> {
    return Promise.reject(new Error("CORE_MULTIPART_UNAVAILABLE"));
  }
  copy(_input: ObjectStorageCopyInput): Promise<ObjectStorageCommit> {
    return Promise.reject(new Error("CORE_COPY_UNAVAILABLE"));
  }

  async *reconcile(
    input: ObjectStorageReconcileInput,
  ): AsyncIterable<ObjectStorageEntry> {
    const parsed = objectStorageReconcileInputSchema.parse(input);
    const journal = await this.#load();
    const entries = Object.values(journal.entries)
      .filter(
        (entry) =>
          entry.ref.ownerId === parsed.ownerId &&
          entry.ref.namespace === parsed.namespace &&
          (!parsed.afterKey || entry.ref.key > parsed.afterKey),
      )
      .sort((left, right) => left.ref.key.localeCompare(right.ref.key))
      .slice(0, parsed.limit);
    for (const { idempotencyKey: _key, ...entry } of entries) yield entry;
  }

  async authorizeTransfer(
    input: ObjectTransferGrantInput,
  ): Promise<ObjectTransferGrant> {
    const parsed = objectTransferGrantInputSchema.parse(input);
    if (parsed.mode !== "core-relay")
      throw new Error("DIRECT_TRANSFER_UNAVAILABLE");
    const { expiresInSeconds, ...grantInput } = parsed;
    const grantId = `transfer_${crypto.randomUUID()}`;
    const expiresAt = new Date(
      Date.now() + expiresInSeconds * 1_000,
    ).toISOString();
    const encoded = Buffer.from(
      JSON.stringify({ ...grantInput, grantId, expiresAt }),
    ).toString("base64url");
    const signature = createHmac("sha256", this.#transferSecret)
      .update(encoded)
      .digest("base64url");
    return {
      ...grantInput,
      grantId,
      expiresAt,
      token: `${encoded}.${signature}`,
    };
  }
}
