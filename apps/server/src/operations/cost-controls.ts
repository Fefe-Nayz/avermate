import type { InValue } from "@libsql/client";
import type { ManagedCapability } from "@avermate/agent-contracts";
import type { EntitlementSqlClient } from "../entitlements/service";

type Row = Record<string, InValue>;

export class ManagedCostControlError extends Error {
  constructor(readonly reasonCode: string) {
    super(`MANAGED_EXECUTION_BLOCKED:${reasonCode}`);
    this.name = "ManagedCostControlError";
  }
}

export class ManagedCostControls {
  constructor(
    private readonly client: EntitlementSqlClient,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async assertAllowed(input: {
    accountId: string;
    capability: ManagedCapability;
    provider?: string;
  }) {
    const now = Math.floor(this.clock().getTime() / 1_000);
    const scopes = [
      ["global", "*"],
      ["account", input.accountId],
      ["capability", input.capability],
      ...(input.provider ? [["provider", input.provider]] : []),
    ];
    for (const [scope, scopeId] of scopes) {
      const rows = await this.client.execute({
        sql: `SELECT state, reasonCode FROM managed_circuit_breakers
          WHERE scope = ? AND scopeId = ? AND state = 'open'
            AND (expiresAt IS NULL OR expiresAt > ?) LIMIT 1`,
        args: [scope!, scopeId!, now],
      });
      const row = rows.rows[0] as Row | undefined;
      if (row) throw new ManagedCostControlError(String(row.reasonCode));
    }
    const abuse = await this.client.execute({
      sql: `SELECT state, reasonCode FROM managed_abuse_decisions
        WHERE accountId = ? AND (capability IS NULL OR capability = ?)
          AND state IN ('restricted', 'quarantined', 'blocked')
          AND (expiresAt IS NULL OR expiresAt > ?)
        ORDER BY createdAt DESC LIMIT 1`,
      args: [input.accountId, input.capability, now],
    });
    const decision = abuse.rows[0] as Row | undefined;
    if (decision) throw new ManagedCostControlError(String(decision.reasonCode));
  }
}
