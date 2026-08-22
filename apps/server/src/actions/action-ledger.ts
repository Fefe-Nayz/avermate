import type { Client, InStatement, InValue, Transaction } from "@libsql/client";
import {
  AGENT_ACTION_CONTRACT_VERSION,
  agentActionActivityFilterSchema,
  agentActionDtoSchema,
  agentActionPreviewSchema,
  type AgentActionActivityFilter,
  type AgentActionBatchCompensationResult,
  type AgentActionDto,
  type AgentActionPreview,
  type AgentActionReservation,
  type AgentActionResource,
  type AgentActionStatus,
  type AgentActionUndoState,
  type ToolActionLedgerWriter,
  type ToolError,
} from "@avermate/agent-contracts";
import { newId } from "../lib/id";
import {
  beginActionWriteTransaction,
  getPersonalTaskCommand,
  personalTaskRevision,
  PersonalTaskCommandError,
  isActionSqlBusy,
  trashPersonalTaskCommand,
  type ActionSqlClient,
} from "./personal-task-command";

export type ActionLedgerSqlClient = Pick<
  Client,
  "execute" | "batch" | "transaction"
>;
type SqlTarget = ActionLedgerSqlClient | Transaction;
type Row = Record<string, InValue>;

export class ActionLedgerError extends Error {
  constructor(
    readonly code:
      | "not-found"
      | "forbidden"
      | "conflict"
      | "invalid-state"
      | "preview-stale"
      | "dependency-pending"
      | "dependency-cycle",
    message: string,
  ) {
    super(message);
    this.name = "ActionLedgerError";
  }
}

export type ActionReservationInput = Parameters<
  ToolActionLedgerWriter["prepare"]
>[0];
export type ActionCompletionInput = Parameters<
  ToolActionLedgerWriter["complete"]
>[1];

export type InterruptedActionExecution = {
  id: string;
  userId: string;
  crashRecovery: "idempotent-retry" | "inspect-required";
};

export interface ActionLedgerHooks {
  /** Runs after an append-only evidence compensation is durable. */
  recomputeLearningMastery?: (
    userId: string,
    objectiveId: string,
  ) => Promise<void>;
}

function nowSeconds(now = new Date()): number {
  return Math.floor(now.getTime() / 1_000);
}

function iso(value: InValue): string {
  const numeric = Number(value);
  return new Date(
    numeric < 10_000_000_000 ? numeric * 1_000 : numeric,
  ).toISOString();
}

function nullableIso(value: InValue): string | null {
  return value === null ? null : iso(value);
}

function nullableString(value: InValue): string | null {
  return value === null ? null : String(value);
}

type EvidenceDecisionSnapshot = {
  state: "included" | "excluded";
  reason: string | null;
};

function evidenceDecisionSnapshot(
  value: unknown,
  label: string,
): EvidenceDecisionSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ActionLedgerError("invalid-state", `${label} is missing`);
  }
  const row = value as Record<string, unknown>;
  if (row.state !== "included" && row.state !== "excluded") {
    throw new ActionLedgerError("invalid-state", `${label} state is invalid`);
  }
  if (row.reason !== null && typeof row.reason !== "string") {
    throw new ActionLedgerError("invalid-state", `${label} reason is invalid`);
  }
  return {
    state: row.state,
    reason: typeof row.reason === "string" ? row.reason.slice(0, 1_000) : null,
  };
}

function json<T = unknown>(value: InValue): T {
  if (typeof value === "string") return JSON.parse(value) as T;
  return value as T;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const signedUrlValue =
  /(?:[?&](?:x-amz-signature|x-goog-signature|signature|sig)=|x-amz-credential=)/i;

function isForbiddenLedgerKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return /(?:accesstoken|refreshtoken|idtoken|password|secret|credential|authorization|cookie|apikey|privatekey)$/.test(
    normalized,
  );
}

function assertLedgerPayloadSafe(
  value: unknown,
  label: string,
  maxBytes = 64 * 1024,
): void {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    throw new ActionLedgerError("invalid-state", `${label} is not JSON-safe`);
  }
  if (new TextEncoder().encode(encoded).byteLength > maxBytes) {
    throw new ActionLedgerError(
      "invalid-state",
      `${label} exceeds its audit budget`,
    );
  }
  const visit = (child: unknown, depth: number): void => {
    if (depth > 32) {
      throw new ActionLedgerError(
        "invalid-state",
        `${label} is too deeply nested`,
      );
    }
    if (typeof child === "string" && signedUrlValue.test(child)) {
      throw new ActionLedgerError(
        "invalid-state",
        `${label} contains a signed URL`,
      );
    }
    if (Array.isArray(child)) {
      for (const item of child) visit(item, depth + 1);
      return;
    }
    if (!child || typeof child !== "object") return;
    for (const [key, nested] of Object.entries(child)) {
      if (isForbiddenLedgerKey(key)) {
        throw new ActionLedgerError(
          "invalid-state",
          `${label} contains forbidden credential material`,
        );
      }
      visit(nested, depth + 1);
    }
  };
  visit(value, 0);
}

export async function actionHash(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical(value)),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function execute(target: SqlTarget, statement: InStatement) {
  return target.execute(statement);
}

async function one(
  target: SqlTarget,
  sql: string,
  args: InValue[] = [],
): Promise<Row | null> {
  return (
    ((await execute(target, { sql, args })).rows[0] as Row | undefined) ?? null
  );
}

async function all(
  target: SqlTarget,
  sql: string,
  args: InValue[] = [],
): Promise<Row[]> {
  return (await execute(target, { sql, args })).rows as Row[];
}

async function appendEvent(
  target: SqlTarget,
  input: {
    actionId: string;
    eventKey: string;
    type: string;
    payload: unknown;
    now: number;
  },
): Promise<void> {
  const sequenceRow = await one(
    target,
    "SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM agent_action_events WHERE actionId = ?",
    [input.actionId],
  );
  await execute(target, {
    sql: `INSERT OR IGNORE INTO agent_action_events
          (id, actionId, sequence, eventKey, type, payloadJson, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      newId("aaevt"),
      input.actionId,
      Number(sequenceRow?.sequence ?? 1),
      input.eventKey,
      input.type,
      JSON.stringify(input.payload),
      input.now,
    ],
  });
}

function resourceFromRow(row: Row): AgentActionResource {
  return {
    actionId: String(row.actionId),
    resourceKind: String(row.resourceKind),
    resourceId: String(row.resourceId),
    operation: row.operation as AgentActionResource["operation"],
    beforeRevision: nullableString(row.beforeRevision),
    afterRevision: nullableString(row.afterRevision),
    beforeSnapshot:
      row.beforeSnapshotJson === null ? null : json(row.beforeSnapshotJson),
    afterSnapshot:
      row.afterSnapshotJson === null ? null : json(row.afterSnapshotJson),
    contentRefBefore: nullableString(row.contentRefBefore),
    contentRefAfter: nullableString(row.contentRefAfter),
  };
}

function approvalFromRow(row: Row | null) {
  return row
    ? {
        id: String(row.id),
        actionId: String(row.actionId),
        state: row.state as "pending" | "approved" | "rejected" | "expired",
        argumentsHash: String(row.argumentsHash),
        previewHash: String(row.previewHash),
        expiresAt: iso(row.expiresAt),
        resolvedAt: nullableIso(row.resolvedAt),
      }
    : null;
}

type UndoProjection = {
  state: AgentActionUndoState;
  activeCompensationActionId: string | null;
  compensationActionIds: string[];
  reason: string | null;
};

export class ActionLedgerService {
  constructor(
    private readonly client: ActionLedgerSqlClient,
    private readonly hooks: ActionLedgerHooks = {},
  ) {}

  /** Internal maintenance lookup; request handlers must use owner-bound get. */
  async getSystem(
    actionId: string,
  ): Promise<{ id: string; userId: string } | null> {
    const row = await one(
      this.client,
      "SELECT id, userId FROM agent_actions WHERE id = ? LIMIT 1",
      [actionId],
    );
    return row ? { id: String(row.id), userId: String(row.userId) } : null;
  }

  /**
   * Startup-only recovery scan. An `executing` row can only outlive its worker
   * when the process stopped between the durable claim and terminal commit.
   * Request handlers must never use this unscoped maintenance query.
   */
  async listInterruptedExecutions(
    limit = 100,
  ): Promise<InterruptedActionExecution[]> {
    const boundedLimit = Math.min(500, Math.max(1, Math.trunc(limit)));
    const rows = await all(
      this.client,
      `SELECT id, userId, crashRecovery FROM agent_actions
       WHERE status = 'executing'
       ORDER BY startedAt, actionSequence, id LIMIT ?`,
      [boundedLimit],
    );
    return rows.map((row) => ({
      id: String(row.id),
      userId: String(row.userId),
      crashRecovery:
        row.crashRecovery === "idempotent-retry"
          ? "idempotent-retry"
          : "inspect-required",
    }));
  }

  /**
   * Fail closed when an interrupted effect cannot be replayed safely. This is
   * deliberately a one-way terminal transition and records one idempotent
   * audit event so repeated startup reconciliation is harmless.
   */
  async markInterruptedInspectRequired(
    userId: string,
    actionId: string,
    reasonCode: string,
  ): Promise<boolean> {
    const now = nowSeconds();
    const safeReason = reasonCode.slice(0, 128);
    const transaction = await beginActionWriteTransaction(this.client);
    try {
      const result = await execute(transaction, {
        sql: `UPDATE agent_actions
              SET status = 'inspect-required',
                  safeError = 'Execution outcome requires inspection',
                  completedAt = ?
              WHERE id = ? AND userId = ? AND status = 'executing'`,
        args: [now, actionId, userId],
      });
      if (result.rowsAffected === 1) {
        await appendEvent(transaction, {
          actionId,
          eventKey: "terminal:inspect-required",
          type: "action.inspect-required",
          payload: { reasonCode: safeReason },
          now,
        });
      }
      await transaction.commit();
      return result.rowsAffected === 1;
    } catch (error) {
      await transaction.rollback().catch(() => undefined);
      throw error;
    }
  }

  private async validateConversationBinding(
    target: SqlTarget,
    input: Pick<
      ActionReservationInput,
      "userId" | "threadId" | "branchId" | "runId"
    >,
  ): Promise<void> {
    if (!input.threadId && !input.branchId && !input.runId) return;
    if (!input.threadId || !input.branchId) {
      throw new ActionLedgerError(
        "forbidden",
        "Thread and branch must be bound together",
      );
    }
    const branch = await one(
      target,
      `SELECT b.id FROM assistant_branches b
       JOIN assistant_threads t ON t.id = b.threadId
       WHERE b.id = ? AND b.threadId = ? AND t.userId = ? LIMIT 1`,
      [input.branchId, input.threadId, input.userId],
    );
    if (!branch) {
      throw new ActionLedgerError(
        "forbidden",
        "Conversation binding is not owned",
      );
    }
    if (input.runId) {
      const run = await one(
        target,
        `SELECT id FROM assistant_runs
         WHERE id = ? AND userId = ? AND threadId = ? AND branchId = ? LIMIT 1`,
        [input.runId, input.userId, input.threadId, input.branchId],
      );
      if (!run)
        throw new ActionLedgerError("forbidden", "Run binding is not owned");
    }
  }

  private async allocateSequence(
    target: SqlTarget,
    userId: string,
    now: number,
  ): Promise<number> {
    await execute(target, {
      sql: `INSERT OR IGNORE INTO agent_action_sequences
            (userId, nextSequence, updatedAt) VALUES (?, 0, ?)`,
      args: [userId, now],
    });
    const result = await execute(target, {
      sql: `UPDATE agent_action_sequences
            SET nextSequence = nextSequence + 1, updatedAt = ?
            WHERE userId = ? RETURNING nextSequence`,
      args: [now, userId],
    });
    return Number(result.rows[0]?.nextSequence);
  }

  private async claimReservedExecution(
    target: SqlTarget,
    input: { userId: string; actionId: string; now: number },
  ): Promise<void> {
    const predecessor = await one(
      target,
      `SELECT p.id, p.status FROM agent_action_dependencies d
       JOIN agent_actions p ON p.id = d.dependsOnActionId
       WHERE d.userId = ? AND d.actionId = ? AND p.userId = ?
         AND p.status <> 'completed'
       ORDER BY p.actionSequence, p.id LIMIT 1`,
      [input.userId, input.actionId, input.userId],
    );
    if (predecessor) {
      throw new ActionLedgerError(
        "dependency-pending",
        `Action dependency ${String(predecessor.id)} is not completed`,
      );
    }
    const claim = await execute(target, {
      sql: `UPDATE agent_actions SET status = 'executing',
            startedAt = COALESCE(startedAt, ?)
            WHERE id = ? AND userId = ? AND status = 'reserved'`,
      args: [input.now, input.actionId, input.userId],
    });
    if (claim.rowsAffected !== 1) {
      throw new ActionLedgerError(
        "dependency-pending",
        "Action execution is already claimed",
      );
    }
    await appendEvent(target, {
      actionId: input.actionId,
      eventKey: "executing",
      type: "action.executing",
      payload: {},
      now: input.now,
    });
  }

  private approvalRequired(input: ActionReservationInput): boolean {
    if (input.approval === "always") return true;
    if (input.approval === "never") return false;
    const auto =
      input.approvalMode === "auto" || input.approvalMode === "auto-reversible";
    return !(
      auto &&
      input.compensation === "guaranteed" &&
      (input.risk === "low" || input.risk === "medium")
    );
  }

  async createBatch(input: {
    userId: string;
    threadId?: string | null;
    branchId?: string | null;
    runId?: string | null;
    label?: string | null;
  }) {
    const now = nowSeconds();
    const transaction = await beginActionWriteTransaction(this.client);
    try {
      await this.validateConversationBinding(transaction, {
        userId: input.userId,
        threadId: input.threadId ?? null,
        branchId: input.branchId ?? null,
        runId: input.runId ?? null,
      });
      const sequence = Number(
        (
          await one(
            transaction,
            "SELECT nextSequence FROM agent_action_sequences WHERE userId = ?",
            [input.userId],
          )
        )?.nextSequence ?? 0,
      );
      const id = newId("aabat");
      const cursor = `domain:${input.userId}:${sequence}`;
      await execute(transaction, {
        sql: `INSERT INTO agent_action_batches
          (id, userId, threadId, branchId, runId, label, status,
           domainCursorBeforeRef, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
        args: [
          id,
          input.userId,
          input.threadId ?? null,
          input.branchId ?? null,
          input.runId ?? null,
          input.label?.slice(0, 256) ?? null,
          cursor,
          now,
        ],
      });
      await transaction.commit();
      return {
        id,
        userId: input.userId,
        threadId: input.threadId ?? null,
        branchId: input.branchId ?? null,
        runId: input.runId ?? null,
        label: input.label ?? null,
        status: "open" as const,
        domainCursorBeforeRef: cursor,
        domainCursorAfterRef: null,
        createdAt: iso(now),
        completedAt: null,
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async completeBatch(input: {
    userId: string;
    batchId: string;
    failed?: boolean;
  }) {
    const now = nowSeconds();
    const transaction = await beginActionWriteTransaction(this.client);
    try {
      const batch = await one(
        transaction,
        "SELECT * FROM agent_action_batches WHERE id = ? AND userId = ? LIMIT 1",
        [input.batchId, input.userId],
      );
      if (!batch) throw new ActionLedgerError("not-found", "Batch not found");
      if (batch.status !== "open") {
        await transaction.commit();
        return;
      }
      const pending = await one(
        transaction,
        `SELECT a.id FROM agent_actions a
         WHERE a.batchId = ? AND a.userId = ?
           AND a.status NOT IN ('completed', 'failed', 'rejected', 'expired', 'inspect-required')
         LIMIT 1`,
        [input.batchId, input.userId],
      );
      const blockedByExternalPredecessor = await one(
        transaction,
        `SELECT d.dependsOnActionId FROM agent_action_dependencies d
         JOIN agent_actions a ON a.id = d.actionId
         JOIN agent_actions p ON p.id = d.dependsOnActionId
         WHERE a.batchId = ? AND a.userId = ? AND p.batchId IS NOT a.batchId
           AND p.status NOT IN ('completed', 'failed', 'rejected', 'expired', 'inspect-required')
         LIMIT 1`,
        [input.batchId, input.userId],
      );
      if (pending || blockedByExternalPredecessor) {
        throw new ActionLedgerError(
          "invalid-state",
          "Batch has non-terminal dependencies",
        );
      }
      if (!input.failed) {
        const incompatible = await one(
          transaction,
          `SELECT a.id FROM agent_actions a
           WHERE a.batchId = ? AND a.userId = ? AND a.status <> 'completed'
           UNION ALL
           SELECT p.id FROM agent_action_dependencies d
           JOIN agent_actions a ON a.id = d.actionId
           JOIN agent_actions p ON p.id = d.dependsOnActionId
           WHERE a.batchId = ? AND a.userId = ? AND p.batchId IS NOT a.batchId
             AND p.status <> 'completed'
           LIMIT 1`,
          [input.batchId, input.userId, input.batchId, input.userId],
        );
        if (incompatible) {
          throw new ActionLedgerError(
            "invalid-state",
            "A completed batch cannot contain or depend on failed actions",
          );
        }
      }
      const cursor = Number(
        (
          await one(
            transaction,
            "SELECT nextSequence FROM agent_action_sequences WHERE userId = ?",
            [input.userId],
          )
        )?.nextSequence ?? 0,
      );
      await execute(transaction, {
        sql: `UPDATE agent_action_batches
              SET status = ?, domainCursorAfterRef = ?, completedAt = ?
              WHERE id = ? AND userId = ? AND status = 'open'`,
        args: [
          input.failed ? "failed" : "completed",
          `domain:${input.userId}:${cursor}`,
          now,
          input.batchId,
          input.userId,
        ],
      });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async reserve(
    input: ActionReservationInput,
  ): Promise<AgentActionReservation> {
    if (input.effect === "read") {
      throw new ActionLedgerError(
        "invalid-state",
        "Read calls do not reserve actions",
      );
    }
    if (input.approvalMode === "read-only") {
      throw new ActionLedgerError("forbidden", "This run is read-only");
    }
    if (!input.idempotencyKey.trim()) {
      throw new ActionLedgerError(
        "invalid-state",
        "An idempotency key is required",
      );
    }
    assertLedgerPayloadSafe(input.redactedInput, "Redacted action input");
    assertLedgerPayloadSafe(input.preview, "Action preview");
    const previewHash = await actionHash({
      toolId: input.toolId,
      toolVersion: input.toolVersion,
      argumentsHash: input.argumentsHash,
      preview: input.preview,
      userId: input.userId,
      actorKind: input.actorKind,
      actorClientId: input.actorClientId,
      threadId: input.threadId,
      branchId: input.branchId,
      runId: input.runId,
      batchId: input.batchId,
      domainScopeKind: input.domainScopeKind,
      domainScopeId: input.domainScopeId,
      effect: input.effect,
      risk: input.risk,
      approval: input.approval,
      compensation: input.compensation,
      compensatorId: input.compensatorId,
      crashRecovery: input.crashRecovery,
    });
    const now = nowSeconds();
    const transaction = await beginActionWriteTransaction(this.client);
    try {
      const existing = await one(
        transaction,
        `SELECT * FROM agent_actions
         WHERE userId = ? AND toolId = ? AND toolVersion = ? AND idempotencyKey = ?
         LIMIT 1`,
        [input.userId, input.toolId, input.toolVersion, input.idempotencyKey],
      );
      if (existing) {
        if (
          existing.argumentsHash !== input.argumentsHash ||
          existing.actorKind !== input.actorKind ||
          nullableString(existing.branchId) !== input.branchId ||
          nullableString(existing.threadId) !== input.threadId ||
          nullableString(existing.runId) !== input.runId ||
          nullableString(existing.actorClientId) !== input.actorClientId ||
          nullableString(existing.batchId) !== input.batchId ||
          nullableString(existing.domainScopeKind) !== input.domainScopeKind ||
          nullableString(existing.domainScopeId) !== input.domainScopeId ||
          existing.effect !== input.effect ||
          existing.risk !== input.risk ||
          nullableString(existing.compensatorId) !== input.compensatorId ||
          existing.crashRecovery !== input.crashRecovery
        ) {
          throw new ActionLedgerError(
            "conflict",
            "The idempotency key is bound to another action",
          );
        }
        if (existing.previewHash !== previewHash) {
          throw new ActionLedgerError(
            "preview-stale",
            "The owned resources changed after the action preview",
          );
        }
        const actionId = String(existing.id);
        const status = existing.status as AgentActionStatus;
        if (status === "completed") {
          await transaction.commit();
          return {
            state: "completed",
            actionId,
            modelProjection: json(existing.modelProjectionJson),
            uiProjection: json(existing.uiProjectionJson),
            auditProjection: json(existing.resultSummaryJson),
          };
        }
        if (status === "awaiting-approval") {
          const approval = await one(
            transaction,
            "SELECT * FROM agent_approvals WHERE actionId = ? LIMIT 1",
            [actionId],
          );
          if (!approval || approval.state !== "pending") {
            throw new ActionLedgerError(
              "invalid-state",
              "Approval projection is inconsistent",
            );
          }
          await transaction.commit();
          return {
            state: "awaiting-approval",
            actionId,
            approvalId: String(approval.id),
            previewHash: String(approval.previewHash),
            expiresAt: iso(approval.expiresAt),
          };
        }
        if (status === "reserved") {
          if (input.claimExecution) {
            await this.claimReservedExecution(transaction, {
              userId: input.userId,
              actionId,
              now,
            });
          }
          await transaction.commit();
          return { state: "ready", actionId, replayed: true };
        }
        if (
          status === "executing" &&
          existing.crashRecovery === "idempotent-retry" &&
          (!input.claimExecution || input.resumeInterrupted)
        ) {
          await transaction.commit();
          return { state: "ready", actionId, replayed: true };
        }
        if (status === "executing") {
          if (input.claimExecution && !input.resumeInterrupted) {
            throw new ActionLedgerError(
              "dependency-pending",
              "Action execution is already in progress",
            );
          }
          await execute(transaction, {
            sql: `UPDATE agent_actions SET status = 'inspect-required',
                  safeError = 'Execution outcome requires inspection', completedAt = ?
                  WHERE id = ? AND status = 'executing'`,
            args: [now, actionId],
          });
          await appendEvent(transaction, {
            actionId,
            eventKey: "terminal:inspect-required",
            type: "action.inspect-required",
            payload: { reasonCode: "crash-window-ambiguous" },
            now,
          });
          await transaction.commit();
          return {
            state: "terminal",
            actionId,
            status: "inspect-required",
            safeError: "Execution outcome requires inspection",
          };
        }
        await transaction.commit();
        return {
          state: "terminal",
          actionId,
          status: status as
            "rejected" | "expired" | "failed" | "inspect-required",
          safeError: nullableString(existing.safeError),
        };
      }

      await this.validateConversationBinding(transaction, input);
      if (input.batchId) {
        const batch = await one(
          transaction,
          `SELECT id FROM agent_action_batches
           WHERE id = ? AND userId = ? AND status = 'open' LIMIT 1`,
          [input.batchId, input.userId],
        );
        if (!batch)
          throw new ActionLedgerError("forbidden", "Batch is not open");
      }
      const sequence = await this.allocateSequence(
        transaction,
        input.userId,
        now,
      );
      const actionId = newId("aact");
      const needsApproval = this.approvalRequired(input);
      await execute(transaction, {
        sql: `INSERT INTO agent_actions
          (id, batchId, userId, actorKind, actorClientId, threadId, branchId,
           runId, toolCallId, domainScopeKind, domainScopeId, toolId, toolVersion,
           effect, risk, argumentsHash, idempotencyKey, actionSequence,
           redactedInputJson, previewJson, previewHash, status, compensatorId,
           crashRecovery, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          actionId,
          input.batchId,
          input.userId,
          input.actorKind,
          input.actorClientId,
          input.threadId,
          input.branchId,
          input.runId,
          input.toolCallId,
          input.domainScopeKind,
          input.domainScopeId,
          input.toolId,
          input.toolVersion,
          input.effect,
          input.risk,
          input.argumentsHash,
          input.idempotencyKey,
          sequence,
          JSON.stringify(input.redactedInput),
          JSON.stringify(input.preview),
          previewHash,
          needsApproval ? "awaiting-approval" : "reserved",
          input.compensatorId,
          input.crashRecovery,
          now,
        ],
      });
      await appendEvent(transaction, {
        actionId,
        eventKey: "reserved",
        type: "action.reserved",
        payload: { sequence, previewHash },
        now,
      });
      if (needsApproval) {
        const approvalId = newId("aappr");
        const expiresAt = now + 10 * 60;
        await execute(transaction, {
          sql: `INSERT INTO agent_approvals
            (id, actionId, userId, state, argumentsHash, previewHash,
             expiresAt, createdAt)
            VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)`,
          args: [
            approvalId,
            actionId,
            input.userId,
            input.argumentsHash,
            previewHash,
            expiresAt,
            now,
          ],
        });
        await appendEvent(transaction, {
          actionId,
          eventKey: "approval:requested",
          type: "action.approval-requested",
          payload: { approvalId, previewHash, expiresAt },
          now,
        });
        await transaction.commit();
        return {
          state: "awaiting-approval",
          actionId,
          approvalId,
          previewHash,
          expiresAt: iso(expiresAt),
        };
      }
      if (input.claimExecution) {
        await this.claimReservedExecution(transaction, {
          userId: input.userId,
          actionId,
          now,
        });
      }
      await transaction.commit();
      return { state: "ready", actionId, replayed: false };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async resolveApproval(input: {
    userId: string;
    actionId: string;
    approvalId: string;
    previewHash: string;
    decision: "approve" | "reject";
    resolutionContext?: unknown;
    now?: Date;
  }): Promise<AgentActionDto> {
    assertLedgerPayloadSafe(
      input.resolutionContext ?? {},
      "Approval resolution context",
      16 * 1024,
    );
    const now = nowSeconds(input.now);
    const transaction = await beginActionWriteTransaction(this.client);
    let committed = false;
    try {
      const row = await one(
        transaction,
        `SELECT a.status AS actionStatus, p.* FROM agent_approvals p
         JOIN agent_actions a ON a.id = p.actionId AND a.userId = p.userId
         WHERE p.id = ? AND p.actionId = ? AND p.userId = ? LIMIT 1`,
        [input.approvalId, input.actionId, input.userId],
      );
      if (!row) throw new ActionLedgerError("not-found", "Approval not found");
      if (row.previewHash !== input.previewHash) {
        throw new ActionLedgerError(
          "preview-stale",
          "Approval preview changed",
        );
      }
      if (row.state !== "pending" || row.actionStatus !== "awaiting-approval") {
        await transaction.commit();
        committed = true;
      } else {
        const expired = Number(row.expiresAt) <= now;
        const nextApproval = expired
          ? "expired"
          : input.decision === "approve"
            ? "approved"
            : "rejected";
        const nextAction =
          nextApproval === "approved" ? "reserved" : nextApproval;
        await execute(transaction, {
          sql: `UPDATE agent_approvals
                SET state = ?, resolvedAt = ?, resolutionContextJson = ?,
                    leaseOwner = NULL, leaseExpiresAt = NULL
                WHERE id = ? AND state = 'pending'`,
          args: [
            nextApproval,
            now,
            JSON.stringify(input.resolutionContext ?? {}),
            input.approvalId,
          ],
        });
        await execute(transaction, {
          sql: `UPDATE agent_actions SET status = ?, completedAt = ?
                WHERE id = ? AND userId = ? AND status = 'awaiting-approval'`,
          args: [
            nextAction,
            nextAction === "reserved" ? null : now,
            input.actionId,
            input.userId,
          ],
        });
        await appendEvent(transaction, {
          actionId: input.actionId,
          eventKey: `approval:${nextApproval}`,
          type: `action.approval-${nextApproval}`,
          payload: {
            approvalId: input.approvalId,
            previewHash: input.previewHash,
          },
          now,
        });
        await transaction.commit();
        committed = true;
      }
    } catch (error) {
      if (!committed) await transaction.rollback().catch(() => undefined);
      throw error;
    }
    return this.get(input.userId, input.actionId);
  }

  async expireApprovals(input: {
    workerId: string;
    limit?: number;
    leaseMs?: number;
    now?: Date;
    retryAttempt?: number;
  }): Promise<string[]> {
    const now = nowSeconds(input.now);
    const leaseUntil = now + Math.ceil((input.leaseMs ?? 30_000) / 1_000);
    const limit = Math.min(100, Math.max(1, input.limit ?? 50));
    const transaction = await beginActionWriteTransaction(this.client);
    try {
      const due = await all(
        transaction,
        `SELECT id, actionId FROM agent_approvals
         WHERE state = 'pending' AND expiresAt <= ?
           AND (leaseExpiresAt IS NULL OR leaseExpiresAt < ?)
         ORDER BY expiresAt, id LIMIT ?`,
        [now, now, limit],
      );
      const expired: string[] = [];
      for (const row of due) {
        const claim = await execute(transaction, {
          sql: `UPDATE agent_approvals SET leaseOwner = ?, leaseExpiresAt = ?
                WHERE id = ? AND state = 'pending'
                  AND (leaseExpiresAt IS NULL OR leaseExpiresAt < ?)`,
          args: [input.workerId, leaseUntil, row.id, now],
        });
        if (claim.rowsAffected !== 1) continue;
        await execute(transaction, {
          sql: `UPDATE agent_approvals SET state = 'expired', resolvedAt = ?,
                leaseOwner = NULL, leaseExpiresAt = NULL
                WHERE id = ? AND state = 'pending' AND leaseOwner = ?`,
          args: [now, row.id, input.workerId],
        });
        await execute(transaction, {
          sql: `UPDATE agent_actions SET status = 'expired', completedAt = ?
                WHERE id = ? AND status = 'awaiting-approval'`,
          args: [now, row.actionId],
        });
        await appendEvent(transaction, {
          actionId: String(row.actionId),
          eventKey: "approval:expired",
          type: "action.approval-expired",
          payload: { approvalId: String(row.id) },
          now,
        });
        expired.push(String(row.actionId));
      }
      await transaction.commit();
      return expired;
    } catch (error) {
      await transaction.rollback().catch(() => undefined);
      if (isActionSqlBusy(error) && (input.retryAttempt ?? 0) < 10) {
        await new Promise<void>((resolve) =>
          setTimeout(resolve, 5 + (input.retryAttempt ?? 0) * 5),
        );
        return this.expireApprovals({
          ...input,
          retryAttempt: (input.retryAttempt ?? 0) + 1,
        });
      }
      throw error;
    }
  }

  async markExecuting(userId: string, actionId: string): Promise<void> {
    const now = nowSeconds();
    const transaction = await beginActionWriteTransaction(this.client);
    try {
      const action = await one(
        transaction,
        "SELECT status FROM agent_actions WHERE id = ? AND userId = ? LIMIT 1",
        [actionId, userId],
      );
      if (!action) throw new ActionLedgerError("not-found", "Action not found");
      if (!["reserved", "executing"].includes(String(action.status))) {
        throw new ActionLedgerError("invalid-state", "Action cannot start");
      }
      if (action.status === "executing") {
        await transaction.commit();
        return;
      }
      await this.claimReservedExecution(transaction, {
        userId,
        actionId,
        now,
      });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback().catch(() => undefined);
      throw error;
    }
  }

  async complete(
    userId: string,
    actionId: string,
    input: ActionCompletionInput,
  ): Promise<void> {
    assertLedgerPayloadSafe(
      input.modelProjection,
      "Model projection",
      256 * 1024,
    );
    assertLedgerPayloadSafe(input.uiProjection, "UI projection", 512 * 1024);
    assertLedgerPayloadSafe(
      input.auditProjection,
      "Audit projection",
      64 * 1024,
    );
    for (const resource of input.resources) {
      if (resource.beforeSnapshot !== undefined) {
        assertLedgerPayloadSafe(
          resource.beforeSnapshot,
          "Before snapshot",
          16 * 1024,
        );
      }
      if (resource.afterSnapshot !== undefined) {
        assertLedgerPayloadSafe(
          resource.afterSnapshot,
          "After snapshot",
          16 * 1024,
        );
      }
      if (
        resource.contentRefBefore &&
        signedUrlValue.test(resource.contentRefBefore)
      ) {
        throw new ActionLedgerError(
          "invalid-state",
          "Before content ref is signed",
        );
      }
      if (
        resource.contentRefAfter &&
        signedUrlValue.test(resource.contentRefAfter)
      ) {
        throw new ActionLedgerError(
          "invalid-state",
          "After content ref is signed",
        );
      }
    }
    const now = nowSeconds();
    const transaction = await beginActionWriteTransaction(this.client);
    try {
      const action = await one(
        transaction,
        "SELECT * FROM agent_actions WHERE id = ? AND userId = ? LIMIT 1",
        [actionId, userId],
      );
      if (!action) throw new ActionLedgerError("not-found", "Action not found");
      if (action.status === "completed") {
        const existingResources = (
          await all(
            transaction,
            `SELECT * FROM agent_action_resources WHERE actionId = ?
             ORDER BY resourceKind, resourceId, operation`,
            [actionId],
          )
        ).map((row) => {
          const resource = resourceFromRow(row);
          const { actionId: _actionId, ...value } = resource;
          return value;
        });
        const submittedResources = input.resources
          .map((resource) => ({
            resourceKind: resource.resourceKind,
            resourceId: resource.resourceId,
            operation: resource.operation,
            beforeRevision: resource.beforeRevision,
            afterRevision: resource.afterRevision,
            beforeSnapshot: resource.beforeSnapshot ?? null,
            afterSnapshot: resource.afterSnapshot ?? null,
            contentRefBefore: resource.contentRefBefore ?? null,
            contentRefAfter: resource.contentRefAfter ?? null,
          }))
          .sort((left, right) =>
            `${left.resourceKind}\0${left.resourceId}\0${left.operation}`.localeCompare(
              `${right.resourceKind}\0${right.resourceId}\0${right.operation}`,
            ),
          );
        const same =
          canonical(json(action.modelProjectionJson)) ===
            canonical(input.modelProjection) &&
          canonical(json(action.uiProjectionJson)) ===
            canonical(input.uiProjection) &&
          canonical(json(action.resultSummaryJson)) ===
            canonical(input.auditProjection) &&
          canonical(existingResources) === canonical(submittedResources);
        if (!same) {
          throw new ActionLedgerError(
            "conflict",
            "Divergent action completion",
          );
        }
        await transaction.commit();
        return;
      }
      if (action.status !== "executing") {
        throw new ActionLedgerError("invalid-state", "Action is not executing");
      }
      if (action.compensatorId && input.resources.length === 0) {
        throw new ActionLedgerError(
          "invalid-state",
          "A compensatable action must record at least one resource fence",
        );
      }
      const resourceKeys = new Set<string>();
      for (const resource of input.resources) {
        const resourceKey = `${resource.resourceKind}\0${resource.resourceId}\0${resource.operation}`;
        if (resourceKeys.has(resourceKey)) {
          throw new ActionLedgerError(
            "invalid-state",
            "Duplicate action resource",
          );
        }
        resourceKeys.add(resourceKey);
        if (
          resource.operation !== "external" &&
          !resource.beforeRevision &&
          !resource.afterRevision
        ) {
          throw new ActionLedgerError(
            "invalid-state",
            "A mutation resource must carry a revision fence",
          );
        }
        await execute(transaction, {
          sql: `INSERT INTO agent_action_resources
            (actionId, resourceKind, resourceId, operation, beforeRevision,
             afterRevision, beforeSnapshotJson, afterSnapshotJson,
             contentRefBefore, contentRefAfter)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            actionId,
            resource.resourceKind,
            resource.resourceId,
            resource.operation,
            resource.beforeRevision,
            resource.afterRevision,
            resource.beforeSnapshot === undefined
              ? null
              : JSON.stringify(resource.beforeSnapshot),
            resource.afterSnapshot === undefined
              ? null
              : JSON.stringify(resource.afterSnapshot),
            resource.contentRefBefore ?? null,
            resource.contentRefAfter ?? null,
          ],
        });
      }
      await execute(transaction, {
        sql: `UPDATE agent_actions SET status = 'completed',
              modelProjectionJson = ?, uiProjectionJson = ?, resultSummaryJson = ?,
              safeError = NULL, completedAt = ?
              WHERE id = ? AND userId = ? AND status = 'executing'`,
        args: [
          JSON.stringify(input.modelProjection),
          JSON.stringify(input.uiProjection),
          JSON.stringify(input.auditProjection),
          now,
          actionId,
          userId,
        ],
      });
      await appendEvent(transaction, {
        actionId,
        eventKey: "terminal:completed",
        type: "action.completed",
        payload: {
          resources: input.resources.map((resource) => ({
            kind: resource.resourceKind,
            id: resource.resourceId,
            operation: resource.operation,
            afterRevision: resource.afterRevision,
          })),
        },
        now,
      });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async fail(
    userId: string,
    actionId: string,
    error: ToolError,
    effectMayHaveOccurred: boolean,
  ): Promise<void> {
    if (error.code === "OPERATION_PENDING") return;
    const now = nowSeconds();
    const staleApproval =
      !effectMayHaveOccurred && error.code === "PREVIEW_STALE";
    const status = effectMayHaveOccurred
      ? "inspect-required"
      : staleApproval
        ? "expired"
        : "failed";
    const safeError = `${error.code}:${error.message}`.slice(0, 1_000);
    const transaction = await beginActionWriteTransaction(this.client);
    try {
      const result = await execute(transaction, {
        sql: `UPDATE agent_actions SET status = ?, safeError = ?, completedAt = ?
              WHERE id = ? AND userId = ? AND status IN ('reserved', 'executing')`,
        args: [status, safeError, now, actionId, userId],
      });
      if (result.rowsAffected === 1) {
        if (staleApproval) {
          await execute(transaction, {
            sql: `UPDATE agent_approvals SET state = 'expired', resolvedAt = ?
                  WHERE actionId = ? AND userId = ? AND state = 'approved'`,
            args: [now, actionId, userId],
          });
        }
        await appendEvent(transaction, {
          actionId,
          eventKey: `terminal:${status}`,
          type: `action.${status}`,
          payload: { code: error.code },
          now,
        });
      }
      await transaction.commit();
    } catch (failureError) {
      await transaction.rollback().catch(() => undefined);
      throw failureError;
    }
  }

  async addDependency(input: {
    userId: string;
    actionId: string;
    dependsOnActionId: string;
    scopeKind: "branch" | "domain";
    scopeId: string;
    relation: "resource" | "explicit" | "saga";
    expectedFenceVersion?: number;
  }): Promise<number> {
    if (input.actionId === input.dependsOnActionId) {
      throw new ActionLedgerError(
        "dependency-cycle",
        "An action cannot depend on itself",
      );
    }
    const now = nowSeconds();
    const transaction = await beginActionWriteTransaction(this.client);
    try {
      await execute(transaction, {
        sql: `INSERT OR IGNORE INTO agent_action_dependency_fences
              (userId, version, updatedAt) VALUES (?, 0, ?)`,
        args: [input.userId, now],
      });
      const fence = await one(
        transaction,
        "SELECT version FROM agent_action_dependency_fences WHERE userId = ?",
        [input.userId],
      );
      const currentVersion = Number(fence?.version ?? 0);
      if (
        input.expectedFenceVersion !== undefined &&
        input.expectedFenceVersion !== currentVersion
      ) {
        throw new ActionLedgerError("conflict", "Dependency fence is stale");
      }
      const rows = await all(
        transaction,
        "SELECT * FROM agent_actions WHERE userId = ? AND id IN (?, ?)",
        [input.userId, input.actionId, input.dependsOnActionId],
      );
      if (rows.length !== 2) {
        throw new ActionLedgerError(
          "forbidden",
          "Dependency action is not owned",
        );
      }
      const action = rows.find((row) => row.id === input.actionId)!;
      const dependency = rows.find(
        (row) => row.id === input.dependsOnActionId,
      )!;
      if (!["reserved", "awaiting-approval"].includes(String(action.status))) {
        throw new ActionLedgerError(
          "invalid-state",
          "Dependencies freeze before execution",
        );
      }
      if (input.scopeKind === "branch") {
        if (
          action.branchId !== input.scopeId ||
          dependency.branchId !== input.scopeId
        ) {
          throw new ActionLedgerError(
            "forbidden",
            "Branch dependency scope mismatch",
          );
        }
      } else if (
        !action.domainScopeKind ||
        action.domainScopeKind !== dependency.domainScopeKind ||
        action.domainScopeId !== dependency.domainScopeId ||
        `${action.domainScopeKind}:${action.domainScopeId}` !== input.scopeId
      ) {
        throw new ActionLedgerError(
          "forbidden",
          "Domain dependency scope mismatch",
        );
      }
      const existingEdge = await one(
        transaction,
        `SELECT fenceVersion FROM agent_action_dependencies
         WHERE userId = ? AND actionId = ? AND dependsOnActionId = ?
           AND scopeKind = ? AND scopeId = ? LIMIT 1`,
        [
          input.userId,
          input.actionId,
          input.dependsOnActionId,
          input.scopeKind,
          input.scopeId,
        ],
      );
      if (existingEdge) {
        await transaction.commit();
        return currentVersion;
      }
      const cycle = await one(
        transaction,
        `WITH RECURSIVE reachable(id) AS (
           SELECT dependsOnActionId FROM agent_action_dependencies
            WHERE userId = ? AND actionId = ?
           UNION
           SELECT d.dependsOnActionId FROM agent_action_dependencies d
            JOIN reachable r ON d.actionId = r.id
            WHERE d.userId = ?
         ) SELECT id FROM reachable WHERE id = ? LIMIT 1`,
        [input.userId, input.dependsOnActionId, input.userId, input.actionId],
      );
      if (cycle) {
        throw new ActionLedgerError(
          "dependency-cycle",
          "Dependency would create a cycle",
        );
      }
      const nextVersion = currentVersion + 1;
      const fenceUpdate = await execute(transaction, {
        sql: `UPDATE agent_action_dependency_fences SET version = ?, updatedAt = ?
              WHERE userId = ? AND version = ?`,
        args: [nextVersion, now, input.userId, currentVersion],
      });
      if (fenceUpdate.rowsAffected !== 1) {
        throw new ActionLedgerError("conflict", "Dependency fence changed");
      }
      await execute(transaction, {
        sql: `INSERT OR IGNORE INTO agent_action_dependencies
          (userId, actionId, dependsOnActionId, scopeKind, scopeId, relation,
           fenceVersion, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          input.userId,
          input.actionId,
          input.dependsOnActionId,
          input.scopeKind,
          input.scopeId,
          input.relation,
          nextVersion,
          now,
        ],
      });
      await transaction.commit();
      return nextVersion;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  private async deriveUndo(
    userId: string,
    action: Row,
    resources: AgentActionResource[],
  ): Promise<UndoProjection> {
    const compensationRows = await all(
      this.client,
      `SELECT id, status, safeError FROM agent_actions
       WHERE userId = ? AND compensationOfActionId = ?
       ORDER BY actionSequence, id`,
      [userId, action.id],
    );
    const compensationIds = compensationRows.map((row) => String(row.id));
    const active = compensationRows.find((row) =>
      ["reserved", "awaiting-approval", "executing"].includes(
        String(row.status),
      ),
    );
    const completed = compensationRows.filter(
      (row) => row.status === "completed",
    );
    if (completed.length > 0) {
      const placeholders = completed.map(() => "?").join(", ");
      const compensatedResources = await all(
        this.client,
        `SELECT resourceKind, resourceId FROM agent_action_resources
         WHERE actionId IN (${placeholders})`,
        completed.map((row) => row.id),
      );
      const covered = new Set(
        compensatedResources.map(
          (resource) => `${resource.resourceKind}:${resource.resourceId}`,
        ),
      );
      const fullyCompensated = resources.every((resource) =>
        covered.has(`${resource.resourceKind}:${resource.resourceId}`),
      );
      return {
        state: fullyCompensated ? "compensated" : "partially-compensated",
        activeCompensationActionId: null,
        compensationActionIds: compensationIds,
        reason: fullyCompensated ? null : "compensation-incomplete",
      };
    }
    if (active) {
      return {
        state:
          active.status === "awaiting-approval"
            ? "approval-pending"
            : "in-progress",
        activeCompensationActionId: String(active.id),
        compensationActionIds: compensationIds,
        reason: null,
      };
    }
    const inspectRequired = compensationRows.find(
      (row) => row.status === "inspect-required",
    );
    if (inspectRequired) {
      return {
        state: "failed",
        activeCompensationActionId: null,
        compensationActionIds: compensationIds,
        reason: "compensation-inspect-required",
      };
    }
    const failed = compensationRows.find((row) => row.status === "failed");
    const acceptedConflict = await one(
      this.client,
      `SELECT id FROM agent_action_events
       WHERE actionId = ? AND type = 'undo.conflict.resolved.keep-current'
       ORDER BY sequence DESC LIMIT 1`,
      [action.id],
    );
    if (acceptedConflict) {
      return {
        state: "blocked",
        activeCompensationActionId: null,
        compensationActionIds: compensationIds,
        reason: "conflict-kept-current",
      };
    }
    const failedWithConflict = compensationRows.find(
      (row) =>
        row.status === "failed" &&
        String(row.safeError ?? "").startsWith("STALE_REVISION:"),
    );
    if (failedWithConflict) {
      return {
        state: "conflicted",
        activeCompensationActionId: null,
        compensationActionIds: compensationIds,
        reason: "resource-revision-changed",
      };
    }
    if (action.status !== "completed") {
      return {
        state: "ineligible",
        activeCompensationActionId: null,
        compensationActionIds: compensationIds,
        reason: "source-not-completed",
      };
    }
    if (!action.compensatorId) {
      return {
        state: "not-applicable",
        activeCompensationActionId: null,
        compensationActionIds: compensationIds,
        reason: "no-reviewed-compensator",
      };
    }
    if (resources.length === 0) {
      return {
        state: "ineligible",
        activeCompensationActionId: null,
        compensationActionIds: compensationIds,
        reason: "missing-resource-fence",
      };
    }
    for (const resource of resources) {
      if (action.compensatorId === "learning.evidence.restore-decision@1") {
        if (
          resource.resourceKind !== "learning-evidence" ||
          resource.operation !== "update" ||
          !resource.afterRevision
        ) {
          return {
            state: "ineligible",
            activeCompensationActionId: null,
            compensationActionIds: compensationIds,
            reason: "unsupported-resource-kind",
          };
        }
        const current = await one(
          this.client,
          `SELECT d.id
           FROM learning_evidence_decisions d
           JOIN learning_evidence e ON e.id = d.evidenceId
           WHERE d.evidenceId = ? AND d.userId = ? AND e.userId = ?
           ORDER BY d.createdAt DESC, d.id DESC LIMIT 1`,
          [resource.resourceId, userId, userId],
        );
        if (!current || String(current.id) !== resource.afterRevision) {
          return {
            state: "conflicted",
            activeCompensationActionId: null,
            compensationActionIds: compensationIds,
            reason: current ? "resource-revision-changed" : "resource-missing",
          };
        }
        continue;
      }
      if (
        action.compensatorId !== "planning.tasks.trash-created@1" ||
        resource.resourceKind !== "planning-task"
      ) {
        return {
          state: "ineligible",
          activeCompensationActionId: null,
          compensationActionIds: compensationIds,
          reason: "unsupported-resource-kind",
        };
      }
      try {
        const current = await getPersonalTaskCommand(
          this.client as ActionSqlClient,
          { userId, taskId: resource.resourceId, includeTrashed: true },
        );
        if (
          current.trashedAt !== null ||
          personalTaskRevision(current) !== resource.afterRevision
        ) {
          return {
            state: "conflicted",
            activeCompensationActionId: null,
            compensationActionIds: compensationIds,
            reason: "resource-revision-changed",
          };
        }
      } catch (error) {
        if (error instanceof PersonalTaskCommandError) {
          return {
            state: "conflicted",
            activeCompensationActionId: null,
            compensationActionIds: compensationIds,
            reason: "resource-missing",
          };
        }
        throw error;
      }
    }
    return {
      state: failed ? "failed" : "eligible",
      activeCompensationActionId: null,
      compensationActionIds: compensationIds,
      reason: failed ? "compensation-failed" : null,
    };
  }

  async get(userId: string, actionId: string): Promise<AgentActionDto> {
    const row = await one(
      this.client,
      "SELECT * FROM agent_actions WHERE id = ? AND userId = ? LIMIT 1",
      [actionId, userId],
    );
    if (!row) throw new ActionLedgerError("not-found", "Action not found");
    const [resourceRows, approvalRow] = await Promise.all([
      all(
        this.client,
        `SELECT * FROM agent_action_resources WHERE actionId = ?
         ORDER BY resourceKind, resourceId, operation`,
        [actionId],
      ),
      one(
        this.client,
        "SELECT * FROM agent_approvals WHERE actionId = ? LIMIT 1",
        [actionId],
      ),
    ]);
    const resources = resourceRows.map(resourceFromRow);
    const undo = await this.deriveUndo(userId, row, resources);
    return agentActionDtoSchema.parse({
      contractVersion: AGENT_ACTION_CONTRACT_VERSION,
      id: String(row.id),
      batchId: nullableString(row.batchId),
      userId: String(row.userId),
      actorKind: row.actorKind,
      actorClientId: nullableString(row.actorClientId),
      threadId: nullableString(row.threadId),
      branchId: nullableString(row.branchId),
      runId: nullableString(row.runId),
      toolCallId: nullableString(row.toolCallId),
      domainScopeKind: nullableString(row.domainScopeKind),
      domainScopeId: nullableString(row.domainScopeId),
      toolId: String(row.toolId),
      toolVersion: Number(row.toolVersion),
      effect: row.effect,
      risk: row.risk,
      argumentsHash: String(row.argumentsHash),
      idempotencyKey: String(row.idempotencyKey),
      actionSequence: Number(row.actionSequence),
      redactedInput: json(row.redactedInputJson),
      preview: row.previewJson === null ? null : json(row.previewJson),
      previewHash: String(row.previewHash),
      status: row.status,
      resultSummary:
        row.resultSummaryJson === null ? null : json(row.resultSummaryJson),
      safeError: nullableString(row.safeError),
      compensatorId: nullableString(row.compensatorId),
      compensationOfActionId: nullableString(row.compensationOfActionId),
      startedAt: nullableIso(row.startedAt),
      completedAt: nullableIso(row.completedAt),
      createdAt: iso(row.createdAt),
      resources,
      approval: approvalFromRow(approvalRow),
      undoState: undo.state,
      activeCompensationActionId: undo.activeCompensationActionId,
      compensationActionIds: undo.compensationActionIds,
      undoReasonCode: undo.reason,
    });
  }

  async resolveConflict(input: {
    userId: string;
    actionId: string;
    resolution: "keep-current";
  }): Promise<AgentActionDto> {
    const current = await this.get(input.userId, input.actionId);
    if (
      current.undoState === "blocked" &&
      current.undoReasonCode === "conflict-kept-current"
    ) {
      return current;
    }
    if (current.undoState !== "conflicted") {
      throw new ActionLedgerError(
        "invalid-state",
        "Only an unresolved undo conflict can be resolved",
      );
    }
    const transaction = await beginActionWriteTransaction(this.client);
    try {
      const owned = await one(
        transaction,
        "SELECT id FROM agent_actions WHERE id = ? AND userId = ? LIMIT 1",
        [input.actionId, input.userId],
      );
      if (!owned) {
        throw new ActionLedgerError("not-found", "Action not found");
      }
      const completedOrActive = await one(
        transaction,
        `SELECT id FROM agent_actions
         WHERE userId = ? AND compensationOfActionId = ?
           AND status IN ('reserved', 'awaiting-approval', 'executing', 'completed')
         LIMIT 1`,
        [input.userId, input.actionId],
      );
      if (completedOrActive) {
        throw new ActionLedgerError(
          "conflict",
          "Undo state changed while the conflict was being resolved",
        );
      }
      await appendEvent(transaction, {
        actionId: input.actionId,
        eventKey: "undo-conflict-resolution:keep-current",
        type: "undo.conflict.resolved.keep-current",
        payload: {
          resolution: input.resolution,
          consequence:
            "The current resource revision is kept and the earlier undo request remains unapplied.",
        },
        now: nowSeconds(),
      });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    return this.get(input.userId, input.actionId);
  }

  async list(
    userId: string,
    rawFilter: AgentActionActivityFilter,
  ): Promise<{ items: AgentActionDto[]; nextCursor: number | null }> {
    const filter = agentActionActivityFilterSchema.parse(rawFilter);
    const clauses = ["a.userId = ?"];
    const args: InValue[] = [userId];
    if (filter.from) {
      clauses.push("a.createdAt >= ?");
      args.push(nowSeconds(new Date(filter.from)));
    }
    if (filter.to) {
      clauses.push("a.createdAt <= ?");
      args.push(nowSeconds(new Date(filter.to)));
    }
    for (const [column, value] of [
      ["a.toolId", filter.toolId],
      ["a.threadId", filter.threadId],
      ["a.branchId", filter.branchId],
      ["a.actorKind", filter.actorKind],
      ["a.status", filter.status],
    ] as const) {
      if (value) {
        clauses.push(`${column} = ?`);
        args.push(value);
      }
    }
    if (filter.resourceKind || filter.resourceId) {
      clauses.push(`EXISTS (SELECT 1 FROM agent_action_resources ar
        WHERE ar.actionId = a.id
          ${filter.resourceKind ? "AND ar.resourceKind = ?" : ""}
          ${filter.resourceId ? "AND ar.resourceId = ?" : ""})`);
      if (filter.resourceKind) args.push(filter.resourceKind);
      if (filter.resourceId) args.push(filter.resourceId);
    }
    const items: AgentActionDto[] = [];
    let scanCursor = filter.cursor ?? null;
    let exhausted = false;
    const chunkSize = filter.undoState
      ? Math.max(50, Math.min(250, filter.limit * 4))
      : filter.limit + 1;
    while (!exhausted && items.length <= filter.limit) {
      const pageClauses = [...clauses];
      const pageArgs = [...args];
      if (scanCursor !== null) {
        pageClauses.push("a.actionSequence < ?");
        pageArgs.push(scanCursor);
      }
      pageArgs.push(chunkSize);
      const rows = await all(
        this.client,
        `SELECT a.id, a.actionSequence FROM agent_actions a
         WHERE ${pageClauses.join(" AND ")}
         ORDER BY a.actionSequence DESC, a.id DESC LIMIT ?`,
        pageArgs,
      );
      exhausted = rows.length < chunkSize;
      if (rows.length === 0) break;
      scanCursor = Number(rows.at(-1)!.actionSequence);
      for (const row of rows) {
        const dto = await this.get(userId, String(row.id));
        if (!filter.undoState || dto.undoState === filter.undoState) {
          items.push(dto);
          if (items.length > filter.limit) break;
        }
      }
    }
    const hasMore = items.length > filter.limit;
    const selected = items.slice(0, filter.limit);
    return {
      items: selected,
      nextCursor:
        hasMore && selected.length > 0 ? selected.at(-1)!.actionSequence : null,
    };
  }

  async reviewBranchSince(input: {
    userId: string;
    branchId: string;
    domainCursorRef: string;
  }): Promise<{
    safeToCompensate: AgentActionDto[];
    conflicted: AgentActionDto[];
    alreadyCompensated: AgentActionDto[];
    nonUndoable: AgentActionDto[];
    unrelatedActionCount: number;
    undoPreview: AgentActionPreview | null;
    truncated: boolean;
  }> {
    const prefix = `domain:${input.userId}:`;
    if (!input.domainCursorRef.startsWith(prefix)) {
      throw new ActionLedgerError(
        "forbidden",
        "Domain cursor is not owned by this account",
      );
    }
    const rawSequence = input.domainCursorRef.slice(prefix.length);
    if (!/^\d+$/u.test(rawSequence)) {
      throw new ActionLedgerError("invalid-state", "Domain cursor is invalid");
    }
    const sequence = Number(rawSequence);
    if (!Number.isSafeInteger(sequence) || sequence < 0) {
      throw new ActionLedgerError("invalid-state", "Domain cursor is invalid");
    }
    const rows = await all(
      this.client,
      `SELECT id, branchId, actionSequence FROM agent_actions
       WHERE userId = ? AND actionSequence > ?
         AND compensationOfActionId IS NULL
       ORDER BY actionSequence, id LIMIT 501`,
      [input.userId, sequence],
    );
    const truncated = rows.length > 500;
    const window = rows.slice(0, 500);
    const attributableRows = window.filter(
      (row) => row.branchId !== null && String(row.branchId) === input.branchId,
    );
    const attributableIds = new Set(
      attributableRows.map((row) => String(row.id)),
    );
    const unrelated = await one(
      this.client,
      `SELECT COUNT(*) AS count FROM agent_actions
       WHERE userId = ? AND actionSequence > ?
         AND compensationOfActionId IS NULL
         AND (branchId IS NULL OR branchId <> ?)`,
      [input.userId, sequence, input.branchId],
    );
    const actions = await Promise.all(
      attributableRows.map((row) => this.get(input.userId, String(row.id))),
    );
    const alreadyCompensated = actions.filter((action) =>
      ["compensated", "partially-compensated"].includes(action.undoState),
    );
    const directlyConflicted = new Set(
      actions
        .filter((action) => action.undoState === "conflicted")
        .map((action) => action.id),
    );
    const candidates = actions.filter(
      (action) =>
        action.undoState === "eligible" ||
        (action.undoState === "failed" &&
          action.undoReasonCode === "compensation-failed"),
    );
    const safeIds = new Set<string>();
    for (const candidate of candidates) {
      const preview = await this.previewUndo(input.userId, [candidate.id]);
      const remainsAttributable = preview.actionIds.every((id) =>
        attributableIds.has(id),
      );
      const fullyEligible =
        preview.eligible.length === preview.actionIds.length &&
        preview.conflicted.length === 0 &&
        preview.nonUndoable.length === 0 &&
        preview.blocked.length === 0;
      if (remainsAttributable && fullyEligible) {
        for (const id of preview.eligible) safeIds.add(id);
      } else {
        for (const id of preview.conflicted) {
          if (attributableIds.has(id)) directlyConflicted.add(id);
        }
      }
    }
    let undoPreview: AgentActionPreview | null = null;
    if (safeIds.size > 0) {
      const preview = await this.previewUndo(input.userId, [...safeIds]);
      const safe =
        preview.actionIds.every((id) => attributableIds.has(id)) &&
        preview.eligible.length === preview.actionIds.length &&
        preview.conflicted.length === 0 &&
        preview.nonUndoable.length === 0 &&
        preview.blocked.length === 0;
      if (safe) {
        undoPreview = preview;
      } else {
        safeIds.clear();
      }
    }
    const safeToCompensate = actions.filter((action) =>
      safeIds.has(action.id),
    );
    const conflicted = actions.filter((action) =>
      directlyConflicted.has(action.id),
    );
    const grouped = new Set([
      ...safeToCompensate.map((action) => action.id),
      ...conflicted.map((action) => action.id),
      ...alreadyCompensated.map((action) => action.id),
    ]);
    const nonUndoable = actions.filter((action) => !grouped.has(action.id));
    return {
      safeToCompensate,
      conflicted,
      alreadyCompensated,
      nonUndoable,
      unrelatedActionCount: Number(unrelated?.count ?? 0),
      undoPreview,
      truncated,
    };
  }

  async dependencyFenceVersion(userId: string): Promise<number> {
    return Number(
      (
        await one(
          this.client,
          "SELECT version FROM agent_action_dependency_fences WHERE userId = ?",
          [userId],
        )
      )?.version ?? 0,
    );
  }

  async listEvents(input: {
    userId: string;
    actionId: string;
    afterSequence?: number;
    limit?: number;
  }) {
    const action = await one(
      this.client,
      "SELECT id FROM agent_actions WHERE id = ? AND userId = ? LIMIT 1",
      [input.actionId, input.userId],
    );
    if (!action) throw new ActionLedgerError("not-found", "Action not found");
    const limit = Math.max(1, Math.min(250, input.limit ?? 100));
    const rows = await all(
      this.client,
      `SELECT id, actionId, sequence, type, payloadJson, createdAt
       FROM agent_action_events
       WHERE actionId = ? AND sequence > ?
       ORDER BY sequence LIMIT ?`,
      [input.actionId, input.afterSequence ?? 0, limit],
    );
    return rows.map((row) => ({
      id: String(row.id),
      actionId: String(row.actionId),
      sequence: Number(row.sequence),
      type: String(row.type),
      payload: json(row.payloadJson),
      createdAt: iso(row.createdAt),
    }));
  }

  async previewUndo(
    userId: string,
    requestedActionIds: readonly string[],
  ): Promise<AgentActionPreview> {
    const unique = [...new Set(requestedActionIds)];
    if (unique.length === 0 || unique.length > 500) {
      throw new ActionLedgerError("invalid-state", "Select 1 to 500 actions");
    }
    const actionRows = await all(
      this.client,
      `SELECT * FROM agent_actions WHERE userId = ? ORDER BY actionSequence, id`,
      [userId],
    );
    const byId = new Map(actionRows.map((row) => [String(row.id), row]));
    if (unique.some((id) => !byId.has(id))) {
      throw new ActionLedgerError("forbidden", "Selected action is not owned");
    }
    const edges = await all(
      this.client,
      `SELECT * FROM agent_action_dependencies WHERE userId = ?`,
      [userId],
    );
    const selected = new Set(unique);
    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of edges) {
        const actionId = String(edge.actionId);
        const dependencyId = String(edge.dependsOnActionId);
        if (
          (selected.has(dependencyId) && !selected.has(actionId)) ||
          (selected.has(actionId) && !selected.has(dependencyId))
        ) {
          selected.add(actionId);
          selected.add(dependencyId);
          changed = true;
        }
      }
    }
    const indegree = new Map([...selected].map((id) => [id, 0]));
    const outgoing = new Map<string, string[]>();
    for (const edge of edges) {
      const actionId = String(edge.actionId);
      const dependencyId = String(edge.dependsOnActionId);
      if (!selected.has(actionId) || !selected.has(dependencyId)) continue;
      indegree.set(actionId, (indegree.get(actionId) ?? 0) + 1);
      outgoing.set(dependencyId, [
        ...(outgoing.get(dependencyId) ?? []),
        actionId,
      ]);
    }
    const compare = (left: string, right: string) => {
      const leftRow = byId.get(left)!;
      const rightRow = byId.get(right)!;
      return (
        Number(leftRow.actionSequence) - Number(rightRow.actionSequence) ||
        left.localeCompare(right)
      );
    };
    const ready = [...selected]
      .filter((id) => indegree.get(id) === 0)
      .sort(compare);
    const ordered: string[] = [];
    while (ready.length > 0) {
      const current = ready.shift()!;
      ordered.push(current);
      for (const dependant of outgoing.get(current) ?? []) {
        const remaining = (indegree.get(dependant) ?? 0) - 1;
        indegree.set(dependant, remaining);
        if (remaining === 0) {
          ready.push(dependant);
          ready.sort(compare);
        }
      }
    }
    if (ordered.length !== selected.size) {
      throw new ActionLedgerError(
        "dependency-cycle",
        "Persisted dependency graph is cyclic",
      );
    }
    const dtos = await Promise.all(ordered.map((id) => this.get(userId, id)));
    const eligible = dtos
      .filter(
        (dto) =>
          dto.undoState === "eligible" ||
          (dto.undoState === "failed" &&
            dto.undoReasonCode === "compensation-failed") ||
          (dto.undoState === "in-progress" &&
            [
              "planning.tasks.trash-created@1",
              "learning.evidence.restore-decision@1",
            ].includes(dto.compensatorId ?? "")),
      )
      .map((dto) => dto.id);
    const conflicted = dtos
      .filter((dto) => dto.undoState === "conflicted")
      .map((dto) => dto.id);
    const nonUndoable = dtos
      .filter((dto) => ["not-applicable", "ineligible"].includes(dto.undoState))
      .map((dto) => dto.id);
    const blocked = dtos
      .filter(
        (dto) =>
          !eligible.includes(dto.id) &&
          !conflicted.includes(dto.id) &&
          !nonUndoable.includes(dto.id) &&
          dto.undoState !== "compensated",
      )
      .map((dto) => dto.id);
    const fence = await this.dependencyFenceVersion(userId);
    const reverseTopologicalOrder = [...ordered].reverse();
    const previewHash = await actionHash({
      userId,
      actionIds: [...selected].sort(),
      reverseTopologicalOrder,
      dependencyFenceVersion: fence,
      eligible,
      conflicted,
      nonUndoable,
      blocked,
    });
    return agentActionPreviewSchema.parse({
      actionIds: [...selected].sort(),
      reverseTopologicalOrder,
      dependencyFenceVersion: fence,
      previewHash,
      eligible,
      conflicted,
      nonUndoable,
      blocked,
    });
  }

  private async compensateTaskCreate(
    userId: string,
    source: AgentActionDto,
  ): Promise<string> {
    const resource = source.resources.find(
      (entry) =>
        entry.resourceKind === "planning-task" && entry.operation === "create",
    );
    if (!resource || !resource.afterRevision) {
      throw new ActionLedgerError(
        "invalid-state",
        "Task resource fence is missing",
      );
    }
    const argumentsHash = await actionHash({
      sourceActionId: source.id,
      taskId: resource.resourceId,
      expectedRevision: resource.afterRevision,
    });
    const preview = {
      title: "Move the agent-created task to trash",
      taskId: resource.resourceId,
      expectedRevision: resource.afterRevision,
    };
    const previewHash = await actionHash(preview);
    const now = nowSeconds();
    const transaction = await beginActionWriteTransaction(this.client);
    let compensationId: string;
    try {
      const attempts = await all(
        transaction,
        `SELECT * FROM agent_actions
         WHERE userId = ? AND compensationOfActionId = ?
           AND toolId = ? AND toolVersion = 1
         ORDER BY actionSequence, id`,
        [userId, source.id, "planning.tasks.trash-created"],
      );
      const completedAttempt = attempts.find(
        (attempt) => attempt.status === "completed",
      );
      if (completedAttempt) {
        await transaction.commit();
        return String(completedAttempt.id);
      }
      if (attempts.some((attempt) => attempt.status === "inspect-required")) {
        throw new ActionLedgerError(
          "invalid-state",
          "Compensation outcome requires inspection before retry",
        );
      }
      const existing = [...attempts]
        .reverse()
        .find((attempt) =>
          ["reserved", "executing"].includes(String(attempt.status)),
        );
      if (existing) {
        if (existing.argumentsHash !== argumentsHash) {
          throw new ActionLedgerError(
            "conflict",
            "Compensation replay diverged",
          );
        }
        compensationId = String(existing.id);
        if (existing.status === "reserved") {
          await execute(transaction, {
            sql: `UPDATE agent_actions SET status = 'executing',
                  startedAt = COALESCE(startedAt, ?)
                  WHERE id = ? AND userId = ? AND status = 'reserved'`,
            args: [now, compensationId, userId],
          });
        }
      } else {
        const failedAttemptCount = attempts.filter(
          (attempt) => attempt.status === "failed",
        ).length;
        const idempotencyKey =
          failedAttemptCount === 0
            ? `compensate:${source.id}:v1`
            : `compensate:${source.id}:v1:retry:${failedAttemptCount + 1}`;
        compensationId = newId("aact");
        const sequence = await this.allocateSequence(transaction, userId, now);
        await execute(transaction, {
          sql: `INSERT INTO agent_actions
            (id, userId, actorKind, actorClientId, threadId, branchId, runId,
             domainScopeKind, domainScopeId, toolId, toolVersion, effect, risk,
             argumentsHash, idempotencyKey, actionSequence, redactedInputJson,
             previewJson, previewHash, status, compensationOfActionId,
             crashRecovery, startedAt, createdAt)
            VALUES (?, ?, 'user-undo', ?, ?, ?, ?, ?, ?, ?, 1, 'delete',
                    'medium', ?, ?, ?, ?, ?, ?, 'executing', ?,
                    'idempotent-retry', ?, ?)`,
          args: [
            compensationId,
            userId,
            source.actorClientId,
            source.threadId,
            source.branchId,
            source.runId,
            source.domainScopeKind,
            source.domainScopeId,
            "planning.tasks.trash-created",
            argumentsHash,
            idempotencyKey,
            sequence,
            JSON.stringify({ taskId: resource.resourceId }),
            JSON.stringify(preview),
            previewHash,
            source.id,
            now,
            now,
          ],
        });
        await execute(transaction, {
          sql: `INSERT INTO agent_approvals
            (id, actionId, userId, state, argumentsHash, previewHash,
             expiresAt, resolvedAt, resolutionContextJson, createdAt)
            VALUES (?, ?, ?, 'approved', ?, ?, ?, ?, ?, ?)`,
          args: [
            newId("aappr"),
            compensationId,
            userId,
            argumentsHash,
            previewHash,
            now + 10 * 60,
            now,
            JSON.stringify({
              source: "user-undo-preview",
              sourceActionId: source.id,
            }),
            now,
          ],
        });
        await appendEvent(transaction, {
          actionId: compensationId,
          eventKey: "executing",
          type: "action.executing",
          payload: { compensationOfActionId: source.id },
          now,
        });
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    let mutationApplied = false;
    try {
      const before = await getPersonalTaskCommand(
        this.client as ActionSqlClient,
        { userId, taskId: resource.resourceId, includeTrashed: true },
      );
      const after = await trashPersonalTaskCommand(
        this.client as ActionSqlClient,
        {
          userId,
          taskId: resource.resourceId,
          expectedRevision: Number(resource.afterRevision),
        },
      );
      mutationApplied = true;
      await this.complete(userId, compensationId, {
        modelProjection: { taskId: after.id, trashed: true },
        uiProjection: {
          taskId: after.id,
          revision: after.revision,
          trashedAt: after.trashedAt?.toISOString() ?? null,
        },
        auditProjection: { outcome: "trashed", resourceId: after.id },
        resources: [
          {
            resourceKind: "planning-task",
            resourceId: after.id,
            operation: "trash",
            // A crash retry observes the already-trashed row at revision N+1.
            // The inverse still fenced the source's N revision, so keep that
            // immutable audit fact rather than rewriting history from the
            // replay observation.
            beforeRevision: resource.afterRevision,
            afterRevision: personalTaskRevision(after),
            beforeSnapshot: { title: before.title, trashed: false },
            afterSnapshot: { title: after.title, trashed: true },
          },
        ],
      });
      return compensationId;
    } catch (error) {
      const toolError: ToolError = {
        code:
          error instanceof PersonalTaskCommandError && error.code === "conflict"
            ? "STALE_REVISION"
            : "EXECUTION_FAILED",
        message: error instanceof Error ? error.message : "Compensation failed",
        retryable: false,
      };
      if (!mutationApplied) {
        await this.fail(userId, compensationId, toolError, false);
      }
      throw error;
    }
  }

  /**
   * Undo an inclusion/exclusion without rewriting immutable evidence or
   * deleting the decision being compensated. The current decision id is the
   * revision fence; a later user decision therefore wins with an explicit
   * conflict instead of being silently overwritten.
   */
  private async compensateLearningEvidenceDecision(
    userId: string,
    source: AgentActionDto,
  ): Promise<string> {
    const resource = source.resources.find(
      (entry) =>
        entry.resourceKind === "learning-evidence" &&
        entry.operation === "update",
    );
    if (!resource?.afterRevision) {
      throw new ActionLedgerError(
        "invalid-state",
        "Learning evidence resource fence is missing",
      );
    }
    const restore = evidenceDecisionSnapshot(
      resource.beforeSnapshot,
      "Previous evidence decision",
    );
    const replaced = evidenceDecisionSnapshot(
      resource.afterSnapshot,
      "Current evidence decision",
    );
    const argumentsHash = await actionHash({
      sourceActionId: source.id,
      evidenceId: resource.resourceId,
      expectedDecisionId: resource.afterRevision,
      restore,
    });
    const preview = {
      title: "Restore the previous learning-evidence decision",
      evidenceId: resource.resourceId,
      expectedDecisionId: resource.afterRevision,
      state: restore.state,
      immutableEvidencePreserved: true,
    };
    const previewHash = await actionHash(preview);
    const now = nowSeconds();
    const actionTransaction = await beginActionWriteTransaction(this.client);
    let compensationId: string;
    try {
      const attempts = await all(
        actionTransaction,
        `SELECT * FROM agent_actions
         WHERE userId = ? AND compensationOfActionId = ?
           AND toolId = ? AND toolVersion = 1
         ORDER BY actionSequence, id`,
        [userId, source.id, "learning.evidence.restore-decision"],
      );
      const completedAttempt = attempts.find(
        (attempt) => attempt.status === "completed",
      );
      if (completedAttempt) {
        await actionTransaction.commit();
        return String(completedAttempt.id);
      }
      if (attempts.some((attempt) => attempt.status === "inspect-required")) {
        throw new ActionLedgerError(
          "invalid-state",
          "Compensation outcome requires inspection before retry",
        );
      }
      const existing = [...attempts]
        .reverse()
        .find((attempt) =>
          ["reserved", "executing"].includes(String(attempt.status)),
        );
      if (existing) {
        if (existing.argumentsHash !== argumentsHash) {
          throw new ActionLedgerError(
            "conflict",
            "Compensation replay diverged",
          );
        }
        compensationId = String(existing.id);
        if (existing.status === "reserved") {
          await execute(actionTransaction, {
            sql: `UPDATE agent_actions SET status = 'executing',
                  startedAt = COALESCE(startedAt, ?)
                  WHERE id = ? AND userId = ? AND status = 'reserved'`,
            args: [now, compensationId, userId],
          });
        }
      } else {
        const failedAttemptCount = attempts.filter(
          (attempt) => attempt.status === "failed",
        ).length;
        const idempotencyKey =
          failedAttemptCount === 0
            ? `compensate:${source.id}:learning-decision:v1`
            : `compensate:${source.id}:learning-decision:v1:retry:${failedAttemptCount + 1}`;
        compensationId = newId("aact");
        const sequence = await this.allocateSequence(
          actionTransaction,
          userId,
          now,
        );
        await execute(actionTransaction, {
          sql: `INSERT INTO agent_actions
            (id, userId, actorKind, actorClientId, threadId, branchId, runId,
             domainScopeKind, domainScopeId, toolId, toolVersion, effect, risk,
             argumentsHash, idempotencyKey, actionSequence, redactedInputJson,
             previewJson, previewHash, status, compensationOfActionId,
             crashRecovery, startedAt, createdAt)
            VALUES (?, ?, 'user-undo', ?, ?, ?, ?, ?, ?, ?, 1, 'update',
                    'medium', ?, ?, ?, ?, ?, ?, 'executing', ?,
                    'idempotent-retry', ?, ?)`,
          args: [
            compensationId,
            userId,
            source.actorClientId,
            source.threadId,
            source.branchId,
            source.runId,
            "learning-evidence",
            resource.resourceId,
            "learning.evidence.restore-decision",
            argumentsHash,
            idempotencyKey,
            sequence,
            JSON.stringify({
              evidenceId: resource.resourceId,
              state: restore.state,
            }),
            JSON.stringify(preview),
            previewHash,
            source.id,
            now,
            now,
          ],
        });
        await execute(actionTransaction, {
          sql: `INSERT INTO agent_approvals
            (id, actionId, userId, state, argumentsHash, previewHash,
             expiresAt, resolvedAt, resolutionContextJson, createdAt)
            VALUES (?, ?, ?, 'approved', ?, ?, ?, ?, ?, ?)`,
          args: [
            newId("aappr"),
            compensationId,
            userId,
            argumentsHash,
            previewHash,
            now + 10 * 60,
            now,
            JSON.stringify({
              source: "user-undo-preview",
              sourceActionId: source.id,
            }),
            now,
          ],
        });
        await appendEvent(actionTransaction, {
          actionId: compensationId,
          eventKey: "executing",
          type: "action.executing",
          payload: { compensationOfActionId: source.id },
          now,
        });
      }
      await actionTransaction.commit();
    } catch (error) {
      await actionTransaction.rollback();
      throw error;
    }

    let mutationApplied = false;
    try {
      const decisionIdempotencyKey = `undo:${source.id}:learning-decision:v1`;
      const mutationTransaction = await beginActionWriteTransaction(
        this.client,
      );
      let decisionId: string;
      let objectiveId: string;
      try {
        const replay = await one(
          mutationTransaction,
          `SELECT d.id, e.objectiveId
           FROM learning_evidence_decisions d
           JOIN learning_evidence e ON e.id = d.evidenceId
           WHERE d.userId = ? AND d.idempotencyKey = ? AND e.userId = ?
           LIMIT 1`,
          [userId, decisionIdempotencyKey, userId],
        );
        if (replay) {
          decisionId = String(replay.id);
          objectiveId = String(replay.objectiveId);
        } else {
          const current = await one(
            mutationTransaction,
            `SELECT d.id, e.objectiveId
             FROM learning_evidence_decisions d
             JOIN learning_evidence e ON e.id = d.evidenceId
             WHERE d.evidenceId = ? AND d.userId = ? AND e.userId = ?
             ORDER BY d.createdAt DESC, d.id DESC LIMIT 1`,
            [resource.resourceId, userId, userId],
          );
          if (!current) {
            throw new ActionLedgerError(
              "conflict",
              "Learning evidence decision no longer exists",
            );
          }
          if (String(current.id) !== resource.afterRevision) {
            throw new ActionLedgerError(
              "conflict",
              "Learning evidence decision changed after the undo preview",
            );
          }
          decisionId = newId("levd");
          objectiveId = String(current.objectiveId);
          await execute(mutationTransaction, {
            sql: `INSERT INTO learning_evidence_decisions
              (id, evidenceId, state, reason, actor, idempotencyKey, userId,
               createdAt) VALUES (?, ?, ?, ?, 'system-correction', ?, ?, ?)`,
            args: [
              decisionId,
              resource.resourceId,
              restore.state,
              restore.reason,
              decisionIdempotencyKey,
              userId,
              nowSeconds(),
            ],
          });
        }
        await mutationTransaction.commit();
      } catch (error) {
        await mutationTransaction.rollback();
        throw error;
      }
      mutationApplied = true;
      await this.hooks.recomputeLearningMastery?.(userId, objectiveId);
      await this.complete(userId, compensationId, {
        modelProjection: {
          evidenceId: resource.resourceId,
          decisionId,
          state: restore.state,
        },
        uiProjection: {
          evidenceId: resource.resourceId,
          decisionId,
          state: restore.state,
          reason: restore.reason,
        },
        auditProjection: {
          outcome: "previous-decision-restored",
          resourceId: resource.resourceId,
          immutableEvidencePreserved: true,
        },
        resources: [
          {
            resourceKind: "learning-evidence",
            resourceId: resource.resourceId,
            operation: "update",
            beforeRevision: resource.afterRevision,
            afterRevision: decisionId,
            beforeSnapshot: replaced,
            afterSnapshot: restore,
          },
        ],
      });
      return compensationId;
    } catch (error) {
      const conflict =
        error instanceof ActionLedgerError && error.code === "conflict";
      const toolError: ToolError = {
        code: conflict ? "STALE_REVISION" : "EXECUTION_FAILED",
        message: error instanceof Error ? error.message : "Compensation failed",
        retryable: false,
      };
      if (!mutationApplied) {
        await this.fail(userId, compensationId, toolError, false);
      }
      throw error;
    }
  }

  async executeUndo(input: {
    userId: string;
    preview: AgentActionPreview;
  }): Promise<AgentActionBatchCompensationResult> {
    const fresh = await this.previewUndo(input.userId, input.preview.actionIds);
    if (
      fresh.previewHash !== input.preview.previewHash ||
      fresh.dependencyFenceVersion !== input.preview.dependencyFenceVersion
    ) {
      throw new ActionLedgerError("preview-stale", "Undo preview is stale");
    }
    const edges = await all(
      this.client,
      "SELECT actionId, dependsOnActionId FROM agent_action_dependencies WHERE userId = ?",
      [input.userId],
    );
    const outcomes = new Map<
      string,
      AgentActionBatchCompensationResult["outcomes"][number]
    >();
    for (const sourceId of fresh.reverseTopologicalOrder) {
      const unsafeDependant = edges.find(
        (edge) =>
          edge.dependsOnActionId === sourceId &&
          fresh.actionIds.includes(String(edge.actionId)) &&
          outcomes.get(String(edge.actionId))?.state !== "compensated",
      );
      if (unsafeDependant) {
        outcomes.set(sourceId, {
          sourceActionId: sourceId,
          compensationActionId: null,
          state: "blocked",
          reasonCode: "uncompensated-dependant",
        });
        continue;
      }
      const source = await this.get(input.userId, sourceId);
      if (source.undoState === "compensated") {
        outcomes.set(sourceId, {
          sourceActionId: sourceId,
          compensationActionId: source.compensationActionIds.at(-1) ?? null,
          state: "compensated",
          reasonCode: "already-compensated",
        });
        continue;
      }
      if (source.undoState === "conflicted") {
        outcomes.set(sourceId, {
          sourceActionId: sourceId,
          compensationActionId: null,
          state: "conflicted",
          reasonCode: source.undoReasonCode,
        });
        continue;
      }
      const resumable =
        source.undoState === "in-progress" &&
        [
          "planning.tasks.trash-created@1",
          "learning.evidence.restore-decision@1",
        ].includes(source.compensatorId ?? "");
      const retryableFailure =
        source.undoState === "failed" &&
        source.undoReasonCode === "compensation-failed";
      if (source.undoState !== "eligible" && !resumable && !retryableFailure) {
        outcomes.set(sourceId, {
          sourceActionId: sourceId,
          compensationActionId: null,
          state: "not-attempted",
          reasonCode: source.undoReasonCode ?? "not-eligible",
        });
        continue;
      }
      try {
        const compensationActionId =
          source.compensatorId === "planning.tasks.trash-created@1"
            ? await this.compensateTaskCreate(input.userId, source)
            : source.compensatorId === "learning.evidence.restore-decision@1"
              ? await this.compensateLearningEvidenceDecision(
                  input.userId,
                  source,
                )
              : (() => {
                  throw new ActionLedgerError(
                    "invalid-state",
                    "Unknown reviewed compensator",
                  );
                })();
        outcomes.set(sourceId, {
          sourceActionId: sourceId,
          compensationActionId,
          state: "compensated",
          reasonCode: null,
        });
      } catch (error) {
        const conflict =
          (error instanceof PersonalTaskCommandError &&
            error.code === "conflict") ||
          (error instanceof ActionLedgerError && error.code === "conflict");
        outcomes.set(sourceId, {
          sourceActionId: sourceId,
          compensationActionId: (await this.get(input.userId, sourceId))
            .activeCompensationActionId,
          state: conflict ? "conflicted" : "failed",
          reasonCode: conflict
            ? "resource-revision-changed"
            : "compensation-failed",
        });
      }
    }
    const orderedOutcomes = fresh.reverseTopologicalOrder.map((id) =>
      outcomes.get(id)!,
    );
    const complete = orderedOutcomes.every(
      (outcome) => outcome.state === "compensated",
    );
    return {
      complete,
      partial:
        !complete &&
        orderedOutcomes.some((outcome) => outcome.state === "compensated"),
      outcomes: orderedOutcomes,
    };
  }
}

export class DurableToolActionLedgerWriter implements ToolActionLedgerWriter {
  readonly kind = "durable" as const;

  constructor(
    private readonly ledger: ActionLedgerService,
    private readonly actorKind: ActionReservationInput["actorKind"],
    private readonly userId: string,
  ) {}

  prepare(input: ActionReservationInput): Promise<AgentActionReservation> {
    if (input.userId !== this.userId || input.actorKind !== this.actorKind) {
      throw new ActionLedgerError(
        "forbidden",
        "Action writer binding mismatch",
      );
    }
    return this.ledger.reserve(input);
  }

  markExecuting(reference: string): Promise<void> {
    return this.ledger.markExecuting(this.userId, reference);
  }

  complete(reference: string, input: ActionCompletionInput): Promise<void> {
    return this.ledger.complete(this.userId, reference, input);
  }

  fail(
    reference: string,
    error: ToolError,
    effectMayHaveOccurred: boolean,
  ): Promise<void> {
    return this.ledger.fail(
      this.userId,
      reference,
      error,
      effectMayHaveOccurred,
    );
  }
}
