import { describe, expect, test } from "bun:test";
import type {
  ObjectAdoptionIntent,
  ObjectAdoptionRecord,
  ObjectAdoptionRepository,
} from "./two-phase-object-adopter";
import { TwoPhaseObjectAdopter } from "./two-phase-object-adopter";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  bytesStream,
  digestBytes,
  FilesystemObjectStorageProvider,
} from "../../../node/src/filesystem-storage";
import type { ObjectStorageMetadata } from "@avermate/agent-contracts";

class MemoryAdoptionRepository implements ObjectAdoptionRepository {
  readonly records = new Map<string, ObjectAdoptionRecord>();
  canonicalWrites = 0;

  async reserve(intent: ObjectAdoptionIntent) {
    const previous = this.records.get(intent.adoptionId);
    if (previous) return previous;
    const record: ObjectAdoptionRecord = { ...intent, state: "reserved" };
    this.records.set(intent.adoptionId, record);
    return record;
  }

  async load(adoptionId: string) {
    return this.records.get(adoptionId) ?? null;
  }

  async markObjectCommitted(
    adoptionId: string,
    objectMetadata: ObjectStorageMetadata,
  ) {
    const previous = this.records.get(adoptionId);
    if (!previous) throw new Error("ADOPTION_NOT_RESERVED");
    const next = {
      ...previous,
      state: "object_committed" as const,
      objectMetadata,
    };
    this.records.set(adoptionId, next);
    return next;
  }

  async adoptCanonical(
    adoptionId: string,
    objectMetadata: ObjectStorageMetadata,
  ) {
    const previous = this.records.get(adoptionId);
    if (!previous) throw new Error("ADOPTION_NOT_RESERVED");
    if (previous.state === "adopted") return previous;
    this.canonicalWrites += 1;
    const next = {
      ...previous,
      state: "adopted" as const,
      objectMetadata,
      canonicalRecordId: `file_${adoptionId}`,
    };
    this.records.set(adoptionId, next);
    return next;
  }

  async markNeedsOperator(adoptionId: string, safeErrorCode: string) {
    const previous = this.records.get(adoptionId);
    if (!previous) throw new Error("ADOPTION_NOT_RESERVED");
    const next = {
      ...previous,
      state: "needs_operator" as const,
      safeErrorCode,
    };
    this.records.set(adoptionId, next);
    return next;
  }

  async *pending(limit: number) {
    let yielded = 0;
    for (const record of this.records.values()) {
      if (record.state !== "adopted" && record.state !== "needs_operator") {
        yield record;
        yielded += 1;
        if (yielded >= limit) return;
      }
    }
  }
}

describe("two-phase object adoption", () => {
  test("reconciles a crash after object commit without duplicating the canonical row", async () => {
    const root = await mkdtemp(join(tmpdir(), "avermate-adoption-"));
    try {
      const provider = new FilesystemObjectStorageProvider({
        id: "node-test",
        root,
        maxObjectBytes: 1024,
        quotaBytes: 4096,
      });
      await provider.initialize();
      const repository = new MemoryAdoptionRepository();
      const bytes = new TextEncoder().encode("two phase");
      const intent = {
        adoptionId: "adopt-1",
        providerId: provider.id,
        ref: { ownerId: "user-1", namespace: "files", key: "two-phase.txt" },
        byteSize: bytes.byteLength,
        mimeType: "text/plain",
        expectedDigest: digestBytes(bytes),
        idempotencyKey: "upload-1",
      };
      const crashing = new TwoPhaseObjectAdopter({
        provider,
        repository,
        afterObjectCommit: () => Promise.reject(new Error("SIMULATED_CRASH")),
      });
      await expect(
        crashing.upload({ ...intent, body: bytesStream(bytes) }),
      ).rejects.toThrow("SIMULATED_CRASH");
      expect((await repository.load(intent.adoptionId))?.state).toBe(
        "object_committed",
      );
      expect(repository.canonicalWrites).toBe(0);

      const recovered = new TwoPhaseObjectAdopter({ provider, repository });
      expect(await recovered.reconcile()).toEqual([
        { adoptionId: "adopt-1", outcome: "adopted" },
      ]);
      expect(repository.canonicalWrites).toBe(1);

      const replay = await recovered.upload({
        ...intent,
        body: bytesStream(bytes),
      });
      expect(replay.replayed).toBe(true);
      expect(repository.canonicalWrites).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("requires operator action when committed bytes disagree with the reservation", async () => {
    const root = await mkdtemp(join(tmpdir(), "avermate-adoption-mismatch-"));
    try {
      const provider = new FilesystemObjectStorageProvider({
        id: "node-test",
        root,
        maxObjectBytes: 1024,
        quotaBytes: 4096,
      });
      await provider.initialize();
      const repository = new MemoryAdoptionRepository();
      const expected = new TextEncoder().encode("expected");
      const actual = new TextEncoder().encode("actual--");
      const intent = {
        adoptionId: "adopt-2",
        providerId: provider.id,
        ref: { ownerId: "user-1", namespace: "files", key: "mismatch.txt" },
        byteSize: expected.byteLength,
        mimeType: "text/plain",
        expectedDigest: digestBytes(expected),
        idempotencyKey: "upload-2",
      };
      await repository.reserve(intent);
      await provider.put({
        ref: intent.ref,
        body: bytesStream(actual),
        byteSize: actual.byteLength,
        mimeType: intent.mimeType,
        expectedDigest: digestBytes(actual),
        idempotencyKey: "corrupt-fixture",
      });
      const adopter = new TwoPhaseObjectAdopter({ provider, repository });
      expect(await adopter.reconcile()).toEqual([
        { adoptionId: "adopt-2", outcome: "needs_operator" },
      ]);
      expect((await repository.load(intent.adoptionId))?.state).toBe(
        "needs_operator",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
