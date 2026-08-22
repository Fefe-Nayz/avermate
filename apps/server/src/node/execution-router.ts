import {
  capabilityRequestSchema,
  capabilityRoutingDecisionSchema,
  type CapabilityPlacement,
  type CapabilityRequest,
  type CapabilityRoutingDecision,
  type ExecutionRouter,
  type NodeCapabilityFeatures,
  type RoutedHandle,
  type RoutedOperation,
} from "@avermate/agent-contracts";

export type PlacementRuntimeState = {
  placement: CapabilityPlacement;
  online: boolean;
  healthy: boolean;
  configRevision?: `sha256:${string}`;
  features: NodeCapabilityFeatures;
  storageRemainingBytes?: number;
  safeUnavailableReason?: string;
};

export interface PlacementStateResolver {
  inspect(
    placement: CapabilityPlacement,
  ): Promise<PlacementRuntimeState | null>;
}

export type RoutedPlacementDispatcher = (
  operation: RoutedOperation,
  decision: CapabilityRoutingDecision,
) => Promise<string>;

/**
 * A dispatch rejected before the placement adapter was invoked. Callers that
 * reserved quota may safely release the reservation for this error class.
 */
export class RoutingDispatchRejectedError extends Error {
  constructor(code: string) {
    super(code);
    this.name = "RoutingDispatchRejectedError";
  }
}

function placementKey(placement: CapabilityPlacement) {
  return placement.kind === "node"
    ? `${placement.kind}:${placement.nodeId}:${placement.providerId}`
    : `${placement.kind}:${placement.providerId}`;
}

function samePlacement(left: CapabilityPlacement, right: CapabilityPlacement) {
  return placementKey(left) === placementKey(right);
}

const isolationStrength = {
  none: 0,
  runc: 1,
  gvisor: 2,
  kata: 3,
  microvm: 3,
} as const;

function capabilityState(
  state: PlacementRuntimeState,
  request: CapabilityRequest,
): { ready: true } | { ready: false; reason: string } {
  if (!state.online) return { ready: false, reason: "PLACEMENT_OFFLINE" };
  if (!state.healthy) {
    return {
      ready: false,
      reason: state.safeUnavailableReason ?? "PLACEMENT_DEGRADED",
    };
  }
  const feature = (() => {
    switch (request.capability) {
      case "storage":
        return state.features.storage;
      case "conversations":
        return state.features.conversations;
      case "retrieval":
        return state.features.retrieval;
      case "models":
        return state.features.models;
      case "jobs":
        return state.features.jobs;
      case "sandbox":
        return state.features.sandbox;
      case "renderers":
        return state.features.renderers;
      case "school-connectors":
        return state.features.schoolConnectors;
    }
  })();
  if (!feature) return { ready: false, reason: "CAPABILITY_NOT_ADVERTISED" };
  if (feature.version < request.requiredCapabilityVersion) {
    return { ready: false, reason: "CAPABILITY_VERSION_INCOMPATIBLE" };
  }
  if (
    request.capability === "retrieval" &&
    state.features.retrieval?.lexical !== true
  ) {
    return { ready: false, reason: "NODE_LEXICAL_BACKEND_REQUIRED" };
  }
  if (
    request.capability === "storage" &&
    state.storageRemainingBytes !== undefined
  ) {
    if (request.expectedInputBytes > state.storageRemainingBytes) {
      return { ready: false, reason: "STORAGE_QUOTA_EXCEEDED" };
    }
  }
  if (request.capability === "sandbox") {
    const sandbox = state.features.sandbox;
    if (!sandbox) return { ready: false, reason: "CAPABILITY_NOT_ADVERTISED" };
    if (
      request.requiredIsolation &&
      isolationStrength[sandbox.isolation] <
        isolationStrength[request.requiredIsolation]
    ) {
      return { ready: false, reason: "SANDBOX_ISOLATION_INSUFFICIENT" };
    }
  }
  if (request.capability === "renderers" && request.requiredRendererDigest) {
    const renderers = state.features.renderers;
    if (!renderers?.imageDigests.includes(request.requiredRendererDigest)) {
      return { ready: false, reason: "RENDERER_DIGEST_UNAVAILABLE" };
    }
  }
  return { ready: true };
}

export class DeterministicExecutionRouter implements ExecutionRouter {
  readonly #resolver: PlacementStateResolver;
  readonly #dispatchers: Map<string, RoutedPlacementDispatcher>;
  readonly #clock: () => Date;

  constructor(input: {
    resolver: PlacementStateResolver;
    dispatchers?: Map<string, RoutedPlacementDispatcher>;
    clock?: () => Date;
  }) {
    this.#resolver = input.resolver;
    this.#dispatchers = input.dispatchers ?? new Map();
    this.#clock = input.clock ?? (() => new Date());
  }

  async resolve(raw: CapabilityRequest): Promise<CapabilityRoutingDecision> {
    const request = capabilityRequestSchema.parse(raw);
    if (request.durablePlacement) {
      const sourceState = await this.#resolver.inspect(
        request.durablePlacement,
      );
      if (!sourceState) throw new Error("DURABLE_PLACEMENT_UNKNOWN");
      if (!samePlacement(sourceState.placement, request.durablePlacement)) {
        throw new Error("PLACEMENT_STATE_MISMATCH");
      }
      const readiness = capabilityState(sourceState, request);
      if (!readiness.ready) {
        throw new Error(`DURABLE_PLACEMENT_UNAVAILABLE:${readiness.reason}`);
      }
      return {
        placement: request.durablePlacement,
        reason: samePlacement(request.selected, request.durablePlacement)
          ? "selected-placement-ready"
          : "durable-placement-required",
        fallbackUsed: false,
        transferRequired: false,
        inspectedAt: this.#clock().toISOString(),
        manifestConfigRevision: sourceState.configRevision,
      };
    }

    const candidates = [request.selected, ...request.fallbackChain];
    const failures: string[] = [];
    for (let index = 0; index < candidates.length; index += 1) {
      const placement = candidates[index];
      const state = await this.#resolver.inspect(placement);
      if (!state) {
        failures.push(`${placementKey(placement)}=PLACEMENT_UNKNOWN`);
        continue;
      }
      if (!samePlacement(state.placement, placement)) {
        failures.push(`${placementKey(placement)}=PLACEMENT_STATE_MISMATCH`);
        continue;
      }
      const readiness = capabilityState(state, request);
      if (!readiness.ready) {
        failures.push(`${placementKey(placement)}=${readiness.reason}`);
        continue;
      }
      const transferRequired = index > 0 && request.expectedInputBytes > 0;
      if (transferRequired && !request.allowDataTransfer) {
        failures.push(`${placementKey(placement)}=DATA_TRANSFER_NOT_APPROVED`);
        continue;
      }
      return {
        placement,
        reason: index === 0 ? "selected-placement-ready" : "explicit-fallback",
        fallbackUsed: index > 0,
        transferRequired,
        inspectedAt: this.#clock().toISOString(),
        manifestConfigRevision: state.configRevision,
      };
    }
    throw new Error(`CAPABILITY_PLACEMENT_UNAVAILABLE:${failures.join(",")}`);
  }

  async dispatch(operation: RoutedOperation): Promise<RoutedHandle> {
    const decision = await this.resolve(operation.request);
    return this.dispatchResolved(operation, decision);
  }

  /**
   * Dispatch a decision that was already policy-checked. Managed accounting
   * uses this seam to reserve quota between routing and the first costly side
   * effect, without resolving a fallback chain a second time.
   */
  async dispatchResolved(
    operation: RoutedOperation,
    rawDecision: CapabilityRoutingDecision,
  ): Promise<RoutedHandle> {
    const request = capabilityRequestSchema.parse(operation.request);
    const decision = capabilityRoutingDecisionSchema.parse(rawDecision);
    if (
      typeof operation.operationId !== "string" ||
      operation.operationId.trim().length === 0 ||
      operation.operationId.length > 256
    ) {
      throw new RoutingDispatchRejectedError("ROUTED_OPERATION_INVALID");
    }

    const candidates = request.durablePlacement
      ? [request.durablePlacement]
      : [request.selected, ...request.fallbackChain];
    const candidateIndex = candidates.findIndex((placement) =>
      samePlacement(placement, decision.placement),
    );
    if (candidateIndex < 0) {
      throw new RoutingDispatchRejectedError("ROUTING_DECISION_FORGED");
    }

    const expectedFallback = !request.durablePlacement && candidateIndex > 0;
    const expectedTransfer = expectedFallback && request.expectedInputBytes > 0;
    const expectedReason = request.durablePlacement
      ? samePlacement(request.selected, request.durablePlacement)
        ? "selected-placement-ready"
        : "durable-placement-required"
      : expectedFallback
        ? "explicit-fallback"
        : "selected-placement-ready";
    if (
      decision.fallbackUsed !== expectedFallback ||
      decision.transferRequired !== expectedTransfer ||
      decision.reason !== expectedReason ||
      (expectedTransfer && !request.allowDataTransfer)
    ) {
      throw new RoutingDispatchRejectedError("ROUTING_DECISION_INCONSISTENT");
    }

    // Resolution is deliberately rechecked after quota reservation and just
    // before the first placement side effect. A manifest revision, health or
    // capability change invalidates the decision rather than silently routing
    // through a now-different execution environment.
    const state = await this.#resolver.inspect(decision.placement);
    if (!state || !samePlacement(state.placement, decision.placement)) {
      throw new RoutingDispatchRejectedError("ROUTING_DECISION_STALE");
    }
    if (state.configRevision !== decision.manifestConfigRevision) {
      throw new RoutingDispatchRejectedError("ROUTING_DECISION_STALE");
    }
    const readiness = capabilityState(state, request);
    if (!readiness.ready) {
      throw new RoutingDispatchRejectedError(
        `ROUTING_DECISION_STALE:${readiness.reason}`,
      );
    }

    const dispatcher = this.#dispatchers.get(placementKey(decision.placement));
    if (!dispatcher) throw new Error("PLACEMENT_DISPATCHER_UNAVAILABLE");
    const placementHandle = await dispatcher(operation, decision);
    return { operationId: operation.operationId, decision, placementHandle };
  }
}

export function executionPlacementKey(placement: CapabilityPlacement) {
  return placementKey(placement);
}
