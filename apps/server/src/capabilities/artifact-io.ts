import { createHash } from "node:crypto";
import type { CapabilityArtifactRef } from "@avermate/agent-contracts";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { files } from "../db/schema";
import { readOwnedFileBytes } from "../lib/owned-file-storage";
import { CAPABILITY_ARTIFACT_FILE_CONSTRAINTS } from "../lib/capability-artifact-policy";
import type { FilePurpose } from "../db/schema/files";

export type CapabilityArtifactWrite = {
  ownerId: string;
  operationId: string;
  bytes: Uint8Array;
  mimeType: string;
  nameHint: string;
  signal: AbortSignal;
  purpose?: Extract<
    FilePurpose,
    "document-artifact" | "course-media" | "grade-copy"
  >;
};

export type CapabilityArtifactAdoption = {
  ownerId: string;
  operationId: string;
  artifact: CapabilityArtifactRef;
  bytes: Uint8Array;
  idempotencyKey: string;
  signal: AbortSignal;
};

/** Owner-bound byte broker used by capability adapters; providers never see storage URLs. */
export interface CapabilityArtifactIo {
  read(
    ownerId: string,
    artifact: CapabilityArtifactRef,
    options: { maximumBytes: number; signal: AbortSignal },
  ): Promise<Uint8Array>;
  write(input: CapabilityArtifactWrite): Promise<CapabilityArtifactRef>;
  adopt?(input: CapabilityArtifactAdoption): Promise<CapabilityArtifactRef>;
}

function digest(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/**
 * Durable Core bridge backed by the existing owner-scoped file store. Artifact
 * keys are opaque file ids, never provider storage keys or signed URLs.
 */
export class StoredFileCapabilityArtifactIo implements CapabilityArtifactIo {
  constructor(private readonly persistence?: {
    write: typeof import("../node/services").storeCapabilityArtifact;
  }) {}

  /** Durable two-phase adoption keeps retries on the same canonical file id. */
  async adopt(input: CapabilityArtifactAdoption): Promise<CapabilityArtifactRef> {
    input.signal.throwIfAborted();
    if (input.artifact.object.ownerId !== input.ownerId || input.bytes.byteLength !== input.artifact.byteSize || digest(input.bytes) !== input.artifact.digest) {
      throw new Error("CAPABILITY_ARTIFACT_ADOPTION_AUTHORITY_MISMATCH");
    }
    const storeCapabilityArtifact = this.persistence?.write ?? (await import("../node/services")).storeCapabilityArtifact;
    const key = createHash("sha256").update(JSON.stringify(["capability-adopt-v1", input.ownerId, input.operationId, input.idempotencyKey, input.artifact.digest, input.artifact.mimeType])).digest("hex").slice(0, 48);
    const adopted = await storeCapabilityArtifact({
      ownerId: input.ownerId,
      adoptionId: `capadopt_${key}`,
      idempotencyKey: `capability-adopt-${key}`,
      artifact: input.artifact,
      purpose: "document-artifact",
      bytes: input.bytes,
    });
    input.signal.throwIfAborted();
    return { ...input.artifact, object: { ownerId: input.ownerId, namespace: "files", key: adopted.fileId } };
  }

  async read(
    ownerId: string,
    artifact: CapabilityArtifactRef,
    options: { maximumBytes: number; signal: AbortSignal },
  ) {
    if (
      artifact.object.ownerId !== ownerId ||
      artifact.object.namespace !== "files"
    ) {
      throw new Error("CAPABILITY_ARTIFACT_OWNER_OR_NAMESPACE_MISMATCH");
    }
    const [file] = await db
      .select({
        id: files.id,
        userId: files.userId,
        provider: files.provider,
        storageKey: files.storageKey,
        mimeType: files.mimeType,
        byteSize: files.byteSize,
        status: files.status,
      })
      .from(files)
      .where(
        and(
          eq(files.id, artifact.object.key),
          eq(files.userId, ownerId),
          eq(files.status, "stored"),
        ),
      )
      .limit(1);
    if (!file) throw new Error("CAPABILITY_ARTIFACT_NOT_FOUND");
    if (
      file.byteSize !== artifact.byteSize ||
      file.mimeType.toLowerCase() !== artifact.mimeType.toLowerCase()
    ) {
      throw new Error("CAPABILITY_ARTIFACT_METADATA_MISMATCH");
    }
    const bytes = new Uint8Array(
      await readOwnedFileBytes(ownerId, file, {
        maxBytes: Math.min(options.maximumBytes, artifact.byteSize),
        signal: options.signal,
      }),
    );
    if (digest(bytes) !== artifact.digest) {
      throw new Error("CAPABILITY_ARTIFACT_DIGEST_MISMATCH");
    }
    return bytes;
  }

  async write(input: CapabilityArtifactWrite) {
    input.signal.throwIfAborted();
    const purpose = input.purpose ?? "document-artifact";
    const policy = CAPABILITY_ARTIFACT_FILE_CONSTRAINTS[purpose];
    if (input.bytes.length < 1 || input.bytes.length > policy.maxBytes || !policy.mimeTypes.includes(input.mimeType)) {
      throw new Error("CAPABILITY_ARTIFACT_WRITE_POLICY_DENIED");
    }
    const contentDigest = digest(input.bytes);
    const key = createHash("sha256").update(JSON.stringify(["capability-write-v1", input.ownerId, input.operationId, input.nameHint, purpose, input.mimeType, contentDigest])).digest("hex");
    const artifact: CapabilityArtifactRef = {
      object: { ownerId: input.ownerId, namespace: purpose, key },
      digest: contentDigest, byteSize: input.bytes.length, mimeType: input.mimeType,
    };
    const storeCapabilityArtifact = this.persistence?.write ?? (await import("../node/services")).storeCapabilityArtifact;
    const stored = await storeCapabilityArtifact({
      ownerId: input.ownerId,
      adoptionId: `capwrite_${key.slice(0, 48)}`,
      idempotencyKey: `capability-write-${key.slice(0, 48)}`,
      artifact,
      purpose,
      bytes: input.bytes,
    });
    input.signal.throwIfAborted();
    return {
      object: {
        ownerId: input.ownerId,
        namespace: "files",
        key: stored.fileId,
      },
      digest: contentDigest,
      byteSize: input.bytes.byteLength,
      mimeType: input.mimeType,
    } satisfies CapabilityArtifactRef;
  }
}

export const coreCapabilityArtifactIo = new StoredFileCapabilityArtifactIo();
