import type { EntitlementSqlClient } from "../entitlements/service";
import { env } from "../lib/env";

const managedTables = [
  "entitlement_snapshots",
  "entitlement_decisions",
  "usage_reservations",
  "usage_events",
  "managed_storage_objects",
  "privacy_operation_requests",
  "managed_beta_accounts",
  "managed_quota_policies",
  "managed_operational_evidence",
  "managed_launch_gates",
] as const;

/** Dependency probe with no model, sandbox, storage, or billing side effect. */
export async function managedReadiness(
  client: EntitlementSqlClient,
  config: {
    deploymentMode?: "hosted" | "full-self-host";
    accountingMode?: "shadow" | "enforce";
    managedAdaptersEnabled?: boolean;
  } = {},
) {
  const deploymentMode = config.deploymentMode ?? env.AVERMATE_DEPLOYMENT_MODE;
  const accountingMode = config.accountingMode ?? env.MANAGED_ACCOUNTING_MODE;
  const managedAdaptersEnabled =
    config.managedAdaptersEnabled ?? env.MANAGED_ADAPTERS_ENABLED;
  try {
    await client.execute("SELECT 1 AS ready");
    const rows = await client.execute({
      sql: `SELECT name FROM sqlite_master WHERE type = 'table'
        AND name IN (${managedTables.map(() => "?").join(",")})`,
      args: [...managedTables],
    });
    const present = new Set(rows.rows.map((row) => String(row.name)));
    const missing = managedTables.filter((table) => !present.has(table));
    const managedSchemaReady = missing.length === 0;
    const ready = !managedAdaptersEnabled || managedSchemaReady;
    return {
      ready,
      checks: {
        database: "ready" as const,
        managedSchema: managedSchemaReady
          ? ("ready" as const)
          : ("missing" as const),
        missingManagedTables: missing,
      },
      mode: {
        deployment: deploymentMode,
        accounting: accountingMode,
        managedAdaptersEnabled,
        betaEnforcementEnabled: env.MANAGED_BETA_ENFORCEMENT_ENABLED,
        billingEnabled: false,
        checkoutEnabled: false,
        telemetryExporter: "none" as const,
      },
    };
  } catch {
    return {
      ready: false,
      checks: {
        database: "unavailable" as const,
        managedSchema: "unknown" as const,
        missingManagedTables: [] as string[],
      },
      mode: {
        deployment: deploymentMode,
        accounting: accountingMode,
        managedAdaptersEnabled,
        betaEnforcementEnabled: env.MANAGED_BETA_ENFORCEMENT_ENABLED,
        billingEnabled: false,
        checkoutEnabled: false,
        telemetryExporter: "none" as const,
      },
    };
  }
}
