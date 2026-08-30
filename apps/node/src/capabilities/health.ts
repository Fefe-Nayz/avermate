export type NodeCapabilityOfferingHealthState =
  | "unknown"
  | "healthy"
  | "degraded"
  | "offline";

export type NodeCapabilityOfferingHealth = {
  offeringId: string;
  state: NodeCapabilityOfferingHealthState;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  latencyMs: number | null;
  safeErrorCode: string | null;
};

function safeErrorCode(error: unknown) {
  const value = error instanceof Error ? error.message : "CAPABILITY_PROBE_FAILED";
  return /^[A-Z0-9_:-]{3,128}$/u.test(value)
    ? value
    : "CAPABILITY_PROBE_FAILED";
}

function initial(offeringId: string): NodeCapabilityOfferingHealth {
  return {
    offeringId,
    state: "unknown",
    consecutiveFailures: 0,
    lastSuccessAt: null,
    lastFailureAt: null,
    latencyMs: null,
    safeErrorCode: null,
  };
}

/**
 * In-memory health projection for immutable Node offerings. The signed
 * offering remains discoverable while transient health changes independently.
 */
export class NodeCapabilityHealthTracker {
  readonly #health = new Map<string, NodeCapabilityOfferingHealth>();

  register(offeringId: string) {
    if (!this.#health.has(offeringId)) {
      this.#health.set(offeringId, initial(offeringId));
    }
  }

  remove(offeringId: string) {
    this.#health.delete(offeringId);
  }

  success(offeringId: string, latencyMs: number, now = new Date()) {
    const previous = this.#health.get(offeringId) ?? initial(offeringId);
    this.#health.set(offeringId, {
      ...previous,
      state: "healthy",
      consecutiveFailures: 0,
      lastSuccessAt: now.toISOString(),
      latencyMs: Math.max(0, Math.trunc(latencyMs)),
      safeErrorCode: null,
    });
  }

  failure(offeringId: string, error: unknown, now = new Date()) {
    const previous = this.#health.get(offeringId) ?? initial(offeringId);
    const failures = previous.consecutiveFailures + 1;
    this.#health.set(offeringId, {
      ...previous,
      state: failures >= 3 ? "offline" : "degraded",
      consecutiveFailures: failures,
      lastFailureAt: now.toISOString(),
      safeErrorCode: safeErrorCode(error),
    });
  }

  async probe(offeringId: string, check: () => Promise<void>) {
    this.register(offeringId);
    const startedAt = performance.now();
    try {
      await check();
      this.success(offeringId, performance.now() - startedAt);
      return true;
    } catch (error) {
      this.failure(offeringId, error);
      return false;
    }
  }

  get(offeringId: string) {
    return structuredClone(this.#health.get(offeringId) ?? initial(offeringId));
  }

  list() {
    return [...this.#health.values()]
      .sort((left, right) => left.offeringId.localeCompare(right.offeringId))
      .map((health) => structuredClone(health));
  }

  aggregate(): NodeCapabilityOfferingHealthState {
    const states = [...this.#health.values()].map((health) => health.state);
    if (states.length === 0 || states.every((state) => state === "unknown")) {
      return "unknown";
    }
    if (states.every((state) => state === "offline")) return "offline";
    if (states.every((state) => state === "healthy")) return "healthy";
    return "degraded";
  }
}
