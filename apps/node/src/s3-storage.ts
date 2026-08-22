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
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";

const s3NodeCredentialsSchema = z.strictObject({
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1).max(128).default("garage"),
  S3_BUCKET: z
    .string()
    .min(3)
    .max(63)
    .regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/u),
  S3_ACCESS_KEY_ID: z.string().min(3).max(256),
  S3_SECRET_ACCESS_KEY: z.string().min(16).max(4_096),
});

export type S3NodeCredentials = z.infer<typeof s3NodeCredentialsSchema>;

type JournalEntry = ObjectStorageMetadata & { idempotencyKey: string };
type Journal = { version: 1; entries: Record<string, JournalEntry> };

function refKey(ref: OwnedObjectRef) {
  return createHash("sha256").update(JSON.stringify(ref)).digest("hex");
}

function physicalKey(ref: OwnedObjectRef) {
  const ownerScope = createHash("sha256")
    .update(`${ref.ownerId}\0${ref.namespace}`)
    .digest("base64url");
  return `avermate-node/v1/${ownerScope}/${ref.key}`;
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
  for (;;) {
    const item = await reader.read();
    if (item.done) break;
    total += item.value.byteLength;
    if (total > maximum) {
      await reader.cancel().catch(() => undefined);
      throw new Error("OBJECT_SIZE_LIMIT_EXCEEDED");
    }
    chunks.push(item.value);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/** Parse a restricted dotenv secret file without interpolating shell syntax. */
export async function loadS3NodeCredentials(
  path: string,
): Promise<S3NodeCredentials> {
  const target = resolve(path);
  const metadata = await stat(target);
  const containerSecret = target.startsWith("/run/secrets/");
  if (
    process.platform !== "win32" &&
    !containerSecret &&
    (metadata.mode & 0o077) !== 0
  ) {
    throw new Error("NODE_S3_SECRET_FILE_PERMISSIONS_TOO_OPEN");
  }
  const entries: Record<string, string> = {};
  for (const sourceLine of (await readFile(target, "utf8")).split(/\r?\n/u)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) throw new Error("NODE_S3_SECRET_FILE_INVALID");
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key in entries || !value) {
      throw new Error("NODE_S3_SECRET_FILE_INVALID");
    }
    entries[key] = value;
  }
  return s3NodeCredentialsSchema.parse(entries);
}

/**
 * Node-owned S3/Garage provider. The local journal is authoritative for
 * ownership and digests; S3 owns only opaque, owner-scoped byte keys.
 */
export class S3ObjectStorageProvider implements ObjectStorageProvider {
  readonly id: string;
  readonly #client: Bun.S3Client;
  readonly #journalPath: string;
  readonly #maxObjectBytes: number;
  readonly #quotaBytes: number;
  readonly #transferSecret: Uint8Array;
  #journal: Journal | null = null;
  #mutex = Promise.resolve();

  constructor(input: {
    id?: string;
    credentials: S3NodeCredentials;
    journalPath: string;
    maxObjectBytes: number;
    quotaBytes: number;
    transferSecret?: Uint8Array;
  }) {
    const credentials = s3NodeCredentialsSchema.parse(input.credentials);
    if (input.maxObjectBytes <= 0 || input.quotaBytes < input.maxObjectBytes) {
      throw new Error("NODE_S3_LIMITS_INVALID");
    }
    this.id = input.id ?? "node-s3";
    this.#journalPath = resolve(input.journalPath);
    this.#maxObjectBytes = input.maxObjectBytes;
    this.#quotaBytes = input.quotaBytes;
    this.#transferSecret = input.transferSecret ?? randomBytes(32);
    this.#client = new Bun.S3Client({
      endpoint: credentials.S3_ENDPOINT,
      region: credentials.S3_REGION,
      bucket: credentials.S3_BUCKET,
      accessKeyId: credentials.S3_ACCESS_KEY_ID,
      secretAccessKey: credentials.S3_SECRET_ACCESS_KEY,
      virtualHostedStyle: false,
    });
  }

  async initialize() {
    await this.#load();
    await this.#client.list({ prefix: "avermate-node/v1/", maxKeys: 1 });
  }

  async usageBytes() {
    return Object.values((await this.#load()).entries).reduce(
      (total, entry) => total + entry.byteSize,
      0,
    );
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
      const parsed = JSON.parse(await readFile(this.#journalPath, "utf8")) as
        Journal | undefined;
      if (!parsed || parsed.version !== 1 || !parsed.entries) {
        throw new Error("NODE_S3_JOURNAL_INVALID");
      }
      this.#journal = parsed;
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

  async #readRemote(ref: OwnedObjectRef, maximum: number) {
    const remote = this.#client.file(physicalKey(ref));
    const size = await this.#client.size(physicalKey(ref));
    if (size > maximum) throw new Error("OBJECT_READ_LIMIT_EXCEEDED");
    const bytes = new Uint8Array(await remote.arrayBuffer());
    if (bytes.byteLength !== size) throw new Error("OBJECT_STREAM_TRUNCATED");
    return bytes;
  }

  async stat(
    input: ObjectStorageStatInput,
  ): Promise<ObjectStorageMetadata | null> {
    const { ref } = objectStorageStatInputSchema.parse(input);
    const entry = (await this.#load()).entries[refKey(ref)];
    if (!entry) return null;
    const key = physicalKey(ref);
    if (!(await this.#client.exists(key))) {
      throw new Error("OBJECT_LEDGER_MISSING_BYTES");
    }
    const remote = await this.#client.stat(key);
    if (remote.size !== entry.byteSize) {
      throw new Error("OBJECT_LEDGER_SIZE_MISMATCH");
    }
    const remoteMimeType = remote.type.split(";", 1)[0]?.trim().toLowerCase();
    if (
      remoteMimeType &&
      remoteMimeType !== entry.mimeType.trim().toLowerCase()
    ) {
      throw new Error("OBJECT_LEDGER_MIME_MISMATCH");
    }
    const { idempotencyKey: _key, ...metadata } = entry;
    return metadata;
  }

  async get(input: ObjectStorageGetInput) {
    const parsed = objectStorageGetInputSchema.parse(input);
    const metadata = await this.stat({ ref: parsed.ref });
    if (!metadata) throw new Error("OBJECT_NOT_FOUND");
    const bytes = await this.#readRemote(
      parsed.ref,
      parsed.maxBytes ?? this.#maxObjectBytes,
    );
    if (digest(bytes) !== metadata.digest) {
      throw new Error("OBJECT_DIGEST_MISMATCH");
    }
    return bytesStream(bytes);
  }

  async getRange(input: ObjectStorageRangeInput): Promise<ObjectStorageRange> {
    const parsed = objectStorageRangeInputSchema.parse(input);
    const metadata = await this.stat({ ref: parsed.ref });
    if (!metadata) throw new Error("OBJECT_NOT_FOUND");
    if (parsed.endInclusive >= metadata.byteSize) {
      throw new Error("OBJECT_RANGE_NOT_SATISFIABLE");
    }
    const bytes = await this.#readRemote(parsed.ref, this.#maxObjectBytes);
    if (digest(bytes) !== metadata.digest) {
      throw new Error("OBJECT_DIGEST_MISMATCH");
    }
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
    if (
      !Number.isSafeInteger(input.byteSize) ||
      input.byteSize < 0 ||
      input.byteSize > this.#maxObjectBytes
    ) {
      throw new Error("OBJECT_SIZE_LIMIT_EXCEEDED");
    }
    const bytes = await readBounded(input.body, this.#maxObjectBytes);
    if (bytes.byteLength !== input.byteSize) {
      throw new Error("OBJECT_STREAM_TRUNCATED");
    }
    if (digest(bytes) !== input.expectedDigest) {
      throw new Error("OBJECT_DIGEST_MISMATCH");
    }
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
      const usedBytes = Object.values(journal.entries).reduce(
        (total, entry) => total + entry.byteSize,
        0,
      );
      if (usedBytes + bytes.byteLength > this.#quotaBytes) {
        throw new Error("OBJECT_QUOTA_EXCEEDED");
      }

      const key = physicalKey(ref);
      let replayed = false;
      if (await this.#client.exists(key)) {
        const orphan = await this.#readRemote(ref, this.#maxObjectBytes);
        if (
          orphan.byteLength !== input.byteSize ||
          digest(orphan) !== input.expectedDigest
        ) {
          throw new Error("ORPHAN_OBJECT_CONFLICT");
        }
        replayed = true;
      } else {
        const written = await this.#client.write(key, bytes, {
          type: input.mimeType,
        });
        if (written !== bytes.byteLength) {
          throw new Error("OBJECT_STREAM_TRUNCATED");
        }
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
      if (!entry) {
        return { ref: parsed.ref, deleted: false, alreadyAbsent: true };
      }
      if (parsed.expectedDigest && parsed.expectedDigest !== entry.digest) {
        throw new Error("OBJECT_DELETE_DIGEST_MISMATCH");
      }
      await this.#client.delete(physicalKey(parsed.ref));
      if (await this.#client.exists(physicalKey(parsed.ref))) {
        throw new Error("OBJECT_DELETE_NOT_CONFIRMED");
      }
      delete journal.entries[key];
      return { ref: parsed.ref, deleted: true, alreadyAbsent: false };
    });
  }

  beginMultipart(_input: MultipartBeginInput): Promise<MultipartHandle> {
    return Promise.reject(new Error("NODE_S3_MULTIPART_UNAVAILABLE"));
  }

  uploadPart(_input: MultipartPartInput): Promise<MultipartPartReceipt> {
    return Promise.reject(new Error("NODE_S3_MULTIPART_UNAVAILABLE"));
  }

  completeMultipart(
    _input: MultipartCompleteInput,
  ): Promise<ObjectStorageCommit> {
    return Promise.reject(new Error("NODE_S3_MULTIPART_UNAVAILABLE"));
  }

  abortMultipart(_input: MultipartAbortInput): Promise<void> {
    return Promise.reject(new Error("NODE_S3_MULTIPART_UNAVAILABLE"));
  }

  copy(_input: ObjectStorageCopyInput): Promise<ObjectStorageCommit> {
    return Promise.reject(new Error("NODE_S3_COPY_UNAVAILABLE"));
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
    for (const { idempotencyKey: _key, ...entry } of entries) {
      if (!(await this.#client.exists(physicalKey(entry.ref)))) {
        throw new Error("OBJECT_LEDGER_MISSING_BYTES");
      }
      yield entry;
    }
  }

  async authorizeTransfer(
    input: ObjectTransferGrantInput,
  ): Promise<ObjectTransferGrant> {
    const parsed = objectTransferGrantInputSchema.parse(input);
    if (parsed.mode !== "core-relay") {
      throw new Error("DIRECT_TRANSFER_UNAVAILABLE");
    }
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
