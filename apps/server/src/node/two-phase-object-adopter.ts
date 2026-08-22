import {
  objectStorageMetadataSchema,
  ownedObjectRefSchema,
  type ObjectSha256,
  type ObjectStorageMetadata,
  type ObjectStorageProvider,
  type OwnedObjectRef,
} from "@avermate/agent-contracts";

export type ObjectAdoptionState =
  "reserved" | "object_committed" | "adopted" | "needs_operator";

export type ObjectAdoptionIntent = {
  adoptionId: string;
  providerId: string;
  ref: OwnedObjectRef;
  byteSize: number;
  mimeType: string;
  expectedDigest: ObjectSha256;
  idempotencyKey: string;
};

export type ObjectAdoptionRecord = ObjectAdoptionIntent & {
  state: ObjectAdoptionState;
  objectMetadata?: ObjectStorageMetadata;
  canonicalRecordId?: string;
  safeErrorCode?: string;
};

/**
 * The production implementation must make reserve/adopt durable. In particular,
 * adoptCanonical must atomically create (or verify) the canonical file row and
 * advance this record. The coordinator intentionally does not pretend an
 * in-memory map can provide that guarantee.
 */
export interface ObjectAdoptionRepository {
  reserve(intent: ObjectAdoptionIntent): Promise<ObjectAdoptionRecord>;
  load(adoptionId: string): Promise<ObjectAdoptionRecord | null>;
  markObjectCommitted(
    adoptionId: string,
    metadata: ObjectStorageMetadata,
  ): Promise<ObjectAdoptionRecord>;
  adoptCanonical(
    adoptionId: string,
    metadata: ObjectStorageMetadata,
  ): Promise<ObjectAdoptionRecord>;
  markNeedsOperator(
    adoptionId: string,
    safeErrorCode: string,
  ): Promise<ObjectAdoptionRecord>;
  pending(limit: number): AsyncIterable<ObjectAdoptionRecord>;
}

export type ObjectAdoptionResult = {
  record: ObjectAdoptionRecord;
  replayed: boolean;
};

function assertIntent(input: ObjectAdoptionIntent) {
  ownedObjectRefSchema.parse(input.ref);
  if (!input.adoptionId || input.adoptionId.length > 256) {
    throw new Error("ADOPTION_ID_INVALID");
  }
  if (!input.idempotencyKey || input.idempotencyKey.length > 256) {
    throw new Error("ADOPTION_IDEMPOTENCY_KEY_INVALID");
  }
  if (!Number.isSafeInteger(input.byteSize) || input.byteSize < 0) {
    throw new Error("ADOPTION_SIZE_INVALID");
  }
  if (!/^sha256:[a-f0-9]{64}$/u.test(input.expectedDigest)) {
    throw new Error("ADOPTION_DIGEST_INVALID");
  }
}

function assertRecordMatchesIntent(
  record: ObjectAdoptionRecord,
  intent: ObjectAdoptionIntent,
) {
  const comparable = (value: ObjectAdoptionIntent) =>
    JSON.stringify({
      adoptionId: value.adoptionId,
      providerId: value.providerId,
      ref: value.ref,
      byteSize: value.byteSize,
      mimeType: value.mimeType,
      expectedDigest: value.expectedDigest,
      idempotencyKey: value.idempotencyKey,
    });
  if (comparable(record) !== comparable(intent)) {
    throw new Error("ADOPTION_IDEMPOTENCY_PAYLOAD_MISMATCH");
  }
}

function assertMetadata(
  metadata: ObjectStorageMetadata,
  intent: ObjectAdoptionIntent,
) {
  const parsed = objectStorageMetadataSchema.parse({
    ref: metadata.ref,
    byteSize: metadata.byteSize,
    mimeType: metadata.mimeType,
    digest: metadata.digest,
    etag: metadata.etag,
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
  });
  if (
    parsed.digest !== intent.expectedDigest ||
    parsed.byteSize !== intent.byteSize ||
    parsed.mimeType !== intent.mimeType ||
    JSON.stringify(parsed.ref) !== JSON.stringify(intent.ref)
  ) {
    throw new Error("ADOPTION_OBJECT_METADATA_MISMATCH");
  }
  return parsed;
}

export class TwoPhaseObjectAdopter {
  readonly #provider: ObjectStorageProvider;
  readonly #repository: ObjectAdoptionRepository;
  readonly #afterObjectCommit?: () => Promise<void>;

  constructor(input: {
    provider: ObjectStorageProvider;
    repository: ObjectAdoptionRepository;
    /** Deterministic crash hook used by the failure-conformance suite. */
    afterObjectCommit?: () => Promise<void>;
  }) {
    this.#provider = input.provider;
    this.#repository = input.repository;
    this.#afterObjectCommit = input.afterObjectCommit;
  }

  async upload(
    input: ObjectAdoptionIntent & { body: ReadableStream<Uint8Array> },
  ): Promise<ObjectAdoptionResult> {
    const { body, ...intent } = input;
    assertIntent(intent);
    if (intent.providerId !== this.#provider.id) {
      throw new Error("ADOPTION_PROVIDER_MISMATCH");
    }
    const reserved = await this.#repository.reserve(intent);
    assertRecordMatchesIntent(reserved, intent);
    if (reserved.state === "needs_operator") {
      throw new Error(
        `ADOPTION_NEEDS_OPERATOR:${reserved.safeErrorCode ?? "UNKNOWN"}`,
      );
    }
    if (reserved.state === "adopted") {
      const metadata = await this.#provider.stat({ ref: intent.ref });
      if (!metadata) throw new Error("ADOPTED_OBJECT_BYTES_MISSING");
      assertMetadata(metadata, intent);
      await body.cancel("already adopted").catch(() => undefined);
      return { record: reserved, replayed: true };
    }

    const commit = await this.#provider.put({
      ref: intent.ref,
      body,
      byteSize: intent.byteSize,
      mimeType: intent.mimeType,
      expectedDigest: intent.expectedDigest,
      idempotencyKey: intent.idempotencyKey,
    });
    const metadata = assertMetadata(commit, intent);
    await this.#repository.markObjectCommitted(intent.adoptionId, metadata);
    await this.#afterObjectCommit?.();
    const observed = await this.#provider.stat({ ref: intent.ref });
    if (!observed) throw new Error("ADOPTION_OBJECT_DISAPPEARED");
    assertMetadata(observed, intent);
    const adopted = await this.#repository.adoptCanonical(
      intent.adoptionId,
      observed,
    );
    if (adopted.state !== "adopted" || !adopted.canonicalRecordId) {
      throw new Error("ADOPTION_REPOSITORY_DID_NOT_COMMIT");
    }
    return { record: adopted, replayed: commit.replayed };
  }

  async reconcile(limit = 250) {
    const results: Array<{
      adoptionId: string;
      outcome: "adopted" | "bytes_missing" | "needs_operator";
    }> = [];
    for await (const record of this.#repository.pending(limit)) {
      if (record.providerId !== this.#provider.id) continue;
      const metadata = await this.#provider.stat({ ref: record.ref });
      if (!metadata) {
        results.push({
          adoptionId: record.adoptionId,
          outcome: "bytes_missing",
        });
        continue;
      }
      try {
        const verified = assertMetadata(metadata, record);
        await this.#repository.markObjectCommitted(record.adoptionId, verified);
        const adopted = await this.#repository.adoptCanonical(
          record.adoptionId,
          verified,
        );
        if (adopted.state !== "adopted" || !adopted.canonicalRecordId) {
          throw new Error("ADOPTION_REPOSITORY_DID_NOT_COMMIT");
        }
        results.push({ adoptionId: record.adoptionId, outcome: "adopted" });
      } catch (error) {
        const safeErrorCode =
          error instanceof Error && /^[A-Z0-9_:]+$/u.test(error.message)
            ? error.message
            : "ADOPTION_RECONCILE_FAILED";
        await this.#repository.markNeedsOperator(
          record.adoptionId,
          safeErrorCode,
        );
        results.push({
          adoptionId: record.adoptionId,
          outcome: "needs_operator",
        });
      }
    }
    return results;
  }
}
