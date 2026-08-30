import {
  canonicalCapabilityJson,
  capabilityOperationEventSchema,
  capabilityRequestSchemas,
  capabilityResultSchemas,
  type CapabilityAdapter,
  type CapabilityAttemptContext,
  type CapabilityKind,
  type CapabilityOffering,
  type CapabilityOperationEvent,
  type CapabilityRequestMap,
  type CapabilityResultMap,
  type CredentialLease,
  type FrozenCapabilityRoute,
  type FrozenCapabilityRoutePlan,
  type StreamingCapabilityAdapter,
  type UnaryCapabilityAdapter,
} from "@avermate/agent-contracts";
import {
  CapabilityConnectionStore,
  type PublicCapabilityConnection,
} from "./connection-store";
import { CapabilityConsentStore } from "./consent-store";
import {
  capabilityFailure,
  CapabilityExecutionError,
  normalizeCapabilityError,
} from "./errors";
import { CapabilityHealthService } from "./health-service";
import type {
  ManagedCapabilityExecutionBroker,
  ManagedCapabilityReservation,
} from "./managed-execution-broker";
import { capabilityRouteMetrics, type CapabilityRouteMetrics } from "./metrics";
import { CapabilityOfferingStore } from "./offering-store";
import {
  CapabilityOperationStore,
  type PublicCapabilityOperation,
} from "./operation-store";
import { CapabilityPolicyStore } from "./policy-store";
import type { ResolvedCapabilityPolicySnapshot } from "./policy-resolver";
import {
  staticProviderPluginRegistry,
  type ProviderPluginRegistry,
} from "./plugin-registry";
import { capabilityDigest } from "./values";
import { capabilitySystemPolicyEpoch } from "./system-policy";

type ExecutorDependencies = {
  operations?: CapabilityOperationStore;
  offerings?: CapabilityOfferingStore;
  connections?: CapabilityConnectionStore;
  consents?: CapabilityConsentStore;
  health?: CapabilityHealthService;
  registry?: ProviderPluginRegistry;
  clock?: () => Date;
  emit?: (event: CapabilityOperationEvent) => Promise<void>;
  metrics?: CapabilityRouteMetrics;
  policies?: CapabilityPolicyStore;
  systemPolicyEpoch?: () => string | Promise<string>;
  managedBroker?: ManagedCapabilityExecutionBroker | null;
};

function unary<K extends CapabilityKind>(
  adapter: CapabilityAdapter<K>,
): UnaryCapabilityAdapter<K> {
  if (!("invoke" in adapter) || typeof adapter.invoke !== "function") {
    throw new CapabilityExecutionError(
      capabilityFailure(
        "CAPABILITY_UNAVAILABLE",
        "Frozen capability route has no unary adapter",
      ),
    );
  }
  return adapter as UnaryCapabilityAdapter<K>;
}

function streaming<K extends CapabilityKind, Event>(
  adapter: CapabilityAdapter<K>,
): StreamingCapabilityAdapter<K, Event> {
  if (!("stream" in adapter) || typeof adapter.stream !== "function") {
    throw new CapabilityExecutionError(
      capabilityFailure(
        "CAPABILITY_UNAVAILABLE",
        "Frozen capability route has no streaming adapter",
      ),
    );
  }
  return adapter as StreamingCapabilityAdapter<K, Event>;
}

function routeForOperation(
  operation: PublicCapabilityOperation,
  routePlan: FrozenCapabilityRoutePlan,
) {
  if (operation.routePlan?.digest !== routePlan.digest) {
    throw new CapabilityExecutionError(
      capabilityFailure("POLICY_CHANGED", "Frozen capability route changed"),
    );
  }
}

function providerRequestIdFromResult(
  result: CapabilityResultMap[CapabilityKind],
) {
  const value = result.providerMetadata?.providerRequestId;
  if (typeof value !== "string") return null;
  const requestId = value.trim();
  return requestId.length > 0 && requestId.length <= 512 ? requestId : null;
}

export class CapabilityExecutor {
  private readonly operations: CapabilityOperationStore;
  private readonly offerings: CapabilityOfferingStore;
  private readonly connections: CapabilityConnectionStore;
  private readonly consents: CapabilityConsentStore;
  private readonly health: CapabilityHealthService;
  private readonly registry: ProviderPluginRegistry;
  private readonly policies: CapabilityPolicyStore;
  private readonly systemPolicyEpoch: () => string | Promise<string>;
  private readonly managedBroker: ManagedCapabilityExecutionBroker | null;
  private readonly clock: () => Date;
  private readonly emit?: ExecutorDependencies["emit"];
  private readonly metrics: CapabilityRouteMetrics;

  constructor(dependencies: ExecutorDependencies = {}) {
    this.operations = dependencies.operations ?? new CapabilityOperationStore();
    this.offerings = dependencies.offerings ?? new CapabilityOfferingStore();
    this.connections =
      dependencies.connections ?? new CapabilityConnectionStore();
    this.consents = dependencies.consents ?? new CapabilityConsentStore();
    this.health = dependencies.health ?? new CapabilityHealthService();
    this.registry = dependencies.registry ?? staticProviderPluginRegistry;
    this.policies = dependencies.policies ?? new CapabilityPolicyStore();
    this.systemPolicyEpoch =
      dependencies.systemPolicyEpoch ?? (() => capabilitySystemPolicyEpoch);
    this.managedBroker = dependencies.managedBroker ?? null;
    this.clock = dependencies.clock ?? (() => new Date());
    this.emit = dependencies.emit;
    this.metrics = dependencies.metrics ?? capabilityRouteMetrics;
  }

  private managedExecutionBroker(offering: CapabilityOffering) {
    if (offering.placement.kind !== "managed") return null;
    if (!this.managedBroker) {
      throw new CapabilityExecutionError(
        capabilityFailure(
          "CAPABILITY_UNAVAILABLE",
          "Managed capability execution is unavailable without a reservation broker",
        ),
      );
    }
    return this.managedBroker;
  }

  async execute<K extends CapabilityKind>(input: {
    ownerId: string;
    operationId: string;
    expectedRevision: number;
    routePlan: FrozenCapabilityRoutePlan;
    request: CapabilityRequestMap[K];
    deadline?: Date;
    signal?: AbortSignal;
  }): Promise<CapabilityResultMap[K]> {
    const operation = await this.operations.get(input.ownerId, input.operationId);
    if (
      !operation ||
      operation.revision !== input.expectedRevision ||
      operation.state !== "ready"
    ) {
      throw new CapabilityExecutionError(
        capabilityFailure(
          operation ? "POLICY_CHANGED" : "CAPABILITY_UNAVAILABLE",
          operation
            ? "Capability operation changed before execution"
            : "Capability operation does not exist",
        ),
      );
    }
    routeForOperation(operation, input.routePlan);
    if (
      input.routePlan.ownerId !== input.ownerId ||
      input.routePlan.operationId !== input.operationId ||
      input.routePlan.capability !== operation.capability
    ) {
      throw new CapabilityExecutionError(
        capabilityFailure("POLICY_CHANGED", "Frozen route authority is invalid"),
      );
    }
    const request = capabilityRequestSchemas[operation.capability].parse(
      input.request,
    ) as CapabilityRequestMap[K];
    const requestDigest = capabilityDigest(request);
    if (requestDigest !== operation.inputDigest) {
      throw new CapabilityExecutionError(
        capabilityFailure("POLICY_CHANGED", "Operation input digest changed"),
      );
    }

    const deadline = input.deadline ?? new Date(this.clock().getTime() + 120_000);
    const abort = new AbortController();
    const cancel = () => abort.abort(input.signal?.reason);
    input.signal?.addEventListener("abort", cancel, { once: true });
    if (input.signal?.aborted) cancel();
    const delay = Math.max(0, Math.min(deadline.getTime() - this.clock().getTime(), 2_147_483_647));
    const timer = setTimeout(
      () => abort.abort(new Error("CAPABILITY_DEADLINE_EXCEEDED")),
      delay,
    );

    let current = operation;
    const routes = [input.routePlan.primary, ...input.routePlan.fallbacks];
    try {
      for (const [routeIndex, route] of routes.entries()) {
        try {
          return await this.executeRoute<K>({
            ownerId: input.ownerId,
            operation: current,
            routePlan: input.routePlan,
            route,
            request,
            requestDigest,
            deadline,
            signal: abort.signal,
            hasFallback: routeIndex < routes.length - 1,
          });
        } catch (rawError) {
          const error = normalizeCapabilityError(rawError, {
            signal: input.signal,
          });
          current = (await this.operations.get(input.ownerId, input.operationId)) ?? current;
          if (
            current.state === "ready" &&
            error.retryable &&
            !error.ambiguous &&
            routeIndex < routes.length - 1
          ) {
            await this.metrics.emit({
              name: "capability_route_fallback_total",
              operationId: input.operationId,
              capability: input.routePlan.capability,
              placement: route.placement.kind,
              outcome: error.code,
            });
            continue;
          }
          await this.metrics.emit({
            name: "capability_route_error_total",
            operationId: input.operationId,
            capability: input.routePlan.capability,
            placement: route.placement.kind,
            outcome: error.code,
          });
          throw new CapabilityExecutionError(error);
        }
      }
      throw new CapabilityExecutionError(
        capabilityFailure("CAPABILITY_UNAVAILABLE", "No frozen route was executable"),
      );
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", cancel);
    }
  }

  /**
   * Streams provider events through the same frozen-route authority fences.
   * `finalize` is an in-process accumulator owned by the typed adapter facade;
   * Core reparses and persists its final result/usage. No fallback is possible
   * after the first acknowledged event has crossed this boundary.
   */
  async *stream<K extends CapabilityKind, Event>(input: {
    ownerId: string;
    operationId: string;
    expectedRevision: number;
    routePlan: FrozenCapabilityRoutePlan;
    request: CapabilityRequestMap[K];
    finalize(): Promise<CapabilityResultMap[K]> | CapabilityResultMap[K];
    providerRequestId?(event: Event): string | null;
    deadline?: Date;
    signal?: AbortSignal;
  }): AsyncIterable<Event> {
    const operation = await this.operations.get(input.ownerId, input.operationId);
    if (
      !operation ||
      operation.revision !== input.expectedRevision ||
      operation.state !== "ready"
    ) {
      throw new CapabilityExecutionError(
        capabilityFailure(
          operation ? "POLICY_CHANGED" : "CAPABILITY_UNAVAILABLE",
          operation
            ? "Capability operation changed before streaming"
            : "Capability operation does not exist",
        ),
      );
    }
    routeForOperation(operation, input.routePlan);
    if (
      input.routePlan.ownerId !== input.ownerId ||
      input.routePlan.operationId !== input.operationId ||
      input.routePlan.capability !== operation.capability
    ) {
      throw new CapabilityExecutionError(
        capabilityFailure("POLICY_CHANGED", "Frozen route authority is invalid"),
      );
    }
    const request = capabilityRequestSchemas[operation.capability].parse(
      input.request,
    ) as CapabilityRequestMap[K];
    const requestDigest = capabilityDigest(request);
    if (requestDigest !== operation.inputDigest) {
      throw new CapabilityExecutionError(
        capabilityFailure("POLICY_CHANGED", "Operation input digest changed"),
      );
    }
    const deadline = input.deadline ?? new Date(this.clock().getTime() + 120_000);
    const abort = new AbortController();
    const cancel = () => abort.abort(input.signal?.reason);
    input.signal?.addEventListener("abort", cancel, { once: true });
    if (input.signal?.aborted) cancel();
    const timer = setTimeout(
      () => abort.abort(new Error("CAPABILITY_DEADLINE_EXCEEDED")),
      Math.max(
        0,
        Math.min(deadline.getTime() - this.clock().getTime(), 2_147_483_647),
      ),
    );
    let current = operation;
    const routes = [input.routePlan.primary, ...input.routePlan.fallbacks];
    try {
      for (const [routeIndex, route] of routes.entries()) {
        try {
          yield* this.streamRoute<K, Event>({
            ownerId: input.ownerId,
            operation: current,
            routePlan: input.routePlan,
            route,
            request,
            requestDigest,
            deadline,
            signal: abort.signal,
            hasFallback: routeIndex < routes.length - 1,
            finalize: input.finalize,
            providerRequestId: input.providerRequestId,
          });
          return;
        } catch (rawError) {
          const error = normalizeCapabilityError(rawError, {
            signal: input.signal,
          });
          current =
            (await this.operations.get(input.ownerId, input.operationId)) ?? current;
          if (
            current.state === "ready" &&
            error.retryable &&
            !error.ambiguous &&
            routeIndex < routes.length - 1
          ) {
            await this.metrics.emit({
              name: "capability_route_fallback_total",
              operationId: input.operationId,
              capability: input.routePlan.capability,
              placement: route.placement.kind,
              outcome: error.code,
            });
            continue;
          }
          await this.metrics.emit({
            name: "capability_route_error_total",
            operationId: input.operationId,
            capability: input.routePlan.capability,
            placement: route.placement.kind,
            outcome: error.code,
          });
          throw new CapabilityExecutionError(error);
        }
      }
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", cancel);
    }
  }

  private async *streamRoute<K extends CapabilityKind, Event>(input: {
    ownerId: string;
    operation: PublicCapabilityOperation;
    routePlan: FrozenCapabilityRoutePlan;
    route: FrozenCapabilityRoute;
    request: CapabilityRequestMap[K];
    requestDigest: string;
    deadline: Date;
    signal: AbortSignal;
    hasFallback: boolean;
    finalize(): Promise<CapabilityResultMap[K]> | CapabilityResultMap[K];
    providerRequestId?: (event: Event) => string | null;
  }): AsyncIterable<Event> {
    const { offering, connection } = await this.assertStaticFences(input);
    const attempt = await this.operations.beginAttempt({
      ownerId: input.ownerId,
      operationId: input.operation.id,
      expectedOperationRevision: input.operation.revision,
      offeringId: input.route.offeringId,
      requestDigest: input.requestDigest,
      credentialVersion:
        input.route.credentialSlots[0]?.expectedVersion ?? null,
      consentRevision: input.route.consentGrants[0]?.expectedRevision ?? null,
    });
    await this.metrics.emit({
      name: "capability_route_attempt_total",
      operationId: input.operation.id,
      capability: input.routePlan.capability,
      provider: offering.provider,
      placement: offering.placement.kind,
      outcome: `stream-attempt-${attempt.ordinal + 1}`,
    });
    let dispatchFences = 0;
    let emitted = false;
    let settled = false;
    let adapterActive = false;
    let providerDispatched = false;
    let managedReservation: ManagedCapabilityReservation | null = null;
    let managedSettlementStarted = false;
    const authorize = async () => {
      dispatchFences += 1;
      input.signal.throwIfAborted();
      if (this.clock().getTime() >= input.deadline.getTime()) {
        throw new CapabilityExecutionError(
          capabilityFailure("PROVIDER_TIMEOUT", "Capability deadline elapsed", {
            retryable: true,
            ambiguous: emitted || dispatchFences > 1,
          }),
        );
      }
      await this.assertLiveFences(input, offering);
      if (adapterActive && !providerDispatched) {
        await this.operations.markProviderDispatch({
          ownerId: input.ownerId,
          operationId: input.operation.id,
          attemptId: attempt.id,
        });
        providerDispatched = true;
      }
    };
    const credential = async (slot: string): Promise<CredentialLease | null> => {
      const frozen = input.route.credentialSlots.find(
        (candidate) => candidate.slot === slot,
      );
      if (!frozen) return null;
      const leased = await this.connections.leaseSecret({
        ownerId: input.ownerId,
        connectionId: input.route.connectionId,
        slot,
        expectedVersion: frozen.expectedVersion,
      });
      return leased
        ? {
            connectionId: input.route.connectionId,
            slot,
            version: leased.version,
            attemptId: attempt.id,
            secret: leased.secret,
            expiresAt: new Date(
              Math.min(
                input.deadline.getTime(),
                this.clock().getTime() + 60_000,
              ),
            ),
          }
        : null;
    };
    const context: CapabilityAttemptContext = {
      ownerId: input.ownerId,
      operationId: input.operation.id,
      attemptId: attempt.id,
      attemptNumber: attempt.ordinal + 1,
      purpose: input.routePlan.purpose,
      offering,
      routePlanDigest: input.routePlan.digest,
      deadline: input.deadline,
      signal: input.signal,
      authorize,
      credential,
      emit: async (event) => {
        const parsed = capabilityOperationEventSchema.parse(event);
        if (
          parsed.operationId !== input.operation.id ||
          parsed.attemptId !== attempt.id
        ) {
          throw new Error("CAPABILITY_EVENT_AUTHORITY_MISMATCH");
        }
        await this.emit?.(parsed);
      },
    };
    try {
      const managedBroker = this.managedExecutionBroker(offering);
      if (managedBroker) {
        managedReservation = await managedBroker.reserve({
          ownerId: input.ownerId,
          operationId: input.operation.id,
          attemptId: attempt.id,
          offering,
          request: input.request,
          pricingSnapshotId: input.route.pricingSnapshotId,
          deadline: input.deadline,
        });
      }
      await authorize();
      const factory = this.registry.require(input.route.pluginId);
      if (!factory.instantiate) {
        throw new CapabilityExecutionError(
          capabilityFailure(
            "CAPABILITY_UNAVAILABLE",
            "Frozen provider plugin has no compiled adapter factory",
          ),
        );
      }
      const plugin = factory.instantiate();
      if (
        canonicalCapabilityJson(plugin.manifest) !==
        canonicalCapabilityJson(factory.manifest)
      ) {
        throw new Error("CAPABILITY_PLUGIN_MANIFEST_MISMATCH");
      }
      const adapter = streaming<K, Event>(
        (await plugin.createAdapter(
          {
            ownerId: input.ownerId,
            connection: connection.connection,
            signal: input.signal,
            credential: async (slot) => {
              const lease = await credential(slot);
              return lease
                ? { secret: lease.secret, version: lease.version }
                : null;
            },
          },
          offering,
        )) as unknown as CapabilityAdapter<K>,
      );
      if (
        canonicalCapabilityJson(adapter.descriptor()) !==
        canonicalCapabilityJson(offering)
      ) {
        throw new Error("CAPABILITY_ADAPTER_DESCRIPTOR_MISMATCH");
      }
      adapterActive = true;
      for await (const event of adapter.stream(context, input.request)) {
        await authorize();
        if (!emitted) {
          await this.operations.acknowledgeAttempt({
            ownerId: input.ownerId,
            operationId: input.operation.id,
            attemptId: attempt.id,
            providerRequestId: input.providerRequestId?.(event) ?? null,
          });
          emitted = true;
        }
        yield event;
      }
      await authorize();
      const result = capabilityResultSchemas[offering.capability].parse(
        await input.finalize(),
      ) as CapabilityResultMap[K];
      const usage = (result as CapabilityResultMap[CapabilityKind]).usage;
      if (managedReservation) {
        managedSettlementStarted = true;
        try {
          await this.managedBroker!.settle({
            reservation: managedReservation,
            usage,
            outcome: "completed",
            dispatched: providerDispatched || emitted,
            ambiguous: false,
          });
        } catch {
          throw new CapabilityExecutionError(
            capabilityFailure(
              "INSPECT_REQUIRED",
              "Managed usage settlement requires reconciliation",
              { ambiguous: true },
            ),
          );
        }
      }
      await this.operations.complete({
        ownerId: input.ownerId,
        operationId: input.operation.id,
        attemptId: attempt.id,
        result,
        usage,
      });
      settled = true;
      await this.health.recordSuccess({
        ownerId: input.ownerId,
        offeringId: offering.id,
        latencyMs: Math.max(
          0,
          this.clock().getTime() - Date.parse(attempt.startedAt),
        ),
      });
      await this.metrics.emit({
        name: "capability_route_completed_total",
        operationId: input.operation.id,
        capability: offering.capability,
        provider: offering.provider,
        placement: offering.placement.kind,
        outcome: "stream-completed",
      });
    } catch (rawError) {
      let error =
        input.signal.aborted &&
        input.signal.reason instanceof Error &&
        input.signal.reason.message === "CAPABILITY_DEADLINE_EXCEEDED"
          ? capabilityFailure("PROVIDER_TIMEOUT", "Capability deadline elapsed", {
              retryable: true,
              ambiguous: emitted || dispatchFences > 1,
            })
          : normalizeCapabilityError(rawError);
      if (
        emitted ||
        (dispatchFences > 1 &&
          error.retryable &&
          !["RATE_LIMITED", "CREDENTIAL_INVALID"].includes(error.code))
      ) {
        error = capabilityFailure(
          "INSPECT_REQUIRED",
          "Streaming provider outcome may be ambiguous; fallback is fenced",
          { ambiguous: true, providerRequestId: error.providerRequestId },
        );
      }
      if (managedReservation && !managedSettlementStarted) {
        managedSettlementStarted = true;
        try {
          await this.managedBroker!.settle({
            reservation: managedReservation,
            usage: null,
            outcome: input.signal.aborted ? "cancelled" : "failed",
            dispatched: providerDispatched || emitted,
            ambiguous: error.ambiguous || emitted,
            evidenceRef: `capability-error:${error.code}`,
          });
        } catch {
          error = capabilityFailure(
            "INSPECT_REQUIRED",
            "Managed usage settlement requires reconciliation",
            { ambiguous: true, providerRequestId: error.providerRequestId },
          );
        }
      }
      const latest = await this.operations.get(input.ownerId, input.operation.id);
      if (
        latest &&
        !["completed", "cancelled", "failed", "inspect-required"].includes(
          latest.state,
        )
      ) {
        await this.operations.failAttempt({
          ownerId: input.ownerId,
          operationId: input.operation.id,
          attemptId: attempt.id,
          error,
          terminal:
            emitted || error.ambiguous || !error.retryable || !input.hasFallback,
        });
      }
      settled = true;
      await this.health
        .recordFailure({ ownerId: input.ownerId, offeringId: offering.id, error })
        .catch(() => undefined);
      throw new CapabilityExecutionError(error);
    } finally {
      if (!settled) {
        let settlementFailed = false;
        if (managedReservation && !managedSettlementStarted) {
          managedSettlementStarted = true;
          try {
            await this.managedBroker!.settle({
              reservation: managedReservation,
              usage: null,
              outcome: "cancelled",
              dispatched: providerDispatched || emitted,
              ambiguous: emitted,
              evidenceRef: "capability-stream-consumer-stopped",
            });
          } catch {
            settlementFailed = true;
          }
        }
        const current = await this.operations.get(input.ownerId, input.operation.id);
        if (
          current &&
          !["completed", "cancelled", "failed", "inspect-required"].includes(
            current.state,
          )
        ) {
          const error = settlementFailed
            ? capabilityFailure(
                "INSPECT_REQUIRED",
                "Managed usage settlement requires reconciliation",
                { ambiguous: true },
              )
            : emitted
            ? capabilityFailure(
                "INSPECT_REQUIRED",
                "Streaming consumer stopped after provider acknowledgement",
                { ambiguous: true },
              )
            : capabilityFailure("CANCELLED", "Streaming consumer stopped");
          await this.operations.failAttempt({
            ownerId: input.ownerId,
            operationId: input.operation.id,
            attemptId: attempt.id,
            error,
            terminal: true,
          });
        }
      }
    }
  }

  private async executeRoute<K extends CapabilityKind>(input: {
    ownerId: string;
    operation: PublicCapabilityOperation;
    routePlan: FrozenCapabilityRoutePlan;
    route: FrozenCapabilityRoute;
    request: CapabilityRequestMap[K];
    requestDigest: string;
    deadline: Date;
    signal: AbortSignal;
    hasFallback: boolean;
  }): Promise<CapabilityResultMap[K]> {
    const { offering, connection } = await this.assertStaticFences(input);
    const firstCredentialVersion = input.route.credentialSlots[0]?.expectedVersion ?? null;
    const firstConsentRevision = input.route.consentGrants[0]?.expectedRevision ?? null;
    const attempt = await this.operations.beginAttempt({
      ownerId: input.ownerId,
      operationId: input.operation.id,
      expectedOperationRevision: input.operation.revision,
      offeringId: input.route.offeringId,
      requestDigest: input.requestDigest,
      credentialVersion: firstCredentialVersion,
      consentRevision: firstConsentRevision,
    });
    await this.metrics.emit({
      name: "capability_route_attempt_total",
      operationId: input.operation.id,
      capability: input.routePlan.capability,
      provider: offering.provider,
      placement: offering.placement.kind,
      outcome: `attempt-${attempt.ordinal + 1}`,
    });
    let dispatchFences = 0;
    let providerCompleted = false;
    let adapterActive = false;
    let providerDispatched = false;
    let managedReservation: ManagedCapabilityReservation | null = null;
    let managedSettlementStarted = false;
    const authorize = async () => {
      dispatchFences += 1;
      input.signal.throwIfAborted();
      if (this.clock().getTime() >= input.deadline.getTime()) {
        throw new CapabilityExecutionError(
          capabilityFailure("PROVIDER_TIMEOUT", "Capability deadline elapsed", {
            retryable: true,
            ambiguous: dispatchFences > 1,
          }),
        );
      }
      await this.assertLiveFences(input, offering);
      if (adapterActive && !providerDispatched) {
        await this.operations.markProviderDispatch({
          ownerId: input.ownerId,
          operationId: input.operation.id,
          attemptId: attempt.id,
        });
        providerDispatched = true;
      }
    };
    const credential = async (slot: string): Promise<CredentialLease | null> => {
      const frozen = input.route.credentialSlots.find(
        (candidate) => candidate.slot === slot,
      );
      if (!frozen) return null;
      const leased = await this.connections.leaseSecret({
        ownerId: input.ownerId,
        connectionId: input.route.connectionId,
        slot,
        expectedVersion: frozen.expectedVersion,
      });
      if (!leased) return null;
      return {
        connectionId: input.route.connectionId,
        slot,
        version: leased.version,
        attemptId: attempt.id,
        secret: leased.secret,
        expiresAt: new Date(
          Math.min(input.deadline.getTime(), this.clock().getTime() + 60_000),
        ),
      };
    };
    const context: CapabilityAttemptContext = {
      ownerId: input.ownerId,
      operationId: input.operation.id,
      attemptId: attempt.id,
      attemptNumber: attempt.ordinal + 1,
      purpose: input.routePlan.purpose,
      offering,
      routePlanDigest: input.routePlan.digest,
      deadline: input.deadline,
      signal: input.signal,
      authorize,
      credential,
      emit: async (event) => {
        const parsed = capabilityOperationEventSchema.parse(event);
        if (
          parsed.operationId !== input.operation.id ||
          parsed.attemptId !== attempt.id
        ) {
          throw new Error("CAPABILITY_EVENT_AUTHORITY_MISMATCH");
        }
        await this.emit?.(parsed);
      },
    };

    try {
      const managedBroker = this.managedExecutionBroker(offering);
      if (managedBroker) {
        managedReservation = await managedBroker.reserve({
          ownerId: input.ownerId,
          operationId: input.operation.id,
          attemptId: attempt.id,
          offering,
          request: input.request,
          pricingSnapshotId: input.route.pricingSnapshotId,
          deadline: input.deadline,
        });
      }
      await authorize();
      const factory = this.registry.require(input.route.pluginId);
      if (!factory.instantiate) {
        throw new CapabilityExecutionError(
          capabilityFailure(
            "CAPABILITY_UNAVAILABLE",
            "Frozen provider plugin has no compiled adapter factory",
          ),
        );
      }
      const plugin = factory.instantiate();
      if (
        canonicalCapabilityJson(plugin.manifest) !==
        canonicalCapabilityJson(factory.manifest)
      ) {
        throw new Error("CAPABILITY_PLUGIN_MANIFEST_MISMATCH");
      }
      const adapter = unary(
        await plugin.createAdapter(
          {
            ownerId: input.ownerId,
            connection: connection.connection,
            signal: input.signal,
            credential: async (slot) => {
              const lease = await credential(slot);
              return lease
                ? { secret: lease.secret, version: lease.version }
                : null;
            },
          },
          offering,
        ),
      );
      if (
        canonicalCapabilityJson(adapter.descriptor()) !==
        canonicalCapabilityJson(offering)
      ) {
        throw new Error("CAPABILITY_ADAPTER_DESCRIPTOR_MISMATCH");
      }
      adapterActive = true;
      const result = capabilityResultSchemas[offering.capability].parse(
        await adapter.invoke(context, input.request),
      ) as CapabilityResultMap[K];
      providerCompleted = true;
      await this.operations.acknowledgeAttempt({
        ownerId: input.ownerId,
        operationId: input.operation.id,
        attemptId: attempt.id,
        providerRequestId: providerRequestIdFromResult(
          result as CapabilityResultMap[CapabilityKind],
        ),
      });
      // Generic publication fence for inline results (STT/OCR/text) as well as
      // artifact-backed results. Revocation/cancellation wins over publication.
      await authorize();
      const usage = (result as CapabilityResultMap[CapabilityKind]).usage;
      if (managedReservation) {
        managedSettlementStarted = true;
        try {
          await this.managedBroker!.settle({
            reservation: managedReservation,
            usage,
            outcome: "completed",
            dispatched: providerDispatched || providerCompleted,
            ambiguous: false,
          });
        } catch {
          throw new CapabilityExecutionError(
            capabilityFailure(
              "INSPECT_REQUIRED",
              "Managed usage settlement requires reconciliation",
              { ambiguous: true },
            ),
          );
        }
      }
      await this.operations.complete({
        ownerId: input.ownerId,
        operationId: input.operation.id,
        attemptId: attempt.id,
        result,
        usage,
      });
      await this.health.recordSuccess({
        ownerId: input.ownerId,
        offeringId: offering.id,
        latencyMs: Math.max(0, this.clock().getTime() - Date.parse(attempt.startedAt)),
      });
      const durationMs = Math.max(
        0,
        this.clock().getTime() - Date.parse(attempt.startedAt),
      );
      await Promise.all([
        this.metrics.emit({
          name: "capability_route_completed_total",
          operationId: input.operation.id,
          capability: offering.capability,
          provider: offering.provider,
          placement: offering.placement.kind,
          outcome: "completed",
        }),
        this.metrics.emit({
          name: "capability_route_duration_ms",
          operationId: input.operation.id,
          capability: offering.capability,
          provider: offering.provider,
          placement: offering.placement.kind,
          value: durationMs,
        }),
      ]);
      return result;
    } catch (rawError) {
      let error =
        input.signal.aborted &&
        input.signal.reason instanceof Error &&
        input.signal.reason.message === "CAPABILITY_DEADLINE_EXCEEDED"
          ? capabilityFailure("PROVIDER_TIMEOUT", "Capability deadline elapsed", {
              retryable: true,
              ambiguous: dispatchFences > 1,
            })
          : normalizeCapabilityError(rawError);
      if (
        providerCompleted ||
        (dispatchFences > 1 &&
          error.retryable &&
          !["RATE_LIMITED", "CREDENTIAL_INVALID"].includes(error.code))
      ) {
        error = capabilityFailure(
          "INSPECT_REQUIRED",
          `Provider outcome may be ambiguous after ${error.code}; automatic retry is fenced`,
          {
            ambiguous: true,
            providerRequestId: error.providerRequestId,
          },
        );
      }
      if (managedReservation && !managedSettlementStarted) {
        managedSettlementStarted = true;
        try {
          await this.managedBroker!.settle({
            reservation: managedReservation,
            usage: null,
            outcome: input.signal.aborted ? "cancelled" : "failed",
            dispatched: providerDispatched || providerCompleted,
            ambiguous: error.ambiguous || providerCompleted,
            evidenceRef: `capability-error:${error.code}`,
          });
        } catch {
          error = capabilityFailure(
            "INSPECT_REQUIRED",
            "Managed usage settlement requires reconciliation",
            { ambiguous: true, providerRequestId: error.providerRequestId },
          );
        }
      }
      const latest = await this.operations.get(input.ownerId, input.operation.id);
      if (
        latest &&
        !["completed", "cancelled", "failed", "inspect-required"].includes(
          latest.state,
        )
      ) {
        await this.operations.failAttempt({
          ownerId: input.ownerId,
          operationId: input.operation.id,
          attemptId: attempt.id,
          error,
          terminal: error.ambiguous || !error.retryable || !input.hasFallback,
        });
      }
      await this.health
        .recordFailure({ ownerId: input.ownerId, offeringId: offering.id, error })
        .catch(() => undefined);
      throw new CapabilityExecutionError(error);
    }
  }

  private async assertStaticFences(input: {
    ownerId: string;
    operation: PublicCapabilityOperation;
    routePlan: FrozenCapabilityRoutePlan;
    route: FrozenCapabilityRoute;
  }) {
    await this.assertPolicyFences(input);
    const offering = await this.offerings.get(input.ownerId, input.route.offeringId);
    if (
      !offering ||
      capabilityDigest(offering) !== input.route.offeringDescriptorDigest ||
      offering.connectionId !== input.route.connectionId ||
      offering.connectionRevision !== input.route.connectionRevision ||
      offering.pluginId !== input.route.pluginId ||
      offering.pluginVersion !== input.route.pluginVersion ||
      offering.adapterRevision !== input.route.adapterRevision ||
      offering.modelId !== input.route.modelId ||
      offering.modelRevision !== input.route.modelRevision ||
      offering.capability !== input.routePlan.capability
    ) {
      throw new CapabilityExecutionError(
        capabilityFailure("POLICY_CHANGED", "Frozen offering descriptor changed"),
      );
    }
    const connection = await this.connections.get(
      input.ownerId,
      input.route.connectionId,
    );
    if (!connection) {
      throw new CapabilityExecutionError(
        capabilityFailure("CAPABILITY_UNAVAILABLE", "Provider connection is unavailable"),
      );
    }
    this.assertConnectionFence(connection, input.route);
    await this.assertConsentFences(input.ownerId, input.route, offering);
    return { offering, connection };
  }

  private assertConnectionFence(
    connection: PublicCapabilityConnection,
    route: FrozenCapabilityRoute,
  ) {
    if (
      connection.connection.revision !== route.connectionRevision ||
      connection.connection.pluginId !== route.pluginId ||
      connection.connection.pluginVersion !== route.pluginVersion ||
      connection.connection.status !== "ready"
    ) {
      throw new CapabilityExecutionError(
        capabilityFailure("CREDENTIAL_CHANGED", "Provider connection changed"),
      );
    }
    for (const frozen of route.credentialSlots) {
      const current = connection.credentialSlots.find(
        (candidate) => candidate.slot === frozen.slot,
      );
      if (
        !current ||
        current.status !== "active" ||
        current.keyVersion !== frozen.expectedVersion
      ) {
        throw new CapabilityExecutionError(
          capabilityFailure("CREDENTIAL_CHANGED", "Capability credential changed"),
        );
      }
    }
  }

  private async assertConsentFences(
    ownerId: string,
    route: FrozenCapabilityRoute,
    offering: Awaited<ReturnType<CapabilityOfferingStore["get"]>> & {},
  ) {
    if (
      offering.dataHandling.requiresExplicitConsent &&
      route.consentGrants.length === 0
    ) {
      throw new CapabilityExecutionError(
        capabilityFailure("CONSENT_REQUIRED", "Explicit provider consent is required"),
      );
    }
    for (const grant of route.consentGrants) {
      if (
        !(await this.consents.isGrantCurrent({
          ownerId,
          consentId: grant.id,
          expectedRevision: grant.expectedRevision,
          connectionId: route.connectionId,
          capability: offering.capability,
          disclosureRevision: offering.dataHandling.disclosureRevision,
        }))
      ) {
        throw new CapabilityExecutionError(
          capabilityFailure("CONSENT_REQUIRED", "Capability consent changed"),
        );
      }
    }
  }

  private async assertLiveFences(
    input: {
      ownerId: string;
      operation: PublicCapabilityOperation;
      routePlan: FrozenCapabilityRoutePlan;
      route: FrozenCapabilityRoute;
    },
    offering: NonNullable<Awaited<ReturnType<CapabilityOfferingStore["get"]>>>,
  ) {
    const [operation, connection] = await Promise.all([
      this.operations.get(input.ownerId, input.operation.id),
      this.connections.get(input.ownerId, input.route.connectionId),
      this.assertPolicyFences(input),
    ]);
    if (
      !operation ||
      !["dispatching", "acknowledged", "waiting-provider"].includes(
        operation.state,
      )
    ) {
      throw new CapabilityExecutionError(
        capabilityFailure("CANCELLED", "Capability operation is no longer active"),
      );
    }
    routeForOperation(operation, input.routePlan);
    if (!connection) {
      throw new CapabilityExecutionError(
        capabilityFailure("CREDENTIAL_CHANGED", "Provider connection disappeared"),
      );
    }
    this.assertConnectionFence(connection, input.route);
    await this.assertConsentFences(input.ownerId, input.route, offering);
  }

  private async assertPolicyFences(input: {
    ownerId: string;
    operation: PublicCapabilityOperation;
    routePlan: FrozenCapabilityRoutePlan;
  }) {
    const raw = await this.operations.getPolicySnapshot(
      input.ownerId,
      input.operation.id,
    );
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new CapabilityExecutionError(
        capabilityFailure("POLICY_CHANGED", "Frozen policy snapshot is unavailable"),
      );
    }
    const candidate = raw as Partial<ResolvedCapabilityPolicySnapshot> & {
      digest?: unknown;
      appliedPolicies?: unknown;
    };
    const digest = typeof candidate.digest === "string" ? candidate.digest : null;
    const applied = Array.isArray(candidate.appliedPolicies)
      ? candidate.appliedPolicies
      : null;
    const validApplied = applied?.every(
      (policy): policy is { id: string; revision: number; scopeKind: string } =>
        Boolean(
          policy &&
            typeof policy === "object" &&
            typeof (policy as { id?: unknown }).id === "string" &&
            Number.isSafeInteger((policy as { revision?: unknown }).revision) &&
            Number((policy as { revision?: unknown }).revision) > 0 &&
            typeof (policy as { scopeKind?: unknown }).scopeKind === "string",
        ),
    );
    const { digest: _digest, ...payload } = raw as Record<string, unknown>;
    const currentSystemEpoch = await this.systemPolicyEpoch();
    if (
      !digest ||
      capabilityDigest(payload) !== digest ||
      digest !== input.routePlan.policySnapshotDigest ||
      candidate.ownerId !== input.ownerId ||
      candidate.capability !== input.routePlan.capability ||
      candidate.purpose !== input.routePlan.purpose ||
      candidate.systemPolicyEpoch !== currentSystemEpoch ||
      !validApplied
    ) {
      throw new CapabilityExecutionError(
        capabilityFailure("POLICY_CHANGED", "Frozen capability policy changed"),
      );
    }
    try {
      await this.policies.assertAppliedPoliciesCurrent({
        ownerId: input.ownerId,
        appliedPolicies: applied,
      });
    } catch {
      throw new CapabilityExecutionError(
        capabilityFailure("POLICY_CHANGED", "Applied capability policy changed"),
      );
    }
  }
}
