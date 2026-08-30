import type { NodeSecretStore } from "../secret-store";

const slotPattern = /^[a-z][a-zA-Z0-9._-]{0,63}$/u;

type SecretBinding = {
  reference: string;
  version: number;
};

export type NodeCapabilitySecretSlotSnapshot = {
  slot: string;
  status: "ready" | "missing";
  version: number;
  hint: string | null;
};

function key(offeringId: string, slot: string) {
  return `${offeringId}\0${slot}`;
}

function assertSlot(slot: string) {
  if (!slotPattern.test(slot)) {
    throw new Error("NODE_CAPABILITY_SECRET_SLOT_INVALID");
  }
}

/**
 * Keeps capability credentials under Node custody. Only readiness, monotone
 * version and a non-sensitive hint may cross the Node/Core boundary.
 */
export class NodeCapabilitySecretCustody {
  readonly #secrets: NodeSecretStore;
  readonly #bindings = new Map<string, SecretBinding>();

  constructor(secrets: NodeSecretStore) {
    this.#secrets = secrets;
  }

  bind(input: {
    offeringId: string;
    slot: string;
    reference: string;
    version: number;
  }) {
    assertSlot(input.slot);
    if (!input.offeringId || input.offeringId.length > 256) {
      throw new Error("NODE_CAPABILITY_OFFERING_ID_INVALID");
    }
    if (!Number.isSafeInteger(input.version) || input.version < 1) {
      throw new Error("NODE_CAPABILITY_SECRET_VERSION_INVALID");
    }
    const bindingKey = key(input.offeringId, input.slot);
    const previous = this.#bindings.get(bindingKey);
    if (previous && input.version <= previous.version) {
      throw new Error("NODE_CAPABILITY_SECRET_VERSION_NOT_MONOTONE");
    }
    this.#bindings.set(bindingKey, {
      reference: input.reference,
      version: input.version,
    });
  }

  unbind(offeringId: string, slot: string) {
    assertSlot(slot);
    this.#bindings.delete(key(offeringId, slot));
  }

  async credential(offeringId: string, slot: string) {
    assertSlot(slot);
    const binding = this.#bindings.get(key(offeringId, slot));
    if (!binding) return null;
    return {
      value: await this.#secrets.read(binding.reference),
      version: binding.version,
    };
  }

  async snapshot(offeringId: string) {
    const entries = [...this.#bindings.entries()]
      .filter(([bindingKey]) => bindingKey.startsWith(`${offeringId}\0`))
      .sort(([left], [right]) => left.localeCompare(right));
    const snapshots: NodeCapabilitySecretSlotSnapshot[] = [];
    for (const [bindingKey, binding] of entries) {
      const slot = bindingKey.slice(bindingKey.indexOf("\0") + 1);
      try {
        const value = await this.#secrets.read(binding.reference);
        snapshots.push({
          slot,
          status: "ready",
          version: binding.version,
          hint: value.length > 4 ? `…${value.slice(-4)}` : "…",
        });
      } catch {
        snapshots.push({
          slot,
          status: "missing",
          version: binding.version,
          hint: null,
        });
      }
    }
    return snapshots;
  }

  /** Deliberately serializes to no secret references or values. */
  toJSON() {
    return { custody: "node-local" as const };
  }
}
