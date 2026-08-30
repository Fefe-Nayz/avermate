import type { Client, InValue } from "@libsql/client";
import {
  capabilityUsageSchema,
  type CapabilityKind,
  type CapabilityUsageUnit,
} from "@avermate/agent-contracts";
import { db } from "../db";
import { capabilityEpoch } from "./values";

type SqlClient = Pick<Client, "execute">;
type Row = Record<string, InValue>;

function parseDecimal(value: string) {
  const [whole = "0", fraction = ""] = value.split(".");
  return {
    scale: fraction.length,
    integer: BigInt(`${whole}${fraction}`),
  };
}

function addDecimals(values: readonly string[]): string {
  const parsed = values.map(parseDecimal);
  const scale = Math.max(0, ...parsed.map((value) => value.scale));
  const total = parsed.reduce(
    (sum, value) =>
      sum + value.integer * 10n ** BigInt(scale - value.scale),
    0n,
  );
  if (scale === 0) return total.toString();
  const padded = total.toString().padStart(scale + 1, "0");
  const result = `${padded.slice(0, -scale)}.${padded.slice(-scale)}`;
  const [resultWhole, resultFraction = ""] = result.split(".");
  const trimmedFraction = resultFraction.replace(/0+$/u, "");
  return trimmedFraction ? `${resultWhole}.${trimmedFraction}` : resultWhole!;
}

export type CapabilityUsageBreakdown = {
  byUnit: Array<{ unit: CapabilityUsageUnit; quantity: string }>;
  costByCurrency: Array<{
    currency: string;
    amountMinor: string;
    authoritative: boolean;
  }>;
};

export type CapabilityUsageSummary = CapabilityUsageBreakdown & {
  byCapability: Array<
    { capability: CapabilityKind } & CapabilityUsageBreakdown
  >;
  operations: {
    total: number;
    completed: number;
    failed: number;
    cancelled: number;
  };
};

function summarizeUsage(rows: readonly Row[]): CapabilityUsageBreakdown {
  const units = new Map<CapabilityUsageUnit, string[]>();
  const costs = new Map<string, { values: string[]; authoritative: boolean }>();
  for (const row of rows) {
    const usage = capabilityUsageSchema.parse(
      typeof row.usageJson === "string"
        ? JSON.parse(row.usageJson)
        : row.usageJson,
    );
    for (const item of usage.items) {
      units.set(item.unit, [
        ...(units.get(item.unit) ?? []),
        item.quantity,
      ]);
    }
    if (usage.cost.currency !== null && usage.cost.amountMinor !== null) {
      const currency = usage.cost.currency;
      const previous = costs.get(currency) ?? {
        values: [],
        authoritative: true,
      };
      previous.values.push(usage.cost.amountMinor);
      previous.authoritative &&= usage.cost.authoritative;
      costs.set(currency, previous);
    }
  }
  return {
    byUnit: [...units]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([unit, values]) => ({ unit, quantity: addDecimals(values) })),
    costByCurrency: [...costs]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([currency, value]) => ({
        currency,
        amountMinor: addDecimals(value.values),
        authoritative: value.authoritative,
      })),
  };
}

export class CapabilityUsageService {
  constructor(private readonly client: SqlClient = db.$client) {}

  async summary(input: {
    ownerId: string;
    since?: Date;
  }): Promise<CapabilityUsageSummary> {
    const since = input.since ? capabilityEpoch(input.since) : 0;
    const [usage, operations] = await Promise.all([
      this.client.execute({
        sql: `SELECT operation.capabilityKind, usage.usageJson
          FROM capability_usage usage
          JOIN capability_operations operation ON operation.id = usage.operationId
          WHERE operation.ownerId = ? AND usage.createdAt >= ?`,
        args: [input.ownerId, since],
      }),
      this.client.execute({
        sql: `SELECT state, COUNT(*) AS count FROM capability_operations
          WHERE ownerId = ? AND createdAt >= ? GROUP BY state`,
        args: [input.ownerId, since],
      }),
    ]);

    const usageRows = usage.rows as Row[];
    const totals = summarizeUsage(usageRows);
    const byCapability = new Map<CapabilityKind, Row[]>();
    for (const row of usageRows) {
      const capability = String(row.capabilityKind) as CapabilityKind;
      byCapability.set(capability, [
        ...(byCapability.get(capability) ?? []),
        row,
      ]);
    }
    const counts = new Map(
      (operations.rows as Row[]).map((row) => [
        String(row.state),
        Number(row.count),
      ]),
    );
    return {
      ...totals,
      byCapability: [...byCapability]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([capability, rows]) => ({
          capability,
          ...summarizeUsage(rows),
        })),
      operations: {
        total: [...counts.values()].reduce((sum, count) => sum + count, 0),
        completed: counts.get("completed") ?? 0,
        failed:
          (counts.get("failed") ?? 0) +
          (counts.get("inspect-required") ?? 0),
        cancelled: counts.get("cancelled") ?? 0,
      },
    };
  }
}
