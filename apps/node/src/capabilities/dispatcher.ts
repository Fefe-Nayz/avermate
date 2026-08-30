import {
  nodeCapabilityJobManifestV1Schema,
  nodeCapabilityOperationSchema,
  nodeCapabilityRequestV1Schema,
  nodeOperationCapability,
  nodeOperationPayloadSchema,
  signedNodeCapabilityInvocationGrantSchema,
  type NodeCapabilityJobManifestV1,
  type NodeCapabilityOperation,
  type NodeCapabilityRequestV1,
  type NodeControlFrame,
  type SignedNodeCapabilityInvocationGrant,
  type UnsignedNodeCapabilityInvocationGrantClaims,
} from "@avermate/agent-contracts";
import type { NodeOperationResultLedger } from "../operation-ledger";
import type { StoredOperationResult } from "../operation-ledger";
import type { GrantReplayLedger } from "../protocol";
import { canonicalDigest } from "../canonical-json";
import {
  NodeCapabilityExecutor,
  nodeCapabilityJobRequestDigest,
  nodeCapabilityRequestDigest,
  verifyNodeCapabilityInvocationGrant,
} from "./executor";
import {
  NodeCapabilityRegistry,
  type NodeCapabilityInvocationMode,
} from "./registry";

type OperationRequest = Extract<
  NodeControlFrame,
  { type: "operation-request" }
>;

const CAPABILITY_OPERATIONS = [
  "capability.invoke",
  "capability.stream",
  "capability.artifact-job",
] as const satisfies readonly NodeCapabilityOperation[];

type CapabilityOperation = (typeof CAPABILITY_OPERATIONS)[number];
type InvocationInput = NodeCapabilityRequestV1 | NodeCapabilityJobManifestV1;

function isCapabilityOperation(
  operation: NodeCapabilityOperation,
): operation is CapabilityOperation {
  return (CAPABILITY_OPERATIONS as readonly string[]).includes(operation);
}

function invocationMode(operation: CapabilityOperation): NodeCapabilityInvocationMode {
  switch (operation) {
    case "capability.invoke":
      return "unary-relay";
    case "capability.stream":
      return "stream-relay";
    case "capability.artifact-job":
      return "artifact-job";
  }
}

function safeErrorCode(error: unknown) {
  const value =
    error instanceof Error ? error.message : "NODE_CAPABILITY_OPERATION_FAILED";
  return /^[A-Z0-9_:-]{3,128}$/u.test(value)
    ? value
    : "NODE_CAPABILITY_OPERATION_FAILED";
}

function retryable(code: string) {
  return /OFFLINE|UNAVAILABLE|TIMEOUT|RATE_LIMIT|CAPACITY/u.test(code);
}

type ActiveOperation = {
  offeringId: string;
  controller: AbortController;
  deadlineTimer: ReturnType<typeof setTimeout>;
};

/** Durable relay dispatcher dedicated to capability protocol v1. */
export class NodeCapabilityV1Dispatcher {
  readonly #nodeId: string;
  readonly #configRevision: () => string;
  readonly #issuerPublicKeyDer: string;
  readonly #issuerKeyId: string;
  readonly #registry: NodeCapabilityRegistry;
  readonly #executor: NodeCapabilityExecutor;
  readonly #grantReplay: GrantReplayLedger;
  readonly #results: NodeOperationResultLedger;
  readonly #maximumConcurrent: number;
  readonly #publish: (
    frame: Extract<NodeControlFrame, { type: "operation-result" }>,
  ) => Promise<void>;
  readonly #active = new Map<string, ActiveOperation>();

  constructor(input: {
    nodeId: string;
    configRevision: () => string;
    issuerPublicKeyDer: string;
    issuerKeyId: string;
    registry: NodeCapabilityRegistry;
    executor: NodeCapabilityExecutor;
    grantReplay: GrantReplayLedger;
    results: NodeOperationResultLedger;
    maximumConcurrent: number;
    publish(
      frame: Extract<NodeControlFrame, { type: "operation-result" }>,
    ): Promise<void>;
  }) {
    this.#nodeId = input.nodeId;
    this.#configRevision = input.configRevision;
    this.#issuerPublicKeyDer = input.issuerPublicKeyDer;
    this.#issuerKeyId = input.issuerKeyId;
    this.#registry = input.registry;
    this.#executor = input.executor;
    this.#grantReplay = input.grantReplay;
    this.#results = input.results;
    this.#maximumConcurrent = Math.max(1, input.maximumConcurrent);
    this.#publish = input.publish;
  }

  get activeCount() {
    return this.#active.size;
  }

  async initialize() {
    await this.#results.initialize();
    return this.#results.recoverInterrupted();
  }

  async accept(frame: OperationRequest, now = Date.now()) {
    const operation = nodeCapabilityOperationSchema.parse(frame.operation);
    if (!isCapabilityOperation(operation)) {
      throw new Error("NODE_CAPABILITY_OPERATION_UNSUPPORTED");
    }
    if (
      frame.nodeId !== this.#nodeId ||
      frame.capability !== "inference" ||
      frame.capabilityVersion !== 1 ||
      nodeOperationCapability(operation) !== "inference"
    ) {
      throw new Error("NODE_CAPABILITY_OPERATION_BINDING_INVALID");
    }
    if (frame.configRevision !== this.#configRevision()) {
      throw new Error("NODE_CAPABILITY_CONFIG_REVISION_MISMATCH");
    }
    const payload = nodeOperationPayloadSchema.parse(frame.payload);
    const value = this.#parseInput(operation, payload.input);
    if (
      value.ownerId !== payload.ownerId ||
      value.operationId !== frame.operationId ||
      value.configRevision !== frame.configRevision
    ) {
      throw new Error("NODE_CAPABILITY_OPERATION_BINDING_INVALID");
    }
    const mode = invocationMode(operation);
    const adapter = this.#registry.resolve(
      value.offeringId,
      value.offeringDigest,
      mode,
    );
    if (adapter.offering.descriptor.capability !== value.capability) {
      throw new Error("NODE_CAPABILITY_KIND_MISMATCH");
    }
    const requestDigest =
      operation === "capability.artifact-job"
        ? nodeCapabilityJobRequestDigest(value as NodeCapabilityJobManifestV1)
        : nodeCapabilityRequestDigest(value as NodeCapabilityRequestV1);
    if (requestDigest !== value.requestDigest) {
      throw new Error("NODE_CAPABILITY_REQUEST_DIGEST_MISMATCH");
    }
    // The wire request digest intentionally covers only the normalized request
    // body for artifact jobs. Durable replay must additionally fence artifacts,
    // limits, offering/config revisions and the selected invocation lane.
    const executionDigest = canonicalDigest({ operation, input: value });
    const grant = signedNodeCapabilityInvocationGrantSchema.parse(frame.grant);
    const claims = verifyNodeCapabilityInvocationGrant({
      grant,
      issuerPublicKeyDer: this.#issuerPublicKeyDer,
      expectedIssuerKeyId: this.#issuerKeyId,
      nodeId: this.#nodeId,
      envelope: {
        ...value,
        inputArtifacts:
          "inputs" in value ? value.inputs : value.inputArtifacts,
        ...("inputs" in value
          ? { egressPolicyDigest: value.egressPolicyDigest, limits: value.limits }
          : {}),
      },
      offeringEgressPolicyDigest: adapter.offering.network.egressPolicyDigest,
      now,
    });
    if (
      Date.parse(frame.deadline) <= now ||
      Date.parse(frame.deadline) > Date.parse(claims.limits.deadline)
    ) {
      throw new Error("NODE_CAPABILITY_DEADLINE_INVALID");
    }
    await this.#grantReplay.accept(claims, executionDigest, now);
    const offered = await this.#results.offer({
      operationId: frame.operationId,
      requestDigest: executionDigest,
      expiresAt: claims.expiresAt,
      now: new Date(now),
    });
    if (offered.replayed) {
      for (const result of offered.record.results) {
        await this.#publishResult(frame, result);
      }
      if (offered.record.state !== "terminal") {
        throw new Error("NODE_CAPABILITY_REPLAY_IN_PROGRESS");
      }
      return { accepted: true, replayed: true };
    }
    const offeringMaximum = adapter.offering.descriptor.limits.maxConcurrency;
    const offeringActive = [...this.#active.values()].filter(
      (active) => active.offeringId === value.offeringId,
    ).length;
    if (
      this.#active.size >= this.#maximumConcurrent ||
      (offeringMaximum !== null && offeringActive >= offeringMaximum)
    ) {
      await this.#terminalFailure(frame, "NODE_CAPABILITY_CAPACITY_EXCEEDED", 1);
      return { accepted: false, replayed: false };
    }
    const controller = new AbortController();
    const deadlineTimer = setTimeout(
      () => controller.abort("deadline"),
      Math.max(1, Date.parse(frame.deadline) - now),
    );
    (deadlineTimer as unknown as { unref?: () => void }).unref?.();
    this.#active.set(frame.operationId, {
      offeringId: value.offeringId,
      controller,
      deadlineTimer,
    });
    void this.#execute(frame, operation, value, grant, claims, controller.signal);
    return { accepted: true, replayed: false };
  }

  async cancel(operationId: string) {
    const active = this.#active.get(operationId);
    if (!active) return false;
    active.controller.abort("cancelled");
    return true;
  }

  async #execute(
    frame: OperationRequest,
    operation: CapabilityOperation,
    input: InvocationInput,
    grant: SignedNodeCapabilityInvocationGrant,
    _claims: UnsignedNodeCapabilityInvocationGrantClaims,
    signal: AbortSignal,
  ) {
    const active = this.#active.get(frame.operationId)!;
    let sequence = 0;
    const emit = async (payload: unknown, terminal: boolean) => {
      sequence += 1;
      const result: StoredOperationResult = {
        sequence,
        ok: true,
        payload,
        retryable: false,
        terminal,
      };
      await this.#results.append(frame.operationId, result);
      await this.#publishResult(frame, result);
    };
    try {
      if (operation === "capability.invoke") {
        await emit(
          await this.#executor.invoke({
            grant,
            request: input as NodeCapabilityRequestV1,
            signal,
          }),
          false,
        );
      } else if (operation === "capability.artifact-job") {
        await emit(
          await this.#executor.artifactJob({
            grant,
            manifest: input as NodeCapabilityJobManifestV1,
            signal,
          }),
          false,
        );
      } else {
        for await (const event of this.#executor.stream({
          grant,
          request: input as NodeCapabilityRequestV1,
          signal,
        })) {
          await emit(event, false);
        }
      }
      await emit(undefined, true);
      this.#registry.health.success(input.offeringId, 0);
    } catch (error) {
      const code = signal.aborted
        ? signal.reason === "deadline"
          ? "NODE_CAPABILITY_DEADLINE_EXCEEDED"
          : "NODE_CAPABILITY_CANCELLED"
        : safeErrorCode(error);
      this.#registry.health.failure(input.offeringId, new Error(code));
      await this.#terminalFailure(frame, code, sequence + 1).catch(
        () => undefined,
      );
    } finally {
      clearTimeout(active.deadlineTimer);
      this.#active.delete(frame.operationId);
    }
  }

  #parseInput(operation: CapabilityOperation, raw: unknown): InvocationInput {
    return operation === "capability.artifact-job"
      ? nodeCapabilityJobManifestV1Schema.parse(raw)
      : nodeCapabilityRequestV1Schema.parse(raw);
  }

  async #terminalFailure(
    frame: OperationRequest,
    code: string,
    sequence: number,
  ) {
    const result: StoredOperationResult = {
      sequence,
      ok: false,
      safeErrorCode: code,
      retryable: retryable(code),
      terminal: true,
    };
    await this.#results.append(frame.operationId, result);
    await this.#publishResult(frame, result);
  }

  #publishResult(frame: OperationRequest, result: StoredOperationResult) {
    return this.#publish({
      type: "operation-result",
      frameId: `frame_${crypto.randomUUID()}`,
      nodeId: this.#nodeId,
      connectionEpoch: frame.connectionEpoch,
      operationId: frame.operationId,
      ...result,
    });
  }
}
