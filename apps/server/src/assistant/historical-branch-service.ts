import type { InValue } from "@libsql/client";
import {
  historicalBranchPreviewSchema,
  historicalBranchSnapshotPreviewSchema,
  sandboxHandleSchema,
  sandboxImageTemplateRefSchema,
  sandboxProfileIdSchema,
  sandboxProviderRuntimeCheckpointRefSchema,
  sandboxWorkspaceSnapshotRefSchema,
  type HistoricalBranchOperation,
  type HistoricalBranchPreview,
  type HistoricalBranchSnapshotPreview,
  type SandboxExecutionProfile,
  type SandboxCreateInput,
  type SandboxHandle,
  type SandboxPreflightInput,
  type SandboxPreflightResult,
  type SandboxProvider,
  type SandboxProviderId,
} from "@avermate/agent-contracts";
import { newId } from "../lib/id";
import { isoFromSqlite, sha256 } from "../search/values";
import type {
  AssistantSqlClient,
  TurnReservation,
} from "./core-conversation-store";
import type { SnapshotLedgerRecord } from "../sandbox/snapshot-ledger";

type Row = Record<string, InValue>;

export type HistoricalBranchErrorCode =
  | "not_found"
  | "invalid_target"
  | "snapshot_unavailable"
  | "snapshot_incompatible"
  | "divergent_replay";

export class HistoricalBranchError extends Error {
  constructor(
    readonly code: HistoricalBranchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "HistoricalBranchError";
  }
}

export interface HistoricalBranchBoundary {
  readonly ownerId: string;
  readonly threadId: string;
  readonly sourceBranchId: string;
  readonly messageId: string;
  readonly operation: HistoricalBranchOperation;
  readonly role: "user" | "assistant";
  readonly forkedFromMessageId: string | null;
  readonly cutoffMessageId: string | null;
  readonly workspaceCopySupported: boolean;
}

export interface ExistingHistoricalReservation {
  readonly reservation: TurnReservation;
  readonly workspaceSnapshotRef: string | null;
  readonly forkedFromMessageId: string | null;
}

export interface HistoricalBranchRepository {
  resolveBoundary(input: {
    ownerId: string;
    sourceBranchId: string;
    messageId: string;
    operation: HistoricalBranchOperation;
  }): Promise<HistoricalBranchBoundary>;
  latestCommittedSnapshot(
    boundary: HistoricalBranchBoundary,
  ): Promise<SnapshotLedgerRecord | null>;
  committedSnapshotById(
    boundary: HistoricalBranchBoundary,
    snapshotId: string,
  ): Promise<SnapshotLedgerRecord | null>;
  existingReservation(input: {
    boundary: HistoricalBranchBoundary;
    clientRequestId: string;
  }): Promise<ExistingHistoricalReservation | null>;
  domainCursorAtBoundary(
    boundary: HistoricalBranchBoundary,
  ): Promise<string | null>;
}

export type HistoricalBranchSandboxProvider = {
  readonly id: SandboxProviderId;
  preflight(input: SandboxPreflightInput): Promise<SandboxPreflightResult>;
  forkWorkspace(
    input: Parameters<SandboxProvider["forkWorkspace"]>[0],
  ): Promise<SandboxHandle>;
  destroy(handle: SandboxHandle): Promise<void>;
};

export interface HistoricalBranchSandboxRuntime {
  readonly provider: HistoricalBranchSandboxProvider;
  readonly profiles: readonly SandboxExecutionProfile[];
  readonly hostPolicyDigest: string | null;
  readonly maxEvidenceAgeMs: number;
  readonly restoreWorkspace?: (input: {
    snapshot: SnapshotLedgerRecord;
    create: SandboxCreateInput & {
      source: NonNullable<SnapshotLedgerRecord["workspaceSnapshotRef"]>;
    };
  }) => Promise<{
    handle: SandboxHandle;
    path: "runtime-checkpoint" | "logical-workspace";
    reason?: string;
  }>;
}

export type WorkspaceBranchResult = {
  readonly reservation: TurnReservation;
  readonly historicalBranch: {
    readonly mode: "workspace-copy";
    readonly sourceBranchId: string;
    readonly destinationBranchId: string;
    readonly snapshot: HistoricalBranchSnapshotPreview;
    readonly sandboxId: string | null;
    readonly expiresAt: string | null;
    readonly reused: boolean;
  };
};

type Compatibility =
  | {
      readonly ok: true;
      readonly runtime: HistoricalBranchSandboxRuntime;
      readonly profile: SandboxExecutionProfile;
    }
  | {
      readonly ok: false;
      readonly reason: "snapshot-incompatible" | "provider-unavailable";
      readonly message: string;
    };

function optionalJson<T>(
  value: unknown,
  parse: (value: unknown) => T,
): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new HistoricalBranchError(
      "snapshot_incompatible",
      "Stored workspace snapshot metadata is invalid.",
    );
  }
  return parse(JSON.parse(value));
}

function snapshotFromRow(row: Row): SnapshotLedgerRecord {
  return Object.freeze({
    id: String(row.id),
    ownerId: String(row.userId),
    threadId: String(row.threadId),
    branchId: String(row.branchId),
    sequence: Number(row.sequence),
    requestId: String(row.requestId),
    conversationCheckpointRef: String(row.conversationCheckpointRef),
    parentWorkspaceSnapshotRef: optionalJson(
      row.parentWorkspaceSnapshotRefJson,
      (value) => sandboxWorkspaceSnapshotRefSchema.parse(value),
    ),
    imageTemplateRef: optionalJson(row.imageTemplateRefJson, (value) =>
      sandboxImageTemplateRefSchema.parse(value),
    )!,
    executionProfileId: sandboxProfileIdSchema.parse(row.executionProfileId),
    executionProfileVersion: String(row.executionProfileVersion),
    status: "committed",
    workspaceSnapshotRef: optionalJson(row.workspaceSnapshotRefJson, (value) =>
      sandboxWorkspaceSnapshotRefSchema.parse(value),
    ),
    sandboxRuntimeCheckpointRef: optionalJson(
      row.sandboxRuntimeCheckpointRefJson,
      (value) => sandboxProviderRuntimeCheckpointRefSchema.parse(value),
    ),
    trustedObjectRef:
      row.trustedObjectRef === null ? null : String(row.trustedObjectRef),
    portableManifestDigest:
      row.portableManifestDigest === null
        ? null
        : String(row.portableManifestDigest),
    byteSize: row.byteSize === null ? null : Number(row.byteSize),
    fileCount: row.fileCount === null ? null : Number(row.fileCount),
    failure: row.safeError === null ? null : String(row.safeError),
    createdAt: isoFromSqlite(row.createdAt),
    updatedAt: isoFromSqlite(row.updatedAt),
    committedAt:
      row.committedAt === null ? null : isoFromSqlite(row.committedAt),
    failedAt: row.failedAt === null ? null : isoFromSqlite(row.failedAt),
  });
}

function reservationFromRow(row: Row): TurnReservation {
  return {
    threadId: String(row.threadId),
    branchId: String(row.branchId),
    userMessageId: String(row.inputMessageId),
    runId: String(row.id),
    reservedOutputMessageId: String(row.reservedOutputMessageId),
    idempotent: true,
  };
}

/** Core placement lookup. Every query re-proves the full owner/thread/branch tuple. */
export class CoreHistoricalBranchRepository implements HistoricalBranchRepository {
  constructor(private readonly client: AssistantSqlClient) {}

  async resolveBoundary(input: {
    ownerId: string;
    sourceBranchId: string;
    messageId: string;
    operation: HistoricalBranchOperation;
  }): Promise<HistoricalBranchBoundary> {
    const result = await this.client.execute({
      sql: `WITH RECURSIVE source_path(id, parentMessageId, role, threadId) AS (
          SELECT messages.id, messages.parentMessageId, messages.role, messages.threadId
          FROM assistant_threads AS threads
          JOIN assistant_branches AS branches
            ON branches.threadId = threads.id
          JOIN assistant_messages AS messages
            ON messages.id = branches.headMessageId
             AND messages.threadId = threads.id
          WHERE threads.userId = ? AND threads.deletedAt IS NULL
            AND threads.placement = 'core' AND branches.id = ?
          UNION ALL
          SELECT parent.id, parent.parentMessageId, parent.role, parent.threadId
          FROM assistant_messages AS parent
          JOIN source_path AS child ON child.parentMessageId = parent.id
          WHERE parent.threadId = child.threadId
        )
        SELECT * FROM source_path WHERE id = ? LIMIT 1`,
      args: [input.ownerId, input.sourceBranchId, input.messageId],
    });
    const row = result.rows[0] as Row | undefined;
    if (!row) {
      throw new HistoricalBranchError(
        "not_found",
        "The historical message is not on this owned source branch.",
      );
    }
    const role = String(row.role);
    if (
      (input.operation === "retry" &&
        (role !== "assistant" || row.parentMessageId === null)) ||
      (input.operation === "edit" && role !== "user" && role !== "assistant")
    ) {
      throw new HistoricalBranchError(
        "invalid_target",
        input.operation === "retry"
          ? "Only an assistant response can be retried."
          : "This message cannot be edited into a historical branch.",
      );
    }
    const parentMessageId =
      row.parentMessageId === null ? null : String(row.parentMessageId);
    return Object.freeze({
      ownerId: input.ownerId,
      threadId: String(row.threadId),
      sourceBranchId: input.sourceBranchId,
      messageId: input.messageId,
      operation: input.operation,
      role: role as "user" | "assistant",
      forkedFromMessageId: parentMessageId,
      cutoffMessageId: role === "user" ? parentMessageId : input.messageId,
      workspaceCopySupported: role === "user" || input.operation === "retry",
    });
  }

  latestCommittedSnapshot(
    boundary: HistoricalBranchBoundary,
  ): Promise<SnapshotLedgerRecord | null> {
    return this.findCommittedSnapshot(boundary);
  }

  committedSnapshotById(
    boundary: HistoricalBranchBoundary,
    snapshotId: string,
  ): Promise<SnapshotLedgerRecord | null> {
    return this.findCommittedSnapshot(boundary, snapshotId);
  }

  async existingReservation(input: {
    boundary: HistoricalBranchBoundary;
    clientRequestId: string;
  }): Promise<ExistingHistoricalReservation | null> {
    const result = await this.client.execute({
      sql: `SELECT runs.*, branches.forkedFromMessageId
        FROM assistant_runs AS runs
        JOIN assistant_threads AS threads
          ON threads.id = runs.threadId AND threads.userId = runs.userId
        JOIN assistant_branches AS branches
          ON branches.id = runs.branchId AND branches.threadId = runs.threadId
        WHERE runs.userId = ? AND runs.threadId = ?
          AND runs.clientRequestId = ? AND threads.deletedAt IS NULL
        LIMIT 1`,
      args: [
        input.boundary.ownerId,
        input.boundary.threadId,
        input.clientRequestId,
      ],
    });
    const row = result.rows[0] as Row | undefined;
    if (!row) return null;
    return Object.freeze({
      reservation: reservationFromRow(row),
      workspaceSnapshotRef:
        row.workspaceSnapshotRef === null
          ? null
          : String(row.workspaceSnapshotRef),
      forkedFromMessageId:
        row.forkedFromMessageId === null
          ? null
          : String(row.forkedFromMessageId),
    });
  }

  async domainCursorAtBoundary(
    boundary: HistoricalBranchBoundary,
  ): Promise<string | null> {
    const result = await this.client.execute({
      sql: `SELECT runs.domainCursorRef
        FROM assistant_runs AS runs
        JOIN assistant_threads AS threads
          ON threads.id = runs.threadId AND threads.userId = runs.userId
        WHERE runs.userId = ? AND runs.threadId = ?
          AND threads.deletedAt IS NULL
          AND runs.domainCursorRef IS NOT NULL
          AND (
            (? = 'user' AND runs.inputMessageId = ?)
            OR
            (? = 'assistant' AND (
              runs.outputMessageId = ? OR runs.reservedOutputMessageId = ?
            ))
          )
        ORDER BY runs.createdAt DESC, runs.id DESC LIMIT 1`,
      args: [
        boundary.ownerId,
        boundary.threadId,
        boundary.role,
        boundary.messageId,
        boundary.role,
        boundary.messageId,
        boundary.messageId,
      ],
    });
    const value = (result.rows[0] as Row | undefined)?.domainCursorRef;
    return value === null || value === undefined ? null : String(value);
  }

  private async findCommittedSnapshot(
    boundary: HistoricalBranchBoundary,
    snapshotId?: string,
  ): Promise<SnapshotLedgerRecord | null> {
    if (!boundary.cutoffMessageId) return null;
    const result = await this.client.execute({
      sql: `WITH RECURSIVE cutoff_path(id, parentMessageId, threadId) AS (
          SELECT id, parentMessageId, threadId
          FROM assistant_messages
          WHERE id = ? AND threadId = ?
          UNION ALL
          SELECT parent.id, parent.parentMessageId, parent.threadId
          FROM assistant_messages AS parent
          JOIN cutoff_path AS child ON child.parentMessageId = parent.id
          WHERE parent.threadId = child.threadId
        )
        SELECT snapshots.*
        FROM workspace_snapshots AS snapshots
        JOIN assistant_threads AS threads
          ON threads.id = snapshots.threadId
         AND threads.userId = snapshots.userId
        JOIN assistant_branches AS branches
          ON branches.id = snapshots.branchId
         AND branches.threadId = snapshots.threadId
        JOIN assistant_conversation_checkpoints AS checkpoints
          ON checkpoints.id = snapshots.conversationCheckpointRef
         AND checkpoints.userId = snapshots.userId
         AND checkpoints.threadId = snapshots.threadId
         AND checkpoints.branchId = snapshots.branchId
        WHERE snapshots.userId = ? AND snapshots.threadId = ?
          AND snapshots.branchId = ? AND snapshots.state = 'committed'
          AND checkpoints.status = 'committed'
          AND checkpoints.inputMessageId IN (SELECT id FROM cutoff_path)
          AND snapshots.workspaceSnapshotRefJson IS NOT NULL
          AND snapshots.portableManifestDigest IS NOT NULL
          AND snapshots.byteSize IS NOT NULL AND snapshots.fileCount IS NOT NULL
          AND snapshots.committedAt IS NOT NULL
          ${snapshotId ? "AND snapshots.id = ?" : ""}
        ORDER BY snapshots.sequence DESC, snapshots.id DESC LIMIT 1`,
      args: [
        boundary.cutoffMessageId,
        boundary.threadId,
        boundary.ownerId,
        boundary.threadId,
        boundary.sourceBranchId,
        ...(snapshotId ? [snapshotId] : []),
      ],
    });
    const row = result.rows[0] as Row | undefined;
    return row ? snapshotFromRow(row) : null;
  }
}

function snapshotPreview(
  snapshot: SnapshotLedgerRecord,
): HistoricalBranchSnapshotPreview {
  if (
    snapshot.status !== "committed" ||
    !snapshot.workspaceSnapshotRef ||
    !snapshot.portableManifestDigest ||
    snapshot.byteSize === null ||
    snapshot.fileCount === null ||
    !snapshot.committedAt
  ) {
    throw new HistoricalBranchError(
      "snapshot_incompatible",
      "The selected workspace snapshot is not a complete committed snapshot.",
    );
  }
  return historicalBranchSnapshotPreviewSchema.parse({
    id: snapshot.id,
    conversationCheckpointRef: snapshot.conversationCheckpointRef,
    sequence: snapshot.sequence,
    executionProfileId: snapshot.executionProfileId,
    executionProfileVersion: snapshot.executionProfileVersion,
    imageDigest: snapshot.imageTemplateRef.imageDigest,
    provider: snapshot.workspaceSnapshotRef.provider,
    portableManifestDigest: snapshot.portableManifestDigest,
    byteSize: snapshot.byteSize,
    fileCount: snapshot.fileCount,
    committedAt: snapshot.committedAt,
  });
}

function boundedMessage(error: unknown, fallback: string): string {
  const message =
    error instanceof Error && error.message ? error.message : fallback;
  return message.slice(0, 2_000);
}

export class HistoricalBranchService {
  constructor(
    private readonly repository: HistoricalBranchRepository,
    private readonly resolveSandboxRuntime: (
      snapshot: SnapshotLedgerRecord,
    ) =>
      HistoricalBranchSandboxRuntime | Promise<HistoricalBranchSandboxRuntime>,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  assertConversationOnly(input: {
    ownerId: string;
    sourceBranchId: string;
    messageId: string;
    operation: HistoricalBranchOperation;
  }): Promise<HistoricalBranchBoundary> {
    // This path deliberately performs only an owned conversation lookup. It
    // never resolves the sandbox provider or reads/writes the snapshot ledger.
    return this.repository.resolveBoundary(input);
  }

  async resolveDataChangesBoundary(input: {
    ownerId: string;
    sourceBranchId: string;
    messageId: string;
    operation: HistoricalBranchOperation;
  }): Promise<HistoricalBranchBoundary & { domainCursorRef: string }> {
    const boundary = await this.repository.resolveBoundary(input);
    const domainCursorRef =
      await this.repository.domainCursorAtBoundary(boundary);
    if (!domainCursorRef) {
      throw new HistoricalBranchError(
        "snapshot_unavailable",
        "No domain-action cursor was committed at this historical boundary.",
      );
    }
    return Object.freeze({ ...boundary, domainCursorRef });
  }

  async preview(input: {
    ownerId: string;
    sourceBranchId: string;
    messageId: string;
    operation: HistoricalBranchOperation;
  }): Promise<HistoricalBranchPreview> {
    const boundary = await this.repository.resolveBoundary(input);
    const domainCursorRef =
      await this.repository.domainCursorAtBoundary(boundary);
    let workspaceCopy: HistoricalBranchPreview["workspaceCopy"];
    if (!boundary.workspaceCopySupported) {
      workspaceCopy = {
        available: false,
        reason: "unsupported-target",
        message:
          "Workspace copy is unavailable when curating an assistant response.",
        snapshot: null,
      };
    } else {
      const snapshot = await this.repository.latestCommittedSnapshot(boundary);
      if (!snapshot) {
        workspaceCopy = {
          available: false,
          reason: "no-committed-snapshot",
          message:
            "No committed workspace snapshot exists at this historical boundary.",
          snapshot: null,
        };
      } else {
        const preview = snapshotPreview(snapshot);
        const compatibility = await this.compatibility(snapshot);
        workspaceCopy = compatibility.ok
          ? { available: true, snapshot: preview }
          : {
              available: false,
              reason: compatibility.reason,
              message: compatibility.message,
              snapshot: preview,
            };
      }
    }
    return historicalBranchPreviewSchema.parse({
      operation: input.operation,
      threadId: boundary.threadId,
      sourceBranchId: boundary.sourceBranchId,
      messageId: boundary.messageId,
      conversationOnly: { available: true },
      workspaceCopy,
      dataChanges: domainCursorRef
        ? { available: true, domainCursorRef }
        : {
            available: false,
            reason: "no-domain-cursor",
            message:
              "No domain-action cursor was committed at this historical boundary.",
          },
    });
  }

  async branchWithWorkspaceCopy(input: {
    ownerId: string;
    sourceBranchId: string;
    messageId: string;
    operation: HistoricalBranchOperation;
    clientRequestId: string;
    snapshotId: string;
    expectedPortableManifestDigest: string;
    createDestination: (input: {
      destinationBranchId: string;
      workspaceSnapshotRef: string;
    }) => Promise<TurnReservation>;
  }): Promise<WorkspaceBranchResult> {
    const boundary = await this.repository.resolveBoundary(input);
    if (!boundary.workspaceCopySupported) {
      throw new HistoricalBranchError(
        "invalid_target",
        "Workspace copy is unavailable for this historical operation.",
      );
    }
    const snapshot = await this.repository.committedSnapshotById(
      boundary,
      input.snapshotId,
    );
    if (!snapshot) {
      throw new HistoricalBranchError(
        "snapshot_unavailable",
        "The selected snapshot is not a committed snapshot owned by this source branch and boundary.",
      );
    }
    const preview = snapshotPreview(snapshot);
    if (
      preview.portableManifestDigest !== input.expectedPortableManifestDigest
    ) {
      throw new HistoricalBranchError(
        "divergent_replay",
        "The selected workspace snapshot no longer matches the confirmed preview.",
      );
    }

    const existing = await this.repository.existingReservation({
      boundary,
      clientRequestId: input.clientRequestId,
    });
    if (existing) {
      if (
        existing.workspaceSnapshotRef !== snapshot.id ||
        existing.forkedFromMessageId !== boundary.forkedFromMessageId
      ) {
        throw new HistoricalBranchError(
          "divergent_replay",
          "The request id was already used for a different historical branch boundary.",
        );
      }
      return {
        reservation: existing.reservation,
        historicalBranch: {
          mode: "workspace-copy",
          sourceBranchId: boundary.sourceBranchId,
          destinationBranchId: existing.reservation.branchId,
          snapshot: preview,
          sandboxId: null,
          expiresAt: null,
          reused: true,
        },
      };
    }

    const compatibility = await this.compatibility(snapshot);
    if (!compatibility.ok) {
      throw new HistoricalBranchError(
        compatibility.reason === "snapshot-incompatible"
          ? "snapshot_incompatible"
          : "snapshot_unavailable",
        compatibility.message,
      );
    }
    const source = snapshot.workspaceSnapshotRef;
    if (!source) {
      throw new HistoricalBranchError(
        "snapshot_unavailable",
        "The selected committed snapshot has no portable workspace reference.",
      );
    }
    const destinationBranchId = newId("abrn");
    const now = this.clock();
    const expiresAt = new Date(
      now.getTime() + compatibility.profile.resources.wallTimeMs + 15 * 60_000,
    );
    const create = {
      operationId: `historical:${sha256(
        `${input.ownerId}\0${input.clientRequestId}`,
      ).slice(0, 48)}`,
      ownerId: input.ownerId,
      threadId: boundary.threadId,
      branchId: destinationBranchId,
      profile: compatibility.profile,
      expectedHostPolicyDigest: compatibility.runtime.hostPolicyDigest!,
      maxEvidenceAgeMs: compatibility.runtime.maxEvidenceAgeMs,
      now,
      expiresAt,
      source,
    } satisfies SandboxCreateInput & {
      source: NonNullable<SnapshotLedgerRecord["workspaceSnapshotRef"]>;
    };
    let handle: SandboxHandle;
    try {
      handle = sandboxHandleSchema.parse(
        compatibility.runtime.restoreWorkspace
          ? (
              await compatibility.runtime.restoreWorkspace({
                snapshot,
                create,
              })
            ).handle
          : await compatibility.runtime.provider.forkWorkspace(create),
      );
    } catch (error) {
      throw new HistoricalBranchError(
        "snapshot_incompatible",
        boundedMessage(
          error,
          "The selected workspace snapshot could not be copied.",
        ),
      );
    }
    if (
      handle.ownerId !== input.ownerId ||
      handle.threadId !== boundary.threadId ||
      handle.branchId !== destinationBranchId ||
      handle.providerId !== source.provider ||
      handle.profileId !== compatibility.profile.id ||
      handle.profileVersion !== compatibility.profile.version ||
      handle.image.imageDigest !== compatibility.profile.image.imageDigest
    ) {
      await this.destroyDestination(compatibility.runtime.provider, handle);
      throw new HistoricalBranchError(
        "snapshot_incompatible",
        "The sandbox provider returned a workspace outside the confirmed destination boundary.",
      );
    }

    let reservation: TurnReservation;
    try {
      reservation = await input.createDestination({
        destinationBranchId,
        workspaceSnapshotRef: snapshot.id,
      });
    } catch (error) {
      await this.destroyDestination(compatibility.runtime.provider, handle);
      throw error;
    }
    if (reservation.branchId !== destinationBranchId) {
      await this.destroyDestination(compatibility.runtime.provider, handle);
      if (!reservation.idempotent) {
        throw new HistoricalBranchError(
          "divergent_replay",
          "The conversation branch did not adopt the confirmed workspace destination.",
        );
      }
      return {
        reservation,
        historicalBranch: {
          mode: "workspace-copy",
          sourceBranchId: boundary.sourceBranchId,
          destinationBranchId: reservation.branchId,
          snapshot: preview,
          sandboxId: null,
          expiresAt: null,
          reused: true,
        },
      };
    }
    return {
      reservation,
      historicalBranch: {
        mode: "workspace-copy",
        sourceBranchId: boundary.sourceBranchId,
        destinationBranchId,
        snapshot: preview,
        sandboxId: handle.sandboxId,
        expiresAt: handle.expiresAt,
        reused: false,
      },
    };
  }

  private async compatibility(
    snapshot: SnapshotLedgerRecord,
  ): Promise<Compatibility> {
    let runtime: HistoricalBranchSandboxRuntime;
    try {
      runtime = await this.resolveSandboxRuntime(snapshot);
    } catch (error) {
      return {
        ok: false,
        reason: "provider-unavailable",
        message: boundedMessage(
          error,
          "The workspace provider is unavailable.",
        ),
      };
    }
    const source = snapshot.workspaceSnapshotRef;
    if (!source || source.provider !== runtime.provider.id) {
      return {
        ok: false,
        reason: "snapshot-incompatible",
        message:
          "The committed snapshot belongs to a different workspace provider.",
      };
    }
    const profile = runtime.profiles.find(
      (candidate) =>
        candidate.enabled &&
        candidate.id === snapshot.executionProfileId &&
        candidate.version === snapshot.executionProfileVersion &&
        candidate.image.imageDigest === snapshot.imageTemplateRef.imageDigest,
    );
    if (!profile) {
      return {
        ok: false,
        reason: "snapshot-incompatible",
        message:
          "The committed snapshot image and execution profile are not enabled exactly on this workspace provider.",
      };
    }
    if (!runtime.hostPolicyDigest) {
      return {
        ok: false,
        reason: "provider-unavailable",
        message: "Workspace execution is disabled for this deployment.",
      };
    }
    try {
      const preflight = await runtime.provider.preflight({
        profile,
        expectedHostPolicyDigest: runtime.hostPolicyDigest,
        maxEvidenceAgeMs: runtime.maxEvidenceAgeMs,
        now: this.clock(),
      });
      if (!preflight.ok) {
        return {
          ok: false,
          reason:
            preflight.reason === "SNAPSHOT_INCOMPATIBLE"
              ? "snapshot-incompatible"
              : "provider-unavailable",
          message: preflight.message.slice(0, 2_000),
        };
      }
    } catch (error) {
      return {
        ok: false,
        reason: "provider-unavailable",
        message: boundedMessage(
          error,
          "Workspace compatibility could not be verified.",
        ),
      };
    }
    return { ok: true, runtime, profile };
  }

  private async destroyDestination(
    provider: HistoricalBranchSandboxProvider,
    handle: SandboxHandle,
  ): Promise<void> {
    try {
      await provider.destroy(handle);
    } catch (error) {
      throw new HistoricalBranchError(
        "snapshot_unavailable",
        boundedMessage(
          error,
          "The failed destination workspace requires cleanup.",
        ),
      );
    }
  }
}
