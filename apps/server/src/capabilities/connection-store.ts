import type { Client, InValue, Transaction } from "@libsql/client";
import {
  capabilityOfferingPlacementSchema,
  providerConnectionPublicSnapshotSchema,
  type CapabilityOfferingPlacement,
  type ProviderConnectionPublicSnapshot,
} from "@avermate/agent-contracts";
import { db } from "../db";
import { open, seal } from "../lib/crypto";
import { newId } from "../lib/id";
import {
  staticProviderPluginRegistry,
  type CapabilityOriginValidator,
  type ProviderPluginRegistry,
} from "./plugin-registry";
import {
  capabilityDigest,
  capabilityEpoch,
  capabilityIso,
  capabilityJson,
} from "./values";

type SqlClient = Pick<Client, "execute" | "transaction">;
type SqlTarget = Pick<Client | Transaction, "execute">;
type Row = Record<string, InValue>;

export type PublicCredentialSlot = {
  slot: string;
  hint: string;
  status: "active" | "invalid" | "revoked" | "missing";
  keyVersion: number | null;
  validatedAt: string | null;
};

export type PublicCapabilityConnection = {
  connection: ProviderConnectionPublicSnapshot;
  credentialSlots: PublicCredentialSlot[];
};

export type CapabilityConnectionSecretInput = {
  slot: string;
  value: string;
};

export class CapabilityConnectionStoreError extends Error {
  constructor(
    readonly code:
      | "NOT_FOUND"
      | "REVISION_CONFLICT"
      | "INVALID_CONFIG"
      | "INVALID_SECRET_SLOT",
    message: string,
  ) {
    super(message);
    this.name = "CapabilityConnectionStoreError";
  }
}

function placementRef(placement: CapabilityOfferingPlacement): string {
  switch (placement.kind) {
    case "core":
    case "full-self-host":
      return placement.instanceId;
    case "managed":
      return placement.pool;
    case "direct-byok":
      return placement.origin;
    case "node":
      return placement.nodeId;
  }
}

function placementEndpointPolicy(
  placement: CapabilityOfferingPlacement,
): "hosted-core" | "node" | "full-self-host" {
  if (placement.kind === "node") return "node";
  if (placement.kind === "full-self-host") return "full-self-host";
  return "hosted-core";
}

function normalizedPlacement(
  input: CapabilityOfferingPlacement,
): CapabilityOfferingPlacement {
  const placement = capabilityOfferingPlacementSchema.parse(input);
  return placement.kind === "direct-byok"
    ? { ...placement, origin: new URL(placement.origin).origin }
    : placement;
}

function connectionFromRow(row: Row): ProviderConnectionPublicSnapshot {
  return providerConnectionPublicSnapshotSchema.parse({
    schemaVersion: 1,
    id: String(row.id),
    ownerKind: row.ownerKind,
    ownerId: String(row.ownerId),
    pluginId: String(row.pluginId),
    pluginVersion: String(row.pluginVersion),
    displayName: String(row.displayName),
    placement: capabilityJson(row.placementJson),
    configVersion: Number(row.configVersion),
    config: capabilityJson(row.configJson),
    configDigest: String(row.configDigest),
    status: row.status,
    revision: Number(row.revision),
    lastValidatedAt:
      row.lastValidatedAt === null ? null : capabilityIso(row.lastValidatedAt),
    createdAt: capabilityIso(row.createdAt),
    updatedAt: capabilityIso(row.updatedAt),
    deletedAt: row.deletedAt === null ? null : capabilityIso(row.deletedAt),
  });
}

function normalizeSecrets(
  manifest: ReturnType<ProviderPluginRegistry["require"]>["manifest"],
  secrets: readonly CapabilityConnectionSecretInput[],
) {
  const allowed = new Set(manifest.secretSlots.map((slot) => slot.name));
  const normalized = secrets.map((input) => ({
    slot: input.slot.trim(),
    value: input.value.trim(),
  }));
  if (
    normalized.some(
      ({ slot, value }) =>
        !allowed.has(slot) || !value || value.length > 8_192,
    ) ||
    new Set(normalized.map(({ slot }) => slot)).size !== normalized.length
  ) {
    throw new CapabilityConnectionStoreError(
      "INVALID_SECRET_SLOT",
      "Connection secrets must match unique reviewed plugin slots",
    );
  }
  return normalized;
}

async function rowForOwner(
  target: SqlTarget,
  ownerId: string,
  connectionId: string,
) {
  const result = await target.execute({
    sql: `SELECT * FROM capability_provider_connections
      WHERE id = ? AND ownerKind = 'user' AND ownerId = ? LIMIT 1`,
    args: [connectionId, ownerId],
  });
  return (result.rows[0] as Row | undefined) ?? null;
}

/** Keep immutable descriptors for history, but retire them in the same write
 * transaction that changes the connection authority they were discovered for. */
async function retireSupersededOfferings(
  target: SqlTarget,
  connectionId: string,
  now: number,
) {
  await target.execute({
    sql: `UPDATE capability_offerings SET status = 'retired',
      retiredAt = COALESCE(retiredAt, ?)
      WHERE connectionId = ? AND status <> 'retired'
        AND json_extract(descriptorJson, '$.connectionRevision') <> (
          SELECT revision FROM capability_provider_connections WHERE id = ?
        )`,
    args: [now, connectionId, connectionId],
  });
}

export class CapabilityConnectionStore {
  constructor(
    private readonly client: SqlClient = db.$client,
    private readonly registry: ProviderPluginRegistry =
      staticProviderPluginRegistry,
    private readonly clock: () => Date = () => new Date(),
    private readonly validateOrigin?: CapabilityOriginValidator,
  ) {}

  async list(ownerId: string): Promise<PublicCapabilityConnection[]> {
    const rows = await this.client.execute({
      sql: `SELECT * FROM capability_provider_connections
        WHERE ownerKind = 'user' AND ownerId = ? AND deletedAt IS NULL
        ORDER BY createdAt, id`,
      args: [ownerId],
    });
    return Promise.all(
      (rows.rows as Row[]).map(async (row) => ({
        connection: connectionFromRow(row),
        credentialSlots: await this.publicCredentialSlots(
          ownerId,
          String(row.id),
          String(row.pluginId),
        ),
      })),
    );
  }

  async get(
    ownerId: string,
    connectionId: string,
  ): Promise<PublicCapabilityConnection | null> {
    const row = await rowForOwner(this.client, ownerId, connectionId);
    if (!row || row.deletedAt !== null) return null;
    return {
      connection: connectionFromRow(row),
      credentialSlots: await this.publicCredentialSlots(
        ownerId,
        connectionId,
        String(row.pluginId),
      ),
    };
  }

  /**
   * Internal-only bootstrap for the deterministic, credential-free native PDF
   * extractor. This deliberately cannot select an arbitrary plugin, placement,
   * config or secret and is not wired to the public connection router.
   */
  async ensureInternalNativeDocumentConnection(input: {
    ownerId: string;
    instanceId: string;
  }): Promise<PublicCapabilityConnection> {
    const ownerId = input.ownerId.trim();
    const placement = normalizedPlacement({
      kind: "core",
      instanceId: input.instanceId.trim(),
    });
    if (placement.kind !== "core") {
      throw new Error("CAPABILITY_NATIVE_DOCUMENT_PLACEMENT_MISMATCH");
    }
    if (!ownerId || ownerId.length > 256) {
      throw new CapabilityConnectionStoreError(
        "INVALID_CONFIG",
        "Native document connection owner is invalid",
      );
    }
    const factory = this.registry.require("avermate.native-document");
    if (
      factory.manifest.secretSlots.length !== 0 ||
      factory.manifest.connectionSchemaVersion !== 1 ||
      !factory.manifest.capabilities.includes("document.extract")
    ) {
      throw new Error("CAPABILITY_NATIVE_DOCUMENT_MANIFEST_MISMATCH");
    }
    const config = {};
    const id = `cconn_native_${capabilityDigest({
      ownerId,
      instanceId: placement.instanceId,
      pluginId: factory.manifest.id,
      pluginVersion: factory.manifest.version,
    }).slice("sha256:".length, "sha256:".length + 40)}`;
    const now = capabilityEpoch(this.clock());
    await this.client.execute({
      sql: `INSERT INTO capability_provider_connections (
        id, ownerKind, ownerId, pluginId, pluginVersion, displayName,
        placementKind, placementRef, placementJson, configVersion,
        configJson, configDigest, status, revision, lastValidatedAt,
        createdAt, updatedAt
      ) VALUES (?, 'user', ?, ?, ?, ?, 'core', ?, ?, 1, ?, ?, 'ready', 1, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING`,
      args: [
        id,
        ownerId,
        factory.manifest.id,
        factory.manifest.version,
        "Avermate native document extraction",
        placement.instanceId,
        JSON.stringify(placement),
        JSON.stringify(config),
        capabilityDigest(config),
        now,
        now,
        now,
      ],
    });
    const connection = await this.get(ownerId, id);
    if (
      !connection ||
      connection.connection.pluginId !== factory.manifest.id ||
      connection.connection.placement.kind !== "core" ||
      connection.connection.placement.instanceId !== placement.instanceId ||
      connection.connection.status !== "ready"
    ) {
      throw new Error("CAPABILITY_NATIVE_DOCUMENT_CONNECTION_UNAVAILABLE");
    }
    return connection;
  }

  async create(input: {
    ownerId: string;
    pluginId: string;
    displayName: string;
    placement: CapabilityOfferingPlacement;
    configVersion: number;
    config: unknown;
    secrets: readonly CapabilityConnectionSecretInput[];
  }): Promise<PublicCapabilityConnection> {
    const factory = this.registry.require(input.pluginId);
    if (input.configVersion !== factory.manifest.connectionSchemaVersion) {
      throw new CapabilityConnectionStoreError(
        "INVALID_CONFIG",
        "Connection schema version does not match the reviewed plugin",
      );
    }
    const placement = normalizedPlacement(input.placement);
    await this.assertPlacementOwned(input.ownerId, input.pluginId, placement);
    let config: Record<string, unknown>;
    try {
      config = await this.registry.validateConnectionConfig({
        pluginId: input.pluginId,
        config: input.config,
        placement: placementEndpointPolicy(placement),
        ...(placement.kind === "direct-byok"
          ? { placementOrigin: placement.origin }
          : {}),
        validateOrigin: this.validateOrigin,
      });
    } catch (error) {
      throw new CapabilityConnectionStoreError(
        "INVALID_CONFIG",
        error instanceof Error ? error.message : "Invalid connection configuration",
      );
    }
    this.assertPlacementConfigBinding(input.pluginId, placement, config);
    const secrets = normalizeSecrets(factory.manifest, input.secrets);
    const id = newId("cconn");
    const now = capabilityEpoch(this.clock());
    const transaction = await this.client.transaction("write");
    try {
      await transaction.execute({
        sql: `INSERT INTO capability_provider_connections (
          id, ownerKind, ownerId, pluginId, pluginVersion, displayName,
          placementKind, placementRef, placementJson, configVersion,
          configJson, configDigest, status, revision, createdAt, updatedAt
        ) VALUES (?, 'user', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 1, ?, ?)`,
        args: [
          id,
          input.ownerId,
          factory.manifest.id,
          factory.manifest.version,
          input.displayName.trim(),
          placement.kind,
          placementRef(placement),
          JSON.stringify(placement),
          input.configVersion,
          JSON.stringify(config),
          capabilityDigest(config),
          now,
          now,
        ],
      });
      for (const secret of secrets) {
        await transaction.execute({
          sql: `INSERT INTO capability_connection_secrets (
            id, connectionId, slot, custody, sealedValue, nodeSecretRef,
            hint, keyVersion, scopesJson, status, createdAt, updatedAt
          ) VALUES (?, ?, ?, 'core-encrypted', ?, NULL, ?, 1, '[]', 'active', ?, ?)`,
          args: [
            newId("csec"),
            id,
            secret.slot,
            seal(secret.value),
            secret.value.slice(-4),
            now,
            now,
          ],
        });
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    const created = await this.get(input.ownerId, id);
    if (!created) throw new Error("Created capability connection is unreadable");
    return created;
  }

  async update(input: {
    ownerId: string;
    connectionId: string;
    expectedRevision: number;
    displayName?: string;
    placement?: CapabilityOfferingPlacement;
    configVersion?: number;
    config?: unknown;
    secrets?: readonly CapabilityConnectionSecretInput[];
  }): Promise<PublicCapabilityConnection> {
    const existing = await this.get(input.ownerId, input.connectionId);
    if (!existing) {
      throw new CapabilityConnectionStoreError("NOT_FOUND", "Connection not found");
    }
    const factory = this.registry.require(existing.connection.pluginId);
    const placement = input.placement
      ? normalizedPlacement(input.placement)
      : existing.connection.placement;
    await this.assertPlacementOwned(
      input.ownerId,
      existing.connection.pluginId,
      placement,
    );
    const configVersion = input.configVersion ?? existing.connection.configVersion;
    if (configVersion !== factory.manifest.connectionSchemaVersion) {
      throw new CapabilityConnectionStoreError(
        "INVALID_CONFIG",
        "Connection schema version does not match the reviewed plugin",
      );
    }
    let config: Record<string, unknown>;
    try {
      config = await this.registry.validateConnectionConfig({
        pluginId: factory.manifest.id,
        config: input.config ?? existing.connection.config,
        placement: placementEndpointPolicy(placement),
        ...(placement.kind === "direct-byok"
          ? { placementOrigin: placement.origin }
          : {}),
        validateOrigin: this.validateOrigin,
      });
    } catch (error) {
      throw new CapabilityConnectionStoreError(
        "INVALID_CONFIG",
        error instanceof Error ? error.message : "Invalid connection configuration",
      );
    }
    this.assertPlacementConfigBinding(factory.manifest.id, placement, config);
    const secrets = normalizeSecrets(factory.manifest, input.secrets ?? []);
    const now = capabilityEpoch(this.clock());
    const transaction = await this.client.transaction("write");
    try {
      const updated = await transaction.execute({
        sql: `UPDATE capability_provider_connections SET
          displayName = ?, placementKind = ?, placementRef = ?, placementJson = ?,
          configVersion = ?, configJson = ?, configDigest = ?, status = 'draft',
          lastValidatedAt = NULL, revision = revision + 1, updatedAt = ?
          WHERE id = ? AND ownerKind = 'user' AND ownerId = ?
            AND revision = ? AND deletedAt IS NULL`,
        args: [
          input.displayName?.trim() ?? existing.connection.displayName,
          placement.kind,
          placementRef(placement),
          JSON.stringify(placement),
          configVersion,
          JSON.stringify(config),
          capabilityDigest(config),
          now,
          input.connectionId,
          input.ownerId,
          input.expectedRevision,
        ],
      });
      if (Number(updated.rowsAffected) !== 1) {
        throw new CapabilityConnectionStoreError(
          "REVISION_CONFLICT",
          "Connection revision changed",
        );
      }
      await retireSupersededOfferings(transaction, input.connectionId, now);
      for (const secret of secrets) {
        await transaction.execute({
          sql: `INSERT INTO capability_connection_secrets (
            id, connectionId, slot, custody, sealedValue, nodeSecretRef,
            hint, keyVersion, scopesJson, status, createdAt, updatedAt
          ) VALUES (?, ?, ?, 'core-encrypted', ?, NULL, ?, 1, '[]', 'active', ?, ?)
          ON CONFLICT(connectionId, slot) DO UPDATE SET
            custody = 'core-encrypted', sealedValue = excluded.sealedValue,
            nodeSecretRef = NULL, hint = excluded.hint,
            keyVersion = capability_connection_secrets.keyVersion + 1,
            status = 'active', revokedAt = NULL, lastValidatedAt = NULL,
            updatedAt = excluded.updatedAt`,
          args: [
            newId("csec"),
            input.connectionId,
            secret.slot,
            seal(secret.value),
            secret.value.slice(-4),
            now,
            now,
          ],
        });
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    const updated = await this.get(input.ownerId, input.connectionId);
    if (!updated) throw new Error("Updated capability connection is unreadable");
    return updated;
  }

  async markValidated(input: {
    ownerId: string;
    connectionId: string;
    expectedRevision: number;
    valid: boolean;
  }): Promise<PublicCapabilityConnection> {
    const now = capabilityEpoch(this.clock());
    const transaction = await this.client.transaction("write");
    try {
      const updated = await transaction.execute({
        sql: `UPDATE capability_provider_connections SET
          revision = revision + CASE WHEN status = 'ready' AND ? = 1 THEN 0 ELSE 1 END,
          status = ?, lastValidatedAt = ?, updatedAt = ?
          WHERE id = ? AND ownerKind = 'user' AND ownerId = ?
            AND revision = ? AND deletedAt IS NULL`,
        args: [
          input.valid ? 1 : 0,
          input.valid ? "ready" : "invalid",
          now,
          now,
          input.connectionId,
          input.ownerId,
          input.expectedRevision,
        ],
      });
      if (Number(updated.rowsAffected) !== 1) {
        throw new CapabilityConnectionStoreError(
          "REVISION_CONFLICT",
          "Connection revision changed",
        );
      }
      // A successful readiness refresh does not change routing authority or
      // invalidate pinned offerings. Failures and lifecycle transitions do.
      await retireSupersededOfferings(transaction, input.connectionId, now);
      await transaction.execute({
        sql: `UPDATE capability_connection_secrets SET status = ?,
          lastValidatedAt = ?, updatedAt = ? WHERE connectionId = ?
          AND status <> 'revoked'`,
        args: [
          input.valid ? "active" : "invalid",
          now,
          now,
          input.connectionId,
        ],
      });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    const result = await this.get(input.ownerId, input.connectionId);
    if (!result) throw new Error("Validated capability connection is unreadable");
    return result;
  }

  async disable(input: {
    ownerId: string;
    connectionId: string;
    expectedRevision: number;
  }): Promise<PublicCapabilityConnection> {
    const now = capabilityEpoch(this.clock());
    const transaction = await this.client.transaction("write");
    try {
      const updated = await transaction.execute({
        sql: `UPDATE capability_provider_connections SET
          status = 'disabled', revision = revision + 1, updatedAt = ?
          WHERE id = ? AND ownerKind = 'user' AND ownerId = ?
            AND revision = ? AND deletedAt IS NULL`,
        args: [now, input.connectionId, input.ownerId, input.expectedRevision],
      });
      if (Number(updated.rowsAffected) !== 1) {
        throw new CapabilityConnectionStoreError(
          "REVISION_CONFLICT",
          "Connection revision changed",
        );
      }
      await retireSupersededOfferings(transaction, input.connectionId, now);
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    const result = await this.get(input.ownerId, input.connectionId);
    if (!result) throw new Error("Disabled capability connection is unreadable");
    return result;
  }

  async softDelete(input: {
    ownerId: string;
    connectionId: string;
    expectedRevision: number;
  }): Promise<{ deleted: true; revision: number }> {
    const now = capabilityEpoch(this.clock());
    const transaction = await this.client.transaction("write");
    try {
      const updated = await transaction.execute({
        sql: `UPDATE capability_provider_connections SET
          status = 'deleted', deletedAt = ?, revision = revision + 1, updatedAt = ?
          WHERE id = ? AND ownerKind = 'user' AND ownerId = ?
            AND revision = ? AND deletedAt IS NULL`,
        args: [
          now,
          now,
          input.connectionId,
          input.ownerId,
          input.expectedRevision,
        ],
      });
      if (Number(updated.rowsAffected) !== 1) {
        throw new CapabilityConnectionStoreError(
          "REVISION_CONFLICT",
          "Connection revision changed",
        );
      }
      await transaction.execute({
        sql: `UPDATE capability_connection_secrets SET
          status = 'revoked', revokedAt = COALESCE(revokedAt, ?), updatedAt = ?
          WHERE connectionId = ? AND status <> 'revoked'`,
        args: [now, now, input.connectionId],
      });
      await transaction.execute({
        sql: `UPDATE capability_offerings SET status = 'retired',
          retiredAt = COALESCE(retiredAt, ?)
          WHERE connectionId = ? AND status <> 'retired'`,
        args: [now, input.connectionId],
      });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    return { deleted: true, revision: input.expectedRevision + 1 };
  }

  async leaseSecret(input: {
    ownerId: string;
    connectionId: string;
    slot: string;
    expectedVersion: number;
  }): Promise<{ secret: string; version: number } | null> {
    const result = await this.client.execute({
      sql: `SELECT secret.sealedValue, secret.keyVersion
        FROM capability_connection_secrets secret
        JOIN capability_provider_connections connection
          ON connection.id = secret.connectionId
        WHERE secret.connectionId = ? AND secret.slot = ?
          AND secret.keyVersion = ? AND secret.status = 'active'
          AND secret.custody = 'core-encrypted'
          AND connection.ownerKind = 'user' AND connection.ownerId = ?
          AND connection.deletedAt IS NULL LIMIT 1`,
      args: [
        input.connectionId,
        input.slot,
        input.expectedVersion,
        input.ownerId,
      ],
    });
    const row = result.rows[0] as Row | undefined;
    if (!row?.sealedValue) return null;
    return { secret: open(String(row.sealedValue)), version: Number(row.keyVersion) };
  }

  private async publicCredentialSlots(
    ownerId: string,
    connectionId: string,
    pluginId: string,
  ): Promise<PublicCredentialSlot[]> {
    const rows = await this.client.execute({
      sql: `SELECT secret.slot, secret.hint, secret.status, secret.keyVersion,
          secret.lastValidatedAt
        FROM capability_connection_secrets secret
        JOIN capability_provider_connections connection
          ON connection.id = secret.connectionId
        WHERE connection.id = ? AND connection.ownerKind = 'user'
          AND connection.ownerId = ? ORDER BY secret.slot`,
      args: [connectionId, ownerId],
    });
    const bySlot = new Map(
      (rows.rows as Row[]).map((row) => [String(row.slot), row]),
    );
    return this.registry.require(pluginId).manifest.secretSlots.map((slot) => {
      const row = bySlot.get(slot.name);
      return row
        ? {
            slot: slot.name,
            hint: String(row.hint),
            status: row.status as "active" | "invalid" | "revoked",
            keyVersion: Number(row.keyVersion),
            validatedAt:
              row.lastValidatedAt === null
                ? null
                : capabilityIso(row.lastValidatedAt),
          }
        : {
            slot: slot.name,
            hint: "",
            status: "missing" as const,
            keyVersion: null,
            validatedAt: null,
          };
    });
  }

  private async assertPlacementOwned(
    ownerId: string,
    pluginId: string,
    placement: CapabilityOfferingPlacement,
  ) {
    if (
      placement.kind === "core" ||
      placement.kind === "managed" ||
      placement.kind === "full-self-host"
    ) {
      throw new CapabilityConnectionStoreError(
        "INVALID_CONFIG",
        "Instance and managed capability placements require operator authority",
      );
    }
    if (placement.kind !== "node") {
      if (pluginId === "avermate.node") {
        throw new CapabilityConnectionStoreError(
          "INVALID_CONFIG",
          "The Avermate Node plugin requires an owned node placement",
        );
      }
      return;
    }
    if (pluginId !== "avermate.node") {
      throw new CapabilityConnectionStoreError(
        "INVALID_CONFIG",
        "Only the reviewed Avermate Node plugin can use a node placement",
      );
    }
    const result = await this.client.execute({
      sql: `SELECT 1 FROM node_account_bindings binding
        JOIN avermate_nodes node ON node.id = binding.nodeId
        WHERE binding.nodeId = ? AND binding.userId = ?
          AND binding.state = 'active' AND node.state <> 'revoked' LIMIT 1`,
      args: [placement.nodeId, ownerId],
    });
    if (result.rows.length !== 1) {
      throw new CapabilityConnectionStoreError(
        "INVALID_CONFIG",
        "Node placement is not actively owned by this account",
      );
    }
  }

  private assertPlacementConfigBinding(
    pluginId: string,
    placement: CapabilityOfferingPlacement,
    config: Record<string, unknown>,
  ) {
    if (
      pluginId === "avermate.node" &&
      (placement.kind !== "node" ||
        config.nodeId !== placement.nodeId ||
        config.configRevision !== placement.configRevision)
    ) {
      throw new CapabilityConnectionStoreError(
        "INVALID_CONFIG",
        "Node configuration must match the signed placement revision",
      );
    }
  }
}
