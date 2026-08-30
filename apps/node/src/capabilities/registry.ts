import {
  nodeCapabilityEventV1Schema,
  nodeCapabilityJobManifestV1Schema,
  nodeCapabilityOfferingSchema,
  nodeCapabilityRequestV1Schema,
  nodeCapabilityResultV1Schema,
  type NodeCapabilityEventV1,
  type NodeCapabilityJobManifestV1,
  type NodeCapabilityOffering,
  type NodeCapabilityRequestV1,
  type NodeCapabilityResultV1,
} from "@avermate/agent-contracts";
import { canonicalDigest } from "../canonical-json";
import type { NodeCapabilitySecretCustody } from "./secret-store";
import { NodeCapabilityHealthTracker } from "./health";

export const NODE_CAPABILITY_MAX_OFFERINGS = 512;
export const NODE_CAPABILITY_INVOCATION_MODES = [
  "unary-relay",
  "stream-relay",
  "artifact-job",
] as const;
export type NodeCapabilityInvocationMode =
  (typeof NODE_CAPABILITY_INVOCATION_MODES)[number];

export type NodeCapabilityAdapterContext = {
  ownerId: string;
  operationId: string;
  deadline: string;
  signal: AbortSignal;
  credential(slot: string): Promise<{ value: string; version: number } | null>;
};

export interface NodeCapabilityAdapter {
  readonly offering: NodeCapabilityOffering;
  readonly invocationModes: readonly NodeCapabilityInvocationMode[];
  invoke?(
    context: NodeCapabilityAdapterContext,
    request: NodeCapabilityRequestV1,
  ): Promise<NodeCapabilityResultV1>;
  stream?(
    context: NodeCapabilityAdapterContext,
    request: NodeCapabilityRequestV1,
  ): AsyncIterable<NodeCapabilityEventV1>;
  artifactJob?(
    context: NodeCapabilityAdapterContext,
    manifest: NodeCapabilityJobManifestV1,
  ): Promise<NodeCapabilityResultV1>;
  health?(): Promise<void>;
}

const forbiddenPublicKey = /^(?:api[_-]?key|access[_-]?token|authorization|base[_-]?url|credential|credential[_-]?ref|endpoint|origin|password|secret|secret[_-]?ref|token|url)$/iu;

function assertPublicValue(value: unknown, path = "offering") {
  if (typeof value === "string") {
    if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(value)) {
      throw new Error(`NODE_CAPABILITY_OFFERING_ENDPOINT_FORBIDDEN:${path}`);
    }
    if (
      /^(?:env|file|secret|vault):/iu.test(value) ||
      /^[a-z]:[\\/]/iu.test(value) ||
      /^\/(?:etc|home|root|run|users|var)(?:\/|$)/iu.test(value)
    ) {
      throw new Error(`NODE_CAPABILITY_OFFERING_SECRET_REFERENCE:${path}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertPublicValue(entry, `${path}.${index}`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (forbiddenPublicKey.test(key)) {
      throw new Error(`NODE_CAPABILITY_OFFERING_SECRET_FIELD:${path}.${key}`);
    }
    assertPublicValue(entry, `${path}.${key}`);
  }
}

function checkedOffering(raw: NodeCapabilityOffering) {
  const offering = nodeCapabilityOfferingSchema.parse(raw);
  assertPublicValue(offering);
  if (offering.descriptor.placement.kind !== "node") {
    throw new Error("NODE_CAPABILITY_OFFERING_PLACEMENT_INVALID");
  }
  if (offering.descriptor.id !== offering.descriptor.id.trim()) {
    throw new Error("NODE_CAPABILITY_OFFERING_ID_INVALID");
  }
  if (canonicalDigest(offering.descriptor) !== offering.descriptorDigest) {
    throw new Error("NODE_CAPABILITY_OFFERING_DIGEST_MISMATCH");
  }
  return offering;
}

function checkedModes(adapter: NodeCapabilityAdapter) {
  const modes = [...new Set(adapter.invocationModes)];
  if (modes.length === 0 || modes.length !== adapter.invocationModes.length) {
    throw new Error("NODE_CAPABILITY_INVOCATION_MODES_INVALID");
  }
  for (const mode of modes) {
    if (!NODE_CAPABILITY_INVOCATION_MODES.includes(mode)) {
      throw new Error("NODE_CAPABILITY_INVOCATION_MODE_UNSUPPORTED");
    }
    if (mode === "unary-relay" && !adapter.invoke) {
      throw new Error("NODE_CAPABILITY_UNARY_ADAPTER_MISSING");
    }
    if (mode === "stream-relay" && !adapter.stream) {
      throw new Error("NODE_CAPABILITY_STREAM_ADAPTER_MISSING");
    }
    if (mode === "artifact-job" && !adapter.artifactJob) {
      throw new Error("NODE_CAPABILITY_JOB_ADAPTER_MISSING");
    }
  }
  return modes.sort();
}

/** Immutable, bounded catalogue of reviewed or Node-controlled adapters. */
export class NodeCapabilityRegistry {
  readonly #nodeId: string;
  readonly #configRevision: () => string;
  readonly #secrets: NodeCapabilitySecretCustody;
  readonly #maximumOfferings: number;
  readonly #adapters = new Map<string, NodeCapabilityAdapter>();
  readonly health = new NodeCapabilityHealthTracker();

  constructor(input: {
    nodeId: string;
    configRevision: () => string;
    secrets: NodeCapabilitySecretCustody;
    maximumOfferings?: number;
  }) {
    this.#nodeId = input.nodeId;
    this.#configRevision = input.configRevision;
    this.#secrets = input.secrets;
    this.#maximumOfferings = Math.min(
      Math.max(input.maximumOfferings ?? NODE_CAPABILITY_MAX_OFFERINGS, 1),
      NODE_CAPABILITY_MAX_OFFERINGS,
    );
  }

  register(adapter: NodeCapabilityAdapter) {
    if (this.#adapters.size >= this.#maximumOfferings) {
      throw new Error("NODE_CAPABILITY_OFFERING_LIMIT_EXCEEDED");
    }
    const offering = checkedOffering(adapter.offering);
    const placement = offering.descriptor.placement;
    if (
      placement.kind !== "node" ||
      placement.nodeId !== this.#nodeId ||
      placement.configRevision !== this.#configRevision()
    ) {
      throw new Error("NODE_CAPABILITY_OFFERING_NODE_BINDING_INVALID");
    }
    const modes = checkedModes(adapter);
    if (this.#adapters.has(offering.descriptor.id)) {
      throw new Error("NODE_CAPABILITY_OFFERING_DUPLICATE");
    }
    this.#adapters.set(offering.descriptor.id, {
      offering,
      invocationModes: modes,
      ...(adapter.invoke ? { invoke: adapter.invoke.bind(adapter) } : {}),
      ...(adapter.stream ? { stream: adapter.stream.bind(adapter) } : {}),
      ...(adapter.artifactJob
        ? { artifactJob: adapter.artifactJob.bind(adapter) }
        : {}),
      ...(adapter.health ? { health: adapter.health.bind(adapter) } : {}),
    });
    this.health.register(offering.descriptor.id);
    return this;
  }

  unregister(offeringId: string) {
    this.#adapters.delete(offeringId);
    this.health.remove(offeringId);
  }

  resolve(
    offeringId: string,
    offeringDigest: string,
    mode: NodeCapabilityInvocationMode,
  ) {
    const adapter = this.#adapters.get(offeringId);
    if (!adapter) throw new Error("NODE_CAPABILITY_OFFERING_NOT_FOUND");
    const placement = adapter.offering.descriptor.placement;
    if (
      placement.kind !== "node" ||
      placement.nodeId !== this.#nodeId ||
      placement.configRevision !== this.#configRevision()
    ) {
      throw new Error("NODE_CAPABILITY_OFFERING_CONFIG_STALE");
    }
    if (adapter.offering.descriptorDigest !== offeringDigest) {
      throw new Error("NODE_CAPABILITY_OFFERING_DIGEST_MISMATCH");
    }
    if (!adapter.invocationModes.includes(mode)) {
      throw new Error("NODE_CAPABILITY_INVOCATION_MODE_UNSUPPORTED");
    }
    return adapter;
  }

  listOfferings() {
    return [...this.#adapters.values()]
      .filter((adapter) => {
        const placement = adapter.offering.descriptor.placement;
        return (
          placement.kind === "node" &&
          placement.nodeId === this.#nodeId &&
          placement.configRevision === this.#configRevision()
        );
      })
      .map((adapter) => structuredClone(adapter.offering))
      .sort((left, right) =>
        left.descriptor.id.localeCompare(right.descriptor.id),
      );
  }

  invocationModes() {
    return [...new Set(
      [...this.#adapters.values()].flatMap((adapter) => {
        const placement = adapter.offering.descriptor.placement;
        return placement.kind === "node" &&
          placement.nodeId === this.#nodeId &&
          placement.configRevision === this.#configRevision()
          ? adapter.invocationModes
          : [];
      }),
    )].sort() as NodeCapabilityInvocationMode[];
  }

  context(input: {
    offeringId: string;
    ownerId: string;
    operationId: string;
    deadline: string;
    signal: AbortSignal;
  }): NodeCapabilityAdapterContext {
    return {
      ownerId: input.ownerId,
      operationId: input.operationId,
      deadline: input.deadline,
      signal: input.signal,
      credential: (slot) => this.#secrets.credential(input.offeringId, slot),
    };
  }

  async probe(offeringId: string) {
    const adapter = this.#adapters.get(offeringId);
    if (!adapter) throw new Error("NODE_CAPABILITY_OFFERING_NOT_FOUND");
    return this.health.probe(offeringId, async () => {
      await adapter.health?.();
    });
  }

  parseRequest(value: unknown) {
    return nodeCapabilityRequestV1Schema.parse(value);
  }

  parseResult(value: unknown) {
    return nodeCapabilityResultV1Schema.parse(value);
  }

  parseEvent(value: unknown) {
    return nodeCapabilityEventV1Schema.parse(value);
  }

  parseJobManifest(value: unknown) {
    return nodeCapabilityJobManifestV1Schema.parse(value);
  }
}
