import type { InValue } from "@libsql/client";
import {
  managedCapabilitySchema,
  pricingSnapshotV1Schema,
  usageUnitSchema,
  type PricingSnapshotV1,
} from "@avermate/agent-contracts";
import type { EntitlementSqlClient } from "../entitlements/service";
import { newId } from "../lib/id";

type Row = Record<string, InValue>;

function seconds(date: Date) {
  return Math.floor(date.getTime() / 1_000);
}

export class PricingService {
  constructor(
    private readonly client: EntitlementSqlClient,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async publish(
    input: Omit<PricingSnapshotV1, "version" | "id"> & { id?: string },
  ) {
    const snapshot = pricingSnapshotV1Schema.parse({
      version: 1,
      id: input.id ?? newId("price"),
      ...input,
    });
    await this.client.execute({
      sql: `INSERT INTO pricing_snapshots
        (id, provider, model, capability, unit, currency, rateMinor,
         quantityScale, effectiveAt, retiredAt, source, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        snapshot.id,
        snapshot.provider,
        snapshot.model ?? null,
        snapshot.capability,
        snapshot.unit,
        snapshot.currency,
        snapshot.rateMinor,
        snapshot.quantityScale,
        seconds(new Date(snapshot.effectiveAt)),
        snapshot.retiredAt ? seconds(new Date(snapshot.retiredAt)) : null,
        snapshot.source,
        seconds(this.clock()),
      ],
    });
    return snapshot;
  }

  async summarizeRun(accountId: string, runId: string) {
    const rows = await this.client.execute({
      sql: `SELECT e.*, p.currency, p.rateMinor, p.quantityScale,
        p.source AS pricingSource
        FROM usage_events e
        LEFT JOIN pricing_snapshots p ON p.id = e.pricingSnapshotId
        WHERE e.accountId = ? AND e.runId = ?
        ORDER BY e.occurredAt, e.id`,
      args: [accountId, runId],
    });
    return (rows.rows as Row[]).map((row) => {
      const quantity = BigInt(String(row.quantity));
      const rate = row.rateMinor === null ? null : BigInt(String(row.rateMinor));
      const scale =
        row.quantityScale === null ? null : BigInt(String(row.quantityScale));
      const costMinor =
        rate === null || scale === null || scale === 0n
          ? null
          : ((quantity * rate + (scale - 1n)) / scale).toString();
      const authoritative = Number(row.authoritative) === 1;
      return {
        eventId: String(row.id),
        capability: managedCapabilitySchema.parse(row.capability),
        quantity: String(row.quantity),
        unit: usageUnitSchema.parse(row.unit),
        direction: String(row.direction),
        provider: row.provider === null ? null : String(row.provider),
        model: row.model === null ? null : String(row.model),
        placement:
          typeof row.placementJson === "string"
            ? JSON.parse(row.placementJson)
            : row.placementJson,
        pricingSnapshotId:
          row.pricingSnapshotId === null ? null : String(row.pricingSnapshotId),
        currency: row.currency === null ? null : String(row.currency),
        providerCostMinor:
          authoritative && row.pricingSource === "provider" ? costMinor : null,
        operatorEstimateMinor:
          !authoritative || row.pricingSource === "operator" ? costMinor : null,
        userChargeMinor: null,
        includedQuota: true,
        final: authoritative,
      };
    });
  }
}
