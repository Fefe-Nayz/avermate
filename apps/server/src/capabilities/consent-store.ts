import type { Client, InValue } from "@libsql/client";
import {
  capabilityOfferingSchema,
  type CapabilityKind,
} from "@avermate/agent-contracts";
import { db } from "../db";
import { newId } from "../lib/id";
import { capabilityIso, capabilityJson } from "./values";

type SqlClient = Pick<Client, "execute">;
type Row = Record<string, InValue>;

export type PublicCapabilityConsent = {
  id: string;
  connectionId: string;
  capability: CapabilityKind;
  disclosureRevision: string;
  status: "granted" | "revoked";
  revision: number;
  grantedAt: string;
  revokedAt: string | null;
};

export class CapabilityConsentStoreError extends Error {
  constructor(
    readonly code:
      | "NOT_FOUND"
      | "REVISION_CONFLICT"
      | "DISCLOSURE_NOT_PUBLISHED",
    message: string,
  ) {
    super(message);
    this.name = "CapabilityConsentStoreError";
  }
}

function consentFromRow(row: Row): PublicCapabilityConsent {
  return {
    id: String(row.id),
    connectionId: String(row.connectionId),
    capability: row.capabilityKind as CapabilityKind,
    disclosureRevision: String(row.disclosureRevision),
    status: row.status as "granted" | "revoked",
    revision: Number(row.revision),
    grantedAt: capabilityIso(row.grantedAt),
    revokedAt: row.revokedAt === null ? null : capabilityIso(row.revokedAt),
  };
}

export class CapabilityConsentStore {
  constructor(
    private readonly client: SqlClient = db.$client,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async list(ownerId: string): Promise<PublicCapabilityConsent[]> {
    const result = await this.client.execute({
      sql: `SELECT * FROM capability_consents
        WHERE ownerId = ? ORDER BY createdAt, id`,
      args: [ownerId],
    });
    return (result.rows as Row[]).map(consentFromRow);
  }

  async grant(input: {
    ownerId: string;
    connectionId: string;
    capability: CapabilityKind;
    disclosureRevision: string;
    expectedRevision: number | null;
  }): Promise<PublicCapabilityConsent> {
    await this.assertPublishedDisclosure(input);
    const existing = await this.findIdentity(input);
    const now = Math.floor(this.clock().getTime() / 1_000);
    if (!existing) {
      if (input.expectedRevision !== null) {
        throw new CapabilityConsentStoreError(
          "REVISION_CONFLICT",
          "Consent does not exist at the expected revision",
        );
      }
      const id = newId("ccons");
      await this.client.execute({
        sql: `INSERT INTO capability_consents (
          id, ownerId, connectionId, capabilityKind, disclosureRevision,
          status, revision, grantedAt, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, 'granted', 1, ?, ?, ?)`,
        args: [
          id,
          input.ownerId,
          input.connectionId,
          input.capability,
          input.disclosureRevision,
          now,
          now,
          now,
        ],
      });
      return (await this.findIdentity(input))!;
    }
    if (input.expectedRevision !== existing.revision) {
      throw new CapabilityConsentStoreError(
        "REVISION_CONFLICT",
        "Consent revision changed",
      );
    }
    const updated = await this.client.execute({
      sql: `UPDATE capability_consents SET status = 'granted',
        revision = revision + 1, grantedAt = ?, revokedAt = NULL, updatedAt = ?
        WHERE id = ? AND ownerId = ? AND revision = ?`,
      args: [now, now, existing.id, input.ownerId, input.expectedRevision],
    });
    if (Number(updated.rowsAffected) !== 1) {
      throw new CapabilityConsentStoreError(
        "REVISION_CONFLICT",
        "Consent revision changed",
      );
    }
    return (await this.findIdentity(input))!;
  }

  async revoke(input: {
    ownerId: string;
    consentId: string;
    expectedRevision: number;
  }): Promise<PublicCapabilityConsent> {
    const now = Math.floor(this.clock().getTime() / 1_000);
    const updated = await this.client.execute({
      sql: `UPDATE capability_consents SET status = 'revoked',
        revision = revision + 1, revokedAt = ?, updatedAt = ?
        WHERE id = ? AND ownerId = ? AND revision = ?`,
      args: [
        now,
        now,
        input.consentId,
        input.ownerId,
        input.expectedRevision,
      ],
    });
    if (Number(updated.rowsAffected) !== 1) {
      throw new CapabilityConsentStoreError(
        "REVISION_CONFLICT",
        "Consent revision changed",
      );
    }
    const result = await this.client.execute({
      sql: `SELECT * FROM capability_consents WHERE id = ? AND ownerId = ? LIMIT 1`,
      args: [input.consentId, input.ownerId],
    });
    const row = result.rows[0] as Row | undefined;
    if (!row) throw new CapabilityConsentStoreError("NOT_FOUND", "Consent not found");
    return consentFromRow(row);
  }

  async isGranted(input: {
    ownerId: string;
    connectionId: string;
    capability: CapabilityKind;
    disclosureRevision: string;
    expectedRevision?: number;
  }): Promise<boolean> {
    const result = await this.client.execute({
      sql: `SELECT revision FROM capability_consents
        WHERE ownerId = ? AND connectionId = ? AND capabilityKind = ?
          AND disclosureRevision = ? AND status = 'granted' LIMIT 1`,
      args: [
        input.ownerId,
        input.connectionId,
        input.capability,
        input.disclosureRevision,
      ],
    });
    const row = result.rows[0] as Row | undefined;
    return Boolean(
      row &&
        (input.expectedRevision === undefined ||
          Number(row.revision) === input.expectedRevision),
    );
  }

  async isGrantCurrent(input: {
    ownerId: string;
    consentId: string;
    expectedRevision: number;
    connectionId: string;
    capability: CapabilityKind;
    disclosureRevision: string;
  }): Promise<boolean> {
    const result = await this.client.execute({
      sql: `SELECT 1 FROM capability_consents
        WHERE id = ? AND ownerId = ? AND revision = ? AND connectionId = ?
          AND capabilityKind = ? AND disclosureRevision = ?
          AND status = 'granted' LIMIT 1`,
      args: [
        input.consentId,
        input.ownerId,
        input.expectedRevision,
        input.connectionId,
        input.capability,
        input.disclosureRevision,
      ],
    });
    return result.rows.length === 1;
  }

  private async findIdentity(input: {
    ownerId: string;
    connectionId: string;
    capability: CapabilityKind;
    disclosureRevision: string;
  }) {
    const result = await this.client.execute({
      sql: `SELECT * FROM capability_consents
        WHERE ownerId = ? AND connectionId = ? AND capabilityKind = ?
          AND disclosureRevision = ? LIMIT 1`,
      args: [
        input.ownerId,
        input.connectionId,
        input.capability,
        input.disclosureRevision,
      ],
    });
    const row = result.rows[0] as Row | undefined;
    return row ? consentFromRow(row) : null;
  }

  private async assertPublishedDisclosure(input: {
    ownerId: string;
    connectionId: string;
    capability: CapabilityKind;
    disclosureRevision: string;
  }) {
    const result = await this.client.execute({
      sql: `SELECT offering.descriptorJson FROM capability_offerings offering
        JOIN capability_provider_connections connection
          ON connection.id = offering.connectionId
        WHERE connection.id = ? AND connection.ownerKind = 'user' AND connection.ownerId = ?
          AND connection.deletedAt IS NULL AND connection.status = 'ready'
          AND json_extract(offering.descriptorJson, '$.connectionRevision') = connection.revision
          AND (offering.expiresAt IS NULL OR offering.expiresAt > ?)
          AND offering.capabilityKind = ?
          AND offering.status IN ('discovered', 'ready', 'unavailable')`,
      args: [input.connectionId, input.ownerId, Math.floor(this.clock().getTime() / 1_000), input.capability],
    });
    const published = (result.rows as Row[]).some((row) => {
      const offering = capabilityOfferingSchema.parse(
        capabilityJson(row.descriptorJson),
      );
      return offering.dataHandling.disclosureRevision === input.disclosureRevision;
    });
    if (!published) {
      throw new CapabilityConsentStoreError(
        "DISCLOSURE_NOT_PUBLISHED",
        "Consent revision is not published by a current offering",
      );
    }
  }
}
