import type { InValue, Transaction } from "@libsql/client";
import {
  AGENT_RUNTIME_PROTOCOL_VERSION,
  agentRunLeaseSchema,
  modelPlacementSchema,
  providerDispatchClaimSchema,
  type AgentRunLease,
  type ModelPlacement,
  type ProviderDispatchClaim,
  type ProviderDispatchClaimState,
  type AgentApprovalMode,
} from "@avermate/agent-contracts";
import { newId } from "../lib/id";
import type { AssistantSqlClient } from "../assistant/core-conversation-store";
import { canonicalJson, jsonValue } from "../search/values";

type Row = Record<string, InValue>;

function epochSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1_000);
}

function iso(value: unknown): string {
  return new Date(Number(value) * 1_000).toISOString();
}

async function one(
  target: AssistantSqlClient | Transaction,
  sql: string,
  args: InValue[],
): Promise<Row | null> {
  const result = await target.execute({ sql, args });
  return (result.rows[0] as Row | undefined) ?? null;
}

function placementFromRow(row: Row): ModelPlacement {
  return modelPlacementSchema.parse(jsonValue(row.placementJson));
}

function leaseFromRow(row: Row): AgentRunLease {
  return agentRunLeaseSchema.parse({
    protocolVersion: AGENT_RUNTIME_PROTOCOL_VERSION,
    id: String(row.id),
    ownerId: String(row.userId),
    runId: String(row.runId),
    workerId: String(row.workerId),
    fencingToken: Number(row.fencingToken),
    state: row.state,
    acquiredAt: iso(row.acquiredAt),
    heartbeatAt: iso(row.heartbeatAt),
    expiresAt: iso(row.expiresAt),
  });
}

function claimFromRow(row: Row, run: Row): ProviderDispatchClaim {
  return providerDispatchClaimSchema.parse({
    protocolVersion: AGENT_RUNTIME_PROTOCOL_VERSION,
    id: String(row.id),
    ownerId: String(row.userId),
    threadId: String(run.threadId),
    branchId: String(run.branchId),
    runId: String(row.runId),
    dispatchKey: String(row.dispatchKey),
    requestDigest: String(row.requestDigest),
    providerKey: String(row.providerKey),
    providerRevision: String(row.providerRevision),
    modelKey: String(row.modelKey),
    modelRevision: String(row.modelRevision),
    placement: placementFromRow(row),
    providerSupportsStableRequestKey: Boolean(
      row.providerSupportsStableRequestKey,
    ),
    stableRequestKey:
      row.stableRequestKey === null ? null : String(row.stableRequestKey),
    state: row.state,
    claimedAt: iso(row.claimedAt),
    updatedAt: iso(row.updatedAt),
    inspectReason:
      row.inspectReason === null ? null : String(row.inspectReason),
  });
}

export class RunControlError extends Error {
  constructor(
    readonly code:
      | "not-found"
      | "lease-unavailable"
      | "stale-fence"
      | "invalid-transition"
      | "divergent-replay",
    message: string,
  ) {
    super(message);
    this.name = "RunControlError";
  }
}

export type RunLeaseFence = Pick<
  AgentRunLease,
  "id" | "ownerId" | "runId" | "workerId" | "fencingToken"
>;

export type DispatchClaimInput = {
  ownerId: string;
  runId: string;
  dispatchKey: string;
  requestDigest: string;
  providerKey: string;
  providerRevision: string;
  modelKey: string;
  modelRevision: string;
  placement: ModelPlacement;
  providerSupportsStableRequestKey: boolean;
  stableRequestKey: string | null;
};

export type FrozenRunConfiguration = {
  ownerId: string;
  runId: string;
  runtimeId: string;
  runtimeVersion: string;
  modelKey: string;
  modelRevision: string;
  providerKey: string;
  providerRevision: string;
  modelPlacement: ModelPlacement;
  policyRevision: string;
  toolCatalogRevision: string;
  branchIdentityDigest: string;
  approvalMode: AgentApprovalMode;
};

const allowedDispatchTransitions: Readonly<
  Record<ProviderDispatchClaimState, readonly ProviderDispatchClaimState[]>
> = {
  claimed: ["claimed", "dispatching", "cancelled", "failed"],
  dispatching: [
    "dispatching",
    "acknowledged",
    "completed",
    "failed",
    "cancelled",
    "inspect-required",
  ],
  acknowledged: [
    "acknowledged",
    "completed",
    "failed",
    "cancelled",
    "inspect-required",
  ],
  completed: ["completed"],
  failed: ["failed"],
  cancelled: ["cancelled"],
  "inspect-required": ["inspect-required"],
};

/**
 * Run leases and provider claims are deliberately separate from conversation
 * checkpoints. They fence workers and external effects; the conversation store
 * remains the only owner of the message DAG and event sequence.
 */
export class ProductionRunControlStore {
  constructor(
    private readonly client: AssistantSqlClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async ownedRun(
    target: AssistantSqlClient | Transaction,
    ownerId: string,
    runId: string,
  ): Promise<Row> {
    const row = await one(
      target,
      `SELECT * FROM assistant_runs WHERE id = ? AND userId = ? LIMIT 1`,
      [runId, ownerId],
    );
    if (!row) throw new RunControlError("not-found", "Run not found");
    return row;
  }

  private async assertFence(
    target: AssistantSqlClient | Transaction,
    fence: RunLeaseFence,
  ): Promise<Row> {
    const row = await one(
      target,
      `SELECT * FROM assistant_run_leases
       WHERE id = ? AND userId = ? AND runId = ? AND workerId = ?
         AND fencingToken = ? AND state = 'active' AND expiresAt > ? LIMIT 1`,
      [
        fence.id,
        fence.ownerId,
        fence.runId,
        fence.workerId,
        fence.fencingToken,
        epochSeconds(this.now()),
      ],
    );
    if (!row) {
      throw new RunControlError(
        "stale-fence",
        "The worker lease is missing, expired, or superseded",
      );
    }
    return row;
  }

  async freezeRunConfiguration(input: FrozenRunConfiguration): Promise<void> {
    const placement = modelPlacementSchema.parse(input.modelPlacement);
    if (!/^[a-f0-9]{64}$/u.test(input.branchIdentityDigest)) {
      throw new Error("Branch identity digest must be SHA-256");
    }
    const transaction = await this.client.transaction("write");
    try {
      const run = await this.ownedRun(transaction, input.ownerId, input.runId);
      const current = {
        runtimeId: String(run.runtimeId),
        runtimeVersion: String(run.runtimeVersion),
        modelKey: String(run.modelKey),
        modelRevision: String(run.modelRevision ?? "legacy/1"),
        providerKey: String(run.providerKey),
        providerRevision: String(run.providerRevision ?? "legacy/1"),
        modelPlacement:
          run.modelPlacementJson === undefined ||
          run.modelPlacementJson === null
            ? ({ kind: "core", instanceId: "legacy" } as const)
            : modelPlacementSchema.parse(jsonValue(run.modelPlacementJson)),
        policyRevision: String(run.policyRevision ?? "assistant-policy/1"),
        toolCatalogRevision: String(run.toolCatalogRevision ?? "legacy/1"),
        branchIdentityDigest:
          run.branchIdentityDigest === null ||
          run.branchIdentityDigest === undefined
            ? null
            : String(run.branchIdentityDigest),
        approvalMode: String(run.approvalMode),
      };
      const unfrozen =
        current.runtimeId === "avermate-readonly" ||
        current.modelRevision === "legacy/1" ||
        current.providerRevision === "legacy/1" ||
        current.toolCatalogRevision === "legacy/1" ||
        current.branchIdentityDigest === null;
      if (!unfrozen) {
        const expected = {
          ...input,
          ownerId: undefined,
          runId: undefined,
          modelPlacement: placement,
        };
        const actual = {
          ...current,
        };
        if (
          canonicalJson(actual) !==
          canonicalJson({
            runtimeId: expected.runtimeId,
            runtimeVersion: expected.runtimeVersion,
            modelKey: expected.modelKey,
            modelRevision: expected.modelRevision,
            providerKey: expected.providerKey,
            providerRevision: expected.providerRevision,
            modelPlacement: expected.modelPlacement,
            policyRevision: expected.policyRevision,
            toolCatalogRevision: expected.toolCatalogRevision,
            branchIdentityDigest: expected.branchIdentityDigest,
            approvalMode: expected.approvalMode,
          })
        ) {
          throw new RunControlError(
            "divergent-replay",
            "Immutable run configuration differs from its reservation",
          );
        }
        await transaction.commit();
        return;
      }
      const changed = await transaction.execute({
        sql: `UPDATE assistant_runs SET runtimeId = ?, runtimeVersion = ?,
          runtimeProtocolVersion = 1, modelKey = ?, modelRevision = ?,
          providerKey = ?, providerRevision = ?, modelPlacementJson = ?,
          policyRevision = ?, toolCatalogRevision = ?, branchIdentityDigest = ?,
          approvalMode = ?, updatedAt = ?
          WHERE id = ? AND userId = ? AND status = 'reserved'`,
        args: [
          input.runtimeId,
          input.runtimeVersion,
          input.modelKey,
          input.modelRevision,
          input.providerKey,
          input.providerRevision,
          canonicalJson(placement),
          input.policyRevision,
          input.toolCatalogRevision,
          input.branchIdentityDigest,
          input.approvalMode,
          epochSeconds(this.now()),
          input.runId,
          input.ownerId,
        ],
      });
      if (changed.rowsAffected !== 1) {
        throw new RunControlError(
          "invalid-transition",
          "Run configuration must be frozen before execution starts",
        );
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async freezeContextManifest(input: {
    ownerId: string;
    runId: string;
    digest: string;
    fence: RunLeaseFence;
  }): Promise<void> {
    if (!/^[a-f0-9]{64}$/u.test(input.digest)) {
      throw new Error("Context manifest digest must be SHA-256");
    }
    const transaction = await this.client.transaction("write");
    try {
      const run = await this.ownedRun(transaction, input.ownerId, input.runId);
      await this.assertFence(transaction, input.fence);
      if (
        run.contextManifestDigest !== null &&
        run.contextManifestDigest !== undefined &&
        String(run.contextManifestDigest) !== input.digest
      ) {
        throw new RunControlError(
          "divergent-replay",
          "Context manifest identity is immutable after provider dispatch",
        );
      }
      await transaction.execute({
        sql: `UPDATE assistant_runs
              SET contextManifestDigest = coalesce(contextManifestDigest, ?),
                  updatedAt = ? WHERE id = ? AND userId = ?`,
        args: [
          input.digest,
          epochSeconds(this.now()),
          input.runId,
          input.ownerId,
        ],
      });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async acquireLease(input: {
    ownerId: string;
    runId: string;
    workerId: string;
    ttlMs?: number;
  }): Promise<AgentRunLease> {
    const transaction = await this.client.transaction("write");
    try {
      const run = await this.ownedRun(transaction, input.ownerId, input.runId);
      if (["complete", "failed", "cancelled"].includes(String(run.status))) {
        throw new RunControlError(
          "lease-unavailable",
          "A terminal run cannot be leased",
        );
      }
      const now = epochSeconds(this.now());
      const ttlSeconds = Math.max(
        5,
        Math.min(300, Math.ceil((input.ttlMs ?? 30_000) / 1_000)),
      );
      const active = await one(
        transaction,
        `SELECT * FROM assistant_run_leases
         WHERE runId = ? AND state = 'active' LIMIT 1`,
        [input.runId],
      );
      if (active && Number(active.expiresAt) > now) {
        if (
          String(active.userId) === input.ownerId &&
          String(active.workerId) === input.workerId
        ) {
          await transaction.execute({
            sql: `UPDATE assistant_run_leases
                  SET heartbeatAt = ?, expiresAt = ? WHERE id = ?`,
            args: [now, now + ttlSeconds, active.id],
          });
          const renewed = await one(
            transaction,
            `SELECT * FROM assistant_run_leases WHERE id = ?`,
            [active.id],
          );
          await transaction.commit();
          return leaseFromRow(renewed!);
        }
        throw new RunControlError(
          "lease-unavailable",
          "The run is already leased by another worker",
        );
      }
      if (active) {
        await transaction.execute({
          sql: `UPDATE assistant_run_leases
                SET state = 'expired', releasedAt = ?
                WHERE id = ? AND state = 'active'`,
          args: [now, active.id],
        });
      }
      const maximum = await one(
        transaction,
        `SELECT coalesce(max(fencingToken), 0) AS token
         FROM assistant_run_leases WHERE runId = ?`,
        [input.runId],
      );
      const fencingToken = Number(maximum?.token ?? 0) + 1;
      const id = newId("arle");
      await transaction.execute({
        sql: `INSERT INTO assistant_run_leases
          (id, userId, runId, workerId, fencingToken, state, acquiredAt,
           heartbeatAt, expiresAt)
          VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
        args: [
          id,
          input.ownerId,
          input.runId,
          input.workerId,
          fencingToken,
          now,
          now,
          now + ttlSeconds,
        ],
      });
      const inserted = await one(
        transaction,
        `SELECT * FROM assistant_run_leases WHERE id = ?`,
        [id],
      );
      await transaction.commit();
      return leaseFromRow(inserted!);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async renewLease(
    fence: RunLeaseFence,
    ttlMs = 30_000,
  ): Promise<AgentRunLease> {
    const transaction = await this.client.transaction("write");
    try {
      await this.assertFence(transaction, fence);
      const now = epochSeconds(this.now());
      const ttlSeconds = Math.max(
        5,
        Math.min(300, Math.ceil(ttlMs / 1_000)),
      );
      await transaction.execute({
        sql: `UPDATE assistant_run_leases SET heartbeatAt = ?, expiresAt = ?
              WHERE id = ? AND fencingToken = ? AND state = 'active'`,
        args: [now, now + ttlSeconds, fence.id, fence.fencingToken],
      });
      const row = await one(
        transaction,
        `SELECT * FROM assistant_run_leases WHERE id = ?`,
        [fence.id],
      );
      await transaction.commit();
      return leaseFromRow(row!);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async releaseLease(
    fence: RunLeaseFence,
    state: "released" | "fenced" = "released",
  ): Promise<void> {
    const transaction = await this.client.transaction("write");
    try {
      // Releasing is cleanup, not authority for a new side effect. An exact
      // lease may have elapsed after the final fenced write while the runtime
      // was serializing its terminal state or waiting behind SQLite work. In
      // that case it is still safe (and necessary) to close the row provided
      // no newer fencing token has superseded it. The conditional UPDATE is
      // the atomic ownership check; all effectful operations continue to use
      // assertFence(), which also requires expiresAt to be in the future.
      const changed = await transaction.execute({
        sql: `UPDATE assistant_run_leases SET state = ?, releasedAt = ?
              WHERE id = ? AND userId = ? AND runId = ? AND workerId = ?
                AND fencingToken = ? AND state = 'active'`,
        args: [
          state,
          epochSeconds(this.now()),
          fence.id,
          fence.ownerId,
          fence.runId,
          fence.workerId,
          fence.fencingToken,
        ],
      });
      if (changed.rowsAffected !== 1) {
        throw new RunControlError("stale-fence", "The lease was superseded");
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async claimProviderDispatch(
    input: DispatchClaimInput,
    fence: RunLeaseFence,
  ): Promise<ProviderDispatchClaim> {
    const parsedPlacement = modelPlacementSchema.parse(input.placement);
    if (
      input.providerSupportsStableRequestKey !==
      (input.stableRequestKey !== null)
    ) {
      throw new RunControlError(
        "divergent-replay",
        "Stable request-key capability and value must agree",
      );
    }
    const transaction = await this.client.transaction("write");
    try {
      const run = await this.ownedRun(transaction, input.ownerId, input.runId);
      await this.assertFence(transaction, fence);
      const existing = await one(
        transaction,
        `SELECT * FROM assistant_provider_dispatch_claims
         WHERE userId = ? AND runId = ? AND dispatchKey = ? LIMIT 1`,
        [input.ownerId, input.runId, input.dispatchKey],
      );
      if (existing) {
        const invariant =
          String(existing.requestDigest) === input.requestDigest &&
          String(existing.providerKey) === input.providerKey &&
          String(existing.providerRevision) === input.providerRevision &&
          String(existing.modelKey) === input.modelKey &&
          String(existing.modelRevision) === input.modelRevision &&
          canonicalJson(placementFromRow(existing)) ===
            canonicalJson(parsedPlacement) &&
          Boolean(existing.providerSupportsStableRequestKey) ===
            input.providerSupportsStableRequestKey &&
          (existing.stableRequestKey === null
            ? null
            : String(existing.stableRequestKey)) === input.stableRequestKey;
        if (!invariant) {
          throw new RunControlError(
            "divergent-replay",
            "The dispatch key was already claimed for a different request",
          );
        }
        await transaction.commit();
        return claimFromRow(existing, run);
      }
      const now = epochSeconds(this.now());
      const id = newId("apdc");
      await transaction.execute({
        sql: `INSERT INTO assistant_provider_dispatch_claims
          (id, userId, runId, dispatchKey, requestDigest, providerKey,
           providerRevision, modelKey, modelRevision, placementJson,
           providerSupportsStableRequestKey, stableRequestKey, state,
           claimedAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'claimed', ?, ?)`,
        args: [
          id,
          input.ownerId,
          input.runId,
          input.dispatchKey,
          input.requestDigest,
          input.providerKey,
          input.providerRevision,
          input.modelKey,
          input.modelRevision,
          canonicalJson(parsedPlacement),
          input.providerSupportsStableRequestKey ? 1 : 0,
          input.stableRequestKey,
          now,
          now,
        ],
      });
      const inserted = await one(
        transaction,
        `SELECT * FROM assistant_provider_dispatch_claims WHERE id = ?`,
        [id],
      );
      await transaction.commit();
      return claimFromRow(inserted!, run);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async transitionProviderDispatch(input: {
    ownerId: string;
    runId: string;
    dispatchKey: string;
    state: ProviderDispatchClaimState;
    fence: RunLeaseFence;
    inspectReason?: string | null;
  }): Promise<ProviderDispatchClaim> {
    const transaction = await this.client.transaction("write");
    try {
      const run = await this.ownedRun(transaction, input.ownerId, input.runId);
      await this.assertFence(transaction, input.fence);
      const claim = await one(
        transaction,
        `SELECT * FROM assistant_provider_dispatch_claims
         WHERE userId = ? AND runId = ? AND dispatchKey = ? LIMIT 1`,
        [input.ownerId, input.runId, input.dispatchKey],
      );
      if (!claim) {
        throw new RunControlError("not-found", "Dispatch claim not found");
      }
      const current = String(claim.state) as ProviderDispatchClaimState;
      if (!allowedDispatchTransitions[current].includes(input.state)) {
        throw new RunControlError(
          "invalid-transition",
          `Provider dispatch cannot move from ${current} to ${input.state}`,
        );
      }
      const now = epochSeconds(this.now());
      const inspectReason =
        input.state === "inspect-required"
          ? (input.inspectReason ?? "Provider outcome is uncertain")
          : null;
      await transaction.execute({
        sql: `UPDATE assistant_provider_dispatch_claims SET state = ?,
          inspectReason = ?,
          dispatchStartedAt = CASE WHEN ? = 'dispatching' THEN coalesce(dispatchStartedAt, ?) ELSE dispatchStartedAt END,
          acknowledgedAt = CASE WHEN ? = 'acknowledged' THEN coalesce(acknowledgedAt, ?) ELSE acknowledgedAt END,
          completedAt = CASE WHEN ? IN ('completed','failed','cancelled','inspect-required') THEN coalesce(completedAt, ?) ELSE completedAt END,
          updatedAt = ?
          WHERE id = ? AND state = ?`,
        args: [
          input.state,
          inspectReason,
          input.state,
          now,
          input.state,
          now,
          input.state,
          now,
          now,
          claim.id,
          current,
        ],
      });
      const summaryState =
        input.state === "claimed"
          ? "pending"
          : input.state === "completed"
            ? "completed"
            : input.state;
      await transaction.execute({
        sql: `UPDATE assistant_runs SET providerDispatchState = ?,
              providerRequestKey = coalesce(providerRequestKey, ?), updatedAt = ?
              WHERE id = ? AND userId = ?`,
        args: [
          summaryState,
          input.dispatchKey,
          now,
          input.runId,
          input.ownerId,
        ],
      });
      const updated = await one(
        transaction,
        `SELECT * FROM assistant_provider_dispatch_claims WHERE id = ?`,
        [claim.id],
      );
      await transaction.commit();
      return claimFromRow(updated!, run);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async requestCancellation(input: {
    ownerId: string;
    runId: string;
    reason: string;
  }): Promise<boolean> {
    const reason = input.reason.trim().slice(0, 1_000);
    if (!reason) throw new Error("Cancellation reason is required");
    const transaction = await this.client.transaction("write");
    try {
      const run = await this.ownedRun(transaction, input.ownerId, input.runId);
      if (["complete", "failed", "cancelled"].includes(String(run.status))) {
        await transaction.commit();
        return false;
      }
      const now = epochSeconds(this.now());
      await transaction.execute({
        sql: `UPDATE assistant_runs SET status = 'cancelling',
          cancellationRequestedAt = coalesce(cancellationRequestedAt, ?),
          cancellationReason = coalesce(cancellationReason, ?), updatedAt = ?
          WHERE id = ? AND userId = ?
            AND status NOT IN ('complete','failed','cancelled')`,
        args: [now, reason, now, input.runId, input.ownerId],
      });
      await transaction.commit();
      return true;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async cancellationRequested(
    ownerId: string,
    runId: string,
    fence?: RunLeaseFence,
  ): Promise<boolean> {
    if (fence) await this.assertFence(this.client, fence);
    const run = await this.ownedRun(this.client, ownerId, runId);
    return (
      String(run.status) === "cancelling" ||
      run.cancellationRequestedAt !== null
    );
  }

  async markWaitingApproval(input: {
    ownerId: string;
    runId: string;
    fence: RunLeaseFence;
  }): Promise<void> {
    const transaction = await this.client.transaction("write");
    try {
      await this.ownedRun(transaction, input.ownerId, input.runId);
      await this.assertFence(transaction, input.fence);
      const changed = await transaction.execute({
        sql: `UPDATE assistant_runs SET status = 'waiting-approval', updatedAt = ?
              WHERE id = ? AND userId = ? AND status = 'running'`,
        args: [epochSeconds(this.now()), input.runId, input.ownerId],
      });
      if (changed.rowsAffected !== 1) {
        throw new RunControlError(
          "invalid-transition",
          "Only a running run can wait for approval",
        );
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async resumeWaitingRun(ownerId: string, runId: string): Promise<void> {
    const result = await this.client.execute({
      sql: `UPDATE assistant_runs SET status = 'reserved', updatedAt = ?
            WHERE id = ? AND userId = ?
              AND status IN ('waiting-approval','waiting-for-user')`,
      args: [epochSeconds(this.now()), runId, ownerId],
    });
    if (result.rowsAffected !== 1) {
      throw new RunControlError(
        "invalid-transition",
        "The run is not waiting for a resume value",
      );
    }
  }

  async reconcileOrphans(limit = 1_000): Promise<{
    expiredLeases: string[];
    replayableDispatches: string[];
    inspectRequired: string[];
    queued: string[];
    waitingApproval: string[];
    cancelling: string[];
  }> {
    const now = epochSeconds(this.now());
    const transaction = await this.client.transaction("write");
    try {
      const leases = await transaction.execute({
        sql: `SELECT id, runId FROM assistant_run_leases
              WHERE state = 'active' AND expiresAt <= ? ORDER BY expiresAt LIMIT ?`,
        args: [now, Math.max(1, Math.min(10_000, limit))],
      });
      const expiredLeases = leases.rows.map((row) => String(row.runId));
      for (const row of leases.rows) {
        await transaction.execute({
          sql: `UPDATE assistant_run_leases
                SET state = 'expired', releasedAt = ?
                WHERE id = ? AND state = 'active' AND expiresAt <= ?`,
          args: [now, row.id, now],
        });
      }
      const orphaned = await transaction.execute({
        sql: `SELECT c.* FROM assistant_provider_dispatch_claims c
          JOIN assistant_runs r ON r.id = c.runId AND r.userId = c.userId
          LEFT JOIN assistant_run_leases l ON l.runId = c.runId
            AND l.state = 'active' AND l.expiresAt > ?
          WHERE c.state IN ('dispatching','acknowledged') AND l.id IS NULL
            AND r.status NOT IN ('complete','failed','cancelled')
          ORDER BY c.updatedAt, c.id LIMIT ?`,
        args: [now, Math.max(1, Math.min(10_000, limit))],
      });
      const replayableDispatches: string[] = [];
      const inspectRequired: string[] = [];
      for (const row of orphaned.rows) {
        const stable = Boolean(row.providerSupportsStableRequestKey);
        if (String(row.state) === "dispatching" && stable) {
          await transaction.execute({
            sql: `UPDATE assistant_provider_dispatch_claims
                  SET state = 'claimed', inspectReason = null, updatedAt = ?
                  WHERE id = ? AND state = 'dispatching'`,
            args: [now, row.id],
          });
          replayableDispatches.push(String(row.runId));
          continue;
        }
        const reason =
          String(row.state) === "acknowledged"
            ? "Provider acknowledged the request before worker loss"
            : "Provider may have received a request without a stable key";
        await transaction.execute({
          sql: `UPDATE assistant_provider_dispatch_claims
                SET state = 'inspect-required', inspectReason = ?,
                    completedAt = coalesce(completedAt, ?), updatedAt = ?
                WHERE id = ? AND state IN ('dispatching','acknowledged')`,
          args: [reason, now, now, row.id],
        });
        await transaction.execute({
          sql: `UPDATE assistant_runs SET providerDispatchState = 'inspect-required',
                terminalReason = 'provider-dispatch-unknown', updatedAt = ?
                WHERE id = ? AND userId = ?
                  AND status NOT IN ('complete','failed','cancelled')`,
          args: [now, row.runId, row.userId],
        });
        inspectRequired.push(String(row.runId));
      }
      const states = await transaction.execute({
        sql: `SELECT id, status FROM assistant_runs
          WHERE status IN ('reserved','waiting-approval','cancelling')
          ORDER BY createdAt, id LIMIT ?`,
        args: [Math.max(1, Math.min(10_000, limit))],
      });
      await transaction.commit();
      return {
        expiredLeases,
        replayableDispatches,
        inspectRequired,
        queued: states.rows
          .filter((row) => row.status === "reserved")
          .map((row) => String(row.id)),
        waitingApproval: states.rows
          .filter((row) => row.status === "waiting-approval")
          .map((row) => String(row.id)),
        cancelling: states.rows
          .filter((row) => row.status === "cancelling")
          .map((row) => String(row.id)),
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
}
