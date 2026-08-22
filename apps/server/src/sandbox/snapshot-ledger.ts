import { randomUUID } from "node:crypto";
import {
  sandboxImageTemplateRefSchema,
  sandboxProfileIdSchema,
  sandboxProviderRuntimeCheckpointRefSchema,
  sandboxWorkspaceSnapshotRefSchema,
  type SandboxImageTemplateRef,
  type SandboxProfileId,
  type SandboxProviderRuntimeCheckpointRef,
  type SandboxWorkspaceSnapshotRef,
} from "@avermate/agent-contracts";

export type SnapshotLedgerStatus = "pending" | "committed" | "failed";
export type SnapshotOutboxStatus =
  "pending" | "leased" | "completed" | "failed";
export type SnapshotOutboxKind = "capture" | "adopt" | "publish" | "gc";

export interface SnapshotCheckpointAuthority {
  verify(input: {
    ownerId: string;
    threadId: string;
    branchId: string;
    conversationCheckpointRef: string;
  }): Promise<boolean>;
}

export interface SnapshotLedgerRecord {
  readonly id: string;
  readonly ownerId: string;
  readonly threadId: string;
  readonly branchId: string;
  readonly sequence: number;
  readonly requestId: string;
  readonly conversationCheckpointRef: string;
  readonly parentWorkspaceSnapshotRef: SandboxWorkspaceSnapshotRef | null;
  readonly imageTemplateRef: SandboxImageTemplateRef;
  readonly executionProfileId: SandboxProfileId;
  readonly executionProfileVersion: string;
  readonly status: SnapshotLedgerStatus;
  readonly workspaceSnapshotRef: SandboxWorkspaceSnapshotRef | null;
  readonly sandboxRuntimeCheckpointRef: SandboxProviderRuntimeCheckpointRef | null;
  readonly trustedObjectRef: string | null;
  readonly portableManifestDigest: string | null;
  readonly byteSize: number | null;
  readonly fileCount: number | null;
  readonly failure: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly committedAt: string | null;
  readonly failedAt: string | null;
}

type MutableSnapshotRecord = {
  -readonly [Key in keyof SnapshotLedgerRecord]: SnapshotLedgerRecord[Key];
} & {
  capturedProviderRef: SandboxWorkspaceSnapshotRef | null;
  capturedTrustedObjectRef: string | null;
  capturedManifestDigest: string | null;
  capturedByteSize: number | null;
  capturedFileCount: number | null;
};

type OutboxRow = {
  id: string;
  recordId: string;
  kind: SnapshotOutboxKind;
  status: SnapshotOutboxStatus;
  attempts: number;
  leasedBy: string | null;
  leasedUntil: number | null;
  updatedAt: number;
};

export interface SnapshotOutboxLease {
  readonly outboxId: string;
  readonly kind: SnapshotOutboxKind;
  readonly record: SnapshotLedgerRecord;
  readonly providerCaptureRef: SandboxWorkspaceSnapshotRef | null;
  readonly attempts: number;
  readonly leasedUntil: string;
}

export interface SnapshotReconciliationAction {
  readonly recordId: string;
  readonly action:
    | "retry-capture"
    | "resume-adoption"
    | "resume-commit"
    | "retry-publish"
    | "orphan-requires-cleanup";
  readonly workspaceSnapshotRef?: SandboxWorkspaceSnapshotRef;
}

export interface SnapshotLedger {
  requestCapture(input: {
    ownerId: string;
    threadId: string;
    branchId: string;
    sequence: number;
    requestId: string;
    conversationCheckpointRef: string;
    parentWorkspaceSnapshotRef?: SandboxWorkspaceSnapshotRef;
    imageTemplateRef: SandboxImageTemplateRef;
    executionProfileId: SandboxProfileId;
    executionProfileVersion: string;
    now?: Date;
  }): Promise<SnapshotLedgerRecord>;
  leaseOutbox(input: {
    workerId: string;
    limit: number;
    leaseMs: number;
    now?: Date;
  }): Promise<readonly SnapshotOutboxLease[]>;
  recordProviderCapture(input: {
    recordId: string;
    workspaceSnapshotRef: SandboxWorkspaceSnapshotRef;
    now?: Date;
  }): Promise<SnapshotLedgerRecord>;
  recordAdoptionCandidate(input: {
    recordId: string;
    workspaceSnapshotRef: SandboxWorkspaceSnapshotRef;
    trustedObjectRef: string;
    portableManifestDigest: string;
    byteSize: number;
    fileCount: number;
    now?: Date;
  }): Promise<SnapshotLedgerRecord>;
  attachRuntimeCheckpoint(input: {
    recordId: string;
    runtimeCheckpointRef: SandboxProviderRuntimeCheckpointRef;
    imageDigest: string;
    executionProfileVersion: string;
    now?: Date;
  }): Promise<SnapshotLedgerRecord>;
  commitAdoption(input: {
    recordId: string;
    workspaceSnapshotRef: SandboxWorkspaceSnapshotRef;
    trustedObjectRef: string;
    now?: Date;
  }): Promise<SnapshotLedgerRecord>;
  failCapture(input: {
    recordId: string;
    failure: string;
    now?: Date;
  }): Promise<SnapshotLedgerRecord>;
  completeOutbox(input: {
    outboxId: string;
    workerId: string;
    now?: Date;
  }): Promise<void>;
  getRestorable(input: {
    ownerId: string;
    threadId: string;
    branchId: string;
    conversationCheckpointRef: string;
  }): Promise<SnapshotLedgerRecord | null>;
  getLatestCompatible(input: {
    ownerId: string;
    threadId: string;
    branchId: string;
    executionProfileId: SandboxProfileId;
    executionProfileVersion: string;
    imageDigest: string;
    maxSequence?: number;
  }): Promise<SnapshotLedgerRecord | null>;
  reconcile(input: {
    pendingOlderThanMs: number;
    leaseExpiredBefore?: Date;
    providerInventory?: readonly SandboxWorkspaceSnapshotRef[];
    now?: Date;
  }): Promise<readonly SnapshotReconciliationAction[]>;
}

/**
 * Reference implementation for contract tests and single-process development.
 * Production wiring deliberately remains blocked on the Plan 029/031 durable
 * migration; this class must not be presented as restart-safe persistence.
 */
export class InMemorySnapshotLedger implements SnapshotLedger {
  readonly #records = new Map<string, MutableSnapshotRecord>();
  readonly #outbox = new Map<string, OutboxRow>();
  #tail: Promise<void> = Promise.resolve();

  constructor(private readonly authority: SnapshotCheckpointAuthority) {}

  requestCapture(input: {
    ownerId: string;
    threadId: string;
    branchId: string;
    sequence: number;
    requestId: string;
    conversationCheckpointRef: string;
    parentWorkspaceSnapshotRef?: SandboxWorkspaceSnapshotRef;
    imageTemplateRef: SandboxImageTemplateRef;
    executionProfileId: SandboxProfileId;
    executionProfileVersion: string;
    now?: Date;
  }): Promise<SnapshotLedgerRecord> {
    return this.lock(async () => {
      validateCaptureIdentity(input);
      await this.assertAuthority(input);
      const imageTemplateRef = sandboxImageTemplateRefSchema.parse(
        input.imageTemplateRef,
      );
      const executionProfileId = sandboxProfileIdSchema.parse(
        input.executionProfileId,
      );
      const executionProfileVersion = input.executionProfileVersion.trim();
      if (
        !executionProfileVersion ||
        executionProfileVersion.length > 128 ||
        imageTemplateRef.profileVersion !== executionProfileVersion
      ) {
        throw new Error(
          "Snapshot image and execution profile versions must match.",
        );
      }
      const parentWorkspaceSnapshotRef = input.parentWorkspaceSnapshotRef
        ? sandboxWorkspaceSnapshotRefSchema.parse(
            input.parentWorkspaceSnapshotRef,
          )
        : null;
      if (parentWorkspaceSnapshotRef) {
        const parent = [...this.#records.values()].find(
          (record) =>
            record.status === "committed" &&
            record.ownerId === input.ownerId &&
            record.threadId === input.threadId &&
            sameSnapshot(
              record.workspaceSnapshotRef,
              parentWorkspaceSnapshotRef,
            ),
        );
        if (!parent) {
          throw new Error(
            "Parent workspace snapshot is not a committed snapshot owned by this thread.",
          );
        }
      }
      const requestMatch = [...this.#records.values()].find(
        (record) =>
          record.ownerId === input.ownerId &&
          record.requestId === input.requestId,
      );
      if (requestMatch) {
        if (
          requestMatch.threadId !== input.threadId ||
          requestMatch.branchId !== input.branchId ||
          requestMatch.sequence !== input.sequence ||
          requestMatch.conversationCheckpointRef !==
            input.conversationCheckpointRef ||
          !sameOptionalSnapshot(
            requestMatch.parentWorkspaceSnapshotRef,
            parentWorkspaceSnapshotRef,
          ) ||
          requestMatch.imageTemplateRef.imageDigest !==
            imageTemplateRef.imageDigest ||
          requestMatch.imageTemplateRef.profileVersion !==
            imageTemplateRef.profileVersion ||
          requestMatch.executionProfileId !== executionProfileId ||
          requestMatch.executionProfileVersion !== executionProfileVersion
        ) {
          throw new Error(
            "Snapshot idempotency key was reused for a different boundary.",
          );
        }
        return publicRecord(requestMatch);
      }
      const sequenceMatch = [...this.#records.values()].find(
        (record) =>
          record.ownerId === input.ownerId &&
          record.branchId === input.branchId &&
          record.sequence === input.sequence,
      );
      if (sequenceMatch) {
        throw new Error(
          "A different capture already owns this branch sequence.",
        );
      }
      const now = input.now ?? new Date();
      const record: MutableSnapshotRecord = {
        id: randomUUID(),
        ownerId: input.ownerId,
        threadId: input.threadId,
        branchId: input.branchId,
        sequence: input.sequence,
        requestId: input.requestId,
        conversationCheckpointRef: input.conversationCheckpointRef,
        parentWorkspaceSnapshotRef: parentWorkspaceSnapshotRef
          ? structuredClone(parentWorkspaceSnapshotRef)
          : null,
        imageTemplateRef: structuredClone(imageTemplateRef),
        executionProfileId,
        executionProfileVersion,
        status: "pending",
        workspaceSnapshotRef: null,
        sandboxRuntimeCheckpointRef: null,
        trustedObjectRef: null,
        portableManifestDigest: null,
        byteSize: null,
        fileCount: null,
        capturedProviderRef: null,
        capturedTrustedObjectRef: null,
        capturedManifestDigest: null,
        capturedByteSize: null,
        capturedFileCount: null,
        failure: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        committedAt: null,
        failedAt: null,
      };
      this.#records.set(record.id, record);
      const outbox = newOutboxRow(record.id, "capture", now);
      this.#outbox.set(outbox.id, outbox);
      return publicRecord(record);
    });
  }

  leaseOutbox(input: {
    workerId: string;
    limit: number;
    leaseMs: number;
    now?: Date;
  }): Promise<readonly SnapshotOutboxLease[]> {
    return this.lock(async () => {
      if (
        !input.workerId ||
        !Number.isInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > 100
      ) {
        throw new Error("A worker and limit between 1 and 100 are required.");
      }
      if (
        !Number.isInteger(input.leaseMs) ||
        input.leaseMs < 1_000 ||
        input.leaseMs > 10 * 60_000
      ) {
        throw new Error(
          "Snapshot outbox lease must be between 1 second and 10 minutes.",
        );
      }
      const now = input.now ?? new Date();
      const selected = [...this.#outbox.values()]
        .filter(
          (row) =>
            row.status === "pending" ||
            (row.status === "leased" &&
              (row.leasedUntil ?? 0) <= now.getTime()),
        )
        .sort((a, b) => a.updatedAt - b.updatedAt)
        .slice(0, input.limit);
      return selected.map((row) => {
        const record = required(this.#records.get(row.recordId));
        const providerCaptureRef = record.capturedProviderRef;
        row.status = "leased";
        row.attempts += 1;
        row.leasedBy = input.workerId;
        row.leasedUntil = now.getTime() + input.leaseMs;
        row.updatedAt = now.getTime();
        return Object.freeze({
          outboxId: row.id,
          kind: row.kind,
          record: publicRecord(record),
          providerCaptureRef: providerCaptureRef
            ? Object.freeze(structuredClone(providerCaptureRef))
            : null,
          attempts: row.attempts,
          leasedUntil: new Date(row.leasedUntil).toISOString(),
        });
      });
    });
  }

  recordProviderCapture(input: {
    recordId: string;
    workspaceSnapshotRef: SandboxWorkspaceSnapshotRef;
    now?: Date;
  }): Promise<SnapshotLedgerRecord> {
    return this.lock(async () => {
      const record = required(this.#records.get(input.recordId));
      const workspaceSnapshotRef = sandboxWorkspaceSnapshotRefSchema.parse(
        input.workspaceSnapshotRef,
      );
      if (record.status !== "pending") {
        if (
          record.status === "committed" &&
          sameSnapshot(record.workspaceSnapshotRef, workspaceSnapshotRef)
        ) {
          return publicRecord(record);
        }
        throw new Error(
          "Provider capture cannot mutate a terminal snapshot record.",
        );
      }
      if (
        record.capturedProviderRef &&
        !sameSnapshot(record.capturedProviderRef, workspaceSnapshotRef)
      ) {
        throw new Error("Provider capture is immutable once recorded.");
      }
      record.capturedProviderRef = structuredClone(workspaceSnapshotRef);
      record.updatedAt = (input.now ?? new Date()).toISOString();
      this.completeKind(record.id, "capture");
      this.ensureOutbox(record.id, "adopt", input.now ?? new Date());
      return publicRecord(record);
    });
  }

  recordAdoptionCandidate(input: {
    recordId: string;
    workspaceSnapshotRef: SandboxWorkspaceSnapshotRef;
    trustedObjectRef: string;
    portableManifestDigest: string;
    byteSize: number;
    fileCount: number;
    now?: Date;
  }): Promise<SnapshotLedgerRecord> {
    return this.lock(async () => {
      const record = required(this.#records.get(input.recordId));
      const workspaceSnapshotRef = sandboxWorkspaceSnapshotRefSchema.parse(
        input.workspaceSnapshotRef,
      );
      if (record.status !== "pending") {
        if (
          record.status === "committed" &&
          sameSnapshot(record.workspaceSnapshotRef, workspaceSnapshotRef) &&
          record.trustedObjectRef === input.trustedObjectRef
        ) {
          return publicRecord(record);
        }
        throw new Error(
          "Adoption candidate cannot mutate a terminal snapshot record.",
        );
      }
      if (
        !record.capturedProviderRef ||
        !sameSnapshot(record.capturedProviderRef, workspaceSnapshotRef)
      ) {
        throw new Error(
          "Adoption candidate must match the captured provider snapshot.",
        );
      }
      const trustedObjectRef = input.trustedObjectRef.trim();
      if (!trustedObjectRef)
        throw new Error("A trusted object reference is required.");
      if (!/^sha256:[a-f0-9]{64}$/u.test(input.portableManifestDigest)) {
        throw new Error("A pinned portable manifest digest is required.");
      }
      if (
        !Number.isSafeInteger(input.byteSize) ||
        input.byteSize < 0 ||
        !Number.isSafeInteger(input.fileCount) ||
        input.fileCount < 0
      ) {
        throw new Error(
          "Adopted snapshot size and file count must be non-negative safe integers.",
        );
      }
      if (
        record.capturedTrustedObjectRef &&
        (record.capturedTrustedObjectRef !== trustedObjectRef ||
          record.capturedManifestDigest !== input.portableManifestDigest ||
          record.capturedByteSize !== input.byteSize ||
          record.capturedFileCount !== input.fileCount)
      ) {
        throw new Error("Adoption candidate is immutable once recorded.");
      }
      record.capturedTrustedObjectRef = trustedObjectRef;
      record.capturedManifestDigest = input.portableManifestDigest;
      record.capturedByteSize = input.byteSize;
      record.capturedFileCount = input.fileCount;
      record.updatedAt = (input.now ?? new Date()).toISOString();
      this.completeKind(record.id, "adopt");
      return publicRecord(record);
    });
  }

  commitAdoption(input: {
    recordId: string;
    workspaceSnapshotRef: SandboxWorkspaceSnapshotRef;
    trustedObjectRef: string;
    now?: Date;
  }): Promise<SnapshotLedgerRecord> {
    return this.lock(async () => {
      const record = required(this.#records.get(input.recordId));
      const workspaceSnapshotRef = sandboxWorkspaceSnapshotRefSchema.parse(
        input.workspaceSnapshotRef,
      );
      await this.assertAuthority(record);
      if (record.status === "committed") {
        if (
          sameSnapshot(record.workspaceSnapshotRef, workspaceSnapshotRef) &&
          record.trustedObjectRef === input.trustedObjectRef
        ) {
          return publicRecord(record);
        }
        throw new Error("Committed snapshots are immutable.");
      }
      if (record.status === "failed")
        throw new Error("Failed snapshots cannot be committed.");
      if (
        !record.capturedProviderRef ||
        !sameSnapshot(record.capturedProviderRef, workspaceSnapshotRef)
      ) {
        throw new Error("Adoption must match the recorded provider capture.");
      }
      if (record.capturedTrustedObjectRef !== input.trustedObjectRef.trim()) {
        throw new Error(
          "Commit must match the recorded trusted adoption candidate.",
        );
      }
      if (
        record.capturedManifestDigest === null ||
        record.capturedByteSize === null ||
        record.capturedFileCount === null
      ) {
        throw new Error("Commit requires complete portable manifest evidence.");
      }
      const duplicateCheckpoint = [...this.#records.values()].find(
        (candidate) =>
          candidate.id !== record.id &&
          candidate.status === "committed" &&
          candidate.ownerId === record.ownerId &&
          candidate.branchId === record.branchId &&
          candidate.conversationCheckpointRef ===
            record.conversationCheckpointRef,
      );
      if (duplicateCheckpoint) {
        throw new Error(
          "A committed snapshot already owns this branch checkpoint.",
        );
      }
      record.status = "committed";
      record.workspaceSnapshotRef = structuredClone(workspaceSnapshotRef);
      record.trustedObjectRef = input.trustedObjectRef;
      record.portableManifestDigest = record.capturedManifestDigest;
      record.byteSize = record.capturedByteSize;
      record.fileCount = record.capturedFileCount;
      record.failure = null;
      const committedAt = (input.now ?? new Date()).toISOString();
      record.updatedAt = committedAt;
      record.committedAt = committedAt;
      this.completeKind(record.id, "capture");
      this.completeKind(record.id, "adopt");
      this.ensureOutbox(record.id, "publish", input.now ?? new Date());
      return publicRecord(record);
    });
  }

  attachRuntimeCheckpoint(input: {
    recordId: string;
    runtimeCheckpointRef: SandboxProviderRuntimeCheckpointRef;
    imageDigest: string;
    executionProfileVersion: string;
    now?: Date;
  }): Promise<SnapshotLedgerRecord> {
    return this.lock(async () => {
      const record = required(this.#records.get(input.recordId));
      if (record.status !== "committed") {
        throw new Error(
          "Runtime accelerators can only attach to committed workspace snapshots.",
        );
      }
      if (
        input.imageDigest !== record.imageTemplateRef.imageDigest ||
        input.executionProfileVersion !== record.executionProfileVersion
      ) {
        throw new Error(
          "Runtime checkpoint is incompatible with the committed image/profile.",
        );
      }
      const runtimeCheckpointRef =
        sandboxProviderRuntimeCheckpointRefSchema.parse(
          input.runtimeCheckpointRef,
        );
      const existing = record.sandboxRuntimeCheckpointRef;
      if (
        existing &&
        (existing.provider !== runtimeCheckpointRef.provider ||
          existing.opaqueRef !== runtimeCheckpointRef.opaqueRef)
      ) {
        throw new Error(
          "Runtime checkpoint accelerator is immutable once attached.",
        );
      }
      record.sandboxRuntimeCheckpointRef =
        structuredClone(runtimeCheckpointRef);
      record.updatedAt = (input.now ?? new Date()).toISOString();
      return publicRecord(record);
    });
  }

  failCapture(input: {
    recordId: string;
    failure: string;
    now?: Date;
  }): Promise<SnapshotLedgerRecord> {
    return this.lock(async () => {
      const record = required(this.#records.get(input.recordId));
      if (record.status === "committed")
        throw new Error("Committed snapshots cannot fail later.");
      if (record.status === "failed") return publicRecord(record);
      record.status = "failed";
      record.failure =
        input.failure.slice(0, 4_096) || "snapshot capture failed";
      const failedAt = (input.now ?? new Date()).toISOString();
      record.updatedAt = failedAt;
      record.failedAt = failedAt;
      this.completeKind(record.id, "capture");
      this.completeKind(record.id, "adopt");
      if (record.capturedProviderRef) {
        this.ensureOutbox(record.id, "gc", input.now ?? new Date());
      }
      return publicRecord(record);
    });
  }

  completeOutbox(input: {
    outboxId: string;
    workerId: string;
    now?: Date;
  }): Promise<void> {
    return this.lock(async () => {
      const row = required(this.#outbox.get(input.outboxId));
      if (row.status === "completed") return;
      if (
        (row.kind !== "publish" && row.kind !== "gc") ||
        row.leasedBy !== input.workerId
      ) {
        throw new Error(
          "Only the active publish/GC lease owner can complete this outbox row.",
        );
      }
      row.status = "completed";
      row.leasedBy = null;
      row.leasedUntil = null;
      row.updatedAt = (input.now ?? new Date()).getTime();
    });
  }

  getRestorable(input: {
    ownerId: string;
    threadId: string;
    branchId: string;
    conversationCheckpointRef: string;
  }): Promise<SnapshotLedgerRecord | null> {
    return this.lock(async () => {
      await this.assertAuthority(input);
      const record = [...this.#records.values()].find(
        (candidate) =>
          candidate.status === "committed" &&
          candidate.ownerId === input.ownerId &&
          candidate.threadId === input.threadId &&
          candidate.branchId === input.branchId &&
          candidate.conversationCheckpointRef ===
            input.conversationCheckpointRef,
      );
      return record ? publicRecord(record) : null;
    });
  }

  getLatestCompatible(input: {
    ownerId: string;
    threadId: string;
    branchId: string;
    executionProfileId: SandboxProfileId;
    executionProfileVersion: string;
    imageDigest: string;
    maxSequence?: number;
  }): Promise<SnapshotLedgerRecord | null> {
    return this.lock(async () => {
      const candidate = [...this.#records.values()]
        .filter(
          (record) =>
            record.status === "committed" &&
            record.ownerId === input.ownerId &&
            record.threadId === input.threadId &&
            record.branchId === input.branchId &&
            record.executionProfileId === input.executionProfileId &&
            record.executionProfileVersion === input.executionProfileVersion &&
            record.imageTemplateRef.imageDigest === input.imageDigest &&
            record.sequence <= (input.maxSequence ?? Number.MAX_SAFE_INTEGER),
        )
        .sort((left, right) => right.sequence - left.sequence)[0];
      if (!candidate) return null;
      await this.assertAuthority(candidate);
      return publicRecord(candidate);
    });
  }

  reconcile(input: {
    pendingOlderThanMs: number;
    leaseExpiredBefore?: Date;
    providerInventory?: readonly SandboxWorkspaceSnapshotRef[];
    now?: Date;
  }): Promise<readonly SnapshotReconciliationAction[]> {
    return this.lock(async () => {
      const now = input.now ?? new Date();
      const actions: SnapshotReconciliationAction[] = [];
      for (const record of this.#records.values()) {
        for (const outbox of this.outboxesFor(record.id)) {
          if (
            outbox.status === "leased" &&
            (outbox.leasedUntil ?? 0) <=
              (input.leaseExpiredBefore ?? now).getTime()
          ) {
            outbox.status = "pending";
            outbox.leasedBy = null;
            outbox.leasedUntil = null;
            outbox.updatedAt = now.getTime();
          }
        }
        if (record.status === "committed") {
          const publish = this.ensureOutbox(record.id, "publish", now);
          if (publish.status !== "completed") {
            actions.push({ recordId: record.id, action: "retry-publish" });
          }
          continue;
        }
        if (record.status === "failed" && record.capturedProviderRef) {
          this.ensureOutbox(record.id, "gc", now);
          actions.push({
            recordId: record.id,
            action: "orphan-requires-cleanup",
            workspaceSnapshotRef: structuredClone(record.capturedProviderRef),
          });
          continue;
        }
        if (record.status !== "pending") continue;
        if (record.capturedProviderRef && record.capturedTrustedObjectRef) {
          actions.push({
            recordId: record.id,
            action: "resume-commit",
            workspaceSnapshotRef: structuredClone(record.capturedProviderRef),
          });
          continue;
        }
        if (record.capturedProviderRef) {
          this.ensureOutbox(record.id, "adopt", now);
          actions.push({
            recordId: record.id,
            action: "resume-adoption",
            workspaceSnapshotRef: structuredClone(record.capturedProviderRef),
          });
          continue;
        }
        const age = now.getTime() - new Date(record.updatedAt).getTime();
        const capture = this.ensureOutbox(record.id, "capture", now);
        const leaseExpired = capture.status !== "leased";
        if (age >= input.pendingOlderThanMs && leaseExpired) {
          capture.status = "pending";
          capture.leasedBy = null;
          capture.leasedUntil = null;
          capture.updatedAt = now.getTime();
          actions.push({ recordId: record.id, action: "retry-capture" });
        }
      }
      const tracked = new Set(
        [...this.#records.values()]
          .map((record) => record.capturedProviderRef)
          .filter((ref): ref is SandboxWorkspaceSnapshotRef => ref !== null)
          .map(snapshotKey),
      );
      for (const candidate of input.providerInventory ?? []) {
        const parsed = sandboxWorkspaceSnapshotRefSchema.parse(candidate);
        if (!tracked.has(snapshotKey(parsed))) {
          actions.push({
            recordId: `untracked:${parsed.digest}`,
            action: "orphan-requires-cleanup",
            workspaceSnapshotRef: structuredClone(parsed),
          });
        }
      }
      const frozen: SnapshotReconciliationAction[] = actions.map((action) =>
        Object.freeze(action),
      );
      return Object.freeze(frozen);
    });
  }

  private async assertAuthority(input: {
    ownerId: string;
    threadId: string;
    branchId: string;
    conversationCheckpointRef: string;
  }): Promise<void> {
    if (!(await this.authority.verify(input))) {
      throw new Error(
        "Conversation checkpoint does not belong to this owner/thread/branch.",
      );
    }
  }

  private outboxesFor(recordId: string): OutboxRow[] {
    return [...this.#outbox.values()].filter(
      (row) => row.recordId === recordId,
    );
  }

  private ensureOutbox(
    recordId: string,
    kind: SnapshotOutboxKind,
    now: Date,
  ): OutboxRow {
    const existing = this.outboxesFor(recordId).find(
      (row) => row.kind === kind,
    );
    if (existing) return existing;
    const row = newOutboxRow(recordId, kind, now);
    this.#outbox.set(row.id, row);
    return row;
  }

  private completeKind(recordId: string, kind: SnapshotOutboxKind): void {
    const row = this.outboxesFor(recordId).find(
      (candidate) => candidate.kind === kind,
    );
    if (!row) return;
    row.status = "completed";
    row.leasedBy = null;
    row.leasedUntil = null;
  }

  private async lock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#tail;
    let release!: () => void;
    this.#tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

function validateCaptureIdentity(input: {
  ownerId: string;
  threadId: string;
  branchId: string;
  sequence: number;
  requestId: string;
  conversationCheckpointRef: string;
}): void {
  if (
    !input.ownerId ||
    !input.threadId ||
    !input.branchId ||
    !input.requestId ||
    !input.conversationCheckpointRef ||
    !Number.isInteger(input.sequence) ||
    input.sequence < 1
  ) {
    throw new Error(
      "Snapshot capture requires a valid owner, branch boundary, request, and sequence.",
    );
  }
}

function publicRecord(record: MutableSnapshotRecord): SnapshotLedgerRecord {
  return Object.freeze({
    id: record.id,
    ownerId: record.ownerId,
    threadId: record.threadId,
    branchId: record.branchId,
    sequence: record.sequence,
    requestId: record.requestId,
    conversationCheckpointRef: record.conversationCheckpointRef,
    parentWorkspaceSnapshotRef: record.parentWorkspaceSnapshotRef
      ? Object.freeze(structuredClone(record.parentWorkspaceSnapshotRef))
      : null,
    imageTemplateRef: Object.freeze(structuredClone(record.imageTemplateRef)),
    executionProfileId: record.executionProfileId,
    executionProfileVersion: record.executionProfileVersion,
    status: record.status,
    workspaceSnapshotRef: record.workspaceSnapshotRef
      ? Object.freeze(structuredClone(record.workspaceSnapshotRef))
      : null,
    sandboxRuntimeCheckpointRef: record.sandboxRuntimeCheckpointRef
      ? Object.freeze(structuredClone(record.sandboxRuntimeCheckpointRef))
      : null,
    trustedObjectRef: record.trustedObjectRef,
    portableManifestDigest: record.portableManifestDigest,
    byteSize: record.byteSize,
    fileCount: record.fileCount,
    failure: record.failure,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    committedAt: record.committedAt,
    failedAt: record.failedAt,
  });
}

function sameSnapshot(
  left: SandboxWorkspaceSnapshotRef | null,
  right: SandboxWorkspaceSnapshotRef,
): boolean {
  return Boolean(
    left &&
    left.provider === right.provider &&
    left.digest === right.digest &&
    left.format === right.format,
  );
}

function sameOptionalSnapshot(
  left: SandboxWorkspaceSnapshotRef | null,
  right: SandboxWorkspaceSnapshotRef | null,
): boolean {
  if (left === null || right === null) return left === right;
  return sameSnapshot(left, right);
}

function required<T>(value: T | undefined): T {
  if (value === undefined)
    throw new Error("Snapshot ledger record was not found.");
  return value;
}

function newOutboxRow(
  recordId: string,
  kind: SnapshotOutboxKind,
  now: Date,
): OutboxRow {
  return {
    id: randomUUID(),
    recordId,
    kind,
    status: "pending",
    attempts: 0,
    leasedBy: null,
    leasedUntil: null,
    updatedAt: now.getTime(),
  };
}

function snapshotKey(ref: SandboxWorkspaceSnapshotRef): string {
  return `${ref.provider}:${ref.format}:${ref.digest}`;
}
