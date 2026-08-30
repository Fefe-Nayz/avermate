import {
  capabilityUsageSchema,
  nodeCapabilityEventV1Schema,
  nodeCapabilityJobManifestV1Schema,
  nodeCapabilityRequestDigestPayload,
  nodeCapabilityRequestV1Schema,
  nodeCapabilityResultDigestPayload,
  nodeCapabilityResultV1Schema,
  signedNodeCapabilityInvocationGrantSchema,
  type CapabilityArtifactRef,
  type CapabilityUsage,
  type NodeCapabilityEventV1,
  type NodeCapabilityExecutionLimits,
  type NodeCapabilityJobManifestV1,
  type NodeCapabilityRequestV1,
  type NodeCapabilityResultV1,
  type SignedNodeCapabilityInvocationGrant,
  type UnsignedNodeCapabilityInvocationGrantClaims,
} from "@avermate/agent-contracts";
import { canonicalDigest, canonicalJson } from "../canonical-json";
import { verifyCanonical } from "../identity";
import {
  NodeCapabilityRegistry,
  type NodeCapabilityAdapterContext,
  type NodeCapabilityInvocationMode,
} from "./registry";

export type NodeCapabilityArtifactVerifier = (
  artifact: CapabilityArtifactRef,
  phase: "input" | "output",
) => Promise<void>;

type CapabilityEnvelope = {
  operationId: string;
  ownerId: string;
  capability: string;
  offeringId: string;
  offeringDigest: string;
  configRevision: string;
  requestDigest: string;
  inputArtifacts: readonly CapabilityArtifactRef[];
  egressPolicyDigest?: string;
  limits?: NodeCapabilityExecutionLimits;
};

type AuthorizedInvocation = {
  claims: UnsignedNodeCapabilityInvocationGrantClaims;
  context: NodeCapabilityAdapterContext;
};

function byteLength(value: unknown) {
  return new TextEncoder().encode(canonicalJson(value)).byteLength;
}

function exactArtifacts(
  left: readonly CapabilityArtifactRef[],
  right: readonly CapabilityArtifactRef[],
) {
  return canonicalJson(left) === canonicalJson(right);
}

function limitsWithin(
  requested: NodeCapabilityExecutionLimits,
  granted: NodeCapabilityExecutionLimits,
) {
  return (
    requested.cpuMillis <= granted.cpuMillis &&
    requested.memoryBytes <= granted.memoryBytes &&
    requested.inputBytes <= granted.inputBytes &&
    requested.outputBytes <= granted.outputBytes &&
    requested.tokenLimit <= granted.tokenLimit &&
    requested.costMinorLimit <= granted.costMinorLimit &&
    Date.parse(requested.deadline) <= Date.parse(granted.deadline)
  );
}

function usageTokens(usage: CapabilityUsage) {
  return usage.items
    .filter((item) =>
      ["input-token", "output-token", "reasoning-token"].includes(item.unit),
    )
    .reduce((total, item) => total + Number(item.quantity), 0);
}

function assertUsageWithin(usage: CapabilityUsage, limits: NodeCapabilityExecutionLimits) {
  const parsed = capabilityUsageSchema.parse(usage);
  const tokens = usageTokens(parsed);
  if (!Number.isFinite(tokens) || tokens > limits.tokenLimit) {
    throw new Error("NODE_CAPABILITY_TOKEN_LIMIT_EXCEEDED");
  }
  if (
    parsed.cost.amountMinor !== null &&
    BigInt(parsed.cost.amountMinor) > BigInt(limits.costMinorLimit)
  ) {
    throw new Error("NODE_CAPABILITY_COST_LIMIT_EXCEEDED");
  }
}

export function nodeCapabilityRequestDigest(request: NodeCapabilityRequestV1) {
  return canonicalDigest(nodeCapabilityRequestDigestPayload(request));
}

export function nodeCapabilityJobRequestDigest(
  manifest: NodeCapabilityJobManifestV1,
) {
  return canonicalDigest(manifest.requestJson);
}

export function nodeCapabilityOutputDigest(result: NodeCapabilityResultV1) {
  return canonicalDigest(nodeCapabilityResultDigestPayload(result));
}

/** Verifies the dedicated offering-scoped grant before touching an adapter. */
export function verifyNodeCapabilityInvocationGrant(input: {
  grant: SignedNodeCapabilityInvocationGrant;
  issuerPublicKeyDer: string;
  expectedIssuerKeyId: string;
  nodeId: string;
  envelope: CapabilityEnvelope;
  offeringEgressPolicyDigest: string;
  now?: number;
}) {
  const grant = signedNodeCapabilityInvocationGrantSchema.parse(input.grant);
  const { claims, keyId, signature } = grant;
  const now = input.now ?? Date.now();
  if (
    keyId !== input.expectedIssuerKeyId ||
    !verifyCanonical(input.issuerPublicKeyDer, claims, signature)
  ) {
    throw new Error("NODE_CAPABILITY_GRANT_SIGNATURE_INVALID");
  }
  if (
    claims.audience !== input.nodeId ||
    claims.nodeId !== input.nodeId ||
    claims.subject !== input.envelope.ownerId ||
    claims.ownerId !== input.envelope.ownerId ||
    claims.operationId !== input.envelope.operationId ||
    claims.offeringId !== input.envelope.offeringId ||
    claims.offeringDigest !== input.envelope.offeringDigest ||
    claims.configRevision !== input.envelope.configRevision ||
    claims.requestDigest !== input.envelope.requestDigest ||
    claims.egressPolicyDigest !== input.offeringEgressPolicyDigest ||
    (input.envelope.egressPolicyDigest !== undefined &&
      claims.egressPolicyDigest !== input.envelope.egressPolicyDigest) ||
    !exactArtifacts(claims.inputArtifacts, input.envelope.inputArtifacts)
  ) {
    throw new Error("NODE_CAPABILITY_GRANT_BINDING_INVALID");
  }
  if (
    Date.parse(claims.notBefore) > now ||
    Date.parse(claims.expiresAt) <= now ||
    Date.parse(claims.limits.deadline) <= now ||
    (input.envelope.limits &&
      !limitsWithin(input.envelope.limits, claims.limits))
  ) {
    throw new Error("NODE_CAPABILITY_GRANT_EXPIRED_OR_LIMIT_INVALID");
  }
  return claims;
}

export class NodeCapabilityExecutor {
  readonly #nodeId: string;
  readonly #configRevision: () => string;
  readonly #issuerPublicKeyDer: string;
  readonly #issuerKeyId: string;
  readonly #registry: NodeCapabilityRegistry;
  readonly #verifyArtifact?: NodeCapabilityArtifactVerifier;

  constructor(input: {
    nodeId: string;
    configRevision: () => string;
    issuerPublicKeyDer: string;
    issuerKeyId: string;
    registry: NodeCapabilityRegistry;
    verifyArtifact?: NodeCapabilityArtifactVerifier;
  }) {
    this.#nodeId = input.nodeId;
    this.#configRevision = input.configRevision;
    this.#issuerPublicKeyDer = input.issuerPublicKeyDer;
    this.#issuerKeyId = input.issuerKeyId;
    this.#registry = input.registry;
    this.#verifyArtifact = input.verifyArtifact;
  }

  async invoke(input: {
    grant: SignedNodeCapabilityInvocationGrant;
    request: NodeCapabilityRequestV1;
    signal?: AbortSignal;
    now?: number;
  }) {
    const request = nodeCapabilityRequestV1Schema.parse(input.request);
    if (request.requestDigest !== nodeCapabilityRequestDigest(request)) {
      throw new Error("NODE_CAPABILITY_REQUEST_DIGEST_MISMATCH");
    }
    const adapter = this.#registry.resolve(
      request.offeringId,
      request.offeringDigest,
      "unary-relay",
    );
    const authorized = await this.#authorize({
      grant: input.grant,
      envelope: {
        ...request,
        inputArtifacts: request.inputArtifacts,
      },
      mode: "unary-relay",
      signal: input.signal,
      now: input.now,
    });
    const result = await adapter.invoke!(authorized.context, request);
    return this.#validateResult(result, request, authorized.claims);
  }

  async *stream(input: {
    grant: SignedNodeCapabilityInvocationGrant;
    request: NodeCapabilityRequestV1;
    signal?: AbortSignal;
    now?: number;
  }): AsyncIterable<NodeCapabilityEventV1> {
    const request = nodeCapabilityRequestV1Schema.parse(input.request);
    if (request.requestDigest !== nodeCapabilityRequestDigest(request)) {
      throw new Error("NODE_CAPABILITY_REQUEST_DIGEST_MISMATCH");
    }
    const adapter = this.#registry.resolve(
      request.offeringId,
      request.offeringDigest,
      "stream-relay",
    );
    const authorized = await this.#authorize({
      grant: input.grant,
      envelope: {
        ...request,
        inputArtifacts: request.inputArtifacts,
      },
      mode: "stream-relay",
      signal: input.signal,
      now: input.now,
    });
    let expectedSequence = 0;
    let emittedBytes = 0;
    let emittedTokens = 0;
    let emittedCostMinor = 0n;
    let completed = false;
    for await (const raw of adapter.stream!(authorized.context, request)) {
      const event = nodeCapabilityEventV1Schema.parse(raw);
      if (
        completed ||
        event.operationId !== request.operationId ||
        event.offeringId !== request.offeringId ||
        event.sequence !== expectedSequence
      ) {
        throw new Error("NODE_CAPABILITY_EVENT_BINDING_INVALID");
      }
      expectedSequence += 1;
      emittedBytes += byteLength(event);
      if (emittedBytes > authorized.claims.limits.outputBytes) {
        throw new Error("NODE_CAPABILITY_OUTPUT_LIMIT_EXCEEDED");
      }
      if (event.type === "usage") {
        const usage = capabilityUsageSchema.parse(event.payload);
        emittedTokens += usageTokens(usage);
        if (
          !Number.isFinite(emittedTokens) ||
          emittedTokens > authorized.claims.limits.tokenLimit
        ) {
          throw new Error("NODE_CAPABILITY_TOKEN_LIMIT_EXCEEDED");
        }
        if (usage.cost.amountMinor !== null) {
          emittedCostMinor += BigInt(usage.cost.amountMinor);
          if (
            emittedCostMinor >
            BigInt(authorized.claims.limits.costMinorLimit)
          ) {
            throw new Error("NODE_CAPABILITY_COST_LIMIT_EXCEEDED");
          }
        }
      }
      if (event.type === "completed") completed = true;
      yield event;
    }
    if (!completed) throw new Error("NODE_CAPABILITY_STREAM_INCOMPLETE");
  }

  async artifactJob(input: {
    grant: SignedNodeCapabilityInvocationGrant;
    manifest: NodeCapabilityJobManifestV1;
    signal?: AbortSignal;
    now?: number;
  }) {
    const manifest = nodeCapabilityJobManifestV1Schema.parse(input.manifest);
    if (manifest.requestDigest !== nodeCapabilityJobRequestDigest(manifest)) {
      throw new Error("NODE_CAPABILITY_REQUEST_DIGEST_MISMATCH");
    }
    const adapter = this.#registry.resolve(
      manifest.offeringId,
      manifest.offeringDigest,
      "artifact-job",
    );
    const authorized = await this.#authorize({
      grant: input.grant,
      envelope: {
        ...manifest,
        inputArtifacts: manifest.inputs,
      },
      mode: "artifact-job",
      signal: input.signal,
      now: input.now,
    });
    const result = await adapter.artifactJob!(authorized.context, manifest);
    return this.#validateResult(result, manifest, authorized.claims);
  }

  async #authorize(input: {
    grant: SignedNodeCapabilityInvocationGrant;
    envelope: CapabilityEnvelope;
    mode: NodeCapabilityInvocationMode;
    signal?: AbortSignal;
    now?: number;
  }): Promise<AuthorizedInvocation> {
    if (input.envelope.configRevision !== this.#configRevision()) {
      throw new Error("NODE_CAPABILITY_CONFIG_REVISION_MISMATCH");
    }
    const adapter = this.#registry.resolve(
      input.envelope.offeringId,
      input.envelope.offeringDigest,
      input.mode,
    );
    if (adapter.offering.descriptor.capability !== input.envelope.capability) {
      throw new Error("NODE_CAPABILITY_KIND_MISMATCH");
    }
    const claims = verifyNodeCapabilityInvocationGrant({
      grant: input.grant,
      issuerPublicKeyDer: this.#issuerPublicKeyDer,
      expectedIssuerKeyId: this.#issuerKeyId,
      nodeId: this.#nodeId,
      envelope: input.envelope,
      offeringEgressPolicyDigest: adapter.offering.network.egressPolicyDigest,
      now: input.now,
    });
    const serializedInputBytes =
      byteLength(
        "requestJson" in input.envelope
          ? input.envelope.requestJson
          : input.envelope,
      ) +
      input.envelope.inputArtifacts.reduce(
        (total, artifact) => total + artifact.byteSize,
        0,
      );
    if (
      serializedInputBytes > claims.limits.inputBytes ||
      (adapter.offering.descriptor.limits.maxInputBytes !== null &&
        serializedInputBytes > adapter.offering.descriptor.limits.maxInputBytes)
    ) {
      throw new Error("NODE_CAPABILITY_INPUT_LIMIT_EXCEEDED");
    }
    await this.#verifyArtifacts(input.envelope.inputArtifacts, "input");
    const deadlineMs = Date.parse(claims.limits.deadline) - Date.now();
    if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) {
      throw new Error("NODE_CAPABILITY_DEADLINE_EXPIRED");
    }
    const signal = AbortSignal.any([
      input.signal ?? new AbortController().signal,
      AbortSignal.timeout(Math.min(deadlineMs, 24 * 60 * 60_000)),
    ]);
    return {
      claims,
      context: this.#registry.context({
        offeringId: input.envelope.offeringId,
        ownerId: input.envelope.ownerId,
        operationId: input.envelope.operationId,
        deadline: claims.limits.deadline,
        signal,
      }),
    };
  }

  async #validateResult(
    raw: NodeCapabilityResultV1,
    request: NodeCapabilityRequestV1 | NodeCapabilityJobManifestV1,
    claims: UnsignedNodeCapabilityInvocationGrantClaims,
  ) {
    const result = nodeCapabilityResultV1Schema.parse(raw);
    if (
      result.operationId !== request.operationId ||
      result.offeringId !== request.offeringId ||
      result.requestDigest !== request.requestDigest ||
      result.outputDigest !== nodeCapabilityOutputDigest(result) ||
      result.outputArtifacts.some(
        (artifact) => artifact.object.ownerId !== request.ownerId,
      )
    ) {
      throw new Error("NODE_CAPABILITY_RESULT_BINDING_INVALID");
    }
    const outputBytes =
      byteLength(result.result) +
      result.outputArtifacts.reduce(
        (total, artifact) => total + artifact.byteSize,
        0,
      );
    const adapter = this.#registry.resolve(
      request.offeringId,
      request.offeringDigest,
      "inputs" in request ? "artifact-job" : "unary-relay",
    );
    if (
      outputBytes > claims.limits.outputBytes ||
      (adapter.offering.descriptor.limits.maxOutputBytes !== null &&
        outputBytes > adapter.offering.descriptor.limits.maxOutputBytes)
    ) {
      throw new Error("NODE_CAPABILITY_OUTPUT_LIMIT_EXCEEDED");
    }
    assertUsageWithin(result.usage, claims.limits);
    await this.#verifyArtifacts(result.outputArtifacts, "output");
    return result;
  }

  async #verifyArtifacts(
    artifacts: readonly CapabilityArtifactRef[],
    phase: "input" | "output",
  ) {
    if (artifacts.length > 0 && !this.#verifyArtifact) {
      throw new Error("NODE_CAPABILITY_ARTIFACT_VERIFIER_REQUIRED");
    }
    for (const artifact of artifacts) {
      await this.#verifyArtifact!(artifact, phase);
    }
  }
}
