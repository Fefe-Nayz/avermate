import { describe, expect, test } from "bun:test";
import { StoredFileCapabilityArtifactIo, type CapabilityArtifactWrite } from "./artifact-io";

describe("capability artifact write identity", () => {
  test.each([
    ["course-media", "audio/webm"],
    ["grade-copy", "image/jpeg"],
    ["document-artifact", "audio/wav"],
  ] as const)("replays stable %s writes across broker instances with MIME and purpose preserved", async (purpose, mimeType) => {
    const writes: Parameters<typeof import("../node/services").storeCapabilityArtifact>[0][] = [];
    const persistence = {
      async write(input: Parameters<typeof import("../node/services").storeCapabilityArtifact>[0]) {
        writes.push(input);
        return { fileId: `file-${input.adoptionId}`, replayed: writes.length > 1 };
      },
    };
    const request: CapabilityArtifactWrite = { ownerId: "owner-1", operationId: "operation-1", nameHint: "source", bytes: new TextEncoder().encode("nonempty owned input"), mimeType, purpose, signal: new AbortController().signal };
    const first = await new StoredFileCapabilityArtifactIo(persistence).write(request);
    const replay = await new StoredFileCapabilityArtifactIo(persistence).write(request);
    expect(replay).toEqual(first);
    expect(first.object.namespace).toBe("files");
    expect(writes[0]?.purpose).toBe(purpose);
    expect(writes[0]?.artifact.mimeType).toBe(mimeType);
    expect(writes[1]?.idempotencyKey).toBe(writes[0]?.idempotencyKey);
    for (const changed of [{ ownerId: "owner-2" }, { nameHint: "other-source" }, { operationId: "operation-2" }, { bytes: new TextEncoder().encode("different bytes") }]) {
      const result = await new StoredFileCapabilityArtifactIo(persistence).write({ ...request, ...changed });
      expect(result.object.key).not.toBe(first.object.key);
    }
  });

  test("denies cross-purpose MIME before the durable storage call", async () => {
    const broker = new StoredFileCapabilityArtifactIo({ async write(): Promise<never> { throw new Error("must not persist"); } });
    await expect(broker.write({ ownerId: "owner", operationId: "operation", nameHint: "source", bytes: new Uint8Array([1]), mimeType: "audio/webm", purpose: "grade-copy", signal: new AbortController().signal })).rejects.toThrow("CAPABILITY_ARTIFACT_WRITE_POLICY_DENIED");
  });

  test("verified Node outputs use the same placement-preserving durable writer as inputs", async () => {
    const writes: Parameters<typeof import("../node/services").storeCapabilityArtifact>[0][] = [];
    const broker = new StoredFileCapabilityArtifactIo({ async write(input) { writes.push(input); return { fileId: "node-backed-canonical-file", replayed: writes.length > 1 }; } });
    const bytes = new TextEncoder().encode("verified output");
    const artifact = { object: { ownerId: "owner-1", namespace: "capability-outputs", key: "operation/result" }, digest: `sha256:${new Bun.CryptoHasher("sha256").update(bytes).digest("hex")}`, byteSize: bytes.length, mimeType: "text/plain" };
    const input = { ownerId: "owner-1", operationId: "operation-1", artifact, bytes, idempotencyKey: "stable-output", signal: new AbortController().signal };
    expect(await broker.adopt(input)).toMatchObject({ object: { namespace: "files", key: "node-backed-canonical-file" } });
    await broker.adopt(input);
    expect(writes[0]?.purpose).toBe("document-artifact");
    expect(writes[1]?.adoptionId).toBe(writes[0]?.adoptionId);
    await expect(broker.adopt({ ...input, ownerId: "other-owner" })).rejects.toThrow("CAPABILITY_ARTIFACT_ADOPTION_AUTHORITY_MISMATCH");
    expect(writes).toHaveLength(2);
  });
});
