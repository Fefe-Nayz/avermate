import { createHash } from "node:crypto";
import type { InValue } from "@libsql/client";
import type { EntitlementSqlClient } from "../entitlements/service";

export const MANAGED_RECOVERY_TABLES = [
  "pricing_snapshots",
  "entitlement_snapshots",
  "entitlement_grants",
  "entitlement_decisions",
  "account_execution_controls",
  "billing_subscriptions",
  "billing_webhook_inbox",
  "managed_circuit_breakers",
  "managed_abuse_decisions",
  "managed_worker_pools",
  "usage_reservations",
  "usage_events",
  "usage_period_aggregates",
  "managed_model_catalogue",
  "managed_storage_objects",
  "placement_migrations",
  "privacy_operation_requests",
  "privacy_operation_targets",
  "security_audit_events",
  "support_elevations",
] as const;

type RecoveryValue = string | number | null;
type RecoveryObject = {
  placement: string;
  opaqueRef: string;
  digest: `sha256:${string}`;
  byteSize: number;
};

export type ManagedRecoverySnapshotV1 = {
  version: 1;
  capturedAt: string;
  tables: Record<string, Array<Record<string, RecoveryValue>>>;
  objects: RecoveryObject[];
  digest: `sha256:${string}`;
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function recoveryValue(value: InValue): RecoveryValue {
  if (value === null || typeof value === "string" || typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  throw new Error("MANAGED_BACKUP_UNSUPPORTED_VALUE");
}

function payload(snapshot: Omit<ManagedRecoverySnapshotV1, "digest">) {
  return {
    version: snapshot.version,
    capturedAt: snapshot.capturedAt,
    tables: snapshot.tables,
    objects: snapshot.objects,
  };
}

export async function captureManagedRecoverySnapshot(input: {
  client: EntitlementSqlClient;
  capturedAt?: Date;
  objects?: RecoveryObject[];
}): Promise<ManagedRecoverySnapshotV1> {
  const tables: ManagedRecoverySnapshotV1["tables"] = {};
  for (const table of MANAGED_RECOVERY_TABLES) {
    const result = await input.client.execute(
      `SELECT * FROM "${table}" ORDER BY rowid`,
    );
    tables[table] = result.rows.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([column, value]) => [
          column,
          recoveryValue(value),
        ]),
      ),
    );
  }
  const withoutDigest = {
    version: 1 as const,
    capturedAt: (input.capturedAt ?? new Date()).toISOString(),
    tables,
    objects: [...(input.objects ?? [])].sort((left, right) =>
      left.opaqueRef.localeCompare(right.opaqueRef),
    ),
  };
  return { ...withoutDigest, digest: digest(payload(withoutDigest)) };
}

export async function restoreManagedRecoverySnapshot(input: {
  client: EntitlementSqlClient;
  snapshot: ManagedRecoverySnapshotV1;
  restoreObject?: (object: RecoveryObject) => Promise<void>;
  verifyObject?: (object: RecoveryObject) => Promise<boolean>;
}) {
  if (digest(payload(input.snapshot)) !== input.snapshot.digest) {
    throw new Error("MANAGED_BACKUP_DIGEST_MISMATCH");
  }
  const tx = await input.client.transaction("write");
  try {
    for (const table of MANAGED_RECOVERY_TABLES) {
      const count = await tx.execute(`SELECT COUNT(*) AS count FROM "${table}"`);
      if (Number(count.rows[0]?.count) !== 0) {
        throw new Error(`MANAGED_RESTORE_TARGET_NOT_EMPTY:${table}`);
      }
      const columnsResult = await tx.execute(`PRAGMA table_info("${table}")`);
      const allowedColumns = new Set(
        columnsResult.rows.map((row) => String(row.name)),
      );
      for (const row of input.snapshot.tables[table] ?? []) {
        const columns = Object.keys(row);
        if (
          columns.length === 0 ||
          columns.some(
            (column) =>
              !/^[A-Za-z][A-Za-z0-9]*$/u.test(column) ||
              !allowedColumns.has(column),
          )
        ) {
          throw new Error(`MANAGED_RESTORE_SCHEMA_MISMATCH:${table}`);
        }
        await tx.execute({
          sql: `INSERT INTO "${table}" (${columns
            .map((column) => `"${column}"`)
            .join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
          args: columns.map((column) => row[column] ?? null),
        });
      }
    }
    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  }

  for (const object of input.snapshot.objects) {
    await input.restoreObject?.(object);
    if (input.verifyObject && !(await input.verifyObject(object))) {
      throw new Error(`MANAGED_RESTORE_OBJECT_MISMATCH:${object.opaqueRef}`);
    }
  }
  const restored = await captureManagedRecoverySnapshot({
    client: input.client,
    capturedAt: new Date(input.snapshot.capturedAt),
    objects: input.snapshot.objects,
  });
  if (restored.digest !== input.snapshot.digest) {
    throw new Error("MANAGED_RESTORE_RECONCILIATION_MISMATCH");
  }
  return {
    digest: restored.digest,
    tableCount: MANAGED_RECOVERY_TABLES.length,
    objectCount: input.snapshot.objects.length,
  };
}
