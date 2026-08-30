import type { Client, InValue } from "@libsql/client";
import {
  capabilityOfferingSchema,
  type CapabilityKind,
  type CapabilityOffering,
} from "@avermate/agent-contracts";
import { db } from "../db";
import { capabilityDigest, capabilityJson } from "./values";

type SqlClient = Pick<Client, "execute">;
type Row = Record<string, InValue>;

export type CapabilityOfferingStatus =
  | "discovered"
  | "ready"
  | "unavailable"
  | "retired";

export class CapabilityOfferingStoreError extends Error {
  constructor(
    readonly code:
      | "NOT_FOUND"
      | "OWNER_MISMATCH"
      | "IDENTITY_MISMATCH"
      | "IMMUTABLE_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "CapabilityOfferingStoreError";
  }
}

export function capabilityOfferingIdentity(
  offering: Omit<CapabilityOffering, "id">,
): string {
  const digest = capabilityDigest({
    connectionId: offering.connectionId,
    connectionRevision: offering.connectionRevision,
    pluginId: offering.pluginId,
    pluginVersion: offering.pluginVersion,
    adapterRevision: offering.adapterRevision,
    capability: offering.capability,
    capabilityProtocolVersion: offering.capabilityProtocolVersion,
    provider: offering.provider,
    modelId: offering.modelId,
    modelRevision: offering.modelRevision,
    placement: offering.placement,
    dataHandling: offering.dataHandling,
    specification: offering.specification,
  });
  return `capoff_${digest.slice("sha256:".length)}`;
}

function descriptorFromRow(row: Row): CapabilityOffering {
  return capabilityOfferingSchema.parse(capabilityJson(row.descriptorJson));
}

export class CapabilityOfferingStore {
  constructor(
    private readonly client: SqlClient = db.$client,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async register(input: {
    ownerId: string;
    offering: CapabilityOffering;
    status?: CapabilityOfferingStatus;
    compatibilityKey?: string | null;
    expiresAt?: Date | null;
  }): Promise<CapabilityOffering> {
    const offering = capabilityOfferingSchema.parse(input.offering);
    const { id: _id, ...identity } = offering;
    if (offering.id !== capabilityOfferingIdentity(identity)) {
      throw new CapabilityOfferingStoreError(
        "IDENTITY_MISMATCH",
        "Offering ID does not match its immutable descriptor",
      );
    }
    const owner = await this.client.execute({
      sql: `SELECT revision, pluginId, pluginVersion, status FROM capability_provider_connections
        WHERE id = ? AND ownerKind = 'user' AND ownerId = ? AND deletedAt IS NULL LIMIT 1`,
      args: [offering.connectionId, input.ownerId],
    });
    const connection = owner.rows[0] as Row | undefined;
    if (!connection) {
      throw new CapabilityOfferingStoreError(
        "OWNER_MISMATCH",
        "Offering connection is not owned by this account",
      );
    }
    if (
      Number(connection.revision) !== offering.connectionRevision ||
      String(connection.pluginId) !== offering.pluginId ||
      String(connection.pluginVersion) !== offering.pluginVersion ||
      connection.status !== "ready"
    ) {
      throw new CapabilityOfferingStoreError(
        "IDENTITY_MISMATCH",
        "Offering does not match the current connection revision",
      );
    }
    const descriptorDigest = capabilityDigest(offering);
    const now = Math.floor(this.clock().getTime() / 1_000);
    const registered = await this.client.execute({
      sql: `INSERT INTO capability_offerings (
        id, connectionId, capabilityKind, descriptorVersion, descriptorJson,
        descriptorDigest, provider, modelId, modelRevision, adapterRevision,
        compatibilityKey, status, discoveredAt, expiresAt, createdAt
      ) SELECT ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM capability_provider_connections
        WHERE id = ? AND ownerKind = 'user' AND ownerId = ?
          AND revision = ? AND pluginId = ? AND pluginVersion = ?
          AND status = 'ready' AND deletedAt IS NULL
      )
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status, discoveredAt = excluded.discoveredAt,
        expiresAt = CASE WHEN ? = 1 THEN excluded.expiresAt ELSE capability_offerings.expiresAt END,
        retiredAt = CASE WHEN excluded.status = 'retired' THEN capability_offerings.retiredAt ELSE NULL END
      WHERE capability_offerings.descriptorDigest = excluded.descriptorDigest`,
      args: [
        offering.id,
        offering.connectionId,
        offering.capability,
        JSON.stringify(offering),
        descriptorDigest,
        offering.provider,
        offering.modelId,
        offering.modelRevision,
        offering.adapterRevision,
        input.compatibilityKey ?? null,
        input.status ?? "discovered",
        now,
        input.expiresAt ? Math.floor(input.expiresAt.getTime() / 1_000) : null,
        now,
        offering.connectionId,
        input.ownerId,
        offering.connectionRevision,
        offering.pluginId,
        offering.pluginVersion,
        input.expiresAt !== undefined ? 1 : 0,
      ],
    });
    const existing = await this.get(input.ownerId, offering.id);
    if (existing && capabilityDigest(existing) !== descriptorDigest) {
      throw new CapabilityOfferingStoreError(
        "IMMUTABLE_CONFLICT",
        "Offering ID already exists with a different descriptor",
      );
    }
    if (!existing || Number(registered.rowsAffected) !== 1) {
      throw new CapabilityOfferingStoreError(
        "IDENTITY_MISMATCH",
        "Offering connection changed during discovery",
      );
    }
    return existing;
  }

  async get(ownerId: string, offeringId: string): Promise<CapabilityOffering | null> {
    const result = await this.client.execute({
      sql: `SELECT offering.descriptorJson
        FROM capability_offerings offering
        JOIN capability_provider_connections connection
          ON connection.id = offering.connectionId
        WHERE offering.id = ? AND connection.ownerKind = 'user' AND connection.ownerId = ?
          AND connection.deletedAt IS NULL LIMIT 1`,
      args: [offeringId, ownerId],
    });
    const row = result.rows[0] as Row | undefined;
    return row ? descriptorFromRow(row) : null;
  }

  async list(input: {
    ownerId: string;
    capability?: CapabilityKind;
    statuses?: readonly CapabilityOfferingStatus[];
  }): Promise<CapabilityOffering[]> {
    const statuses = input.statuses ?? ["discovered", "ready", "unavailable"];
    if (statuses.length === 0) return [];
    const statusPlaceholders = statuses.map(() => "?").join(", ");
    const result = await this.client.execute({
      sql: `SELECT offering.descriptorJson
        FROM capability_offerings offering
        JOIN capability_provider_connections connection
          ON connection.id = offering.connectionId
        WHERE connection.ownerKind = 'user' AND connection.ownerId = ?
          AND connection.deletedAt IS NULL AND connection.status = 'ready'
          AND json_extract(offering.descriptorJson, '$.connectionRevision') = connection.revision
          AND (offering.expiresAt IS NULL OR offering.expiresAt > ?)
          AND offering.status IN (${statusPlaceholders})
          ${input.capability ? "AND offering.capabilityKind = ?" : ""}
        ORDER BY offering.provider, offering.modelId, offering.id`,
      args: [
        input.ownerId,
        Math.floor(this.clock().getTime() / 1_000),
        ...statuses,
        ...(input.capability ? [input.capability] : []),
      ],
    });
    return (result.rows as Row[]).map(descriptorFromRow);
  }

  async setStatus(input: {
    ownerId: string;
    offeringId: string;
    status: CapabilityOfferingStatus;
  }): Promise<boolean> {
    const now = Math.floor(this.clock().getTime() / 1_000);
    const result = await this.client.execute({
      sql: `UPDATE capability_offerings SET status = ?,
        retiredAt = CASE WHEN ? = 'retired' THEN ? ELSE retiredAt END
        WHERE id = ? AND connectionId IN (
          SELECT id FROM capability_provider_connections
          WHERE ownerKind = 'user' AND ownerId = ? AND deletedAt IS NULL
            AND (? = 'retired' OR (status = 'ready'
              AND revision = json_extract(capability_offerings.descriptorJson, '$.connectionRevision')))
        )`,
      args: [input.status, input.status, now, input.offeringId, input.ownerId, input.status],
    });
    return Number(result.rowsAffected) === 1;
  }
}
