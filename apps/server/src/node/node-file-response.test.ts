import { describe, expect, test } from "bun:test";
import type { ObjectStorageProvider } from "@avermate/agent-contracts";
import { createHash } from "node:crypto";
import { nodeFileResponse } from "./node-file-response";

function stream(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function provider(bytes: Uint8Array): ObjectStorageProvider {
  const metadata = {
    ref: { ownerId: "user-1", namespace: "files", key: "course/a.pdf" },
    byteSize: bytes.byteLength,
    mimeType: "application/pdf",
    digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const,
    etag: "etag-1",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
  return {
    id: "node:node_test:relay-storage-v1",
    capabilities: async () => ({
      providerId: "node:node_test:relay-storage-v1",
      maxObjectBytes: 1024,
      maxPartBytes: 1024,
      minPartBytes: 1,
      multipart: true,
      range: true,
      copy: false,
      reconcile: true,
      directTransfer: false,
      checksumAlgorithms: ["sha256"],
    }),
    stat: async () => metadata,
    get: async () => stream(bytes),
    getRange: async ({ start, endInclusive }) => ({
      metadata,
      start,
      endInclusive,
      totalBytes: bytes.byteLength,
      body: stream(bytes.slice(start, endInclusive + 1)),
    }),
    put: async () => ({ ...metadata, replayed: false }),
    delete: async ({ ref }) => ({ ref, deleted: true, alreadyAbsent: false }),
    beginMultipart: async () => {
      throw new Error("unused");
    },
    uploadPart: async () => {
      throw new Error("unused");
    },
    completeMultipart: async () => {
      throw new Error("unused");
    },
    abortMultipart: async () => undefined,
    async *reconcile() {},
    authorizeTransfer: async () => {
      throw new Error("unused");
    },
  };
}

const file = {
  provider: "node:node_test:relay-storage-v1",
  storageKey: "course/a.pdf",
  userId: "user-1",
  byteSize: 6,
  mimeType: "application/pdf",
};

describe("Node file HTTP boundary", () => {
  test("serves full, suffix range and HEAD without a Core fallback", async () => {
    const storage = provider(new TextEncoder().encode("abcdef"));
    const resolveProvider = async () => storage;
    const full = await nodeFileResponse(
      new Request("https://example.test/files/a"),
      file,
      { disposition: "inline", resolveProvider },
    );
    expect(await full?.text()).toBe("abcdef");
    expect(full?.headers.get("accept-ranges")).toBe("bytes");

    const ranged = await nodeFileResponse(
      new Request("https://example.test/files/a", {
        headers: { range: "bytes=-2" },
      }),
      file,
      { disposition: "attachment", resolveProvider },
    );
    expect(ranged?.status).toBe(206);
    expect(ranged?.headers.get("content-range")).toBe("bytes 4-5/6");
    expect(await ranged?.text()).toBe("ef");

    const head = await nodeFileResponse(
      new Request("https://example.test/files/a", { method: "HEAD" }),
      file,
      { disposition: "inline", resolveProvider },
    );
    expect(head?.headers.get("content-length")).toBe("6");
  });

  test("reports an actionable typed offline state", async () => {
    const response = await nodeFileResponse(
      new Request("https://example.test/files/a"),
      file,
      {
        disposition: "inline",
        resolveProvider: async () => {
          throw new Error("NODE_CAPABILITY_OFFLINE");
        },
      },
    );
    expect(response?.status).toBe(503);
    expect(await response?.json()).toMatchObject({
      error: {
        code: "NODE_STORAGE_CAPABILITY_OFFLINE",
        settingsPath: "/settings/node",
      },
    });
  });
});
