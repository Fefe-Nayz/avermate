import type { Client, InValue } from "@libsql/client";
import {
  capabilityErrorCodeSchema,
  type CapabilityError,
  type CapabilityErrorCode,
} from "@avermate/agent-contracts";
import { db } from "../db";
import { capabilityEpoch, capabilityIso } from "./values";

type SqlClient = Pick<Client, "execute">;
type Row = Record<string, InValue>;

export type CapabilityHealthState =
  | "unknown"
  | "validating"
  | "healthy"
  | "degraded"
  | "offline"
  | "unauthorized"
  | "disabled";

export type PublicCapabilityOfferingHealth = {
  offeringId: string;
  state: CapabilityHealthState;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  consecutiveFailures: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  safeErrorCode: CapabilityErrorCode | null;
  revision: number;
  expiresAt: string;
  updatedAt: string;
};

function healthFromRow(row: Row, now: Date): PublicCapabilityOfferingHealth {
  const expiresAt = capabilityIso(row.expiresAt);
  const storedState = String(row.state) as CapabilityHealthState;
  return {
    offeringId: String(row.offeringId),
    state:
      Date.parse(expiresAt) <= now.getTime() && storedState !== "disabled"
        ? "unknown"
        : storedState,
    lastSuccessAt:
      row.lastSuccessAt === null ? null : capabilityIso(row.lastSuccessAt),
    lastFailureAt:
      row.lastFailureAt === null ? null : capabilityIso(row.lastFailureAt),
    consecutiveFailures: Number(row.consecutiveFailures),
    latencyP50Ms:
      row.latencyP50Ms === null ? null : Number(row.latencyP50Ms),
    latencyP95Ms:
      row.latencyP95Ms === null ? null : Number(row.latencyP95Ms),
    safeErrorCode:
      row.safeErrorCode === null
        ? null
        : capabilityErrorCodeSchema.parse(row.safeErrorCode),
    revision: Number(row.revision),
    expiresAt,
    updatedAt: capabilityIso(row.updatedAt),
  };
}

export class CapabilityHealthService {
  constructor(
    private readonly client: SqlClient = db.$client,
    private readonly clock: () => Date = () => new Date(),
    private readonly ttlMs = 5 * 60_000,
  ) {}

  async list(ownerId: string): Promise<PublicCapabilityOfferingHealth[]> {
    const result = await this.client.execute({
      sql: `SELECT health.* FROM capability_offering_health health
        JOIN capability_offerings offering ON offering.id = health.offeringId
        JOIN capability_provider_connections connection
          ON connection.id = offering.connectionId
        WHERE connection.ownerKind = 'user' AND connection.ownerId = ?
          AND connection.deletedAt IS NULL
        ORDER BY health.offeringId`,
      args: [ownerId],
    });
    const now = this.clock();
    return (result.rows as Row[]).map((row) => healthFromRow(row, now));
  }

  async get(
    ownerId: string,
    offeringId: string,
  ): Promise<PublicCapabilityOfferingHealth | null> {
    const result = await this.client.execute({
      sql: `SELECT health.* FROM capability_offering_health health
        JOIN capability_offerings offering ON offering.id = health.offeringId
        JOIN capability_provider_connections connection
          ON connection.id = offering.connectionId
        WHERE health.offeringId = ? AND connection.ownerKind = 'user'
          AND connection.ownerId = ? AND connection.deletedAt IS NULL LIMIT 1`,
      args: [offeringId, ownerId],
    });
    const row = result.rows[0] as Row | undefined;
    return row ? healthFromRow(row, this.clock()) : null;
  }

  async markValidating(ownerId: string, offeringId: string) {
    await this.assertOwned(ownerId, offeringId);
    const now = this.clock();
    await this.client.execute({
      sql: `INSERT INTO capability_offering_health (
          offeringId, state, consecutiveFailures, revision, expiresAt, updatedAt
        ) VALUES (?, 'validating', 0, 1, ?, ?)
        ON CONFLICT(offeringId) DO UPDATE SET state = 'validating',
          safeErrorCode = NULL, revision = revision + 1,
          expiresAt = excluded.expiresAt, updatedAt = excluded.updatedAt`,
      args: [
        offeringId,
        capabilityEpoch(new Date(now.getTime() + this.ttlMs)),
        capabilityEpoch(now),
      ],
    });
  }

  async recordSuccess(input: {
    ownerId: string;
    offeringId: string;
    latencyMs: number;
  }) {
    await this.assertOwned(input.ownerId, input.offeringId);
    const latencyMs = Math.max(0, Math.min(Math.round(input.latencyMs), 3_600_000));
    const now = this.clock();
    await this.client.execute({
      sql: `INSERT INTO capability_offering_health (
          offeringId, state, lastSuccessAt, consecutiveFailures,
          latencyP50Ms, latencyP95Ms, revision, expiresAt, updatedAt
        ) VALUES (?, 'healthy', ?, 0, ?, ?, 1, ?, ?)
        ON CONFLICT(offeringId) DO UPDATE SET state = 'healthy',
          lastSuccessAt = excluded.lastSuccessAt, consecutiveFailures = 0,
          latencyP50Ms = CASE WHEN latencyP50Ms IS NULL THEN excluded.latencyP50Ms
            ELSE CAST((latencyP50Ms * 3 + excluded.latencyP50Ms) / 4 AS INTEGER) END,
          latencyP95Ms = CASE WHEN latencyP95Ms IS NULL THEN excluded.latencyP95Ms
            ELSE MAX(latencyP95Ms, excluded.latencyP95Ms) END,
          safeErrorCode = NULL, revision = revision + 1,
          expiresAt = excluded.expiresAt, updatedAt = excluded.updatedAt`,
      args: [
        input.offeringId,
        capabilityEpoch(now),
        latencyMs,
        latencyMs,
        capabilityEpoch(new Date(now.getTime() + this.ttlMs)),
        capabilityEpoch(now),
      ],
    });
  }

  async recordFailure(input: {
    ownerId: string;
    offeringId: string;
    error: CapabilityError;
  }) {
    await this.assertOwned(input.ownerId, input.offeringId);
    const code = capabilityErrorCodeSchema.parse(input.error.code);
    const unauthorized = [
      "AUTHENTICATION_REQUIRED",
      "CREDENTIAL_INVALID",
      "CREDENTIAL_CHANGED",
    ].includes(code);
    const now = this.clock();
    await this.client.execute({
      sql: `INSERT INTO capability_offering_health (
          offeringId, state, lastFailureAt, consecutiveFailures,
          safeErrorCode, revision, expiresAt, updatedAt
        ) VALUES (?, ?, ?, 1, ?, 1, ?, ?)
        ON CONFLICT(offeringId) DO UPDATE SET
          state = CASE WHEN ? THEN 'unauthorized'
            WHEN consecutiveFailures + 1 >= 3 THEN 'offline'
            ELSE 'degraded' END,
          lastFailureAt = excluded.lastFailureAt,
          consecutiveFailures = consecutiveFailures + 1,
          safeErrorCode = excluded.safeErrorCode, revision = revision + 1,
          expiresAt = excluded.expiresAt, updatedAt = excluded.updatedAt`,
      args: [
        input.offeringId,
        unauthorized ? "unauthorized" : "degraded",
        capabilityEpoch(now),
        code,
        capabilityEpoch(new Date(now.getTime() + this.ttlMs)),
        capabilityEpoch(now),
        unauthorized ? 1 : 0,
      ],
    });
  }

  async markDisabled(ownerId: string, offeringId: string) {
    await this.assertOwned(ownerId, offeringId);
    const now = this.clock();
    await this.client.execute({
      sql: `INSERT INTO capability_offering_health (
          offeringId, state, consecutiveFailures, revision, expiresAt, updatedAt
        ) VALUES (?, 'disabled', 0, 1, ?, ?)
        ON CONFLICT(offeringId) DO UPDATE SET state = 'disabled',
          revision = revision + 1, expiresAt = excluded.expiresAt,
          updatedAt = excluded.updatedAt`,
      args: [
        offeringId,
        capabilityEpoch(new Date(now.getTime() + 365 * 24 * 60 * 60_000)),
        capabilityEpoch(now),
      ],
    });
  }

  private async assertOwned(ownerId: string, offeringId: string) {
    const result = await this.client.execute({
      sql: `SELECT 1 FROM capability_offerings offering
        JOIN capability_provider_connections connection
          ON connection.id = offering.connectionId
        WHERE offering.id = ? AND connection.ownerKind = 'user'
          AND connection.ownerId = ? AND connection.deletedAt IS NULL LIMIT 1`,
      args: [offeringId, ownerId],
    });
    if (result.rows.length === 0) {
      throw new Error("CAPABILITY_HEALTH_OFFERING_NOT_OWNED");
    }
  }
}
