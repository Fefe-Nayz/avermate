import type {
  CapabilityRoutingDecision,
  ExecutionRouter,
  ManagedCapability,
  RoutedHandle,
  RoutedOperation,
  UsageUnit,
} from "@avermate/agent-contracts";
import type { UsageLedger } from "./ledger";
import { RoutingDispatchRejectedError } from "../node/execution-router";

export type UsageEstimate = {
  capability: ManagedCapability;
  unit: UsageUnit;
  maximumQuantity: string;
  estimatorVersion: string;
  userId?: string;
  provider?: string;
  model?: string;
  pricingSnapshotId?: string;
  expiresAt: Date;
};

export interface ResolvedExecutionRouter extends ExecutionRouter {
  dispatchResolved(
    operation: RoutedOperation,
    decision: CapabilityRoutingDecision,
  ): Promise<RoutedHandle>;
}

export type MeteredRoutedHandle = RoutedHandle & {
  reservationId?: string;
  entitlementDecisionId?: string;
  shadowWouldBlock?: boolean;
};

/**
 * Reservation gate for operator-paid placement. Core/BYOK/user-node routing
 * remains independent and never silently consumes managed allowance.
 */
export class MeteredExecutionRouter implements ExecutionRouter {
  constructor(
    private readonly delegate: ResolvedExecutionRouter,
    private readonly ledger: UsageLedger,
    private readonly estimate: (
      operation: RoutedOperation,
      decision: CapabilityRoutingDecision,
    ) => Promise<UsageEstimate> | UsageEstimate,
    private readonly attachGrant: (
      operation: RoutedOperation,
      grant: { reservationId: string; entitlementDecisionId: string },
    ) => RoutedOperation,
    private readonly assertDispatch?: (input: {
      accountId: string;
      capability: ManagedCapability;
      providerId: string;
    }) => Promise<void>,
  ) {}

  resolve(input: Parameters<ExecutionRouter["resolve"]>[0]) {
    return this.delegate.resolve(input);
  }

  async dispatch(operation: RoutedOperation): Promise<MeteredRoutedHandle> {
    const decision = await this.delegate.resolve(operation.request);
    if (decision.placement.kind !== "managed") {
      return this.delegate.dispatchResolved(operation, decision);
    }
    const estimate = await this.estimate(operation, decision);
    await this.assertDispatch?.({
      accountId: operation.request.userId,
      capability: estimate.capability,
      providerId: decision.placement.providerId,
    });
    const reserved = await this.ledger.reserve({
      accountId: operation.request.userId,
      userId: estimate.userId ?? operation.request.userId,
      capability: estimate.capability,
      unit: estimate.unit,
      maximumQuantity: estimate.maximumQuantity,
      idempotencyKey: `dispatch:${operation.operationId}`,
      placement: decision.placement,
      runId: operation.request.capability === "models" ? operation.operationId : undefined,
      jobId: operation.request.capability === "jobs" ? operation.operationId : undefined,
      provider: estimate.provider,
      model: estimate.model,
      pricingSnapshotId: estimate.pricingSnapshotId,
      expiresAt: estimate.expiresAt,
      estimatorVersion: estimate.estimatorVersion,
    });
    const routed = this.attachGrant(operation, {
      reservationId: reserved.reservation.id,
      entitlementDecisionId: reserved.decision.decisionId,
    });
    let handle: RoutedHandle;
    try {
      handle = await this.delegate.dispatchResolved(routed, decision);
    } catch (error) {
      if (error instanceof RoutingDispatchRejectedError) {
        // This typed rejection happens before the placement adapter is called,
        // so releasing the complete reservation is safe and exact.
        await this.ledger.settle({
          accountId: operation.request.userId,
          reservationId: reserved.reservation.id,
          actualQuantity: "0",
          outcome: "failed",
          authoritative: true,
          provider: estimate.provider,
          model: estimate.model,
          evidenceRef: error.message,
        });
      }
      // Failures after the adapter boundary deliberately leave the bounded
      // reservation unsettled for a provider callback/reconciler; they are not
      // assumed free.
      throw error;
    }
    return {
      ...handle,
      reservationId: reserved.reservation.id,
      entitlementDecisionId: reserved.decision.decisionId,
      shadowWouldBlock: reserved.decision.wouldBlock,
    };
  }
}
