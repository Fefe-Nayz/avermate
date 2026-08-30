import type { Client, InValue, Transaction } from "@libsql/client";
import {
  capabilityAttemptSchema,
  capabilityErrorCodeSchema,
  capabilityKindSchema,
  capabilityPurposeSchema,
  capabilityResultSchemas,
  capabilityUsageSchema,
  frozenCapabilityRoutePlanSchema,
  type CapabilityAttempt,
  type CapabilityError,
  type CapabilityErrorCode,
  type CapabilityKind,
  type CapabilityOperationState,
  type CapabilityResultMap,
  type CapabilityUsage,
  type FrozenCapabilityRoutePlan,
} from "@avermate/agent-contracts";
import { db } from "../db";
import { newId } from "../lib/id";
import {
  capabilityDigest,
  capabilityEpoch,
  capabilityIso,
  capabilityJson,
} from "./values";

type SqlClient = Pick<Client, "execute" | "transaction">;
type SqlTarget = Pick<Client | Transaction, "execute">;
type Row = Record<string, InValue>;

export type PublicCapabilityOperation = {
  id: string;
  capability: CapabilityKind;
  purpose: string;
  inputDigest: string;
  idempotencyKey: string;
  state: CapabilityOperationState;
  routePlan: FrozenCapabilityRoutePlan | null;
  resultDigest: string | null;
  hasResult: boolean;
  safeErrorCode: CapabilityErrorCode | null;
  retryable: boolean;
  ambiguous: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type PublicCapabilityUsageRecord = {
  id: string;
  operationId: string;
  attemptId: string;
  digest: string;
  usage: CapabilityUsage;
  createdAt: string;
};

export type PublicCapabilityOperationDetail = {
  operation: PublicCapabilityOperation;
  attempts: CapabilityAttempt[];
  usage: PublicCapabilityUsageRecord[];
};

export class CapabilityOperationStoreError extends Error {
  constructor(
    readonly code:
      | "NOT_FOUND"
      | "REVISION_CONFLICT"
      | "DIVERGENT_REPLAY"
      | "INVALID_TRANSITION"
      | "ROUTE_MISMATCH",
    message: string,
  ) {
    super(message);
    this.name = "CapabilityOperationStoreError";
  }
}

function operationFromRow(row: Row): PublicCapabilityOperation {
  return {
    id: String(row.id),
    capability: capabilityKindSchema.parse(row.capabilityKind),
    purpose: capabilityPurposeSchema.parse(row.purpose),
    inputDigest: String(row.inputDigest),
    idempotencyKey: String(row.idempotencyKey),
    state: row.state as CapabilityOperationState,
    routePlan:
      row.routePlanJson === null
        ? null
        : frozenCapabilityRoutePlanSchema.parse(
            capabilityJson(row.routePlanJson),
          ),
    resultDigest: row.resultDigest === null ? null : String(row.resultDigest),
    hasResult: row.resultRefJson !== null,
    safeErrorCode:
      row.safeErrorCode === null
        ? null
        : capabilityErrorCodeSchema.parse(row.safeErrorCode),
    retryable: Boolean(row.retryable),
    ambiguous: Boolean(row.ambiguous),
    revision: Number(row.revision),
    createdAt: capabilityIso(row.createdAt),
    updatedAt: capabilityIso(row.updatedAt),
    completedAt:
      row.completedAt === null ? null : capabilityIso(row.completedAt),
  };
}

function attemptFromRow(row: Row): CapabilityAttempt {
  return capabilityAttemptSchema.parse({
    schemaVersion: 1,
    id: String(row.id),
    operationId: String(row.operationId),
    ordinal: Number(row.ordinal),
    offeringId: String(row.offeringId),
    requestDigest: String(row.requestDigest),
    state: row.state,
    providerRequestId:
      row.providerRequestId === null ? null : String(row.providerRequestId),
    credentialVersion:
      row.credentialVersion === null ? null : Number(row.credentialVersion),
    consentRevision:
      row.consentRevision === null ? null : Number(row.consentRevision),
    errorClass: row.errorClass === null ? null : String(row.errorClass),
    retryable: Boolean(row.retryable),
    safeDiagnostic:
      row.safeDiagnosticJson === null
        ? null
        : capabilityJson(row.safeDiagnosticJson),
    startedAt: capabilityIso(row.startedAt),
    acknowledgedAt:
      row.acknowledgedAt === null ? null : capabilityIso(row.acknowledgedAt),
    completedAt:
      row.completedAt === null ? null : capabilityIso(row.completedAt),
  });
}

function usageFromRow(row: Row): PublicCapabilityUsageRecord {
  const usage = capabilityUsageSchema.parse(capabilityJson(row.usageJson));
  const digest = String(row.usageDigest);
  if (capabilityDigest(usage) !== digest) {
    throw new CapabilityOperationStoreError(
      "DIVERGENT_REPLAY",
      "Persisted capability usage digest does not match its envelope",
    );
  }
  return {
    id: String(row.id),
    operationId: String(row.operationId),
    attemptId: String(row.attemptId),
    digest,
    usage,
    createdAt: capabilityIso(row.createdAt),
  };
}

async function ownedOperationRow(
  target: SqlTarget,
  ownerId: string,
  operationId: string,
) {
  const result = await target.execute({
    sql: `SELECT * FROM capability_operations
      WHERE id = ? AND ownerId = ? LIMIT 1`,
    args: [operationId, ownerId],
  });
  return (result.rows[0] as Row | undefined) ?? null;
}

async function ownedAttemptRow(
  target: SqlTarget,
  ownerId: string,
  operationId: string,
  attemptId: string,
) {
  const result = await target.execute({
    sql: `SELECT attempt.* FROM capability_attempts attempt
      JOIN capability_operations operation ON operation.id = attempt.operationId
      WHERE attempt.id = ? AND attempt.operationId = ? AND operation.ownerId = ?
      LIMIT 1`,
    args: [attemptId, operationId, ownerId],
  });
  return (result.rows[0] as Row | undefined) ?? null;
}

async function persistUsageEnvelope(
  target: SqlTarget,
  input: {
    ownerId: string;
    operationId: string;
    attemptId: string;
    usage: CapabilityUsage;
    now: number;
  },
) {
  const usage = capabilityUsageSchema.parse(input.usage);
  const usageDigest = capabilityDigest(usage);
  const attempt = await ownedAttemptRow(
    target,
    input.ownerId,
    input.operationId,
    input.attemptId,
  );
  if (!attempt) {
    throw new CapabilityOperationStoreError("NOT_FOUND", "Attempt not found");
  }
  const inserted = await target.execute({
    sql: `INSERT INTO capability_usage (
      id, operationId, attemptId, usageDigest, usageJson, createdAt
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(attemptId) DO NOTHING`,
    args: [
      newId("cuse"),
      input.operationId,
      input.attemptId,
      usageDigest,
      JSON.stringify(usage),
      input.now,
    ],
  });
  const stored = await target.execute({
    sql: `SELECT * FROM capability_usage WHERE attemptId = ? LIMIT 1`,
    args: [input.attemptId],
  });
  const row = stored.rows[0] as Row | undefined;
  if (
    !row ||
    String(row.operationId) !== input.operationId ||
    String(row.usageDigest) !== usageDigest ||
    capabilityDigest(
      capabilityUsageSchema.parse(capabilityJson(row.usageJson)),
    ) !== usageDigest
  ) {
    throw new CapabilityOperationStoreError(
      "DIVERGENT_REPLAY",
      "Attempt usage is already bound to a different envelope",
    );
  }
  return {
    digest: usageDigest,
    replayed: Number(inserted.rowsAffected) !== 1,
  };
}

function frozenPolicySnapshotDigest(snapshot: unknown) {
  if (
    snapshot &&
    typeof snapshot === "object" &&
    !Array.isArray(snapshot) &&
    typeof (snapshot as { digest?: unknown }).digest === "string"
  ) {
    const { digest, ...payload } = snapshot as Record<string, unknown> & {
      digest: string;
    };
    if (capabilityDigest(payload) !== digest) {
      throw new CapabilityOperationStoreError(
        "ROUTE_MISMATCH",
        "Policy snapshot digest does not match its contents",
      );
    }
    return digest;
  }
  return capabilityDigest(snapshot);
}

function isIdempotencyUniqueViolation(error: unknown) {
  let current = error;
  for (let depth = 0; current && depth < 8; depth += 1) {
    const candidate = current as {
      cause?: unknown;
      code?: unknown;
      extendedCode?: unknown;
      message?: unknown;
    };
    const code = [candidate.code, candidate.extendedCode].find(
      (value): value is string => typeof value === "string",
    );
    const message =
      typeof candidate.message === "string" ? candidate.message : "";
    const isUnique =
      code === "SQLITE_CONSTRAINT_UNIQUE" ||
      (code === "SQLITE_CONSTRAINT" && message.includes("UNIQUE constraint")) ||
      message.includes("UNIQUE constraint failed");
    const isIdempotencyIndex =
      message.includes("capability_operations_owner_idempotency_unique") ||
      (message.includes("capability_operations.ownerId") &&
        message.includes("capability_operations.capabilityKind") &&
        message.includes("capability_operations.idempotencyKey"));
    if (isUnique && isIdempotencyIndex) return true;
    current = candidate.cause;
  }
  return false;
}

export class CapabilityOperationStore {
  constructor(
    private readonly client: SqlClient = db.$client,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async reserve(input: {
    ownerId: string;
    capability: CapabilityKind;
    purpose: string;
    inputDigest: string;
    idempotencyKey: string;
    policySnapshot: unknown;
  }): Promise<{ operation: PublicCapabilityOperation; replayed: boolean }> {
    const capability = capabilityKindSchema.parse(input.capability);
    const purpose = capabilityPurposeSchema.parse(input.purpose);
    const policySnapshotDigest = frozenPolicySnapshotDigest(
      input.policySnapshot,
    );
    const existing = await this.client.execute({
      sql: `SELECT * FROM capability_operations
        WHERE ownerId = ? AND capabilityKind = ? AND idempotencyKey = ? LIMIT 1`,
      args: [input.ownerId, capability, input.idempotencyKey],
    });
    const existingRow = existing.rows[0] as Row | undefined;
    if (existingRow) {
      if (
        String(existingRow.inputDigest) !== input.inputDigest ||
        String(existingRow.purpose) !== purpose ||
        String(existingRow.policySnapshotDigest) !== policySnapshotDigest
      ) {
        throw new CapabilityOperationStoreError(
          "DIVERGENT_REPLAY",
          "Capability idempotency key was reused with different input",
        );
      }
      return { operation: operationFromRow(existingRow), replayed: true };
    }
    const id = newId("cop");
    const now = capabilityEpoch(this.clock());
    try {
      await this.client.execute({
        sql: `INSERT INTO capability_operations (
          id, ownerId, capabilityKind, purpose, inputDigest, idempotencyKey,
          policySnapshotJson, policySnapshotDigest, state, revision,
          createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'reserved', 1, ?, ?)`,
        args: [
          id,
          input.ownerId,
          capability,
          purpose,
          input.inputDigest,
          input.idempotencyKey,
          JSON.stringify(input.policySnapshot),
          policySnapshotDigest,
          now,
          now,
        ],
      });
    } catch (error) {
      // A concurrent identical reservation may win the UNIQUE constraint.
      // Re-read exactly once; schema, IO and lock failures must never recurse.
      if (!isIdempotencyUniqueViolation(error)) throw error;
      const collision = await this.client.execute({
        sql: `SELECT * FROM capability_operations
          WHERE ownerId = ? AND capabilityKind = ? AND idempotencyKey = ? LIMIT 1`,
        args: [input.ownerId, capability, input.idempotencyKey],
      });
      const row = collision.rows[0] as Row | undefined;
      if (!row) throw error;
      if (
        String(row.inputDigest) !== input.inputDigest ||
        String(row.purpose) !== purpose ||
        String(row.policySnapshotDigest) !== policySnapshotDigest
      ) {
        throw new CapabilityOperationStoreError(
          "DIVERGENT_REPLAY",
          "Capability idempotency key was reused with different input",
        );
      }
      return { operation: operationFromRow(row), replayed: true };
    }
    const created = await this.get(input.ownerId, id);
    if (!created)
      throw new Error("Reserved capability operation is unreadable");
    return { operation: created, replayed: false };
  }

  async get(ownerId: string, operationId: string) {
    const row = await ownedOperationRow(this.client, ownerId, operationId);
    return row ? operationFromRow(row) : null;
  }

  async findByIdempotencyKey(
    ownerId: string,
    capability: CapabilityKind,
    idempotencyKey: string,
  ) {
    const result = await this.client.execute({
      sql: `SELECT * FROM capability_operations
        WHERE ownerId = ? AND capabilityKind = ? AND idempotencyKey = ? LIMIT 1`,
      args: [ownerId, capability, idempotencyKey],
    });
    const row = result.rows[0] as Row | undefined;
    return row ? operationFromRow(row) : null;
  }

  async getPolicySnapshot(
    ownerId: string,
    operationId: string,
  ): Promise<unknown | null> {
    const result = await this.client.execute({
      sql: `SELECT policySnapshotJson FROM capability_operations
        WHERE id = ? AND ownerId = ? LIMIT 1`,
      args: [operationId, ownerId],
    });
    const row = result.rows[0] as Row | undefined;
    return row ? capabilityJson(row.policySnapshotJson) : null;
  }

  /** Owner-bound typed result replay; never exposes another operation's payload. */
  async getResult<K extends CapabilityKind>(
    ownerId: string,
    operationId: string,
    capability: K,
  ): Promise<CapabilityResultMap[K] | null> {
    const result = await this.client.execute({
      sql: `SELECT capabilityKind, state, resultRefJson
        FROM capability_operations
        WHERE id = ? AND ownerId = ? LIMIT 1`,
      args: [operationId, ownerId],
    });
    const row = result.rows[0] as Row | undefined;
    if (
      !row ||
      row.state !== "completed" ||
      row.resultRefJson === null ||
      row.capabilityKind !== capability
    ) {
      return null;
    }
    return capabilityResultSchemas[capability].parse(
      capabilityJson(row.resultRefJson),
    ) as CapabilityResultMap[K];
  }

  async list(input: {
    ownerId: string;
    limit?: number;
    state?: CapabilityOperationState;
  }): Promise<PublicCapabilityOperation[]> {
    const limit = Math.max(1, Math.min(input.limit ?? 50, 250));
    const result = await this.client.execute({
      sql: `SELECT * FROM capability_operations WHERE ownerId = ?
        ${input.state ? "AND state = ?" : ""}
        ORDER BY createdAt DESC, id DESC LIMIT ?`,
      args: [input.ownerId, ...(input.state ? [input.state] : []), limit],
    });
    return (result.rows as Row[]).map(operationFromRow);
  }

  async detail(
    ownerId: string,
    operationId: string,
  ): Promise<PublicCapabilityOperationDetail | null> {
    const operation = await this.get(ownerId, operationId);
    if (!operation) return null;
    const [attempts, usage] = await Promise.all([
      this.client.execute({
        sql: `SELECT attempt.* FROM capability_attempts attempt
          JOIN capability_operations operation ON operation.id = attempt.operationId
          WHERE attempt.operationId = ? AND operation.ownerId = ?
          ORDER BY attempt.ordinal`,
        args: [operationId, ownerId],
      }),
      this.client.execute({
        sql: `SELECT usage.* FROM capability_usage usage
          JOIN capability_operations operation ON operation.id = usage.operationId
          WHERE usage.operationId = ? AND operation.ownerId = ?
          ORDER BY usage.createdAt, usage.id`,
        args: [operationId, ownerId],
      }),
    ]);
    return {
      operation,
      attempts: (attempts.rows as Row[]).map(attemptFromRow),
      usage: (usage.rows as Row[]).map(usageFromRow),
    };
  }

  async freezeRoute(input: {
    ownerId: string;
    operationId: string;
    expectedRevision: number;
    routePlan: FrozenCapabilityRoutePlan;
  }): Promise<PublicCapabilityOperation> {
    const routePlan = frozenCapabilityRoutePlanSchema.parse(input.routePlan);
    if (
      routePlan.ownerId !== input.ownerId ||
      routePlan.operationId !== input.operationId
    ) {
      throw new CapabilityOperationStoreError(
        "ROUTE_MISMATCH",
        "Frozen route does not belong to this operation",
      );
    }
    const { digest: _digest, ...digestPayload } = routePlan;
    if (capabilityDigest(digestPayload) !== routePlan.digest) {
      throw new CapabilityOperationStoreError(
        "ROUTE_MISMATCH",
        "Frozen route digest does not match its snapshot",
      );
    }
    const now = capabilityEpoch(this.clock());
    const result = await this.client.execute({
      sql: `UPDATE capability_operations SET routePlanJson = ?,
        routePlanDigest = ?, state = 'ready', revision = revision + 1,
        updatedAt = ? WHERE id = ? AND ownerId = ? AND revision = ?
          AND policySnapshotDigest = ?
          AND state IN ('reserved', 'routing') AND routePlanJson IS NULL`,
      args: [
        JSON.stringify(routePlan),
        routePlan.digest,
        now,
        input.operationId,
        input.ownerId,
        input.expectedRevision,
        routePlan.policySnapshotDigest,
      ],
    });
    if (Number(result.rowsAffected) !== 1) {
      throw new CapabilityOperationStoreError(
        "REVISION_CONFLICT",
        "Capability operation changed before route freeze",
      );
    }
    return (await this.get(input.ownerId, input.operationId))!;
  }

  async beginAttempt(input: {
    ownerId: string;
    operationId: string;
    expectedOperationRevision: number;
    offeringId: string;
    requestDigest: string;
    credentialVersion: number | null;
    consentRevision: number | null;
  }): Promise<CapabilityAttempt> {
    const transaction = await this.client.transaction("write");
    try {
      const operation = await ownedOperationRow(
        transaction,
        input.ownerId,
        input.operationId,
      );
      if (!operation) {
        throw new CapabilityOperationStoreError(
          "NOT_FOUND",
          "Operation not found",
        );
      }
      if (
        Number(operation.revision) !== input.expectedOperationRevision ||
        !["ready", "dispatching", "waiting-provider"].includes(
          String(operation.state),
        )
      ) {
        throw new CapabilityOperationStoreError(
          "REVISION_CONFLICT",
          "Operation changed before attempt dispatch",
        );
      }
      const routePlan = frozenCapabilityRoutePlanSchema.parse(
        capabilityJson(operation.routePlanJson),
      );
      if (
        ![routePlan.primary, ...routePlan.fallbacks].some(
          (route) => route.offeringId === input.offeringId,
        )
      ) {
        throw new CapabilityOperationStoreError(
          "ROUTE_MISMATCH",
          "Attempt offering is absent from the frozen route",
        );
      }
      const ordinals = await transaction.execute({
        sql: `SELECT COALESCE(MAX(ordinal), -1) + 1 AS ordinal
          FROM capability_attempts WHERE operationId = ?`,
        args: [input.operationId],
      });
      const ordinal = Number(ordinals.rows[0]?.ordinal ?? 0);
      const id = newId("catt");
      const now = capabilityEpoch(this.clock());
      await transaction.execute({
        sql: `INSERT INTO capability_attempts (
          id, operationId, ordinal, offeringId, requestDigest, state,
          credentialVersion, consentRevision, retryable, ambiguous, startedAt
        ) VALUES (?, ?, ?, ?, ?, 'dispatching', ?, ?, 0, 0, ?)`,
        args: [
          id,
          input.operationId,
          ordinal,
          input.offeringId,
          input.requestDigest,
          input.credentialVersion,
          input.consentRevision,
          now,
        ],
      });
      const operationUpdate = await transaction.execute({
        sql: `UPDATE capability_operations SET state = 'dispatching',
          revision = revision + 1, updatedAt = ?
          WHERE id = ? AND ownerId = ? AND revision = ?`,
        args: [
          now,
          input.operationId,
          input.ownerId,
          input.expectedOperationRevision,
        ],
      });
      if (Number(operationUpdate.rowsAffected) !== 1) {
        throw new CapabilityOperationStoreError(
          "REVISION_CONFLICT",
          "Operation changed before attempt dispatch",
        );
      }
      await transaction.commit();
      const attempts = await this.detail(input.ownerId, input.operationId);
      return attempts!.attempts.find((attempt) => attempt.id === id)!;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async acknowledgeAttempt(input: {
    ownerId: string;
    operationId: string;
    attemptId: string;
    providerRequestId: string | null;
  }): Promise<void> {
    const now = capabilityEpoch(this.clock());
    const result = await this.client.execute({
      sql: `UPDATE capability_attempts SET state = 'acknowledged',
        providerRequestId = ?, acknowledgedAt = ?
        WHERE id = ? AND operationId = ? AND state = 'dispatching'
          AND operationId IN (SELECT id FROM capability_operations WHERE ownerId = ?)`,
      args: [
        input.providerRequestId,
        now,
        input.attemptId,
        input.operationId,
        input.ownerId,
      ],
    });
    if (Number(result.rowsAffected) !== 1) {
      throw new CapabilityOperationStoreError(
        "INVALID_TRANSITION",
        "Attempt cannot be acknowledged",
      );
    }
    await this.client.execute({
      sql: `UPDATE capability_operations SET state = 'acknowledged',
        revision = revision + 1, updatedAt = ?
        WHERE id = ? AND ownerId = ? AND state = 'dispatching'`,
      args: [now, input.operationId, input.ownerId],
    });
  }

  /**
   * Durable proof that the reviewed adapter crossed its final pre-provider
   * authorization fence. This is deliberately written before the side effect:
   * an immediate process crash is therefore billed conservatively instead of
   * releasing an expired reservation as if dispatch were known not to happen.
   */
  async markProviderDispatch(input: {
    ownerId: string;
    operationId: string;
    attemptId: string;
  }): Promise<void> {
    const now = capabilityEpoch(this.clock());
    const result = await this.client.execute({
      sql: `UPDATE capability_attempts SET
        providerDispatchedAt = COALESCE(providerDispatchedAt, ?)
        WHERE id = ? AND operationId = ?
          AND state IN ('dispatching', 'acknowledged', 'waiting-provider')
          AND operationId IN (
            SELECT id FROM capability_operations
            WHERE id = ? AND ownerId = ?
              AND state IN ('dispatching', 'acknowledged', 'waiting-provider')
          )`,
      args: [
        now,
        input.attemptId,
        input.operationId,
        input.operationId,
        input.ownerId,
      ],
    });
    if (Number(result.rowsAffected) !== 1) {
      throw new CapabilityOperationStoreError(
        "INVALID_TRANSITION",
        "Provider dispatch cannot be armed for an inactive attempt",
      );
    }
  }

  async complete(input: {
    ownerId: string;
    operationId: string;
    attemptId: string;
    result: unknown;
    usage: CapabilityUsage;
    resultDigest?: string;
  }): Promise<PublicCapabilityOperation> {
    const now = capabilityEpoch(this.clock());
    const resultDigest = input.resultDigest ?? capabilityDigest(input.result);
    const transaction = await this.client.transaction("write");
    try {
      const operationRow = await ownedOperationRow(
        transaction,
        input.ownerId,
        input.operationId,
      );
      const attemptRow = await ownedAttemptRow(
        transaction,
        input.ownerId,
        input.operationId,
        input.attemptId,
      );
      if (!operationRow || !attemptRow) {
        throw new CapabilityOperationStoreError(
          "NOT_FOUND",
          "Operation or attempt not found",
        );
      }
      const operationState = String(operationRow.state);
      const attemptState = String(attemptRow.state);
      const completedReplay =
        operationState === "completed" && attemptState === "completed";
      if (
        completedReplay &&
        String(operationRow.resultDigest ?? "") !== resultDigest
      ) {
        throw new CapabilityOperationStoreError(
          "DIVERGENT_REPLAY",
          "Completed operation is already bound to another result",
        );
      }
      if (
        !completedReplay &&
        (!["dispatching", "acknowledged", "waiting-provider"].includes(
          operationState,
        ) ||
          !["dispatching", "acknowledged", "waiting-provider"].includes(
            attemptState,
          ))
      ) {
        throw new CapabilityOperationStoreError(
          "INVALID_TRANSITION",
          "Operation and attempt cannot complete from their current states",
        );
      }
      await persistUsageEnvelope(transaction, {
        ownerId: input.ownerId,
        operationId: input.operationId,
        attemptId: input.attemptId,
        usage: input.usage,
        now,
      });
      if (completedReplay) {
        await transaction.commit();
        return operationFromRow(operationRow);
      }
      const attempt = await transaction.execute({
        sql: `UPDATE capability_attempts SET state = 'completed', completedAt = ?
          WHERE id = ? AND operationId = ?
            AND state IN ('dispatching', 'acknowledged', 'waiting-provider')`,
        args: [now, input.attemptId, input.operationId],
      });
      if (Number(attempt.rowsAffected) !== 1) {
        throw new CapabilityOperationStoreError(
          "INVALID_TRANSITION",
          "Attempt cannot complete from its current state",
        );
      }
      const operation = await transaction.execute({
        sql: `UPDATE capability_operations SET state = 'completed',
          resultRefJson = ?, resultDigest = ?, safeErrorCode = NULL,
          retryable = 0, ambiguous = 0, completedAt = ?, updatedAt = ?,
          revision = revision + 1
          WHERE id = ? AND ownerId = ?
            AND state IN ('dispatching', 'acknowledged', 'waiting-provider')`,
        args: [
          JSON.stringify(input.result),
          resultDigest,
          now,
          now,
          input.operationId,
          input.ownerId,
        ],
      });
      if (Number(operation.rowsAffected) !== 1) {
        throw new CapabilityOperationStoreError(
          "INVALID_TRANSITION",
          "Operation cannot complete from its current state",
        );
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    return (await this.get(input.ownerId, input.operationId))!;
  }

  async failAttempt(input: {
    ownerId: string;
    operationId: string;
    attemptId: string;
    error: CapabilityError;
    terminal: boolean;
  }): Promise<PublicCapabilityOperation> {
    const code = capabilityErrorCodeSchema.parse(input.error.code);
    const now = capabilityEpoch(this.clock());
    const attemptState = input.error.ambiguous ? "inspect-required" : "failed";
    const transaction = await this.client.transaction("write");
    try {
      const operation = await ownedOperationRow(
        transaction,
        input.ownerId,
        input.operationId,
      );
      const attempt = await ownedAttemptRow(
        transaction,
        input.ownerId,
        input.operationId,
        input.attemptId,
      );
      if (!operation || !attempt) {
        throw new CapabilityOperationStoreError(
          "NOT_FOUND",
          "Operation or attempt not found",
        );
      }
      // Cancellation/completion may win after the executor's last read. A late
      // failure must never revive that operation or rewrite a terminal attempt.
      const terminalStates = [
        "completed",
        "failed",
        "cancelled",
        "inspect-required",
      ];
      if (
        terminalStates.includes(String(operation.state)) ||
        terminalStates.includes(String(attempt.state))
      ) {
        await transaction.commit();
        return operationFromRow(operation);
      }
      await transaction.execute({
        sql: `UPDATE capability_attempts SET state = ?, errorClass = ?,
          retryable = ?, ambiguous = ?, safeDiagnosticJson = ?, completedAt = ?
          WHERE id = ? AND operationId = ?
            AND operationId IN (SELECT id FROM capability_operations WHERE ownerId = ?)`,
        args: [
          attemptState,
          code,
          input.error.retryable ? 1 : 0,
          input.error.ambiguous ? 1 : 0,
          input.error.safeDiagnostic
            ? JSON.stringify(input.error.safeDiagnostic)
            : null,
          now,
          input.attemptId,
          input.operationId,
          input.ownerId,
        ],
      });
      if (input.terminal || input.error.ambiguous) {
        await transaction.execute({
          sql: `UPDATE capability_operations SET state = ?, safeErrorCode = ?,
            retryable = ?, ambiguous = ?, completedAt = ?, updatedAt = ?,
            revision = revision + 1 WHERE id = ? AND ownerId = ?
            AND state NOT IN ('completed', 'cancelled')`,
          args: [
            input.error.ambiguous ? "inspect-required" : "failed",
            code,
            input.error.retryable ? 1 : 0,
            input.error.ambiguous ? 1 : 0,
            now,
            now,
            input.operationId,
            input.ownerId,
          ],
        });
      } else {
        await transaction.execute({
          sql: `UPDATE capability_operations SET state = 'ready',
            revision = revision + 1, updatedAt = ?
            WHERE id = ? AND ownerId = ?`,
          args: [now, input.operationId, input.ownerId],
        });
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    return (await this.get(input.ownerId, input.operationId))!;
  }

  async cancel(input: {
    ownerId: string;
    operationId: string;
    expectedRevision: number;
  }): Promise<PublicCapabilityOperation> {
    const now = capabilityEpoch(this.clock());
    const transaction = await this.client.transaction("write");
    try {
      const updated = await transaction.execute({
        sql: `UPDATE capability_operations SET state = 'cancelled',
          safeErrorCode = 'CANCELLED', retryable = 0, ambiguous = 0,
          completedAt = ?, updatedAt = ?, revision = revision + 1
          WHERE id = ? AND ownerId = ? AND revision = ?
            AND state NOT IN ('completed', 'failed', 'cancelled', 'inspect-required')`,
        args: [
          now,
          now,
          input.operationId,
          input.ownerId,
          input.expectedRevision,
        ],
      });
      if (Number(updated.rowsAffected) !== 1) {
        throw new CapabilityOperationStoreError(
          "REVISION_CONFLICT",
          "Operation cannot be cancelled at this revision",
        );
      }
      await transaction.execute({
        sql: `UPDATE capability_attempts SET state = 'cancelled',
          errorClass = 'CANCELLED', retryable = 0, ambiguous = 0,
          safeDiagnosticJson = NULL, completedAt = ?
          WHERE operationId = ?
            AND state NOT IN ('completed', 'failed', 'cancelled', 'inspect-required')`,
        args: [now, input.operationId],
      });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    return (await this.get(input.ownerId, input.operationId))!;
  }

  async recordUsage(input: {
    ownerId: string;
    operationId: string;
    attemptId: string;
    usage: CapabilityUsage;
  }): Promise<{ digest: string; replayed: boolean }> {
    const now = capabilityEpoch(this.clock());
    const transaction = await this.client.transaction("write");
    try {
      const persisted = await persistUsageEnvelope(transaction, {
        ...input,
        now,
      });
      await transaction.commit();
      return persisted;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
}
