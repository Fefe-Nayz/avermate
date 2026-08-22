import { describe, expect, test } from "bun:test";
import type {
  ObjectStorageMetadata,
  ObjectStorageProvider,
} from "@avermate/agent-contracts";
import { LocalNodeProviderTransport } from "./provider-transport";

const ref = {
  ownerId: "owner-a",
  namespace: "artifact-worker-results",
  key: "result.json",
};

const metadata: ObjectStorageMetadata = {
  ref,
  byteSize: 1,
  mimeType: "application/json",
  digest: `sha256:${"1".repeat(64)}`,
  etag: "etag-a",
  createdAt: "2026-08-22T12:00:00.000Z",
  updatedAt: "2026-08-22T12:00:00.000Z",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function transport(storage: Partial<ObjectStorageProvider>) {
  return new LocalNodeProviderTransport("node-a", {
    storage: storage as ObjectStorageProvider,
  });
}

describe("local node object read cancellation", () => {
  test("aborts a pending stat operation", async () => {
    const started = deferred<void>();
    const controller = new AbortController();
    const pending = transport({
      id: "test",
      stat: () => {
        started.resolve();
        return new Promise(() => undefined);
      },
    }).statNodeObject({
      nodeId: "node-a",
      ownerId: "owner-a",
      ref,
      signal: controller.signal,
    });
    await started.promise;
    controller.abort(new Error("cancel stat"));

    await expect(pending).rejects.toThrow("cancel stat");
  });

  test("cancels a stream returned after get was aborted", async () => {
    const getStarted = deferred<void>();
    const lateGet = deferred<ReadableStream<Uint8Array>>();
    const cancelled = deferred<void>();
    let cancellations = 0;
    const controller = new AbortController();
    const abortedReader = transport({
      id: "test",
      stat: async () => metadata,
      get: () => {
        getStarted.resolve();
        return lateGet.promise;
      },
    })
      .readNodeObject({
        nodeId: "node-a",
        ownerId: "owner-a",
        ref,
        maxBytes: 1,
        signal: controller.signal,
      })
      [Symbol.asyncIterator]();
    const pending = abortedReader.next();
    await getStarted.promise;
    controller.abort(new Error("cancel get"));
    await expect(pending).rejects.toThrow("cancel get");

    lateGet.resolve({
      cancel: async () => {
        cancellations += 1;
        cancelled.resolve();
      },
    } as unknown as ReadableStream<Uint8Array>);
    await cancelled.promise;
    expect(cancellations).toBe(1);
  });

  test("cancels the reader when a pending read is aborted", async () => {
    const readStarted = deferred<void>();
    const controller = new AbortController();
    let cancellations = 0;
    const stream = {
      getReader: () => ({
        read: () => {
          readStarted.resolve();
          return new Promise<ReadableStreamReadResult<Uint8Array>>(
            () => undefined,
          );
        },
        cancel: async () => {
          cancellations += 1;
        },
      }),
    } as unknown as ReadableStream<Uint8Array>;
    const reader = transport({
      id: "test",
      stat: async () => metadata,
      get: async () => stream,
    })
      .readNodeObject({
        nodeId: "node-a",
        ownerId: "owner-a",
        ref,
        maxBytes: 1,
        signal: controller.signal,
      })
      [Symbol.asyncIterator]();
    const pending = reader.next();
    await readStarted.promise;
    controller.abort(new Error("cancel read"));

    await expect(pending).rejects.toThrow("cancel read");
    expect(cancellations).toBe(1);
  });
});
