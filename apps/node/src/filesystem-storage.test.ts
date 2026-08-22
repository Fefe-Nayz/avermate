import { afterEach, describe, expect, test } from "bun:test";
import { runObjectStorageConformance } from "@avermate/agent-contracts/storage-conformance";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { canonicalJson } from "./canonical-json";
import {
  bytesStream,
  digestBytes,
  FilesystemObjectStorageProvider,
} from "./filesystem-storage";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function provider(
  input: { quotaBytes?: number; maxObjectBytes?: number } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "avermate-node-storage-"));
  roots.push(root);
  const instance = new FilesystemObjectStorageProvider({
    root,
    maxObjectBytes: input.maxObjectBytes ?? 1024 * 1024,
    quotaBytes: input.quotaBytes ?? 10 * 1024 * 1024,
    transferSecret: new Uint8Array(32).fill(7),
  });
  await instance.initialize();
  return instance;
}

describe("node filesystem object storage", () => {
  test("passes the reusable provider conformance suite", async () => {
    const report = await runObjectStorageConformance(await provider());
    expect(report.providerId).toBe("node-filesystem");
    expect(report.passed).toContain("multipart-resume-complete");
    expect(report.passed).toContain("owner-isolation");
  });

  test("enforces object and aggregate quota limits before publication", async () => {
    const storage = await provider({ quotaBytes: 8, maxObjectBytes: 6 });
    const first = new TextEncoder().encode("123456");
    await storage.put({
      ref: { ownerId: "u", namespace: "n", key: "one" },
      body: bytesStream(first),
      byteSize: first.byteLength,
      mimeType: "text/plain",
      expectedDigest: digestBytes(first),
      idempotencyKey: "one",
    });
    const second = new TextEncoder().encode("123");
    await expect(
      storage.put({
        ref: { ownerId: "u", namespace: "n", key: "two" },
        body: bytesStream(second),
        byteSize: second.byteLength,
        mimeType: "text/plain",
        expectedDigest: digestBytes(second),
        idempotencyKey: "two",
      }),
    ).rejects.toThrow("STORAGE_QUOTA_EXCEEDED");
    expect(
      await storage.stat({ ref: { ownerId: "u", namespace: "n", key: "two" } }),
    ).toBeNull();
  });

  test("adopts an exact orphan left between byte commit and ledger commit", async () => {
    const root = await mkdtemp(join(tmpdir(), "avermate-node-storage-orphan-"));
    roots.push(root);
    const storage = new FilesystemObjectStorageProvider({
      root,
      maxObjectBytes: 1024,
      quotaBytes: 4096,
    });
    await storage.initialize();
    const ref = {
      ownerId: "owner",
      namespace: "materials",
      key: "recover.pdf",
    };
    const bytes = new TextEncoder().encode("committed before crash");
    const refId = createHash("sha256").update(canonicalJson(ref)).digest("hex");
    await mkdir(join(root, "objects"), { recursive: true });
    await writeFile(join(root, "objects", `${refId}.blob`), bytes);

    const commit = await storage.put({
      ref,
      body: bytesStream(bytes),
      byteSize: bytes.byteLength,
      mimeType: "application/pdf",
      expectedDigest: digestBytes(bytes),
      idempotencyKey: "retry-after-crash",
    });

    expect(commit.replayed).toBe(true);
    expect((await storage.stat({ ref }))?.digest).toBe(digestBytes(bytes));
  });

  test("never overwrites a conflicting orphan", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "avermate-node-storage-conflict-"),
    );
    roots.push(root);
    const storage = new FilesystemObjectStorageProvider({
      root,
      maxObjectBytes: 1024,
      quotaBytes: 4096,
    });
    await storage.initialize();
    const ref = {
      ownerId: "owner",
      namespace: "materials",
      key: "recover.pdf",
    };
    const orphan = new TextEncoder().encode("different");
    const requested = new TextEncoder().encode("requested");
    const refId = createHash("sha256").update(canonicalJson(ref)).digest("hex");
    await writeFile(join(root, "objects", `${refId}.blob`), orphan);

    await expect(
      storage.put({
        ref,
        body: bytesStream(requested),
        byteSize: requested.byteLength,
        mimeType: "application/pdf",
        expectedDigest: digestBytes(requested),
        idempotencyKey: "conflict",
      }),
    ).rejects.toThrow("ORPHAN_OBJECT_CONFLICT");
  });
});
