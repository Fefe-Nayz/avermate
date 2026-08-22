import type { ObjectStorageProvider } from "@avermate/agent-contracts";
import type { files } from "../db/schema";
import {
  createPairedNodeObjectStorageProvider,
  nodeIdFromStorageProvider,
} from "../node/services";
import { readStorageObject } from "./storage-backend";

/**
 * Minimum database identity required to read an Avermate-owned file internally.
 * Callers must carry the owner from their domain query; storage never infers it
 * from a browser URL or ambient authentication cookie.
 */
export type OwnedStoredFile = Pick<
  typeof files.$inferSelect,
  | "id"
  | "userId"
  | "provider"
  | "storageKey"
  | "mimeType"
  | "byteSize"
  | "status"
>;

export type OwnedFileStorageDependencies = {
  readManagedObject?: typeof readStorageObject;
  resolveNodeProvider?: (input: {
    ownerId: string;
    nodeId: string;
  }) => Promise<Pick<ObjectStorageProvider, "stat" | "get">>;
};

export type OwnedFileReadOptions = {
  signal?: AbortSignal;
  maxBytes?: number;
  dependencies?: OwnedFileStorageDependencies;
};

export function isInternalOwnedFileProvider(provider: string) {
  return (
    provider === "local" ||
    provider === "s3" ||
    nodeIdFromStorageProvider(provider) !== null
  );
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Owned file read aborted", "AbortError");
}

function readStreamChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
) {
  if (!signal) return reader.read();
  throwIfAborted(signal);
  return new Promise<Awaited<ReturnType<typeof reader.read>>>(
    (resolve, reject) => {
      let settled = false;
      const settle = () => {
        if (settled) return false;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        return true;
      };
      const onAbort = () => {
        const reason =
          signal.reason instanceof Error
            ? signal.reason
            : new DOMException("Owned file read aborted", "AbortError");
        void reader.cancel(reason).catch(() => undefined);
        if (settle()) reject(reason);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      void reader.read().then(
        (value) => {
          if (settle()) resolve(value);
        },
        (error: unknown) => {
          if (settle()) reject(error);
        },
      );
    },
  );
}

function readLimit(file: OwnedStoredFile, requested?: number) {
  const maximum = requested ?? file.byteSize;
  if (!Number.isSafeInteger(maximum) || maximum < 0) {
    throw new Error("OWNED_FILE_READ_LIMIT_INVALID");
  }
  if (file.byteSize > maximum) {
    throw new Error("OWNED_FILE_READ_LIMIT_EXCEEDED");
  }
  return maximum;
}

function assertReadableOwnedFile(ownerId: string, file: OwnedStoredFile) {
  if (!ownerId || file.userId !== ownerId) {
    throw new Error("OWNED_FILE_OWNER_MISMATCH");
  }
  if (file.status !== "stored") {
    throw new Error("OWNED_FILE_UNAVAILABLE");
  }
  if (
    !file.id ||
    !file.storageKey ||
    !file.mimeType ||
    !Number.isSafeInteger(file.byteSize) ||
    file.byteSize < 0
  ) {
    throw new Error("OWNED_FILE_IDENTITY_INVALID");
  }
}

function singleChunkStream(bytes: ArrayBuffer) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
}

function boundedVerifiedStream(
  source: ReadableStream<Uint8Array>,
  expectedBytes: number,
  maximumBytes: number,
  signal?: AbortSignal,
) {
  const reader = source.getReader();
  let total = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        throwIfAborted(signal);
        const next = await readStreamChunk(reader, signal);
        if (next.done) {
          if (total !== expectedBytes) {
            throw new Error("OWNED_FILE_SIZE_MISMATCH");
          }
          controller.close();
          return;
        }
        total += next.value.byteLength;
        if (total > maximumBytes || total > expectedBytes) {
          throw new Error("OWNED_FILE_READ_LIMIT_EXCEEDED");
        }
        controller.enqueue(next.value);
      } catch (error) {
        await reader.cancel(error).catch(() => undefined);
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined);
    },
  });
}

/**
 * Open a bounded internal stream for a local, S3 or paired-Node file.
 *
 * This is the sole provider dispatch boundary for domain jobs. In particular,
 * it never resolves `/api/files/:id`, a signed browser URL or a user cookie.
 */
export async function streamOwnedFile(
  ownerId: string,
  file: OwnedStoredFile,
  options: OwnedFileReadOptions = {},
): Promise<ReadableStream<Uint8Array>> {
  assertReadableOwnedFile(ownerId, file);
  const maximum = readLimit(file, options.maxBytes);
  throwIfAborted(options.signal);

  if (file.provider === "local" || file.provider === "s3") {
    const bytes = await (
      options.dependencies?.readManagedObject ?? readStorageObject
    )(file.provider, file.storageKey, {
      signal: options.signal,
      maxBytes: maximum,
    });
    throwIfAborted(options.signal);
    if (bytes.byteLength !== file.byteSize) {
      throw new Error("OWNED_FILE_SIZE_MISMATCH");
    }
    return singleChunkStream(bytes);
  }

  const nodeId = nodeIdFromStorageProvider(file.provider);
  if (!nodeId) throw new Error("OWNED_FILE_STORAGE_PROVIDER_UNSUPPORTED");
  const provider = await (
    options.dependencies?.resolveNodeProvider ??
    ((identity) => createPairedNodeObjectStorageProvider(identity))
  )({ ownerId, nodeId });
  const ref = { ownerId, namespace: "files" as const, key: file.storageKey };
  const metadata = await provider.stat({ ref });
  throwIfAborted(options.signal);
  if (!metadata) throw new Error("OWNED_FILE_UNAVAILABLE");
  if (
    metadata.byteSize !== file.byteSize ||
    metadata.mimeType.toLowerCase() !== file.mimeType.toLowerCase()
  ) {
    throw new Error("OWNED_FILE_METADATA_MISMATCH");
  }
  return boundedVerifiedStream(
    await provider.get({ ref, maxBytes: Math.max(1, maximum) }),
    file.byteSize,
    maximum,
    options.signal,
  );
}

/** Read an owned file completely while retaining the same bounded stream path. */
export async function readOwnedFileBytes(
  ownerId: string,
  file: OwnedStoredFile,
  options: OwnedFileReadOptions = {},
): Promise<ArrayBuffer> {
  const maximum = readLimit(file, options.maxBytes);
  const stream = await streamOwnedFile(ownerId, file, options);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      throwIfAborted(options.signal);
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maximum || total > file.byteSize) {
        throw new Error("OWNED_FILE_READ_LIMIT_EXCEEDED");
      }
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  throwIfAborted(options.signal);
  if (total !== file.byteSize) throw new Error("OWNED_FILE_SIZE_MISMATCH");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}
