import type { ManagedCapability, UsageUnit } from "@avermate/agent-contracts";
import { db } from "../db";
import { env } from "../lib/env";
import type { ResolvedServiceKey } from "../lib/service-keys";
import { managedUsage } from "../managed/services";
import { ManagedCostControls } from "../operations/cost-controls";

const controls = new ManagedCostControls(db.$client);
const RESERVATION_TTL_MS = 60 * 60 * 1_000;

export type ManagedProviderReservation = {
  accountId: string;
  id: string;
  maximumQuantity: string;
  provider: string;
  model?: string;
};

export function usesManagedOperatorSpend(credential: ResolvedServiceKey) {
  return (
    credential.source === "operator" &&
    env.AVERMATE_DEPLOYMENT_MODE === "hosted" &&
    env.MANAGED_ADAPTERS_ENABLED
  );
}

/** Reserve before the first external side effect of an operator-paid call. */
export async function reserveManagedProviderUsage(input: {
  credential: ResolvedServiceKey;
  accountId: string;
  operationId?: string;
  capability: ManagedCapability;
  unit: UsageUnit;
  maximumQuantity: string;
  provider: string;
  model?: string;
  estimatorVersion: string;
}): Promise<ManagedProviderReservation | null> {
  if (!usesManagedOperatorSpend(input.credential)) return null;
  if (!input.operationId?.trim()) {
    throw new Error("MANAGED_OPERATION_ID_REQUIRED");
  }
  await controls.assertAllowed({
    accountId: input.accountId,
    capability: input.capability,
    provider: input.provider,
    maximumQuantity: input.maximumQuantity,
    unit: input.unit,
  });
  const reserved = await managedUsage().reserve({
    accountId: input.accountId,
    userId: input.accountId,
    capability: input.capability,
    unit: input.unit,
    maximumQuantity: input.maximumQuantity,
    idempotencyKey: `provider:${input.operationId}:${input.capability}`,
    placement: { kind: "managed", providerId: input.provider },
    runId: input.operationId,
    provider: input.provider,
    model: input.model,
    expiresAt: new Date(Date.now() + RESERVATION_TTL_MS),
    estimatorVersion: input.estimatorVersion,
  });
  return {
    accountId: input.accountId,
    id: reserved.reservation.id,
    maximumQuantity: input.maximumQuantity,
    provider: input.provider,
    model: input.model,
  };
}

export async function settleManagedProviderUsage(
  reservation: ManagedProviderReservation | null,
  input: {
    actualQuantity: string;
    outcome: "completed" | "failed" | "cancelled";
    authoritative: boolean;
    evidenceRef?: string;
  },
) {
  if (!reservation) return;
  await managedUsage().settle({
    accountId: reservation.accountId,
    reservationId: reservation.id,
    actualQuantity: input.actualQuantity,
    outcome: input.outcome,
    authoritative: input.authoritative,
    provider: reservation.provider,
    model: reservation.model,
    evidenceRef: input.evidenceRef,
  });
}
