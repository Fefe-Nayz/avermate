import { afterEach, describe, expect, test } from "bun:test";
import { runObjectStorageConformance } from "@avermate/agent-contracts/storage-conformance";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  coreStorageBackendKey,
  CoreObjectStorageProvider,
  type CoreStorageByteBackend,
} from "./core-object-storage-provider";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

class MemoryBackend implements CoreStorageByteBackend {
  readonly objects = new Map<string, { bytes: Uint8Array; mimeType: string }>();
  async put(input: { key: string; bytes: Uint8Array; mimeType: string }) {
    if (this.objects.has(input.key)) throw new Error("BACKEND_OBJECT_EXISTS");
    this.objects.set(input.key, {
      bytes: input.bytes.slice(),
      mimeType: input.mimeType,
    });
  }
  async get(key: string) {
    const item = this.objects.get(key);
    if (!item) throw new Error("OBJECT_NOT_FOUND");
    return item.bytes.slice();
  }
  async stat(key: string) {
    const item = this.objects.get(key);
    return item
      ? { byteSize: item.bytes.byteLength, mimeType: item.mimeType }
      : null;
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}

describe("Core object storage adapter", () => {
  test("passes the shared semantics supported by the compatibility backend", async () => {
    const root = await mkdtemp(join(tmpdir(), "avermate-core-storage-"));
    roots.push(root);
    const provider = new CoreObjectStorageProvider({
      id: "core-memory",
      backend: new MemoryBackend(),
      journalPath: join(root, "journal.json"),
      maxObjectBytes: 1024 * 1024,
      transferSecret: new Uint8Array(32).fill(3),
    });
    const report = await runObjectStorageConformance(provider);
    expect(report.providerId).toBe("core-memory");
    expect(report.passed).toContain("range");
    expect(report.passed).not.toContain("multipart-resume-complete");
  });

  test("detects ledger/backend divergence instead of returning corrupt bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "avermate-core-storage-"));
    roots.push(root);
    const backend = new MemoryBackend();
    const provider = new CoreObjectStorageProvider({
      id: "core-memory",
      backend,
      journalPath: join(root, "journal.json"),
      maxObjectBytes: 1024,
    });
    const bytes = new TextEncoder().encode("abc");
    const digest =
      `sha256:${new Bun.CryptoHasher("sha256").update(bytes).digest("hex")}` as const;
    const ref = { ownerId: "user-1", namespace: "files", key: "object" };
    await provider.put({
      ref,
      body: new Blob([bytes]).stream(),
      byteSize: bytes.byteLength,
      mimeType: "text/plain",
      expectedDigest: digest,
      idempotencyKey: "put",
    });
    backend.objects.set(coreStorageBackendKey(ref), {
      bytes: new TextEncoder().encode("xyz"),
      mimeType: "text/plain",
    });
    await expect(provider.get({ ref })).rejects.toThrow(
      "OBJECT_DIGEST_MISMATCH",
    );
  });
});
