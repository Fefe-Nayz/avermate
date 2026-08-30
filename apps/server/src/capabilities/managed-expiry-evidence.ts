import type { Client } from "@libsql/client";
import type { UsageExpirySettlementResolver } from "../usage/ledger";

type SqlClient = Pick<Client, "execute">;

/**
 * Converts a durable capability dispatch fence into conservative expiry
 * accounting. Missing/corrupt evidence fails closed at the reserved maximum;
 * a known pre-dispatch attempt may be released normally by the ledger.
 */
export function capabilityRegistryExpirySettlementResolver(
  client: SqlClient,
): UsageExpirySettlementResolver {
  return async (reservation) => {
    if (!reservation.idempotencyKey.startsWith("capreg:")) return undefined;
    if (!reservation.runId || !reservation.jobId) {
      return {
        actualQuantity: reservation.reservedQuantity,
        outcome: "failed",
        authoritative: false,
        evidenceRef: "capability-registry-expiry-evidence-missing",
      };
    }
    const evidence = await client.execute({
      sql: `SELECT attempt.providerDispatchedAt
        FROM capability_attempts attempt
        JOIN capability_operations operation ON operation.id = attempt.operationId
        WHERE attempt.id = ? AND operation.id = ? AND operation.ownerId = ?
        LIMIT 1`,
      args: [reservation.jobId, reservation.runId, reservation.accountId],
    });
    const row = evidence.rows[0];
    if (!row) {
      return {
        actualQuantity: reservation.reservedQuantity,
        outcome: "failed",
        authoritative: false,
        evidenceRef: "capability-registry-expiry-evidence-missing",
      };
    }
    if (row.providerDispatchedAt === null) return undefined;
    return {
      actualQuantity: reservation.reservedQuantity,
      outcome: "failed",
      authoritative: false,
      evidenceRef: "capability-registry-expired-after-dispatch",
    };
  };
}
