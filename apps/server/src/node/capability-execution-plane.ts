import type {
  CapabilityPlacement,
  CapabilityRequest,
  CapabilityRoutingDecision,
  CitationResolver,
  ConversationStore,
  CorpusStore,
  LexicalSearchBackend,
  ModelGateway,
  NodeCapabilityId,
  NodeCapabilityFeatures,
  ObjectStorageProvider,
  SandboxProvider,
} from "@avermate/agent-contracts";
import {
  DeterministicExecutionRouter,
  executionPlacementKey,
  type PlacementRuntimeState,
  type RoutedPlacementDispatcher,
} from "./execution-router";

export type RetrievalCapabilityProviders = {
  corpus: CorpusStore;
  lexical: LexicalSearchBackend;
  citations: CitationResolver;
};

export type CapabilityProviderSet = {
  storage?: ObjectStorageProvider;
  conversations?: ConversationStore;
  retrieval?: RetrievalCapabilityProviders;
  models?: ModelGateway;
  sandbox?: SandboxProvider;
};

type RoutableCapability = keyof CapabilityProviderSet;
type ProviderFor<C extends RoutableCapability> = NonNullable<
  CapabilityProviderSet[C]
>;

type Registration = {
  state: PlacementRuntimeState;
  inspectState?: () => Promise<PlacementRuntimeState | null>;
  providers: CapabilityProviderSet;
  provenCapabilityRevisions: Readonly<
    Partial<Record<RoutableCapability, string>>
  >;
};

export type RoutedCapabilityResult<T> = {
  decision: CapabilityRoutingDecision;
  placementHandle: string;
  value: T;
};

const noResult = Symbol("no routed capability result");

class CapabilityInvocation<C extends RoutableCapability, T> {
  value: T | typeof noResult = noResult;

  constructor(
    readonly capability: C,
    readonly invoke: (
      provider: ProviderFor<C>,
      decision: CapabilityRoutingDecision,
    ) => Promise<T>,
  ) {}
}

function placementMatches(
  state: PlacementRuntimeState,
  placement: CapabilityPlacement,
) {
  return (
    executionPlacementKey(state.placement) === executionPlacementKey(placement)
  );
}

async function providerReady(
  registration: Registration,
  state: PlacementRuntimeState,
  capability: RoutableCapability,
) {
  if (
    state.placement.kind === "node" &&
    registration.provenCapabilityRevisions[capability] !== state.configRevision
  ) {
    return false;
  }
  const provider = registration.providers[capability];
  if (!provider) return false;
  try {
    switch (capability) {
      case "storage": {
        const advertised = state.features.storage;
        const actual = await registration.providers.storage!.capabilities();
        return Boolean(
          advertised &&
          actual.maxObjectBytes >= advertised.maxObjectBytes &&
          (!advertised.multipart || actual.multipart),
        );
      }
      case "retrieval": {
        const capabilities =
          await registration.providers.retrieval!.lexical.capabilities();
        return (
          capabilities.available &&
          capabilities.modes.includes("terms") &&
          capabilities.modes.includes("exact")
        );
      }
      case "models":
      case "conversations":
        return true;
      case "sandbox":
        return (await registration.providers.sandbox!.capabilities()).available;
    }
  } catch {
    return false;
  }
}

function withoutFeature(
  features: NodeCapabilityFeatures,
  capability: RoutableCapability,
) {
  const next = { ...features };
  delete next[capability];
  return next;
}

/**
 * The Core execution data plane. Resolution, a final fail-closed provider
 * probe, and the first provider side effect happen through one router path.
 * A node capability is routable only after its conformance result is supplied
 * explicitly in `provenCapabilities`.
 */
export class CapabilityExecutionPlane {
  readonly #registrations = new Map<string, Registration>();
  readonly #dispatchers = new Map<string, RoutedPlacementDispatcher>();
  readonly router: DeterministicExecutionRouter;

  constructor(input: { clock?: () => Date } = {}) {
    this.router = new DeterministicExecutionRouter({
      resolver: { inspect: (placement) => this.#inspect(placement) },
      dispatchers: this.#dispatchers,
      clock: input.clock,
    });
  }

  register(input: {
    state: PlacementRuntimeState;
    /** Optional live control-channel view used on every resolve and dispatch. */
    inspectState?: () => Promise<PlacementRuntimeState | null>;
    providers: CapabilityProviderSet;
    /** Required for every Node provider; ignored for non-Node placements. */
    provenCapabilities?: Readonly<Partial<Record<RoutableCapability, true>>>;
  }) {
    const key = executionPlacementKey(input.state.placement);
    if (this.#registrations.has(key)) {
      throw new Error(`CAPABILITY_PLACEMENT_ALREADY_REGISTERED:${key}`);
    }
    const state = structuredClone(input.state);
    const provenCapabilityRevisions = Object.fromEntries(
      Object.entries(input.provenCapabilities ?? {})
        .filter(
          (entry): entry is [RoutableCapability, true] => entry[1] === true,
        )
        .map(([capability]) => [
          capability,
          state.configRevision ?? "unversioned-node-manifest",
        ]),
    );
    this.#registrations.set(key, {
      state,
      inspectState: input.inspectState,
      providers: input.providers,
      provenCapabilityRevisions,
    });
    this.#dispatchers.set(key, (operation, decision) =>
      this.#dispatch(
        key,
        operation.payload,
        operation.request.capability,
        decision,
      ),
    );
    return this;
  }

  async #inspect(
    placement: CapabilityPlacement,
  ): Promise<PlacementRuntimeState | null> {
    const registration = this.#registrations.get(
      executionPlacementKey(placement),
    );
    if (!registration) return null;
    const state = registration.inspectState
      ? await registration.inspectState()
      : registration.state;
    if (!state || !placementMatches(state, placement)) {
      return null;
    }
    let features = { ...state.features };
    for (const capability of [
      "storage",
      "conversations",
      "retrieval",
      "models",
      "sandbox",
    ] as const) {
      if (
        features[capability] &&
        !(await providerReady(registration, state, capability))
      ) {
        features = withoutFeature(features, capability);
      }
    }
    return { ...state, features };
  }

  async #dispatch(
    registrationKey: string,
    payload: unknown,
    requestedCapability: NodeCapabilityId,
    decision: CapabilityRoutingDecision,
  ) {
    if (!(payload instanceof CapabilityInvocation)) {
      throw new Error("CAPABILITY_DISPATCH_PAYLOAD_INVALID");
    }
    const invocation = payload as CapabilityInvocation<
      RoutableCapability,
      unknown
    >;
    if (invocation.capability !== requestedCapability) {
      throw new Error("CAPABILITY_DISPATCH_PAYLOAD_INVALID");
    }
    const registration = this.#registrations.get(registrationKey);
    if (!registration) throw new Error("CAPABILITY_PROVIDER_UNAVAILABLE");
    const state = registration.inspectState
      ? await registration.inspectState()
      : registration.state;
    if (
      !state ||
      !placementMatches(state, decision.placement) ||
      !(await providerReady(registration, state, invocation.capability))
    ) {
      throw new Error("CAPABILITY_PROVIDER_UNAVAILABLE");
    }
    const provider = registration.providers[invocation.capability];
    if (!provider) throw new Error("CAPABILITY_PROVIDER_UNAVAILABLE");
    invocation.value = await invocation.invoke(provider as never, decision);
    return `capability:${invocation.capability}:${crypto.randomUUID()}`;
  }

  async #run<C extends RoutableCapability, T>(input: {
    capability: C;
    request: CapabilityRequest;
    operationId: string;
    invoke: (
      provider: ProviderFor<C>,
      decision: CapabilityRoutingDecision,
    ) => Promise<T>;
  }): Promise<RoutedCapabilityResult<T>> {
    if (input.request.capability !== input.capability) {
      throw new Error("CAPABILITY_REQUEST_MISMATCH");
    }
    const invocation = new CapabilityInvocation(input.capability, input.invoke);
    const handle = await this.router.dispatch({
      operationId: input.operationId,
      request: input.request,
      payload: invocation,
    });
    if (invocation.value === noResult) {
      throw new Error("CAPABILITY_DISPATCH_RESULT_MISSING");
    }
    return {
      decision: handle.decision,
      placementHandle: handle.placementHandle,
      value: invocation.value,
    };
  }

  runStorage<T>(input: {
    request: CapabilityRequest;
    operationId: string;
    invoke: (
      provider: ObjectStorageProvider,
      decision: CapabilityRoutingDecision,
    ) => Promise<T>;
  }) {
    return this.#run({ ...input, capability: "storage" });
  }

  runConversation<T>(input: {
    request: CapabilityRequest;
    operationId: string;
    invoke: (
      provider: ConversationStore,
      decision: CapabilityRoutingDecision,
    ) => Promise<T>;
  }) {
    return this.#run({ ...input, capability: "conversations" });
  }

  runRetrieval<T>(input: {
    request: CapabilityRequest;
    operationId: string;
    invoke: (
      provider: RetrievalCapabilityProviders,
      decision: CapabilityRoutingDecision,
    ) => Promise<T>;
  }) {
    return this.#run({ ...input, capability: "retrieval" });
  }

  runModel<T>(input: {
    request: CapabilityRequest;
    operationId: string;
    invoke: (
      provider: ModelGateway,
      decision: CapabilityRoutingDecision,
    ) => Promise<T>;
  }) {
    return this.#run({ ...input, capability: "models" });
  }

  runSandbox<T>(input: {
    request: CapabilityRequest;
    operationId: string;
    invoke: (
      provider: SandboxProvider,
      decision: CapabilityRoutingDecision,
    ) => Promise<T>;
  }) {
    return this.#run({ ...input, capability: "sandbox" });
  }
}
