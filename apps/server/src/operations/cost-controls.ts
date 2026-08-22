import type { InValue } from "@libsql/client";
import type { ManagedCapability, UsageUnit } from "@avermate/agent-contracts";
import type { EntitlementSqlClient } from "../entitlements/service";
import { env } from "../lib/env";
import { managedBetaAccountForDispatch } from "../managed/beta-control-plane";

type Row = Record<string, InValue>;

export class ManagedCostControlError extends Error {
  constructor(readonly reasonCode: string) {
    super(`MANAGED_EXECUTION_BLOCKED:${reasonCode}`);
    this.name = "ManagedCostControlError";
  }
}

export class ManagedCostControls {
  private readonly betaEnforcementEnabled: boolean;

  constructor(
    private readonly client: EntitlementSqlClient,
    private readonly clock: () => Date = () => new Date(),
    options: { betaEnforcementEnabled?: boolean } = {},
  ) {
    this.betaEnforcementEnabled =
      options.betaEnforcementEnabled ?? env.MANAGED_BETA_ENFORCEMENT_ENABLED;
  }

  async assertAllowed(input: {
    accountId: string;
    capability: ManagedCapability;
    provider?: string;
    maximumQuantity?: string;
    unit?: UsageUnit;
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
    if (decision)
      throw new ManagedCostControlError(String(decision.reasonCode));

    if (
      env.AVERMATE_DEPLOYMENT_MODE === "hosted" &&
      this.betaEnforcementEnabled
    ) {
      await this.#assertBetaPolicy(input);
    }
  }

  async #assertBetaPolicy(input: {
    accountId: string;
    capability: ManagedCapability;
    provider?: string;
    maximumQuantity?: string;
    unit?: UsageUnit;
  }) {
    let account: Awaited<ReturnType<typeof managedBetaAccountForDispatch>>;
    try {
      account = await managedBetaAccountForDispatch(
        this.client,
        input.accountId,
      );
    } catch {
      throw new ManagedCostControlError("BETA_CONTROL_PLANE_UNAVAILABLE");
    }
    if (!account) throw new ManagedCostControlError("BETA_INVITE_REQUIRED");
    if (account.state !== "active") {
      throw new ManagedCostControlError("BETA_ACCOUNT_NOT_ACTIVE");
    }
    if (!account.managedDataConsent) {
      throw new ManagedCostControlError("BETA_CONSENT_REQUIRED");
    }
    if (!account.capabilities.includes(input.capability)) {
      throw new ManagedCostControlError("BETA_CAPABILITY_NOT_ELIGIBLE");
    }

    const policies = await this.client.execute({
      sql: `SELECT scope, scopeId, capability, period, hardLimit, concurrency
        FROM managed_quota_policies WHERE enabled = 1 AND (
          (scope = 'global' AND scopeId = '*') OR
          (scope = 'account' AND scopeId = ?) OR
          (scope = 'cohort' AND scopeId = ?) OR
          (scope = 'provider' AND scopeId = ?) OR
          (scope = 'capability' AND scopeId = ?)
        )`,
      args: [
        input.accountId,
        account.cohort,
        input.provider ?? "",
        input.capability,
      ],
    });
    const maximum = input.maximumQuantity ?? "0";
    if (!/^(?:0|[1-9]\d*)$/u.test(maximum)) {
      throw new ManagedCostControlError("BETA_QUOTA_ESTIMATE_INVALID");
    }
    const aggregates = new Map<
      string,
      { consumed: bigint; reserved: bigint; active: number }
    >();
    for (const policy of policies.rows as Row[]) {
      const policyCapability = String(policy.capability);
      if (policyCapability !== "*" && policyCapability !== input.capability) {
        continue;
      }
      const period = String(policy.period);
      const current = this.clock();
      const start =
        period === "daily"
          ? Date.UTC(
              current.getUTCFullYear(),
              current.getUTCMonth(),
              current.getUTCDate(),
            ) / 1_000
          : Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1) /
            1_000;
      const key = `${period}:${start}`;
      let aggregate = aggregates.get(key);
      if (!aggregate) {
        const [events, reservations] = await Promise.all([
          this.client.execute({
            sql: `SELECT COALESCE(SUM(CASE
                WHEN direction = 'consume' THEN CAST(quantity AS INTEGER)
                WHEN direction = 'adjust' THEN CAST(quantity AS INTEGER)
                ELSE 0 END), 0) AS consumed
              FROM usage_events WHERE accountId = ? AND capability = ?
                AND occurredAt >= ?`,
            args: [input.accountId, input.capability, start],
          }),
          this.client.execute({
            sql: `SELECT COUNT(*) AS active,
              COALESCE(SUM(CAST(reservedQuantity AS INTEGER)
                - CAST(consumedQuantity AS INTEGER)
                - CAST(releasedQuantity AS INTEGER)), 0) AS reserved
              FROM usage_reservations WHERE accountId = ? AND capability = ?
                AND status = 'reserved' AND createdAt >= ?`,
            args: [input.accountId, input.capability, start],
          }),
        ]);
        aggregate = {
          consumed: BigInt(String(events.rows[0]?.consumed ?? "0")),
          reserved: BigInt(String(reservations.rows[0]?.reserved ?? "0")),
          active: Number(reservations.rows[0]?.active ?? 0),
        };
        aggregates.set(key, aggregate);
      }
      const hardLimit = BigInt(String(policy.hardLimit));
      if (
        aggregate.consumed + aggregate.reserved + BigInt(maximum) >
        hardLimit
      ) {
        throw new ManagedCostControlError(
          `BETA_${period.toUpperCase()}_HARD_LIMIT_EXCEEDED`,
        );
      }
      const concurrency = Number(policy.concurrency);
      if (concurrency >= 0 && aggregate.active >= concurrency) {
        throw new ManagedCostControlError("BETA_CONCURRENCY_LIMIT_EXCEEDED");
      }
    }
  }
}
