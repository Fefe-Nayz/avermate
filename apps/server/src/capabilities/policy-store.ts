import type { Client, InValue } from "@libsql/client";
import {
  capabilityPolicySchema,
  type CapabilityKind,
  type CapabilityPolicy,
  type CapabilityPolicyConstraints,
  type CapabilityPolicyMode,
  type CapabilityPolicyScope,
} from "@avermate/agent-contracts";
import { db } from "../db";
import { newId } from "../lib/id";
import { capabilityIso, capabilityJson } from "./values";

type SqlClient = Pick<Client, "execute">;
type Row = Record<string, InValue>;

export class CapabilityPolicyStoreError extends Error {
  constructor(
    readonly code:
      | "NOT_FOUND"
      | "REVISION_CONFLICT"
      | "OFFERING_MISMATCH"
      | "POLICY_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "CapabilityPolicyStoreError";
  }
}

export type CapabilityPolicyUpsertInput = {
  ownerId: string;
  policyId?: string;
  expectedRevision: number | null;
  scope: CapabilityPolicyScope;
  capability: CapabilityKind;
  purposePattern: string;
  mode: CapabilityPolicyMode;
  primaryOfferingId: string | null;
  fallbackOfferingIds: string[];
  constraints: CapabilityPolicyConstraints;
};

function policyFromRow(row: Row): CapabilityPolicy {
  return capabilityPolicySchema.parse({
    schemaVersion: 1,
    id: String(row.id),
    ownerId: String(row.ownerId),
    scope: { kind: row.scopeKind, id: String(row.scopeId) },
    capability: row.capabilityKind,
    purposePattern: String(row.purposePattern),
    mode: row.mode,
    primaryOfferingId:
      row.primaryOfferingId === null ? null : String(row.primaryOfferingId),
    fallbackOfferingIds: capabilityJson(row.fallbackOfferingIdsJson),
    constraints: capabilityJson(row.constraintsJson),
    revision: Number(row.revision),
    createdAt: capabilityIso(row.createdAt),
    updatedAt: capabilityIso(row.updatedAt),
    deletedAt: row.deletedAt === null ? null : capabilityIso(row.deletedAt),
  });
}

export class CapabilityPolicyStore {
  constructor(
    private readonly client: SqlClient = db.$client,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async list(ownerId: string, capability?: CapabilityKind): Promise<CapabilityPolicy[]> {
    const result = await this.client.execute({
      sql: `SELECT * FROM capability_policies
        WHERE ownerId = ? AND deletedAt IS NULL
          ${capability ? "AND capabilityKind = ?" : ""}
        ORDER BY scopeKind, scopeId, purposePattern, id`,
      args: [ownerId, ...(capability ? [capability] : [])],
    });
    return (result.rows as Row[]).map(policyFromRow);
  }

  async get(ownerId: string, policyId: string): Promise<CapabilityPolicy | null> {
    const result = await this.client.execute({
      sql: `SELECT * FROM capability_policies
        WHERE id = ? AND ownerId = ? AND deletedAt IS NULL LIMIT 1`,
      args: [policyId, ownerId],
    });
    const row = result.rows[0] as Row | undefined;
    return row ? policyFromRow(row) : null;
  }

  async assertAppliedPoliciesCurrent(input: {
    ownerId: string;
    appliedPolicies: readonly {
      id: string;
      revision: number;
      scopeKind: string;
    }[];
  }): Promise<void> {
    if (input.appliedPolicies.length === 0) return;
    const ids = input.appliedPolicies.map((policy) => policy.id);
    if (new Set(ids).size !== ids.length) {
      throw new CapabilityPolicyStoreError(
        "REVISION_CONFLICT",
        "Frozen policy snapshot repeats an applied policy",
      );
    }
    const result = await this.client.execute({
      sql: `SELECT id, revision, scopeKind FROM capability_policies
        WHERE ownerId = ? AND deletedAt IS NULL
          AND id IN (${ids.map(() => "?").join(", ")})`,
      args: [input.ownerId, ...ids],
    });
    const current = new Map(
      (result.rows as Row[]).map((row) => [
        String(row.id),
        { revision: Number(row.revision), scopeKind: String(row.scopeKind) },
      ]),
    );
    const changed = input.appliedPolicies.some((policy) => {
      const value = current.get(policy.id);
      return (
        !value ||
        value.revision !== policy.revision ||
        value.scopeKind !== policy.scopeKind
      );
    });
    if (changed) {
      throw new CapabilityPolicyStoreError(
        "REVISION_CONFLICT",
        "An applied capability policy changed after route freeze",
      );
    }
  }

  async upsert(input: CapabilityPolicyUpsertInput): Promise<CapabilityPolicy> {
    const nowDate = this.clock();
    const nowIso = nowDate.toISOString();
    const candidate = capabilityPolicySchema.parse({
      schemaVersion: 1,
      id: input.policyId ?? newId("cpol"),
      ownerId: input.ownerId,
      scope: input.scope,
      capability: input.capability,
      purposePattern: input.purposePattern,
      mode: input.mode,
      primaryOfferingId: input.primaryOfferingId,
      fallbackOfferingIds: input.fallbackOfferingIds,
      constraints: input.constraints,
      revision: input.expectedRevision === null ? 1 : input.expectedRevision + 1,
      createdAt: nowIso,
      updatedAt: nowIso,
      deletedAt: null,
    });
    await this.assertOfferings(
      input.ownerId,
      input.capability,
      [
        ...(candidate.primaryOfferingId ? [candidate.primaryOfferingId] : []),
        ...candidate.fallbackOfferingIds,
      ],
    );
    const now = Math.floor(nowDate.getTime() / 1_000);
    if (input.expectedRevision === null) {
      try {
        await this.client.execute({
          sql: `INSERT INTO capability_policies (
            id, ownerId, scopeKind, scopeId, capabilityKind, purposePattern,
            mode, primaryOfferingId, fallbackOfferingIdsJson, constraintsJson,
            revision, createdAt, updatedAt
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          args: [
            candidate.id,
            candidate.ownerId,
            candidate.scope.kind,
            candidate.scope.id,
            candidate.capability,
            candidate.purposePattern,
            candidate.mode,
            candidate.primaryOfferingId,
            JSON.stringify(candidate.fallbackOfferingIds),
            JSON.stringify(candidate.constraints),
            now,
            now,
          ],
        });
      } catch (error) {
        throw new CapabilityPolicyStoreError(
          "POLICY_CONFLICT",
          "A policy already exists for this scope and purpose",
        );
      }
      const created = await this.get(input.ownerId, candidate.id);
      if (!created) throw new Error("Created capability policy is unreadable");
      return created;
    }

    if (!input.policyId) {
      throw new CapabilityPolicyStoreError(
        "NOT_FOUND",
        "Updating a policy requires its ID",
      );
    }
    const updated = await this.client.execute({
      sql: `UPDATE capability_policies SET
        scopeKind = ?, scopeId = ?, capabilityKind = ?, purposePattern = ?,
        mode = ?, primaryOfferingId = ?, fallbackOfferingIdsJson = ?,
        constraintsJson = ?, revision = revision + 1, updatedAt = ?
        WHERE id = ? AND ownerId = ? AND revision = ? AND deletedAt IS NULL`,
      args: [
        candidate.scope.kind,
        candidate.scope.id,
        candidate.capability,
        candidate.purposePattern,
        candidate.mode,
        candidate.primaryOfferingId,
        JSON.stringify(candidate.fallbackOfferingIds),
        JSON.stringify(candidate.constraints),
        now,
        input.policyId,
        input.ownerId,
        input.expectedRevision,
      ],
    });
    if (Number(updated.rowsAffected) !== 1) {
      throw new CapabilityPolicyStoreError(
        "REVISION_CONFLICT",
        "Capability policy revision changed",
      );
    }
    const result = await this.get(input.ownerId, input.policyId);
    if (!result) throw new Error("Updated capability policy is unreadable");
    return result;
  }

  private async assertOfferings(
    ownerId: string,
    capability: CapabilityKind,
    offeringIds: readonly string[],
  ) {
    for (const offeringId of offeringIds) {
      const result = await this.client.execute({
        sql: `SELECT 1 FROM capability_offerings offering
          JOIN capability_provider_connections connection
            ON connection.id = offering.connectionId
          WHERE offering.id = ? AND offering.capabilityKind = ?
            AND connection.ownerKind = 'user' AND connection.ownerId = ?
            AND connection.deletedAt IS NULL LIMIT 1`,
        args: [offeringId, capability, ownerId],
      });
      if (result.rows.length === 0) {
        throw new CapabilityPolicyStoreError(
          "OFFERING_MISMATCH",
          "Policy offering is absent, foreign-owned or capability-incompatible",
        );
      }
    }
  }
}
