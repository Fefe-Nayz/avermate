import type { Client, InValue, Transaction } from "@libsql/client";
import {
  capabilityPlacementSchema,
  managedCapabilitySchema,
  usageQuantitySchema,
  usageReservationV1Schema,
  usageUnitSchema,
  type CapabilityPlacement,
  type EntitlementDecisionV1,
  type ManagedCapability,
  type UsageReservationV1,
  type UsageUnit,
} from "@avermate/agent-contracts";
import {
  EntitlementPolicyError,
  EntitlementService,
  type EntitlementSqlClient,
} from "../entitlements/service";
import { newId } from "../lib/id";
import { SecurityAuditWriter } from "../observability/audit";

type Row = Record<string, InValue>;

function seconds(date: Date) {
  return Math.floor(date.getTime() / 1_000);
}

function iso(value: InValue): string {
  const numeric = Number(value);
  return new Date(numeric < 10_000_000_000 ? numeric * 1_000 : numeric).toISOString();
}

function nullableIso(value: InValue): string | undefined {
  return value === null ? undefined : iso(value);
}

function json<T>(value: InValue): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
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

function reservationFromRow(row: Row): UsageReservationV1 {
  return usageReservationV1Schema.parse({
    version: 1,
    id: String(row.id),
    accountId: String(row.accountId),
    userId: row.userId === null ? undefined : String(row.userId),
    capability: row.capability,
    unit: row.unit,
    reservedQuantity: String(row.reservedQuantity),
    consumedQuantity: String(row.consumedQuantity),
    releasedQuantity: String(row.releasedQuantity),
    status: row.status,
    idempotencyKey: String(row.idempotencyKey),
    decisionId: String(row.decisionId),
    entitlementSnapshotId: String(row.entitlementSnapshotId),
    placement: json(row.placementJson),
    runId: row.runId === null ? undefined : String(row.runId),
    jobId: row.jobId === null ? undefined : String(row.jobId),
    expiresAt: iso(row.expiresAt),
    createdAt: iso(row.createdAt),
    settledAt: nullableIso(row.settledAt),
  });
}

export class UsageLedgerError extends Error {
  constructor(
    readonly code:
      | "not-found"
      | "forbidden"
      | "conflict"
      | "invalid-state"
      | "capability-denied",
    message: string,
    readonly decision?: EntitlementDecisionV1,
  ) {
    super(message);
    this.name = "UsageLedgerError";
  }
}

export type UsageReservationInput = {
  accountId: string;
  userId?: string;
  capability: ManagedCapability;
  unit: UsageUnit;
  maximumQuantity: string;
  idempotencyKey: string;
  placement: CapabilityPlacement;
  runId?: string;
  jobId?: string;
  provider?: string;
  model?: string;
  pricingSnapshotId?: string;
  expiresAt: Date;
  estimatorVersion: string;
};

export type UsageSettlementInput = {
  accountId: string;
  reservationId: string;
  actualQuantity: string;
  outcome: "completed" | "failed" | "cancelled" | "expired";
  authoritative: boolean;
  provider?: string;
  model?: string;
  evidenceRef?: string;
};

export type UsageExpirySettlement = Pick<
  UsageSettlementInput,
  "actualQuantity" | "outcome" | "authoritative" | "evidenceRef"
>;

export type UsageExpirySettlementResolver = (
  reservation: UsageReservationV1,
) => Promise<UsageExpirySettlement | undefined>;

export class UsageLedger {
  readonly #client: EntitlementSqlClient;
  readonly #entitlements: EntitlementService;
  readonly #clock: () => Date;
  readonly #audit: SecurityAuditWriter;
  readonly #expirySettlement?: UsageExpirySettlementResolver;
  #writeTail: Promise<void> = Promise.resolve();

  constructor(
    client: EntitlementSqlClient,
    entitlements: EntitlementService,
    options: {
      clock?: () => Date;
      expirySettlement?: UsageExpirySettlementResolver;
    } = {},
  ) {
    this.#client = client;
    this.#entitlements = entitlements;
    this.#clock = options.clock ?? (() => new Date());
    this.#expirySettlement = options.expirySettlement;
    this.#audit = new SecurityAuditWriter(client, this.#clock);
  }

  async reserve(raw: UsageReservationInput): Promise<{
    reservation: UsageReservationV1;
    decision: EntitlementDecisionV1;
    replayed: boolean;
  }> {
    const input = {
      ...raw,
      capability: managedCapabilitySchema.parse(raw.capability),
      unit: usageUnitSchema.parse(raw.unit),
      maximumQuantity: usageQuantitySchema.parse(raw.maximumQuantity),
      placement: capabilityPlacementSchema.parse(raw.placement),
    };
    if (!input.idempotencyKey || input.idempotencyKey.length > 256) {
      throw new UsageLedgerError("invalid-state", "Invalid idempotency key");
    }
    if (input.expiresAt <= this.#clock()) {
      throw new UsageLedgerError(
        "invalid-state",
        "Reservation expiry must be in the future",
      );
    }

    const result = await this.#write(async (tx) => {
      const replay = await tx.execute({
        sql: `SELECT * FROM usage_reservations
          WHERE accountId = ? AND capability = ? AND idempotencyKey = ? LIMIT 1`,
        args: [input.accountId, input.capability, input.idempotencyKey],
      });
      const existing = replay.rows[0] as Row | undefined;
      if (existing) {
        if (
          String(existing.unit) !== input.unit ||
          String(existing.reservedQuantity) !== input.maximumQuantity ||
          canonical(json(existing.placementJson)) !== canonical(input.placement) ||
          String(existing.runId ?? "") !== (input.runId ?? "") ||
          String(existing.jobId ?? "") !== (input.jobId ?? "")
        ) {
          throw new UsageLedgerError(
            "conflict",
            "Idempotency key is already bound to different reservation inputs",
          );
        }
        const decision = await this.#decisionById(
          String(existing.decisionId),
          tx,
        );
        return {
          reservation: reservationFromRow(existing),
          decision,
          replayed: true,
        };
      }

      const resolved = await this.#entitlements.resolve(
        input.accountId,
        input.capability,
        tx,
      );
      const periodStart = seconds(new Date(resolved.snapshot.period.startsAt));
      const periodEnd = seconds(new Date(resolved.snapshot.period.endsAt));
      const aggregateRows = await tx.execute({
        sql: `SELECT consumedQuantity, adjustedQuantity
          FROM usage_period_aggregates
          WHERE accountId = ? AND capability = ? AND periodStartsAt = ?
            AND periodEndsAt = ? LIMIT 1`,
        args: [input.accountId, input.capability, periodStart, periodEnd],
      });
      const aggregate = aggregateRows.rows[0] as Row | undefined;
      const consumed = BigInt(String(aggregate?.consumedQuantity ?? "0"));
      const adjusted = BigInt(String(aggregate?.adjustedQuantity ?? "0"));
      const activeRows = await tx.execute({
        sql: `SELECT reservedQuantity, consumedQuantity, releasedQuantity
          FROM usage_reservations
          WHERE accountId = ? AND capability = ? AND status = 'reserved'
            AND expiresAt > ?`,
        args: [input.accountId, input.capability, seconds(this.#clock())],
      });
      const outstanding = (activeRows.rows as Row[]).reduce(
        (sum, row) =>
          sum +
          BigInt(String(row.reservedQuantity)) -
          BigInt(String(row.consumedQuantity)) -
          BigInt(String(row.releasedQuantity)),
        0n,
      );
      const accounted = consumed + adjusted + outstanding;
      const aggregateBefore = (accounted < 0n ? 0n : accounted).toString();
      const decision = await this.#entitlements.decide(
        {
          accountId: input.accountId,
          capability: input.capability,
          quantity: input.maximumQuantity,
          unit: input.unit,
          aggregateBefore,
          activeReservations: activeRows.rows.length,
        },
        tx,
      );
      if (!decision.allowed) return { denied: decision } as const;

      const id = newId("ures");
      const now = this.#clock();
      await tx.execute({
        sql: `INSERT INTO usage_reservations
          (id, accountId, userId, capability, unit, reservedQuantity,
           consumedQuantity, releasedQuantity, status, idempotencyKey,
           decisionId, entitlementSnapshotId, placementJson, runId, jobId,
           provider, model, pricingSnapshotId, expiresAt, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, '0', '0', 'reserved', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id,
          input.accountId,
          input.userId ?? null,
          input.capability,
          input.unit,
          input.maximumQuantity,
          input.idempotencyKey,
          decision.decisionId,
          decision.snapshotId,
          canonical(input.placement),
          input.runId ?? null,
          input.jobId ?? null,
          input.provider ?? null,
          input.model ?? null,
          input.pricingSnapshotId ?? null,
          seconds(input.expiresAt),
          seconds(now),
        ],
      });
      await this.#appendEvent(tx, {
        id: newId("uevt"),
        accountId: input.accountId,
        userId: input.userId,
        capability: input.capability,
        quantity: input.maximumQuantity,
        unit: input.unit,
        direction: "reserve",
        idempotencyKey: `reservation:${id}:reserve`,
        reservationId: id,
        runId: input.runId,
        jobId: input.jobId,
        provider: input.provider,
        model: input.model,
        placement: input.placement,
        pricingSnapshotId: input.pricingSnapshotId,
        authoritative: false,
        estimatorVersion: input.estimatorVersion,
        occurredAt: now,
      });
      const inserted = await tx.execute({
        sql: "SELECT * FROM usage_reservations WHERE id = ? LIMIT 1",
        args: [id],
      });
      return {
        reservation: reservationFromRow(inserted.rows[0] as Row),
        decision,
        replayed: false,
      };
    });
    if ("reservation" in result && result.reservation) return result;
    const denial = "denied" in result ? result.denied : undefined;
    if (!denial) {
      throw new UsageLedgerError(
        "invalid-state",
        "Reservation transaction returned an invalid result",
      );
    }
    throw new UsageLedgerError(
      "capability-denied",
      `Managed capability denied: ${denial.reason}`,
      denial,
    );
  }

  async settle(input: UsageSettlementInput): Promise<{
    reservation: UsageReservationV1;
    replayed: boolean;
  }> {
    const actual = usageQuantitySchema.parse(input.actualQuantity);
    return this.#write(async (tx) => {
      const rows = await tx.execute({
        sql: "SELECT * FROM usage_reservations WHERE id = ? LIMIT 1",
        args: [input.reservationId],
      });
      const row = rows.rows[0] as Row | undefined;
      if (!row) throw new UsageLedgerError("not-found", "Reservation not found");
      if (String(row.accountId) !== input.accountId) {
        throw new UsageLedgerError("forbidden", "Reservation is not owned by account");
      }
      if (String(row.status) !== "reserved") {
        if (String(row.consumedQuantity) !== actual) {
          throw new UsageLedgerError(
            "conflict",
            "Reservation was already settled with a different actual quantity",
          );
        }
        return { reservation: reservationFromRow(row), replayed: true };
      }
      const reserved = BigInt(String(row.reservedQuantity));
      const consumed = BigInt(actual);
      const released = reserved > consumed ? reserved - consumed : 0n;
      const now = this.#clock();
      const status =
        input.outcome === "cancelled"
          ? "cancelled"
          : input.outcome === "expired"
            ? "expired"
            : "settled";
      await this.#appendEvent(tx, {
        id: newId("uevt"),
        accountId: input.accountId,
        userId: row.userId === null ? undefined : String(row.userId),
        capability: managedCapabilitySchema.parse(row.capability),
        quantity: actual,
        unit: usageUnitSchema.parse(row.unit),
        direction: "consume",
        idempotencyKey: `reservation:${input.reservationId}:consume`,
        reservationId: input.reservationId,
        runId: row.runId === null ? undefined : String(row.runId),
        jobId: row.jobId === null ? undefined : String(row.jobId),
        provider: input.provider ?? (row.provider === null ? undefined : String(row.provider)),
        model: input.model ?? (row.model === null ? undefined : String(row.model)),
        placement: capabilityPlacementSchema.parse(json(row.placementJson)),
        pricingSnapshotId:
          row.pricingSnapshotId === null
            ? undefined
            : String(row.pricingSnapshotId),
        authoritative: input.authoritative,
        estimatorVersion: input.authoritative ? undefined : "reservation-final/1",
        occurredAt: now,
      });
      if (released > 0n) {
        await this.#appendEvent(tx, {
          id: newId("uevt"),
          accountId: input.accountId,
          userId: row.userId === null ? undefined : String(row.userId),
          capability: managedCapabilitySchema.parse(row.capability),
          quantity: released.toString(),
          unit: usageUnitSchema.parse(row.unit),
          direction: "release",
          idempotencyKey: `reservation:${input.reservationId}:release`,
          reservationId: input.reservationId,
          runId: row.runId === null ? undefined : String(row.runId),
          jobId: row.jobId === null ? undefined : String(row.jobId),
          provider: row.provider === null ? undefined : String(row.provider),
          model: row.model === null ? undefined : String(row.model),
          placement: capabilityPlacementSchema.parse(json(row.placementJson)),
          pricingSnapshotId:
            row.pricingSnapshotId === null
              ? undefined
              : String(row.pricingSnapshotId),
          authoritative: false,
          estimatorVersion: "reservation-release/1",
          occurredAt: now,
        });
      }
      await this.#increaseAggregate(tx, {
        accountId: input.accountId,
        capability: managedCapabilitySchema.parse(row.capability),
        unit: usageUnitSchema.parse(row.unit),
        snapshotId: String(row.entitlementSnapshotId),
        consumedDelta: consumed,
        adjustmentDelta: 0n,
        occurredAt: now,
      });
      await tx.execute({
        sql: `UPDATE usage_reservations SET
          consumedQuantity = ?, releasedQuantity = ?, status = ?, settledAt = ?
          WHERE id = ? AND accountId = ? AND status = 'reserved'`,
        args: [
          actual,
          released.toString(),
          status,
          seconds(now),
          input.reservationId,
          input.accountId,
        ],
      });
      const updated = await tx.execute({
        sql: "SELECT * FROM usage_reservations WHERE id = ? LIMIT 1",
        args: [input.reservationId],
      });
      return {
        reservation: reservationFromRow(updated.rows[0] as Row),
        replayed: false,
      };
    });
  }

  async adjust(input: {
    accountId: string;
    userId?: string;
    capability: ManagedCapability;
    unit: UsageUnit;
    signedQuantity: string;
    idempotencyKey: string;
    placement: CapabilityPlacement;
    actorId: string;
    reason: string;
    evidenceRef?: string;
    correlationId: string;
  }) {
    if (!/^-?(?:0|[1-9]\d*)$/u.test(input.signedQuantity)) {
      throw new UsageLedgerError("invalid-state", "Invalid adjustment quantity");
    }
    return this.#write(async (tx) => {
      const existing = await tx.execute({
        sql: "SELECT id, quantity FROM usage_events WHERE accountId = ? AND idempotencyKey = ? LIMIT 1",
        args: [input.accountId, input.idempotencyKey],
      });
      if (existing.rows[0]) {
        if (String(existing.rows[0].quantity) !== input.signedQuantity) {
          throw new UsageLedgerError(
            "conflict",
            "Adjustment idempotency key is bound to another quantity",
          );
        }
        return { id: String(existing.rows[0].id), replayed: true };
      }
      const capability = managedCapabilitySchema.parse(input.capability);
      const unit = usageUnitSchema.parse(input.unit);
      const placement = capabilityPlacementSchema.parse(input.placement);
      const resolved = await this.#entitlements.resolve(
        input.accountId,
        capability,
        tx,
      );
      const id = newId("uevt");
      const now = this.#clock();
      await this.#appendEvent(tx, {
        id,
        accountId: input.accountId,
        userId: input.userId,
        capability,
        quantity: input.signedQuantity,
        unit,
        direction: "adjust",
        idempotencyKey: input.idempotencyKey,
        placement,
        authoritative: true,
        adjustment: {
          actorId: input.actorId,
          reason: input.reason,
          evidenceRef: input.evidenceRef,
        },
        occurredAt: now,
      });
      await this.#increaseAggregate(tx, {
        accountId: input.accountId,
        capability,
        unit,
        snapshotId: resolved.snapshot.id,
        consumedDelta: 0n,
        adjustmentDelta: BigInt(input.signedQuantity),
        occurredAt: now,
      });
      await this.#audit.append(
        {
          accountId: input.accountId,
          actorId: input.actorId,
          actorKind: "admin",
          action: "usage.adjusted",
          resourceKind: "usage-event",
          resourceId: id,
          justification: input.reason,
          correlationId: input.correlationId,
          policyVersion: "managed-usage/1",
          metadata: {
            capability,
            quantity: input.signedQuantity,
            unit,
            evidenceRef: input.evidenceRef,
          },
        },
        tx,
      );
      return { id, replayed: false };
    });
  }

  async reconcileExpired(limit = 250) {
    const rows = await this.#client.execute({
      sql: `SELECT * FROM usage_reservations
        WHERE status = 'reserved' AND expiresAt <= ?
        ORDER BY expiresAt ASC LIMIT ?`,
      args: [seconds(this.#clock()), Math.max(1, Math.min(limit, 1_000))],
    });
    const settled: string[] = [];
    for (const row of rows.rows as Row[]) {
      const reservation = reservationFromRow(row);
      // A capability adapter can persist pre-dispatch evidence separately from
      // the usage ledger. Resolver failures intentionally leave the reservation
      // outstanding: an unavailable proof store must never become a free run.
      const resolution = await this.#expirySettlement?.(reservation);
      await this.settle({
        accountId: reservation.accountId,
        reservationId: reservation.id,
        actualQuantity: resolution?.actualQuantity ?? "0",
        outcome: resolution?.outcome ?? "expired",
        authoritative: resolution?.authoritative ?? false,
        evidenceRef: resolution?.evidenceRef,
      });
      settled.push(reservation.id);
    }
    return settled;
  }

  async emergencyDisable(input: {
    accountId: string;
    actorId: string;
    actorKind: "user" | "admin";
    justification: string;
    correlationId: string;
  }) {
    await this.#entitlements.setEmergencyDisabled({ ...input, disabled: true });
    const rows = await this.#client.execute({
      sql: `SELECT id FROM usage_reservations
        WHERE accountId = ? AND status = 'reserved'`,
      args: [input.accountId],
    });
    for (const row of rows.rows as Row[]) {
      await this.settle({
        accountId: input.accountId,
        reservationId: String(row.id),
        actualQuantity: "0",
        outcome: "cancelled",
        authoritative: false,
      });
    }
    return { cancelledReservations: rows.rows.length };
  }

  async totals(accountId: string, capability: ManagedCapability) {
    const resolved = await this.#entitlements.resolve(accountId, capability);
    const periodStart = seconds(new Date(resolved.snapshot.period.startsAt));
    const periodEnd = seconds(new Date(resolved.snapshot.period.endsAt));
    const [aggregateRows, reservationRows] = await Promise.all([
      this.#client.execute({
        sql: `SELECT consumedQuantity, adjustedQuantity
          FROM usage_period_aggregates WHERE accountId = ? AND capability = ?
            AND periodStartsAt = ? AND periodEndsAt = ? LIMIT 1`,
        args: [accountId, capability, periodStart, periodEnd],
      }),
      this.#client.execute({
        sql: `SELECT reservedQuantity, consumedQuantity, releasedQuantity
          FROM usage_reservations WHERE accountId = ? AND capability = ?
            AND status = 'reserved' AND expiresAt > ?`,
        args: [accountId, capability, seconds(this.#clock())],
      }),
    ]);
    const aggregate = aggregateRows.rows[0] as Row | undefined;
    const consumed = BigInt(String(aggregate?.consumedQuantity ?? "0"));
    const adjusted = BigInt(String(aggregate?.adjustedQuantity ?? "0"));
    const reserved = (reservationRows.rows as Row[]).reduce(
      (sum, row) =>
        sum +
        BigInt(String(row.reservedQuantity)) -
        BigInt(String(row.consumedQuantity)) -
        BigInt(String(row.releasedQuantity)),
      0n,
    );
    return {
      accountId,
      capability,
      unit: resolved.entitlement.unit,
      consumed: consumed.toString(),
      adjusted: adjusted.toString(),
      netConsumed: (consumed + adjusted).toString(),
      reserved: reserved.toString(),
      hardLimit: resolved.entitlement.hardLimit ?? null,
      softLimit: resolved.entitlement.softLimit ?? null,
      snapshotId: resolved.snapshot.id,
      status: resolved.snapshot.status,
      emergencyDisabled: resolved.emergencyDisabled,
    };
  }

  async #decisionById(id: string, target: Transaction) {
    const rows = await target.execute({
      sql: "SELECT * FROM entitlement_decisions WHERE id = ? LIMIT 1",
      args: [id],
    });
    const row = rows.rows[0] as Row | undefined;
    if (!row) throw new UsageLedgerError("not-found", "Decision not found");
    return {
      version: 1,
      decisionId: String(row.id),
      accountId: String(row.accountId),
      snapshotId: String(row.snapshotId),
      snapshotRevision: String(row.snapshotRevision),
      capability: managedCapabilitySchema.parse(row.capability),
      quantity: usageQuantitySchema.parse(row.quantity),
      unit: usageUnitSchema.parse(row.unit),
      mode: row.mode as "shadow" | "enforce",
      allowed: Number(row.allowed) === 1,
      wouldBlock: Number(row.wouldBlock) === 1,
      reason: row.reason as EntitlementDecisionV1["reason"],
      decidedAt: iso(row.decidedAt),
    } satisfies EntitlementDecisionV1;
  }

  async #increaseAggregate(
    tx: Transaction,
    input: {
      accountId: string;
      capability: ManagedCapability;
      unit: UsageUnit;
      snapshotId: string;
      consumedDelta: bigint;
      adjustmentDelta: bigint;
      occurredAt: Date;
    },
  ) {
    const snapshotRows = await tx.execute({
      sql: `SELECT periodStartsAt, periodEndsAt FROM entitlement_snapshots
        WHERE id = ? AND accountId = ? LIMIT 1`,
      args: [input.snapshotId, input.accountId],
    });
    const snapshot = snapshotRows.rows[0] as Row | undefined;
    if (!snapshot) {
      throw new UsageLedgerError("invalid-state", "Entitlement snapshot missing");
    }
    const existingRows = await tx.execute({
      sql: `SELECT consumedQuantity, adjustedQuantity
        FROM usage_period_aggregates
        WHERE accountId = ? AND capability = ? AND periodStartsAt = ?
          AND periodEndsAt = ? LIMIT 1`,
      args: [
        input.accountId,
        input.capability,
        snapshot.periodStartsAt,
        snapshot.periodEndsAt,
      ],
    });
    const existing = existingRows.rows[0] as Row | undefined;
    const consumed =
      BigInt(String(existing?.consumedQuantity ?? "0")) + input.consumedDelta;
    const adjusted =
      BigInt(String(existing?.adjustedQuantity ?? "0")) + input.adjustmentDelta;
    await tx.execute({
      sql: `INSERT INTO usage_period_aggregates
        (accountId, capability, unit, periodStartsAt, periodEndsAt,
         consumedQuantity, adjustedQuantity, finalEventOccurredAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(accountId, capability, periodStartsAt, periodEndsAt)
        DO UPDATE SET consumedQuantity = excluded.consumedQuantity,
          adjustedQuantity = excluded.adjustedQuantity,
          finalEventOccurredAt = excluded.finalEventOccurredAt,
          updatedAt = excluded.updatedAt`,
      args: [
        input.accountId,
        input.capability,
        input.unit,
        snapshot.periodStartsAt,
        snapshot.periodEndsAt,
        consumed.toString(),
        adjusted.toString(),
        seconds(input.occurredAt),
        seconds(this.#clock()),
      ],
    });
  }

  async #appendEvent(
    tx: Transaction,
    input: {
      id: string;
      accountId: string;
      userId?: string;
      capability: ManagedCapability;
      quantity: string;
      unit: UsageUnit;
      direction: "reserve" | "consume" | "release" | "adjust";
      idempotencyKey: string;
      reservationId?: string;
      runId?: string;
      jobId?: string;
      provider?: string;
      model?: string;
      placement: CapabilityPlacement;
      pricingSnapshotId?: string;
      authoritative: boolean;
      estimatorVersion?: string;
      adjustment?: {
        actorId: string;
        reason: string;
        evidenceRef?: string;
      };
      occurredAt: Date;
    },
  ) {
    await tx.execute({
      sql: `INSERT INTO usage_events
        (id, accountId, userId, capability, quantity, unit, direction,
         idempotencyKey, reservationId, runId, jobId, provider, model,
         placementJson, pricingSnapshotId, authoritative, estimatorVersion,
         adjustmentActorId, adjustmentReason, adjustmentEvidenceRef,
         occurredAt, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        input.id,
        input.accountId,
        input.userId ?? null,
        input.capability,
        input.quantity,
        input.unit,
        input.direction,
        input.idempotencyKey,
        input.reservationId ?? null,
        input.runId ?? null,
        input.jobId ?? null,
        input.provider ?? null,
        input.model ?? null,
        canonical(input.placement),
        input.pricingSnapshotId ?? null,
        input.authoritative ? 1 : 0,
        input.estimatorVersion ?? null,
        input.adjustment?.actorId ?? null,
        input.adjustment?.reason ?? null,
        input.adjustment?.evidenceRef ?? null,
        seconds(input.occurredAt),
        seconds(this.#clock()),
      ],
    });
  }

  async #write<T>(operation: (tx: Transaction) => Promise<T>): Promise<T> {
    let release!: () => void;
    const predecessor = this.#writeTail;
    this.#writeTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await predecessor;
    const tx = await this.#client.transaction("write");
    try {
      const result = await operation(tx);
      await tx.commit();
      return result;
    } catch (error) {
      await tx.rollback();
      if (error instanceof EntitlementPolicyError) {
        throw new UsageLedgerError(
          "capability-denied",
          error.message,
        );
      }
      throw error;
    } finally {
      release();
    }
  }
}
