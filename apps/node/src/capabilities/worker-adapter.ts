import {
  emptyCapabilityUsage,
  nodeCapabilityJobManifestV1Schema,
  nodeCapabilityOfferingSchema,
  nodeCapabilityResultV1Schema,
  type NodeCapabilityJobManifestV1,
  type NodeCapabilityOffering,
  type NodeCapabilityResultV1,
  type NodeJobExecutionProfile,
  type NodeJobV1,
} from "@avermate/agent-contracts";
import { canonicalDigest } from "../canonical-json";
import type {
  NodeJobHandler,
  NodeJobHandlerContext,
} from "../job-dispatcher";
import type {
  NodeCapabilityAdapter,
  NodeCapabilityAdapterContext,
} from "./registry";

type HealthyNodeJobHandler = NodeJobHandler & {
  healthy?(): Promise<boolean>;
  executionProfile?(): NodeJobExecutionProfile;
};

function syntheticJob(input: {
  manifest: NodeCapabilityJobManifestV1;
  entryManifest: NodeCapabilityJobManifestV1["inputs"][number];
  handler: HealthyNodeJobHandler;
  nodeId: string;
  executionProfile?: NodeJobExecutionProfile;
}): NodeJobV1 {
  const { manifest } = input;
  const unsigned = {
    id: manifest.operationId,
    principalRef: {
      userId: manifest.ownerId,
      nodeId: input.nodeId,
      actorKind: "system" as const,
    },
    kind: input.handler.kind,
    capabilityVersion: input.handler.capabilityVersion,
    ...(input.executionProfile
      ? { executionProfile: input.executionProfile }
      : {}),
    inputRefs: [input.entryManifest],
    resourceRefs: manifest.inputs.map((artifact) => artifact.object),
    policyRef: manifest.configRevision,
    limits: {
      cpuMillis: manifest.limits.cpuMillis,
      memoryBytes: manifest.limits.memoryBytes,
      inputBytes: manifest.limits.inputBytes,
      outputBytes: manifest.limits.outputBytes,
      deadline: manifest.limits.deadline,
    },
    idempotencyKey: manifest.operationId,
  };
  return {
    ...unsigned,
    envelopeDigest: canonicalDigest(unsigned),
    // The dedicated capability grant was already verified by the executor.
    // Legacy handlers never inspect this compatibility-only envelope field.
    grant: {
      claims: {
        version: 1,
        issuer: "capability-v1",
        audience: unsigned.principalRef.nodeId,
        subject: manifest.ownerId,
        nodeId: unsigned.principalRef.nodeId,
        userId: manifest.ownerId,
        actorKind: "system",
        jobId: manifest.operationId,
        jti: `capability-${manifest.operationId}`,
        capabilities: [input.handler.requiredCapability],
        resources: unsigned.resourceRefs,
        limits: {
          byteLimit: manifest.limits.inputBytes + manifest.limits.outputBytes,
          tokenLimit: manifest.limits.tokenLimit,
          costMinorLimit: manifest.limits.costMinorLimit,
          deadline: manifest.limits.deadline,
        },
        notBefore: new Date(
          Math.max(0, Date.now() - 1_000),
        ).toISOString(),
        expiresAt: manifest.limits.deadline,
        issuedAt: new Date(Math.max(0, Date.now() - 1_000)).toISOString(),
      },
      keyId: "capability-v1",
      signature: "compatibility-only-signature-not-used",
    },
  };
}

/**
 * Adapts reviewed artifact handlers (including local OCR/STT) to the generic
 * artifact-job lane without weakening their manifest and sandbox checks.
 */
export class LegacyArtifactWorkerCapabilityAdapter
  implements NodeCapabilityAdapter
{
  readonly invocationModes = ["artifact-job"] as const;
  readonly offering: NodeCapabilityOffering;
  readonly #handler: HealthyNodeJobHandler;
  readonly #nodeId: string;
  readonly #executionProfile?: NodeJobExecutionProfile;

  constructor(input: {
    offering: NodeCapabilityOffering;
    handler: HealthyNodeJobHandler;
    nodeId: string;
  }) {
    this.offering = nodeCapabilityOfferingSchema.parse(input.offering);
    const expectedCapability =
      input.handler.kind === "artifact.local-ocr"
        ? "document.ocr"
        : input.handler.kind === "artifact.local-transcription"
          ? "speech.transcribe"
          : null;
    if (
      expectedCapability === null ||
      this.offering.descriptor.capability !== expectedCapability
    ) {
      throw new Error("NODE_CAPABILITY_WORKER_OFFERING_MISMATCH");
    }
    this.#handler = input.handler;
    this.#nodeId = input.nodeId;
    this.#executionProfile = input.handler.executionProfile?.();
  }

  async health() {
    if (this.#handler.healthy && !(await this.#handler.healthy())) {
      throw new Error("NODE_CAPABILITY_WORKER_UNHEALTHY");
    }
  }

  async artifactJob(
    context: NodeCapabilityAdapterContext,
    raw: NodeCapabilityJobManifestV1,
  ): Promise<NodeCapabilityResultV1> {
    const manifest = nodeCapabilityJobManifestV1Schema.parse(raw);
    if (
      context.ownerId !== manifest.ownerId ||
      context.operationId !== manifest.operationId ||
      context.signal.aborted
    ) {
      throw new Error("NODE_CAPABILITY_WORKER_CONTEXT_INVALID");
    }
    const entryManifests = manifest.inputs.filter(
      (artifact) => artifact.mimeType === "application/json",
    );
    if (entryManifests.length !== 1) {
      throw new Error("NODE_CAPABILITY_WORKER_MANIFEST_REQUIRED");
    }
    const job = syntheticJob({
      manifest,
      entryManifest: entryManifests[0]!,
      handler: this.#handler,
      nodeId: this.#nodeId,
      ...(this.#executionProfile
        ? { executionProfile: this.#executionProfile }
        : {}),
    });
    const handlerContext: NodeJobHandlerContext = {
      job,
      grantedResources: manifest.inputs.map((artifact) => artifact.object),
      signal: context.signal,
      progress: async () => undefined,
    };
    const outputArtifacts = await this.#handler.execute(handlerContext);
    const resultValue = {
      workerKind: this.#handler.kind,
      capabilityVersion: this.#handler.capabilityVersion,
    };
    const result = {
      schemaVersion: 1 as const,
      operationId: manifest.operationId,
      offeringId: manifest.offeringId,
      requestDigest: manifest.requestDigest,
      outputDigest: canonicalDigest({
        result: resultValue,
        outputArtifacts,
      }),
      result: resultValue,
      outputArtifacts,
      usage: emptyCapabilityUsage(),
      providerRequestId: null,
    };
    return nodeCapabilityResultV1Schema.parse(result);
  }
}
