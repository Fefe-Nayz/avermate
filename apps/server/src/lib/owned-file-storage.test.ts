import type { ObjectStorageProvider } from "@avermate/agent-contracts";
import { describe, expect, test } from "bun:test";
import {
  readOwnedFileBytes,
  streamOwnedFile,
  type OwnedStoredFile,
} from "./owned-file-storage";

function storedFile(overrides: Partial<OwnedStoredFile> = {}): OwnedStoredFile {
  return {
    id: "file-owned-1",
    userId: "owner-1",
    provider: "local",
    storageKey: "private/course-material/owner-1/source.pdf",
    mimeType: "application/pdf",
    byteSize: 4,
    status: "stored",
    ...overrides,
  };
}

function stream(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, 2));
      controller.enqueue(bytes.slice(2));
      controller.close();
    },
  });
}

describe("owner-scoped file storage reads", () => {
  test("reads managed storage through the injected internal byte seam", async () => {
    const calls: unknown[] = [];
    const bytes = await readOwnedFileBytes("owner-1", storedFile(), {
      maxBytes: 8,
      dependencies: {
        readManagedObject: async (provider, storageKey, options) => {
          calls.push({ provider, storageKey, maxBytes: options?.maxBytes });
          return Uint8Array.from([1, 2, 3, 4]).buffer;
        },
      },
    });
    expect([...new Uint8Array(bytes)]).toEqual([1, 2, 3, 4]);
    expect(calls).toEqual([
      {
        provider: "local",
        storageKey: "private/course-material/owner-1/source.pdf",
        maxBytes: 8,
      },
    ]);
  });

  test("reads a simulated paired-Node provider without an URL or cookie", async () => {
    const file = storedFile({
      provider: "node:node_test_1:relay-storage-v1",
      storageKey: "private/course-material/owner-1/node.pdf",
    });
    const calls: unknown[] = [];
    const provider = {
      stat: async ({ ref }) => {
        calls.push({ kind: "stat", ref });
        return {
          ref,
          byteSize: 4,
          mimeType: "application/pdf",
          digest: `sha256:${"a".repeat(64)}`,
          etag: "node-etag-1",
          createdAt: "2026-08-22T00:00:00.000Z",
          updatedAt: "2026-08-22T00:00:00.000Z",
        };
      },
      get: async ({ ref, maxBytes }) => {
        calls.push({ kind: "get", ref, maxBytes });
        return stream(Uint8Array.from([7, 8, 9, 10]));
      },
    } satisfies Pick<ObjectStorageProvider, "stat" | "get">;

    const bytes = await readOwnedFileBytes("owner-1", file, {
      dependencies: {
        resolveNodeProvider: async (identity) => {
          expect(identity).toEqual({
            ownerId: "owner-1",
            nodeId: "node_test_1",
          });
          return provider;
        },
      },
    });

    expect([...new Uint8Array(bytes)]).toEqual([7, 8, 9, 10]);
    expect(calls).toEqual([
      {
        kind: "stat",
        ref: {
          ownerId: "owner-1",
          namespace: "files",
          key: "private/course-material/owner-1/node.pdf",
        },
      },
      {
        kind: "get",
        ref: {
          ownerId: "owner-1",
          namespace: "files",
          key: "private/course-material/owner-1/node.pdf",
        },
        maxBytes: 4,
      },
    ]);
  });

  test("rejects an owner mismatch before resolving any provider", async () => {
    let resolved = false;
    await expect(
      streamOwnedFile("other-owner", storedFile(), {
        dependencies: {
          resolveNodeProvider: async () => {
            resolved = true;
            throw new Error("must not run");
          },
        },
      }),
    ).rejects.toThrow("OWNED_FILE_OWNER_MISMATCH");
    expect(resolved).toBe(false);
  });

  test("rejects mismatched Node metadata before reading its body", async () => {
    let bodyRead = false;
    const file = storedFile({ provider: "node:node_test_2:relay-storage-v1" });
    await expect(
      readOwnedFileBytes("owner-1", file, {
        dependencies: {
          resolveNodeProvider: async () =>
            ({
              stat: async ({ ref }) => ({
                ref,
                byteSize: 5,
                mimeType: "application/pdf",
                digest: `sha256:${"b".repeat(64)}`,
                etag: "node-etag-2",
                createdAt: "2026-08-22T00:00:00.000Z",
                updatedAt: "2026-08-22T00:00:00.000Z",
              }),
              get: async () => {
                bodyRead = true;
                return stream(Uint8Array.from([1, 2, 3, 4]));
              },
            }) satisfies Pick<ObjectStorageProvider, "stat" | "get">,
        },
      }),
    ).rejects.toThrow("OWNED_FILE_METADATA_MISMATCH");
    expect(bodyRead).toBe(false);
  });

  test("rejects a truncated Node stream after verified metadata", async () => {
    const file = storedFile({ provider: "node:node_test_3:relay-storage-v1" });
    await expect(
      readOwnedFileBytes("owner-1", file, {
        dependencies: {
          resolveNodeProvider: async () => ({
            stat: async ({ ref }) => ({
              ref,
              byteSize: 4,
              mimeType: "application/pdf",
              digest: `sha256:${"c".repeat(64)}`,
              etag: "node-etag-3",
              createdAt: "2026-08-22T00:00:00.000Z",
              updatedAt: "2026-08-22T00:00:00.000Z",
            }),
            get: async () => stream(Uint8Array.from([1, 2, 3])),
          }),
        },
      }),
    ).rejects.toThrow("OWNED_FILE_SIZE_MISMATCH");
  });

  test("cancels an in-flight Node stream when the job signal aborts", async () => {
    const controller = new AbortController();
    let opened!: () => void;
    const bodyOpened = new Promise<void>((resolve) => {
      opened = resolve;
    });
    const file = storedFile({ provider: "node:node_test_4:relay-storage-v1" });
    const pending = readOwnedFileBytes("owner-1", file, {
      signal: controller.signal,
      dependencies: {
        resolveNodeProvider: async () => ({
          stat: async ({ ref }) => ({
            ref,
            byteSize: 4,
            mimeType: "application/pdf",
            digest: `sha256:${"d".repeat(64)}`,
            etag: "node-etag-4",
            createdAt: "2026-08-22T00:00:00.000Z",
            updatedAt: "2026-08-22T00:00:00.000Z",
          }),
          get: async () =>
            new ReadableStream<Uint8Array>({
              start() {
                opened();
              },
              pull: () => new Promise<void>(() => undefined),
            }),
        }),
      },
    });
    await bodyOpened;
    controller.abort(new DOMException("cancelled", "AbortError"));
    await expect(pending).rejects.toThrow("cancelled");
  });
});
