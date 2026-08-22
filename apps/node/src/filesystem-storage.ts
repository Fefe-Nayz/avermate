import {
  multipartAbortInputSchema,
  multipartBeginInputSchema,
  multipartCompleteInputSchema,
  objectStorageCopyInputSchema,
  objectStorageDeleteInputSchema,
  objectStorageGetInputSchema,
  objectStorageRangeInputSchema,
  objectStorageReconcileInputSchema,
  objectStorageStatInputSchema,
  objectTransferGrantInputSchema,
  ownedObjectRefSchema,
  type MultipartHandle,
  type MultipartPartInput,
  type MultipartPartReceipt,
  type ObjectStorageCapabilities,
  type ObjectStorageCommit,
  type ObjectStorageDeleteResult,
  type ObjectStorageEntry,
  type ObjectStorageGetInput,
  type ObjectStorageMetadata,
  type ObjectStorageProvider,
  type ObjectStoragePutInput,
  type ObjectStorageRange,
  type ObjectStorageRangeInput,
  type ObjectTransferGrant,
  type OwnedObjectRef,
} from "@avermate/agent-contracts";
import { createHash, createHmac, randomBytes } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { canonicalJson } from "./canonical-json";

type StoredMetadata = ObjectStorageMetadata & {
  version: 1;
  idempotencyKey: string;
};

type MultipartManifest = {
  version: 1;
  uploadId: string;
  ref: OwnedObjectRef;
  byteSize: number;
  mimeType: string;
  expectedDigest: `sha256:${string}`;
  idempotencyKey: string;
  expiresAt: string;
  state: "open" | "completed" | "aborted";
  parts: Record<
    string,
    {
      partNumber: number;
      byteSize: number;
      digest: `sha256:${string}`;
      etag: string;
    }
  >;
  commit?: ObjectStorageCommit;
};

function sha256(bytes: Uint8Array | string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function publicMetadata(metadata: StoredMetadata): ObjectStorageMetadata {
  const {
    version: _version,
    idempotencyKey: _idempotencyKey,
    ...result
  } = metadata;
  return result;
}

function streamFromNode(readable: NodeJS.ReadableStream) {
  return Readable.toWeb(
    readable as Readable,
  ) as unknown as ReadableStream<Uint8Array>;
}

async function atomicJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  await rename(temporary, path);
}

async function exists(path: string) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export class FilesystemObjectStorageProvider implements ObjectStorageProvider {
  readonly id: string;
  readonly #root: string;
  readonly #maxObjectBytes: number;
  readonly #maxPartBytes: number;
  readonly #quotaBytes: number;
  readonly #transferSecret: Uint8Array;
  readonly #locks = new Map<string, Promise<unknown>>();

  constructor(input: {
    id?: string;
    root: string;
    maxObjectBytes: number;
    quotaBytes: number;
    maxPartBytes?: number;
    transferSecret?: Uint8Array;
  }) {
    this.id = input.id ?? "node-filesystem";
    this.#root = resolve(input.root);
    this.#maxObjectBytes = input.maxObjectBytes;
    this.#maxPartBytes =
      input.maxPartBytes ?? Math.min(64 * 1024 * 1024, input.maxObjectBytes);
    this.#quotaBytes = input.quotaBytes;
    this.#transferSecret = input.transferSecret ?? randomBytes(32);
  }

  async initialize() {
    await Promise.all(
      ["objects", "metadata", "temporary", "multipart", "multipart-keys"].map(
        (directory) =>
          mkdir(join(this.#root, directory), { recursive: true, mode: 0o700 }),
      ),
    );
  }

  async capabilities(): Promise<ObjectStorageCapabilities> {
    return {
      providerId: this.id,
      maxObjectBytes: this.#maxObjectBytes,
      maxPartBytes: this.#maxPartBytes,
      minPartBytes: 1,
      multipart: true,
      range: true,
      copy: true,
      reconcile: true,
      directTransfer: false,
      checksumAlgorithms: ["sha256"],
    };
  }

  #refId(ref: OwnedObjectRef) {
    const parsed = ownedObjectRefSchema.parse(ref);
    return createHash("sha256").update(canonicalJson(parsed)).digest("hex");
  }

  #objectPath(ref: OwnedObjectRef) {
    return join(this.#root, "objects", `${this.#refId(ref)}.blob`);
  }

  #metadataPath(ref: OwnedObjectRef) {
    return join(this.#root, "metadata", `${this.#refId(ref)}.json`);
  }

  #multipartPath(uploadId: string) {
    if (!/^upload_[a-zA-Z0-9-]+$/u.test(uploadId))
      throw new Error("INVALID_UPLOAD_ID");
    return join(this.#root, "multipart", uploadId);
  }

  async #withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolveLock) => {
      release = resolveLock;
    });
    const queued = previous.then(() => current);
    this.#locks.set(key, queued);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (this.#locks.get(key) === queued) this.#locks.delete(key);
    }
  }

  async #metadata(ref: OwnedObjectRef): Promise<StoredMetadata | null> {
    try {
      return JSON.parse(
        await readFile(this.#metadataPath(ref), "utf8"),
      ) as StoredMetadata;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async stat(input: { ref: OwnedObjectRef }) {
    const { ref } = objectStorageStatInputSchema.parse(input);
    const metadata = await this.#metadata(ref);
    if (!metadata) return null;
    if (!(await exists(this.#objectPath(ref))))
      throw new Error("OBJECT_LEDGER_MISSING_BYTES");
    return publicMetadata(metadata);
  }

  async get(input: ObjectStorageGetInput): Promise<ReadableStream<Uint8Array>> {
    const { ref, maxBytes } = objectStorageGetInputSchema.parse(input);
    const metadata = await this.stat({ ref });
    if (!metadata) throw new Error("OBJECT_NOT_FOUND");
    if (maxBytes !== undefined && metadata.byteSize > maxBytes) {
      throw new Error("OBJECT_READ_LIMIT_EXCEEDED");
    }
    return streamFromNode(createReadStream(this.#objectPath(ref)));
  }

  async getRange(input: ObjectStorageRangeInput): Promise<ObjectStorageRange> {
    const parsed = objectStorageRangeInputSchema.parse(input);
    const metadata = await this.stat({ ref: parsed.ref });
    if (!metadata) throw new Error("OBJECT_NOT_FOUND");
    if (
      parsed.start >= metadata.byteSize ||
      parsed.endInclusive >= metadata.byteSize
    ) {
      throw new Error("OBJECT_RANGE_NOT_SATISFIABLE");
    }
    return {
      metadata,
      start: parsed.start,
      endInclusive: parsed.endInclusive,
      totalBytes: metadata.byteSize,
      body: streamFromNode(
        createReadStream(this.#objectPath(parsed.ref), {
          start: parsed.start,
          end: parsed.endInclusive,
        }),
      ),
    };
  }

  async #writeVerified(input: {
    body: ReadableStream<Uint8Array>;
    byteSize: number;
    expectedDigest: string;
    temporaryPath: string;
    maximumBytes: number;
  }) {
    if (input.byteSize > input.maximumBytes)
      throw new Error("OBJECT_SIZE_LIMIT_EXCEEDED");
    const handle = await open(input.temporaryPath, "wx", 0o600);
    const hash = createHash("sha256");
    const reader = input.body.getReader();
    let total = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        if (!(part.value instanceof Uint8Array))
          throw new Error("OBJECT_STREAM_INVALID_CHUNK");
        total += part.value.byteLength;
        if (total > input.byteSize || total > input.maximumBytes) {
          throw new Error("OBJECT_STREAM_OVERFLOW");
        }
        hash.update(part.value);
        await handle.write(part.value);
      }
      await handle.sync();
    } catch (error) {
      await reader.cancel(error).catch(() => undefined);
      throw error;
    } finally {
      await handle.close();
    }
    if (total !== input.byteSize) throw new Error("OBJECT_STREAM_TRUNCATED");
    const digest = `sha256:${hash.digest("hex")}`;
    if (digest !== input.expectedDigest)
      throw new Error("OBJECT_DIGEST_MISMATCH");
    return digest as `sha256:${string}`;
  }

  async #usageBytes() {
    let total = 0;
    const files = new Bun.Glob("*.json");
    for await (const name of files.scan({
      cwd: join(this.#root, "metadata"),
      onlyFiles: true,
    })) {
      const metadata = JSON.parse(
        await readFile(join(this.#root, "metadata", name), "utf8"),
      ) as StoredMetadata;
      total += metadata.byteSize;
    }
    return total;
  }

  async usageBytes() {
    await this.initialize();
    return this.#usageBytes();
  }

  async #digestPath(path: string) {
    const hash = createHash("sha256");
    let byteSize = 0;
    for await (const chunk of createReadStream(path)) {
      const bytes = chunk as Buffer;
      byteSize += bytes.byteLength;
      hash.update(bytes);
    }
    return {
      byteSize,
      digest: `sha256:${hash.digest("hex")}` as `sha256:${string}`,
    };
  }

  async put(input: ObjectStoragePutInput): Promise<ObjectStorageCommit> {
    const ref = ownedObjectRefSchema.parse(input.ref);
    if (!Number.isSafeInteger(input.byteSize) || input.byteSize < 0) {
      throw new Error("OBJECT_SIZE_INVALID");
    }
    if (!input.mimeType || input.mimeType.length > 255)
      throw new Error("OBJECT_MIME_INVALID");
    if (!/^sha256:[a-f0-9]{64}$/u.test(input.expectedDigest)) {
      throw new Error("OBJECT_DIGEST_INVALID");
    }
    if (!input.idempotencyKey || input.idempotencyKey.length > 256) {
      throw new Error("OBJECT_IDEMPOTENCY_KEY_INVALID");
    }
    await this.initialize();
    return this.#withLock("quota", async () => {
      const previous = await this.#metadata(ref);
      if (previous) {
        if (
          previous.digest !== input.expectedDigest ||
          previous.byteSize !== input.byteSize ||
          previous.mimeType !== input.mimeType
        ) {
          throw new Error("OBJECT_ALREADY_EXISTS_DIFFERENT_CONTENT");
        }
        return { ...publicMetadata(previous), replayed: true };
      }
      const objectPath = this.#objectPath(ref);
      if (await exists(objectPath)) {
        const orphan = await this.#digestPath(objectPath);
        if (
          orphan.digest !== input.expectedDigest ||
          orphan.byteSize !== input.byteSize
        ) {
          throw new Error("ORPHAN_OBJECT_CONFLICT");
        }
        if ((await this.#usageBytes()) + orphan.byteSize > this.#quotaBytes) {
          throw new Error("STORAGE_QUOTA_EXCEEDED_ORPHAN");
        }
        const now = new Date().toISOString();
        const recovered: StoredMetadata = {
          version: 1,
          ref,
          byteSize: orphan.byteSize,
          mimeType: input.mimeType,
          digest: orphan.digest,
          etag: orphan.digest,
          createdAt: now,
          updatedAt: now,
          idempotencyKey: input.idempotencyKey,
        };
        await atomicJson(this.#metadataPath(ref), recovered);
        return { ...publicMetadata(recovered), replayed: true };
      }
      if ((await this.#usageBytes()) + input.byteSize > this.#quotaBytes) {
        throw new Error("STORAGE_QUOTA_EXCEEDED");
      }
      const temporary = join(
        this.#root,
        "temporary",
        `${crypto.randomUUID()}.upload`,
      );
      try {
        const digest = await this.#writeVerified({
          body: input.body,
          byteSize: input.byteSize,
          expectedDigest: input.expectedDigest,
          temporaryPath: temporary,
          maximumBytes: this.#maxObjectBytes,
        });
        await rename(temporary, objectPath);
        const now = new Date().toISOString();
        const metadata: StoredMetadata = {
          version: 1,
          ref,
          byteSize: input.byteSize,
          mimeType: input.mimeType,
          digest,
          etag: digest,
          createdAt: now,
          updatedAt: now,
          idempotencyKey: input.idempotencyKey,
        };
        await atomicJson(this.#metadataPath(ref), metadata);
        return { ...publicMetadata(metadata), replayed: false };
      } finally {
        await rm(temporary, { force: true }).catch(() => undefined);
      }
    });
  }

  async delete(input: {
    ref: OwnedObjectRef;
    expectedDigest?: `sha256:${string}`;
    idempotencyKey: string;
  }): Promise<ObjectStorageDeleteResult> {
    const parsed = objectStorageDeleteInputSchema.parse(input);
    await this.initialize();
    return this.#withLock(`delete:${this.#refId(parsed.ref)}`, async () => {
      const metadata = await this.#metadata(parsed.ref);
      if (!metadata) {
        return { ref: parsed.ref, deleted: false, alreadyAbsent: true };
      }
      if (parsed.expectedDigest && metadata.digest !== parsed.expectedDigest) {
        throw new Error("OBJECT_DELETE_DIGEST_MISMATCH");
      }
      await rm(this.#objectPath(parsed.ref), { force: true });
      await rm(this.#metadataPath(parsed.ref), { force: true });
      return { ref: parsed.ref, deleted: true, alreadyAbsent: false };
    });
  }

  async beginMultipart(
    input: Parameters<ObjectStorageProvider["beginMultipart"]>[0],
  ): Promise<MultipartHandle> {
    const parsed = multipartBeginInputSchema.parse(input);
    if (parsed.byteSize > this.#maxObjectBytes)
      throw new Error("OBJECT_SIZE_LIMIT_EXCEEDED");
    await this.initialize();
    const key = createHash("sha256")
      .update(
        canonicalJson({
          ref: parsed.ref,
          idempotencyKey: parsed.idempotencyKey,
        }),
      )
      .digest("hex");
    return this.#withLock(`multipart-key:${key}`, async () => {
      const keyPath = join(this.#root, "multipart-keys", `${key}.json`);
      try {
        const existing = JSON.parse(
          await readFile(keyPath, "utf8"),
        ) as MultipartManifest;
        if (
          existing.byteSize !== parsed.byteSize ||
          existing.expectedDigest !== parsed.expectedDigest ||
          existing.mimeType !== parsed.mimeType
        ) {
          throw new Error("IDEMPOTENCY_PAYLOAD_MISMATCH");
        }
        return {
          uploadId: existing.uploadId,
          ref: existing.ref,
          byteSize: existing.byteSize,
          expectedDigest: existing.expectedDigest,
          expiresAt: existing.expiresAt,
          replayed: true,
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const uploadId = `upload_${crypto.randomUUID()}`;
      const manifest: MultipartManifest = {
        version: 1,
        uploadId,
        ref: parsed.ref,
        byteSize: parsed.byteSize,
        mimeType: parsed.mimeType,
        expectedDigest: parsed.expectedDigest as `sha256:${string}`,
        idempotencyKey: parsed.idempotencyKey,
        expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
        state: "open",
        parts: {},
      };
      const manifestPath = join(this.#multipartPath(uploadId), "manifest.json");
      await atomicJson(manifestPath, manifest);
      await atomicJson(keyPath, manifest);
      return {
        uploadId,
        ref: parsed.ref,
        byteSize: parsed.byteSize,
        expectedDigest: parsed.expectedDigest,
        expiresAt: manifest.expiresAt,
        replayed: false,
      };
    });
  }

  async #readMultipart(uploadId: string): Promise<MultipartManifest> {
    try {
      return JSON.parse(
        await readFile(
          join(this.#multipartPath(uploadId), "manifest.json"),
          "utf8",
        ),
      ) as MultipartManifest;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error("MULTIPART_UPLOAD_NOT_FOUND");
      }
      throw error;
    }
  }

  async uploadPart(input: MultipartPartInput): Promise<MultipartPartReceipt> {
    if (
      !Number.isInteger(input.partNumber) ||
      input.partNumber < 1 ||
      input.partNumber > 10_000
    ) {
      throw new Error("MULTIPART_PART_NUMBER_INVALID");
    }
    if (!Number.isSafeInteger(input.byteSize) || input.byteSize < 1) {
      throw new Error("MULTIPART_PART_SIZE_INVALID");
    }
    return this.#withLock(`multipart:${input.uploadId}`, async () => {
      const manifest = await this.#readMultipart(input.uploadId);
      if (manifest.ref.ownerId !== input.ownerId)
        throw new Error("MULTIPART_OWNER_MISMATCH");
      if (manifest.state !== "open")
        throw new Error("MULTIPART_UPLOAD_NOT_OPEN");
      const existing = manifest.parts[String(input.partNumber)];
      if (existing) {
        if (
          existing.digest !== input.expectedDigest ||
          existing.byteSize !== input.byteSize
        ) {
          throw new Error("MULTIPART_PART_REPLAY_MISMATCH");
        }
        return { uploadId: input.uploadId, ...existing, replayed: true };
      }
      const path = join(
        this.#multipartPath(input.uploadId),
        `part-${input.partNumber}.blob`,
      );
      const digest = await this.#writeVerified({
        body: input.body,
        byteSize: input.byteSize,
        expectedDigest: input.expectedDigest,
        temporaryPath: path,
        maximumBytes: this.#maxPartBytes,
      });
      const receipt = {
        partNumber: input.partNumber,
        byteSize: input.byteSize,
        digest,
        etag: digest,
      };
      manifest.parts[String(input.partNumber)] = receipt;
      await atomicJson(
        join(this.#multipartPath(input.uploadId), "manifest.json"),
        manifest,
      );
      return { uploadId: input.uploadId, ...receipt, replayed: false };
    });
  }

  async completeMultipart(
    input: Parameters<ObjectStorageProvider["completeMultipart"]>[0],
  ): Promise<ObjectStorageCommit> {
    const parsed = multipartCompleteInputSchema.parse(input);
    return this.#withLock(`multipart:${parsed.uploadId}`, async () => {
      const manifest = await this.#readMultipart(parsed.uploadId);
      if (manifest.ref.ownerId !== parsed.ownerId)
        throw new Error("MULTIPART_OWNER_MISMATCH");
      if (manifest.state === "completed" && manifest.commit) {
        return { ...manifest.commit, replayed: true };
      }
      if (manifest.state !== "open")
        throw new Error("MULTIPART_UPLOAD_NOT_OPEN");
      const numbers = parsed.parts.map((part) => part.partNumber);
      if (
        new Set(numbers).size !== numbers.length ||
        numbers.some((value, index) => value !== index + 1)
      ) {
        throw new Error("MULTIPART_PART_ORDER_INVALID");
      }
      let total = 0;
      for (const requested of parsed.parts) {
        const recorded = manifest.parts[String(requested.partNumber)];
        if (!recorded || recorded.etag !== requested.etag) {
          throw new Error("MULTIPART_PART_ETAG_MISMATCH");
        }
        total += recorded.byteSize;
      }
      if (total !== manifest.byteSize)
        throw new Error("MULTIPART_TOTAL_SIZE_MISMATCH");
      const body = streamFromNode(
        Readable.from(
          (async function* (provider: FilesystemObjectStorageProvider) {
            for (const requested of parsed.parts) {
              const stream = createReadStream(
                join(
                  provider.#multipartPath(parsed.uploadId),
                  `part-${requested.partNumber}.blob`,
                ),
              );
              for await (const chunk of stream) yield chunk as Buffer;
            }
          })(this),
        ),
      );
      const commit = await this.put({
        ref: manifest.ref,
        body,
        byteSize: manifest.byteSize,
        mimeType: manifest.mimeType,
        expectedDigest: manifest.expectedDigest,
        idempotencyKey: `multipart:${manifest.uploadId}`,
      });
      manifest.state = "completed";
      manifest.commit = commit;
      await atomicJson(
        join(this.#multipartPath(parsed.uploadId), "manifest.json"),
        manifest,
      );
      for (const requested of parsed.parts) {
        await rm(
          join(
            this.#multipartPath(parsed.uploadId),
            `part-${requested.partNumber}.blob`,
          ),
          {
            force: true,
          },
        );
      }
      return commit;
    });
  }

  async abortMultipart(
    input: Parameters<ObjectStorageProvider["abortMultipart"]>[0],
  ) {
    const parsed = multipartAbortInputSchema.parse(input);
    return this.#withLock(`multipart:${parsed.uploadId}`, async () => {
      let manifest: MultipartManifest;
      try {
        manifest = await this.#readMultipart(parsed.uploadId);
      } catch (error) {
        if ((error as Error).message === "MULTIPART_UPLOAD_NOT_FOUND") return;
        throw error;
      }
      if (manifest.ref.ownerId !== parsed.ownerId)
        throw new Error("MULTIPART_OWNER_MISMATCH");
      if (manifest.state === "completed")
        throw new Error("MULTIPART_ALREADY_COMPLETED");
      manifest.state = "aborted";
      await atomicJson(
        join(this.#multipartPath(parsed.uploadId), "manifest.json"),
        manifest,
      );
      for (const part of Object.values(manifest.parts)) {
        await rm(
          join(
            this.#multipartPath(parsed.uploadId),
            `part-${part.partNumber}.blob`,
          ),
          {
            force: true,
          },
        );
      }
    });
  }

  async copy(input: Parameters<NonNullable<ObjectStorageProvider["copy"]>>[0]) {
    const parsed = objectStorageCopyInputSchema.parse(input);
    if (parsed.source.ownerId !== parsed.destination.ownerId) {
      throw new Error("OBJECT_COPY_CROSS_OWNER_DENIED");
    }
    const source = await this.stat({ ref: parsed.source });
    if (!source) throw new Error("OBJECT_NOT_FOUND");
    if (source.digest !== parsed.expectedSourceDigest) {
      throw new Error("OBJECT_COPY_DIGEST_MISMATCH");
    }
    return this.put({
      ref: parsed.destination,
      body: await this.get({ ref: parsed.source }),
      byteSize: source.byteSize,
      mimeType: source.mimeType,
      expectedDigest: source.digest,
      idempotencyKey: parsed.idempotencyKey,
    });
  }

  async *reconcile(
    input: Parameters<ObjectStorageProvider["reconcile"]>[0],
    internalWildcard = false,
  ): AsyncIterable<ObjectStorageEntry> {
    const parsed = internalWildcard
      ? input
      : objectStorageReconcileInputSchema.parse(input);
    const directory = new Bun.Glob("*.json");
    const metadata: StoredMetadata[] = [];
    for await (const name of directory.scan({
      cwd: join(this.#root, "metadata"),
      onlyFiles: true,
    })) {
      const item = JSON.parse(
        await readFile(join(this.#root, "metadata", name), "utf8"),
      ) as StoredMetadata;
      if (
        (internalWildcard || item.ref.ownerId === parsed.ownerId) &&
        (internalWildcard || item.ref.namespace === parsed.namespace) &&
        (!parsed.afterKey || item.ref.key > parsed.afterKey)
      ) {
        metadata.push(item);
      }
    }
    metadata.sort((left, right) => left.ref.key.localeCompare(right.ref.key));
    for (const item of metadata.slice(0, parsed.limit))
      yield publicMetadata(item);
  }

  async authorizeTransfer(
    input: Parameters<ObjectStorageProvider["authorizeTransfer"]>[0],
  ): Promise<ObjectTransferGrant> {
    const parsed = objectTransferGrantInputSchema.parse(input);
    if (parsed.mode === "direct-https")
      throw new Error("DIRECT_TRANSFER_UNAVAILABLE");
    if (parsed.byteLimit > this.#maxObjectBytes)
      throw new Error("TRANSFER_LIMIT_EXCEEDED");
    const grantId = `transfer_${crypto.randomUUID()}`;
    const expiresAt = new Date(
      Date.now() + parsed.expiresInSeconds * 1_000,
    ).toISOString();
    const { expiresInSeconds: _expiresInSeconds, ...grantInput } = parsed;
    const payload = { ...grantInput, grantId, expiresAt };
    const encoded = Buffer.from(canonicalJson(payload)).toString("base64url");
    const signature = createHmac("sha256", this.#transferSecret)
      .update(encoded)
      .digest("base64url");
    return { ...payload, token: `${encoded}.${signature}` };
  }
}

export async function readStreamBytes(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    chunks.push(item.value);
    total += item.value.byteLength;
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export function bytesStream(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

export function digestBytes(bytes: Uint8Array) {
  return sha256(bytes);
}
