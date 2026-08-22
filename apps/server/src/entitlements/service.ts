import type {
  Client,
  InStatement,
  InValue,
  Transaction,
} from "@libsql/client";
import {
  capabilityEntitlementSchema,
  entitlementDecisionV1Schema,
  entitlementSnapshotV1Schema,
  managedCapabilitySchema,
  usageQuantitySchema,
  usageUnitSchema,
  type CapabilityEntitlement,
  type EntitlementDecisionV1,
  type EntitlementSnapshotV1,
  type ManagedCapability,
  type UsageUnit,
} from "@avermate/agent-contracts";
import { newId } from "../lib/id";
import { SecurityAuditWriter } from "../observability/audit";
import {
  CAPABILITY_UNITS,
  FREE_MANAGED_ENTITLEMENTS,
  SELF_HOST_ENTITLEMENTS,
} from "./capabilities";

export type EntitlementSqlClient = Pick<
  Client,
  "execute" | "batch" | "transaction"
>;
export type EntitlementSqlTarget = Pick<Client, "execute"> | Transaction;

type Row = Record<string, InValue>;

function seconds(date: Date) {
  return Math.floor(date.getTime() / 1_000);
}

function iso(value: InValue) {
  const numeric = Number(value);
  return new Date(numeric < 10_000_000_000 ? numeric * 1_000 : numeric).toISOString();
}

function json<T>(value: InValue): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

function rowToSnapshot(row: Row): EntitlementSnapshotV1 {
  return entitlementSnapshotV1Schema.parse({
    version: 1,
    id: String(row.id),
    accountId: String(row.accountId),
    revision: String(row.revision),
    plan: String(row.plan),
    status: row.status,
    period: {
      startsAt: iso(row.periodStartsAt),
      endsAt: iso(row.periodEndsAt),
    },
    capabilities: json(row.capabilitiesJson),
    source: row.source,
    issuedAt: iso(row.issuedAt),
  });
}

export class EntitlementPolicyError extends Error {
  constructor(
    readonly code:
      | "not-found"
      | "invalid-entitlement"
      | "capability-denied"
      | "conflict",
    message: string,
  ) {
    super(message);
    this.name = "EntitlementPolicyError";
  }
}

export type ResolvedEntitlement = {
  snapshot: EntitlementSnapshotV1;
  entitlement: CapabilityEntitlement;
  activeGrantIds: string[];
  emergencyDisabled: boolean;
};

export type EntitlementDecisionInput = {
  accountId: string;
  capability: ManagedCapability;
  quantity: string;
  unit: UsageUnit;
  aggregateBefore: string;
  activeReservations?: number;
};

export class EntitlementService {
  readonly #client: EntitlementSqlClient;
  readonly #mode: "shadow" | "enforce";
  readonly #selfHost: boolean;
  readonly #clock: () => Date;
  readonly #audit: SecurityAuditWriter;
  readonly #cache = new Map<
    string,
    { expiresAt: number; snapshot: EntitlementSnapshotV1 }
  >();
  readonly #cacheTtlMs: number;

  constructor(
    client: EntitlementSqlClient,
    options: {
      mode?: "shadow" | "enforce";
      selfHost?: boolean;
      clock?: () => Date;
      cacheTtlMs?: number;
    } = {},
  ) {
    this.#client = client;
    this.#mode = options.mode ?? "shadow";
    this.#selfHost = options.selfHost ?? false;
    this.#clock = options.clock ?? (() => new Date());
    this.#cacheTtlMs = Math.min(options.cacheTtlMs ?? 15_000, 60_000);
    this.#audit = new SecurityAuditWriter(client, this.#clock);
  }

  get mode() {
    return this.#mode;
  }

  invalidate(accountId: string) {
    this.#cache.delete(accountId);
  }

  async publishSnapshot(
    raw: EntitlementSnapshotV1,
    actor: { actorId: string; justification: string; correlationId: string },
  ) {
    const snapshot = entitlementSnapshotV1Schema.parse(raw);
    if (snapshot.period.endsAt <= snapshot.period.startsAt) {
      throw new EntitlementPolicyError(
        "invalid-entitlement",
        "Entitlement period is invalid",
      );
    }
    const tx = await this.#client.transaction("write");
    try {
      await tx.execute({
        sql: `INSERT INTO entitlement_snapshots
          (id, accountId, revision, plan, status, periodStartsAt, periodEndsAt,
           capabilitiesJson, source, issuedAt, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          snapshot.id,
          snapshot.accountId,
          snapshot.revision,
          snapshot.plan,
          snapshot.status,
          seconds(new Date(snapshot.period.startsAt)),
          seconds(new Date(snapshot.period.endsAt)),
          JSON.stringify(snapshot.capabilities),
          snapshot.source,
          seconds(new Date(snapshot.issuedAt)),
          seconds(this.#clock()),
        ],
      });
      await this.#audit.append(
        {
          accountId: snapshot.accountId,
          actorId: actor.actorId,
          actorKind: "admin",
          action: "entitlement.snapshot-published",
          resourceKind: "entitlement-snapshot",
          resourceId: snapshot.id,
          justification: actor.justification,
          correlationId: actor.correlationId,
          policyVersion: "managed-entitlements/1",
          metadata: {
            revision: snapshot.revision,
            plan: snapshot.plan,
            status: snapshot.status,
            source: snapshot.source,
          },
        },
        tx,
      );
      await tx.commit();
      this.invalidate(snapshot.accountId);
      return snapshot;
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  async grant(
    input: {
      accountId: string;
      capability: ManagedCapability;
      entitlement: CapabilityEntitlement;
      expiresAt: Date;
      actorId: string;
      reason: string;
      correlationId: string;
    },
  ) {
    const capability = managedCapabilitySchema.parse(input.capability);
    const entitlement = capabilityEntitlementSchema.parse(input.entitlement);
    if (input.expiresAt <= this.#clock()) {
      throw new EntitlementPolicyError(
        "invalid-entitlement",
        "Grant expiry must be in the future",
      );
    }
    const id = newId("entg");
    const tx = await this.#client.transaction("write");
    try {
      await tx.execute({
        sql: `INSERT INTO entitlement_grants
          (id, accountId, capability, entitlementJson, reason, actorId,
           expiresAt, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id,
          input.accountId,
          capability,
          JSON.stringify(entitlement),
          input.reason,
          input.actorId,
          seconds(input.expiresAt),
          seconds(this.#clock()),
        ],
      });
      await this.#audit.append(
        {
          accountId: input.accountId,
          actorId: input.actorId,
          actorKind: "admin",
          action: "entitlement.grant-created",
          resourceKind: "entitlement-grant",
          resourceId: id,
          justification: input.reason,
          correlationId: input.correlationId,
          policyVersion: "managed-entitlements/1",
          metadata: { capability, entitlement, expiresAt: input.expiresAt },
        },
        tx,
      );
      await tx.commit();
      this.invalidate(input.accountId);
      return { id };
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  async setEmergencyDisabled(input: {
    accountId: string;
    disabled: boolean;
    actorId: string;
    actorKind: "user" | "admin";
    justification: string;
    correlationId: string;
  }) {
    const tx = await this.#client.transaction("write");
    try {
      await tx.execute({
        sql: `INSERT INTO account_execution_controls
          (accountId, paidExecutionDisabled, revision, updatedAt)
          VALUES (?, ?, 1, ?)
          ON CONFLICT(accountId) DO UPDATE SET
            paidExecutionDisabled = excluded.paidExecutionDisabled,
            revision = account_execution_controls.revision + 1,
            updatedAt = excluded.updatedAt`,
        args: [
          input.accountId,
          input.disabled ? 1 : 0,
          seconds(this.#clock()),
        ],
      });
      await this.#audit.append(
        {
          accountId: input.accountId,
          actorId: input.actorId,
          actorKind: input.actorKind,
          action: input.disabled
            ? "managed-execution.disabled"
            : "managed-execution.enabled",
          resourceKind: "account-execution-control",
          resourceId: input.accountId,
          justification: input.justification,
          correlationId: input.correlationId,
          policyVersion: "managed-entitlements/1",
        },
        tx,
      );
      await tx.commit();
      this.invalidate(input.accountId);
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  async resolve(
    accountId: string,
    capability: ManagedCapability,
    target: EntitlementSqlTarget = this.#client,
  ): Promise<ResolvedEntitlement> {
    managedCapabilitySchema.parse(capability);
    const now = this.#clock();
    let snapshot: EntitlementSnapshotV1 | undefined;
    if (target === this.#client) {
      const cached = this.#cache.get(accountId);
      if (cached && cached.expiresAt > now.getTime()) snapshot = cached.snapshot;
    }
    if (!snapshot) {
      const rows = await target.execute({
        sql: `SELECT * FROM entitlement_snapshots
          WHERE accountId = ? AND periodStartsAt <= ? AND periodEndsAt > ?
          ORDER BY issuedAt DESC, createdAt DESC LIMIT 1`,
        args: [accountId, seconds(now), seconds(now)],
      });
      const row = rows.rows[0] as Row | undefined;
      snapshot = row
        ? rowToSnapshot(row)
        : await this.#ensureDefault(accountId, target);
      if (target === this.#client) {
        this.#cache.set(accountId, {
          expiresAt: now.getTime() + this.#cacheTtlMs,
          snapshot,
        });
      }
    }

    const grantRows = await target.execute({
      sql: `SELECT id, entitlementJson FROM entitlement_grants
        WHERE accountId = ? AND capability = ? AND revokedAt IS NULL
          AND expiresAt > ? ORDER BY createdAt ASC`,
      args: [accountId, capability, seconds(now)],
    });
    let entitlement = snapshot.capabilities[capability];
    const activeGrantIds: string[] = [];
    for (const grant of grantRows.rows as Row[]) {
      entitlement = capabilityEntitlementSchema.parse(
        json(grant.entitlementJson),
      );
      activeGrantIds.push(String(grant.id));
    }
    entitlement ??= {
      enabled: false,
      hardLimit: "0",
      softLimit: "0",
      unit: CAPABILITY_UNITS[capability],
      concurrency: 0,
    };
    const control = await target.execute({
      sql: `SELECT paidExecutionDisabled FROM account_execution_controls
        WHERE accountId = ? LIMIT 1`,
      args: [accountId],
    });
    return {
      snapshot,
      entitlement,
      activeGrantIds,
      emergencyDisabled: Number(control.rows[0]?.paidExecutionDisabled ?? 0) === 1,
    };
  }

  async decide(
    raw: EntitlementDecisionInput,
    target: EntitlementSqlTarget = this.#client,
  ): Promise<EntitlementDecisionV1> {
    const input = {
      ...raw,
      capability: managedCapabilitySchema.parse(raw.capability),
      quantity: usageQuantitySchema.parse(raw.quantity),
      aggregateBefore: usageQuantitySchema.parse(raw.aggregateBefore),
      unit: usageUnitSchema.parse(raw.unit),
    };
    const resolved = await this.resolve(input.accountId, input.capability, target);
    if (
      resolved.entitlement.unit &&
      resolved.entitlement.unit !== input.unit
    ) {
      throw new EntitlementPolicyError(
        "invalid-entitlement",
        "Capability unit does not match its entitlement",
      );
    }

    let reason: EntitlementDecisionV1["reason"] = "allowed";
    if (resolved.emergencyDisabled) reason = "emergency-disabled";
    else if (
      resolved.snapshot.status === "restricted" ||
      resolved.snapshot.status === "cancelled"
    ) {
      reason = "entitlement-restricted";
    } else if (!resolved.entitlement.enabled) reason = "capability-disabled";
    else if (
      resolved.entitlement.hardLimit !== undefined &&
      BigInt(input.aggregateBefore) + BigInt(input.quantity) >
        BigInt(resolved.entitlement.hardLimit)
    ) {
      reason = "hard-limit-exceeded";
    } else if (
      resolved.entitlement.concurrency !== undefined &&
      (input.activeReservations ?? 0) >= resolved.entitlement.concurrency
    ) {
      reason = "hard-limit-exceeded";
    }
    const wouldBlock = reason !== "allowed";
    const allowed =
      !wouldBlock ||
      (this.#mode === "shadow" && reason !== "emergency-disabled");
    const decision = entitlementDecisionV1Schema.parse({
      version: 1,
      decisionId: newId("entd"),
      accountId: input.accountId,
      snapshotId: resolved.snapshot.id,
      snapshotRevision: resolved.snapshot.revision,
      capability: input.capability,
      quantity: input.quantity,
      unit: input.unit,
      mode: this.#mode,
      allowed,
      wouldBlock,
      reason,
      decidedAt: this.#clock().toISOString(),
    });
    await target.execute({
      sql: `INSERT INTO entitlement_decisions
        (id, accountId, snapshotId, snapshotRevision, capability, quantity,
         unit, mode, allowed, wouldBlock, reason, aggregateBefore, decidedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        decision.decisionId,
        decision.accountId,
        decision.snapshotId,
        decision.snapshotRevision,
        decision.capability,
        decision.quantity,
        decision.unit,
        decision.mode,
        decision.allowed ? 1 : 0,
        decision.wouldBlock ? 1 : 0,
        decision.reason,
        input.aggregateBefore,
        seconds(new Date(decision.decidedAt)),
      ],
    });
    return decision;
  }

  async #ensureDefault(
    accountId: string,
    target: EntitlementSqlTarget,
  ): Promise<EntitlementSnapshotV1> {
    const source = this.#selfHost ? "self-host" : "free";
    const id = `ents_default_${source.replace("-", "_")}_${accountId}`;
    const snapshot = entitlementSnapshotV1Schema.parse({
      version: 1,
      id,
      accountId,
      revision: `${source}/1`,
      plan: source,
      status: "active",
      period: {
        startsAt: "2000-01-01T00:00:00.000Z",
        endsAt: "9999-12-31T23:59:59.000Z",
      },
      capabilities: this.#selfHost
        ? SELF_HOST_ENTITLEMENTS
        : FREE_MANAGED_ENTITLEMENTS,
      source,
      issuedAt: "2000-01-01T00:00:00.000Z",
    });
    await target.execute({
      sql: `INSERT OR IGNORE INTO entitlement_snapshots
        (id, accountId, revision, plan, status, periodStartsAt, periodEndsAt,
         capabilitiesJson, source, issuedAt, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        snapshot.id,
        accountId,
        snapshot.revision,
        snapshot.plan,
        snapshot.status,
        seconds(new Date(snapshot.period.startsAt)),
        seconds(new Date(snapshot.period.endsAt)),
        JSON.stringify(snapshot.capabilities),
        snapshot.source,
        seconds(new Date(snapshot.issuedAt)),
        seconds(this.#clock()),
      ],
    });
    const result = await target.execute({
      sql: "SELECT * FROM entitlement_snapshots WHERE id = ? LIMIT 1",
      args: [id],
    });
    const row = result.rows[0] as Row | undefined;
    if (!row) {
      throw new EntitlementPolicyError(
        "not-found",
        "Default entitlement snapshot could not be created",
      );
    }
    return rowToSnapshot(row);
  }
}
