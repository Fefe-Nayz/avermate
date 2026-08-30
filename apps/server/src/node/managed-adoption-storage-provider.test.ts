import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ManagedAdoptionStorageProvider } from "./managed-adoption-storage-provider";
import { capabilityNodeAdoptionStorage } from "./capability-adoption-storage";
import { FilesystemObjectStorageProvider } from "../../../node/src/filesystem-storage";

const bytes = new TextEncoder().encode("nonempty local immutable artifact");
const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
const body = () => new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } });

describe("capability artifact adoption placement", () => {
  test.each([
    ["course-media", "audio/webm", ".weba"],
    ["grade-copy", "image/jpeg", ".jpg"],
    ["document-artifact", "audio/wav", ".wav"],
  ] as const)("local %s commits preserve inferred MIME and replay without duplicate bytes", async (purpose, mimeType, extension) => {
    const provider = new ManagedAdoptionStorageProvider("local");
    const ref = { ownerId: "owner-local", namespace: purpose, key: `node-adoptions/v1/${crypto.randomUUID().replaceAll("-", "")}/artifact${extension}` };
    try {
      const input = { ref, body: body(), byteSize: bytes.length, mimeType, expectedDigest: digest, idempotencyKey: "stable-local-commit" };
      const [first, concurrent] = await Promise.all([provider.put(input), provider.put({ ...input, body: body() })]);
      expect(first.mimeType).toBe(mimeType);
      expect(concurrent.digest).toBe(first.digest);
      expect((await provider.stat({ ref }))?.digest).toBe(digest);
      expect((await provider.put({ ...input, body: body() })).replayed).toBe(true);
    } finally {
      await provider.delete({ ref, expectedDigest: digest, idempotencyKey: "test-cleanup" });
    }
  });

  test("Node-selected storage keeps canonical bytes on that Node under physical namespace=files", async () => {
    const root = await mkdtemp(join(tmpdir(), "capability-node-adoption-"));
    const node = new FilesystemObjectStorageProvider({ id: "node:node_fixture:relay-storage-v1", root, maxObjectBytes: 1_000_000, quotaBytes: 1_000_000 });
    await node.initialize();
    try {
      const provider = capabilityNodeAdoptionStorage(node);
      const ref = { ownerId: "owner-node", namespace: "course-media", key: "node-adoptions/v1/source.weba" };
      expect(provider.id).toBe(node.id);
      await provider.put({ ref, body: body(), byteSize: bytes.length, mimeType: "audio/webm", expectedDigest: digest, idempotencyKey: "node-stable-commit" });
      expect(await node.stat({ ref })).toBeNull();
      expect((await node.stat({ ref: { ...ref, namespace: "files" } }))?.mimeType).toBe("audio/webm");
      expect((await provider.stat({ ref }))?.ref).toEqual(ref);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
