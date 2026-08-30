import {
  ManagedTelemetry,
  type OperationalExporter,
} from "../observability/telemetry";

export const capabilityRouteMetricNames = Object.freeze([
  "capability_route_planned_total",
  "capability_route_selected_total",
  "capability_route_attempt_total",
  "capability_route_fallback_total",
  "capability_route_completed_total",
  "capability_route_error_total",
  "capability_route_duration_ms",
  "capability_route_shadow_mismatch_total",
] as const);

export type CapabilityRouteMetricName =
  (typeof capabilityRouteMetricNames)[number];

/** Vendor-neutral, privacy-minimized metric boundary for capability routing. */
export class CapabilityRouteMetrics {
  private readonly telemetry: ManagedTelemetry;

  constructor(exporter?: OperationalExporter, clock?: () => Date) {
    this.telemetry = new ManagedTelemetry(exporter, clock);
  }

  emit(input: {
    name: CapabilityRouteMetricName;
    operationId: string;
    capability: string;
    provider?: string;
    placement?: string;
    outcome?: string;
    value?: number;
  }) {
    return this.telemetry.emit({
      kind: "metric",
      name: input.name,
      correlationId: input.operationId,
      attributes: {
        capability: input.capability,
        provider: input.provider ?? null,
        placement: input.placement ?? null,
        outcome: input.outcome ?? null,
        value: input.value ?? 1,
      },
    });
  }
}

export const capabilityRouteMetrics = new CapabilityRouteMetrics();
