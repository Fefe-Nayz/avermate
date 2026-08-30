import { z } from "zod";
import {
  capabilityArtifactRefSchema,
  capabilityKindSchema,
  capabilityOfferingPublicDescriptorSchema,
  capabilityPurposeSchema,
  type CapabilityArtifactRef,
} from "./capability";
import { capabilityUsageSchema } from "./capability-operation";
import { objectSha256Schema } from "./storage";

const boundedIdSchema = z.string().trim().min(1).max(256);
const timestampSchema = z.iso.datetime({ offset: true });
const signatureSchema = z
  .string()
  .min(32)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/u, "expected a base64url signature");

export const nodeCapabilityInvocationModeSchema = z.enum([
  "unary-relay",
  "stream-relay",
  "artifact-job",
]);
export type NodeCapabilityInvocationMode = z.infer<
  typeof nodeCapabilityInvocationModeSchema
>;

export const nodeCapabilityOfferingSchema = z
  .strictObject({
    descriptor: capabilityOfferingPublicDescriptorSchema,
    descriptorDigest: objectSha256Schema,
    runtime: z.strictObject({
      implementation: z.string().trim().min(1).max(256),
      runtimeRevision: z.string().trim().min(1).max(256),
      imageDigest: objectSha256Schema.nullable(),
      modelRevision: z.string().trim().min(1).max(256),
    }),
    network: z.strictObject({
      egressPolicyDigest: objectSha256Schema,
    }),
  })
  .superRefine((offering, context) => {
    if (offering.descriptor.placement.kind !== "node") {
      context.addIssue({
        code: "custom",
        path: ["descriptor", "placement"],
        message: "Node offerings require node placement",
      });
    }
    if (offering.descriptor.modelRevision !== offering.runtime.modelRevision) {
      context.addIssue({
        code: "custom",
        path: ["runtime", "modelRevision"],
        message: "runtime and descriptor model revisions must match",
      });
    }
  });
export type NodeCapabilityOffering = z.infer<
  typeof nodeCapabilityOfferingSchema
>;

export const nodeCapabilityInferenceFeaturesSchema = z
  .strictObject({
    version: z.literal(1),
    offerings: z.array(nodeCapabilityOfferingSchema).max(512),
    invocationModes: z
      .array(nodeCapabilityInvocationModeSchema)
      .min(1)
      .max(3),
    maxConcurrent: z.number().int().positive().max(10_000),
    secretCustody: z.literal("node-local"),
  })
  .superRefine((features, context) => {
    const offeringIds = features.offerings.map(
      (offering) => offering.descriptor.id,
    );
    if (new Set(offeringIds).size !== offeringIds.length) {
      context.addIssue({
        code: "custom",
        path: ["offerings"],
        message: "Node offering IDs must be unique",
      });
    }
    if (new Set(features.invocationModes).size !== features.invocationModes.length) {
      context.addIssue({
        code: "custom",
        path: ["invocationModes"],
        message: "Node invocation modes must be unique",
      });
    }
  });
export type NodeCapabilityInferenceFeatures = z.infer<
  typeof nodeCapabilityInferenceFeaturesSchema
>;

export const nodeCapabilityExecutionLimitsSchema = z.strictObject({
  cpuMillis: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  memoryBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  inputBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  outputBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  tokenLimit: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  costMinorLimit: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  deadline: timestampSchema,
});
export type NodeCapabilityExecutionLimits = z.infer<
  typeof nodeCapabilityExecutionLimitsSchema
>;

function artifactAuthorityKey(artifact: CapabilityArtifactRef) {
  return `${artifact.object.ownerId}\0${artifact.object.namespace}\0${artifact.object.key}\0${artifact.digest}`;
}

function validateArtifactAuthority(
  ownerId: string,
  artifacts: readonly CapabilityArtifactRef[],
  context: z.core.$RefinementCtx,
  path: PropertyKey[],
) {
  const keys = new Set<string>();
  for (const [index, artifact] of artifacts.entries()) {
    if (artifact.object.ownerId !== ownerId) {
      context.addIssue({
        code: "custom",
        path: [...path, index, "object", "ownerId"],
        message: "capability artifacts must be owned by the grant owner",
      });
    }
    const key = artifactAuthorityKey(artifact);
    if (keys.has(key)) {
      context.addIssue({
        code: "custom",
        path: [...path, index],
        message: "capability artifact authority cannot contain duplicates",
      });
    }
    keys.add(key);
  }
}

export const nodeCapabilityJobManifestV1Schema = z
  .strictObject({
    schemaVersion: z.literal(1),
    operationId: boundedIdSchema,
    ownerId: boundedIdSchema,
    capability: capabilityKindSchema,
    purpose: capabilityPurposeSchema,
    offeringId: boundedIdSchema,
    offeringDigest: objectSha256Schema,
    configRevision: objectSha256Schema,
    inputs: z.array(capabilityArtifactRefSchema).max(256),
    requestJson: z.unknown(),
    requestDigest: objectSha256Schema,
    limits: nodeCapabilityExecutionLimitsSchema,
    egressPolicyDigest: objectSha256Schema,
  })
  .superRefine((manifest, context) => {
    validateArtifactAuthority(manifest.ownerId, manifest.inputs, context, [
      "inputs",
    ]);
  });
export type NodeCapabilityJobManifestV1 = z.infer<
  typeof nodeCapabilityJobManifestV1Schema
>;

/** Artifact-job request digests intentionally bind the normalized request JSON.
 * The manifest, artifacts, limits and execution lane are independently bound by
 * the signed invocation grant and the Node execution journal. */
export function nodeCapabilityJobRequestDigestPayload(
  manifest: NodeCapabilityJobManifestV1,
) {
  return manifest.requestJson;
}

export const nodeCapabilityRequestV1Schema = z
  .strictObject({
    schemaVersion: z.literal(1),
    operationId: boundedIdSchema,
    ownerId: boundedIdSchema,
    capability: capabilityKindSchema,
    purpose: capabilityPurposeSchema,
    offeringId: boundedIdSchema,
    offeringDigest: objectSha256Schema,
    configRevision: objectSha256Schema,
    requestDigest: objectSha256Schema,
    inputArtifacts: z.array(capabilityArtifactRefSchema).max(256),
    input: z.unknown(),
  })
  .superRefine((request, context) => {
    validateArtifactAuthority(
      request.ownerId,
      request.inputArtifacts,
      context,
      ["inputArtifacts"],
    );
  });
export type NodeCapabilityRequestV1 = z.infer<
  typeof nodeCapabilityRequestV1Schema
>;

export function nodeCapabilityRequestDigestPayload(
  request: NodeCapabilityRequestV1,
) {
  const { requestDigest: _requestDigest, ...payload } = request;
  return payload;
}

export const nodeCapabilityResultV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  operationId: boundedIdSchema,
  offeringId: boundedIdSchema,
  requestDigest: objectSha256Schema,
  outputDigest: objectSha256Schema,
  result: z.unknown(),
  outputArtifacts: z.array(capabilityArtifactRefSchema).max(256),
  usage: capabilityUsageSchema,
  providerRequestId: z.string().trim().min(1).max(512).nullable(),
});
export type NodeCapabilityResultV1 = z.infer<
  typeof nodeCapabilityResultV1Schema
>;

export function nodeCapabilityResultDigestPayload(
  result: NodeCapabilityResultV1,
) {
  return { result: result.result, outputArtifacts: result.outputArtifacts };
}

export const nodeCapabilityEventV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  operationId: boundedIdSchema,
  offeringId: boundedIdSchema,
  sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  type: z.enum(["acknowledged", "chunk", "usage", "completed"]),
  payload: z.unknown(),
});
export type NodeCapabilityEventV1 = z.infer<
  typeof nodeCapabilityEventV1Schema
>;

export const unsignedNodeCapabilityInvocationGrantClaimsSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    issuer: boundedIdSchema,
    audience: boundedIdSchema,
    subject: boundedIdSchema,
    ownerId: boundedIdSchema,
    nodeId: boundedIdSchema,
    operationId: boundedIdSchema,
    offeringId: boundedIdSchema,
    offeringDigest: objectSha256Schema,
    configRevision: objectSha256Schema,
    requestDigest: objectSha256Schema,
    inputArtifacts: z.array(capabilityArtifactRefSchema).max(256),
    limits: nodeCapabilityExecutionLimitsSchema,
    egressPolicyDigest: objectSha256Schema,
    notBefore: timestampSchema,
    expiresAt: timestampSchema,
    issuedAt: timestampSchema,
    jti: boundedIdSchema,
  })
  .superRefine((claims, context) => {
    validateArtifactAuthority(
      claims.ownerId,
      claims.inputArtifacts,
      context,
      ["inputArtifacts"],
    );
    const issuedAt = Date.parse(claims.issuedAt);
    const notBefore = Date.parse(claims.notBefore);
    const expiresAt = Date.parse(claims.expiresAt);
    const deadline = Date.parse(claims.limits.deadline);
    if (issuedAt > notBefore || notBefore >= expiresAt) {
      context.addIssue({
        code: "custom",
        path: ["notBefore"],
        message: "grant validity must satisfy issuedAt <= notBefore < expiresAt",
      });
    }
    if (deadline > expiresAt) {
      context.addIssue({
        code: "custom",
        path: ["limits", "deadline"],
        message: "execution deadline cannot outlive the grant",
      });
    }
  });
export type UnsignedNodeCapabilityInvocationGrantClaims = z.infer<
  typeof unsignedNodeCapabilityInvocationGrantClaimsSchema
>;

export const signedNodeCapabilityInvocationGrantSchema = z.strictObject({
  claims: unsignedNodeCapabilityInvocationGrantClaimsSchema,
  keyId: boundedIdSchema,
  signature: signatureSchema,
});
export type SignedNodeCapabilityInvocationGrant = z.infer<
  typeof signedNodeCapabilityInvocationGrantSchema
>;

export interface NodeCapabilityTransport {
  online(nodeId: string): Promise<boolean>;
  listCapabilityOfferings(input: {
    nodeId: string;
    ownerId: string;
  }): Promise<NodeCapabilityOffering[]>;
  invokeCapability(input: {
    nodeId: string;
    ownerId: string;
    grant: SignedNodeCapabilityInvocationGrant;
    request: NodeCapabilityRequestV1;
    signal?: AbortSignal;
  }): Promise<NodeCapabilityResultV1>;
  streamCapability(input: {
    nodeId: string;
    ownerId: string;
    grant: SignedNodeCapabilityInvocationGrant;
    request: NodeCapabilityRequestV1;
    signal?: AbortSignal;
  }): AsyncIterable<NodeCapabilityEventV1>;
  artifactJobCapability?(input: {
    nodeId: string;
    ownerId: string;
    grant: SignedNodeCapabilityInvocationGrant;
    manifest: NodeCapabilityJobManifestV1;
    signal?: AbortSignal;
  }): Promise<NodeCapabilityResultV1>;
}
