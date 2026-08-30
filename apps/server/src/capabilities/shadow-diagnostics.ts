import { newId } from "../lib/id";
import { capabilityRouteMetrics } from "./metrics";
import type {
  CapabilityRouteSelection,
  CapabilityShadowObservation,
} from "./runtime";

export type PublicCapabilityShadowMismatch = {
  id: string;
  occurredAt: string;
  capability: CapabilityShadowObservation["capability"];
  purpose: string;
  legacy: CapabilityRouteSelection | null;
  registry: CapabilityRouteSelection | null;
  match: false;
  safeErrorCode: "SHADOW_RESOLUTION_FAILED" | null;
};

function safeSelection(
  selection: CapabilityRouteSelection | null,
): CapabilityRouteSelection | null {
  if (!selection) return null;
  const bounded = (value: string | null, maximum = 256) =>
    value === null ? null : value.slice(0, maximum);
  return {
    offeringId: bounded(selection.offeringId),
    routeKey: bounded(selection.routeKey, 512),
    provider: bounded(selection.provider, 128),
    modelId: bounded(selection.modelId),
    reason: selection.reason.slice(0, 512),
  };
}

/** Bounded process-local shadow telemetry; never contains owner ids or secrets publicly. */
export class CapabilityShadowDiagnostics {
  readonly #byOwner = new Map<string, PublicCapabilityShadowMismatch[]>();

  constructor(
    private readonly clock: () => Date = () => new Date(),
    private readonly maximumPerOwner = 500,
  ) {}

  async record(observation: CapabilityShadowObservation): Promise<void> {
    if (observation.match === true && observation.safeErrorCode === null) return;
    const item: PublicCapabilityShadowMismatch = {
      id: newId("cshadow"),
      occurredAt: this.clock().toISOString(),
      capability: observation.capability,
      purpose: observation.purpose,
      legacy: safeSelection(observation.legacy),
      registry: safeSelection(observation.registry),
      match: false,
      safeErrorCode: observation.safeErrorCode,
    };
    const items = [item, ...(this.#byOwner.get(observation.ownerId) ?? [])].slice(
      0,
      this.maximumPerOwner,
    );
    this.#byOwner.set(observation.ownerId, items);
    await capabilityRouteMetrics.emit({
      name: "capability_route_shadow_mismatch_total",
      operationId: item.id,
      capability: item.capability,
      provider: item.registry?.provider ?? undefined,
      outcome: item.safeErrorCode ?? "route-mismatch",
    });
  }

  list(ownerId: string, limit = 100): PublicCapabilityShadowMismatch[] {
    return (this.#byOwner.get(ownerId) ?? []).slice(
      0,
      Math.max(1, Math.min(limit, 250)),
    );
  }
}

export const capabilityShadowDiagnostics = new CapabilityShadowDiagnostics();
