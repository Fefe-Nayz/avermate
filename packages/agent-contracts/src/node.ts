import { z } from "zod";
import { modelDescriptorSchema } from "./model-gateway";
import { objectSha256Schema, ownedObjectRefSchema } from "./storage";

export const AVERMATE_NODE_PROTOCOL = "avermate-node/2" as const;
export const AVERMATE_NODE_PROTOCOL_MAJOR = 2 as const;
export const MAX_NODE_CONTROL_FRAME_BYTES = 256 * 1024;
export const MAX_NODE_CONTROL_BUFFER_BYTES = 4 * 1024 * 1024;
export const MAX_NODE_STREAM_FRAME_BYTES = 64 * 1024;
export const MAX_NODE_STREAM_BUFFER_BYTES = 2 * 1024 * 1024;

const boundedIdSchema = z.string().min(1).max(256);
const digestSchema = objectSha256Schema;
const timestampSchema = z.iso.datetime({ offset: true });
const signatureSchema = z
  .string()
  .min(32)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/u, "expected a base64url signature");

export const nodeCapabilityIdSchema = z.enum([
  "storage",
  "conversations",
  "retrieval",
  "models",
  "jobs",
  "sandbox",
  "renderers",
  "school-connectors",
]);
export type NodeCapabilityId = z.infer<typeof nodeCapabilityIdSchema>;

export const nodeLimitSnapshotSchema = z.strictObject({
  maxConcurrentJobs: z.number().int().nonnegative().max(10_000),
  maxControlFrameBytes: z
    .number()
    .int()
    .positive()
    .max(4 * 1024 * 1024),
  maxStreamFrameBytes: z
    .number()
    .int()
    .positive()
    .max(1024 * 1024),
  maxBufferedStreamBytes: z
    .number()
    .int()
    .positive()
    .max(64 * 1024 * 1024),
  storageQuotaBytes: z.number().int().nonnegative(),
  storageUsedBytes: z.number().int().nonnegative(),
});
export type NodeLimitSnapshot = z.infer<typeof nodeLimitSnapshotSchema>;

const versionOneSchema = z.literal(1);
// Unknown capability names are preserved so a previous-minor Core can verify
// the exact signed payload and then ignore capabilities it does not understand.
export const nodeCapabilityFeaturesSchema = z.looseObject({
  storage: z
    .strictObject({
      version: versionOneSchema,
      maxObjectBytes: z.number().int().positive(),
      multipart: z.boolean(),
      directTransfer: z.boolean(),
      encryptionModes: z.array(z.enum(["transport-tls", "e2e-v1"])).max(8),
    })
    .optional(),
  conversations: z
    .strictObject({
      version: versionOneSchema,
      search: z.boolean(),
      maxBytes: z.number().int().positive(),
    })
    .optional(),
  retrieval: z
    .strictObject({
      version: versionOneSchema,
      lexical: z.literal(true),
      vectorSpaces: z
        .array(
          z.strictObject({
            model: z.string().min(1).max(256),
            dimensions: z.array(z.number().int().positive()).min(1).max(16),
          }),
        )
        .max(64),
    })
    .optional(),
  models: z
    .strictObject({
      version: versionOneSchema,
      models: z.array(modelDescriptorSchema).max(256),
    })
    .optional(),
  jobs: z
    .strictObject({
      version: versionOneSchema,
      kinds: z.array(z.string().min(1).max(128)).max(256),
      maxConcurrent: z.number().int().positive().max(10_000),
    })
    .optional(),
  sandbox: z
    .strictObject({
      version: versionOneSchema,
      isolation: z.enum(["none", "runc", "gvisor", "kata", "microvm"]),
      workspaceSnapshots: z.boolean(),
      runtimeCheckpoints: z.boolean(),
      browser: z.boolean(),
      gpu: z.boolean(),
    })
    .optional(),
  renderers: z
    .strictObject({
      version: versionOneSchema,
      kinds: z.array(z.string().min(1).max(128)).max(256),
      imageDigests: z.array(digestSchema).max(256),
    })
    .optional(),
  schoolConnectors: z
    .strictObject({
      version: versionOneSchema,
      providers: z.array(z.string().min(1).max(128)).max(32),
    })
    .optional(),
});
export type NodeCapabilityFeatures = z.infer<
  typeof nodeCapabilityFeaturesSchema
>;

export const unsignedNodeCapabilityManifestV2Schema = z.strictObject({
  protocol: z.literal(AVERMATE_NODE_PROTOCOL),
  nodeId: boundedIdSchema,
  build: z.string().min(1).max(128),
  configRevision: digestSchema,
  features: nodeCapabilityFeaturesSchema,
  limits: nodeLimitSnapshotSchema,
  issuedAt: timestampSchema,
  expiresAt: timestampSchema,
  keyId: boundedIdSchema,
});
export type UnsignedNodeCapabilityManifestV2 = z.infer<
  typeof unsignedNodeCapabilityManifestV2Schema
>;

export const nodeCapabilityManifestV2Schema =
  unsignedNodeCapabilityManifestV2Schema.extend({ signature: signatureSchema });
export type NodeCapabilityManifestV2 = z.infer<
  typeof nodeCapabilityManifestV2Schema
>;

export const nodeHealthStateSchema = z.enum([
  "configured",
  "supported",
  "healthy",
  "degraded",
  "offline",
]);
export const nodeCapabilityHealthSchema = z.strictObject({
  capability: nodeCapabilityIdSchema,
  state: nodeHealthStateSchema,
  lastSuccessAt: timestampSchema.nullable(),
  lastErrorAt: timestampSchema.nullable(),
  safeErrorCode: z.string().min(1).max(128).nullable(),
  queued: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
});
export type NodeCapabilityHealth = z.infer<typeof nodeCapabilityHealthSchema>;

export const nodePairingCodeSchema = z
  .string()
  .regex(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/u);
export const nodePairingOfferSchema = z.strictObject({
  protocol: z.literal(AVERMATE_NODE_PROTOCOL),
  pairingAttemptId: boundedIdSchema,
  nodeId: boundedIdSchema,
  publicSigningKey: z.string().min(32).max(512),
  keyId: boundedIdSchema,
  fingerprint: z.string().regex(/^[A-Z2-7]{16,64}$/u),
  codeHash: digestSchema,
  expiresAt: timestampSchema,
});
export type NodePairingOffer = z.infer<typeof nodePairingOfferSchema>;

export const nodePairingBindingSchema = z.strictObject({
  pairingAttemptId: boundedIdSchema,
  nodeId: boundedIdSchema,
  userId: boundedIdSchema,
  protocolMajor: z.literal(AVERMATE_NODE_PROTOCOL_MAJOR),
  publicSigningKey: z.string().min(32).max(512),
  fingerprint: z.string().regex(/^[A-Z2-7]{16,64}$/u),
  credentialId: boundedIdSchema,
  credentialExpiresAt: timestampSchema,
  pairedAt: timestampSchema,
});
export type NodePairingBinding = z.infer<typeof nodePairingBindingSchema>;

export const nodeGrantLimitsSchema = z.strictObject({
  byteLimit: z.number().int().nonnegative(),
  tokenLimit: z.number().int().nonnegative(),
  costMinorLimit: z.number().int().nonnegative(),
  deadline: timestampSchema,
});
export type NodeGrantLimits = z.infer<typeof nodeGrantLimitsSchema>;

export const nodeCapabilityGrantClaimsSchema = z.strictObject({
  version: z.literal(1),
  issuer: boundedIdSchema,
  audience: boundedIdSchema,
  subject: boundedIdSchema,
  nodeId: boundedIdSchema,
  userId: boundedIdSchema,
  actorKind: z.enum(["embedded-agent", "mcp", "system", "user"]),
  actorClientId: boundedIdSchema.optional(),
  jobId: boundedIdSchema,
  jti: boundedIdSchema,
  capabilities: z.array(z.string().min(1).max(128)).min(1).max(64),
  resources: z.array(ownedObjectRefSchema).max(256),
  limits: nodeGrantLimitsSchema,
  notBefore: timestampSchema,
  expiresAt: timestampSchema,
  issuedAt: timestampSchema,
});
export type NodeCapabilityGrantClaims = z.infer<
  typeof nodeCapabilityGrantClaimsSchema
>;

export const signedNodeCapabilityGrantSchema = z.strictObject({
  claims: nodeCapabilityGrantClaimsSchema,
  keyId: boundedIdSchema,
  signature: signatureSchema,
});
export type SignedNodeCapabilityGrant = z.infer<
  typeof signedNodeCapabilityGrantSchema
>;

export const nodeArtifactRefSchema = z.strictObject({
  object: ownedObjectRefSchema,
  digest: digestSchema,
  byteSize: z.number().int().nonnegative(),
  mimeType: z.string().min(1).max(255),
});
export type NodeArtifactRef = z.infer<typeof nodeArtifactRefSchema>;

export const nodeJobLimitsSchema = z.strictObject({
  cpuMillis: z.number().int().positive(),
  memoryBytes: z.number().int().positive(),
  inputBytes: z.number().int().nonnegative(),
  outputBytes: z.number().int().nonnegative(),
  deadline: timestampSchema,
});
export type NodeJobLimits = z.infer<typeof nodeJobLimitsSchema>;

export const unsignedNodeJobV1Schema = z.strictObject({
  id: boundedIdSchema,
  principalRef: z.strictObject({
    userId: boundedIdSchema,
    nodeId: boundedIdSchema,
    actorKind: z.enum(["embedded-agent", "mcp", "system", "user"]),
    actorClientId: boundedIdSchema.optional(),
  }),
  kind: z.string().min(1).max(128),
  capabilityVersion: z.number().int().positive(),
  inputRefs: z.array(nodeArtifactRefSchema).max(256),
  policyRef: boundedIdSchema,
  limits: nodeJobLimitsSchema,
  idempotencyKey: boundedIdSchema,
});
export type UnsignedNodeJobV1 = z.infer<typeof unsignedNodeJobV1Schema>;

export const nodeJobV1Schema = unsignedNodeJobV1Schema.extend({
  envelopeDigest: digestSchema,
  grant: signedNodeCapabilityGrantSchema,
});
export type NodeJobV1 = z.infer<typeof nodeJobV1Schema>;

export const nodeJobStageSchema = z.enum([
  "offered",
  "leased",
  "provisioning",
  "running",
  "snapshotting",
  "adopting",
  "cancel-requested",
  "cancelled",
  "completed",
  "failed",
  "inspect-required",
]);
export type NodeJobStage = z.infer<typeof nodeJobStageSchema>;

export const nodeJobEventSchema = z.strictObject({
  jobId: boundedIdSchema,
  sequence: z.number().int().positive(),
  eventId: boundedIdSchema,
  stage: nodeJobStageSchema,
  emittedAt: timestampSchema,
  terminal: z.boolean(),
  progress: z
    .strictObject({
      numerator: z.number().nonnegative(),
      denominator: z.number().positive(),
      unit: z.string().min(1).max(64),
      message: z.string().min(1).max(512),
    })
    .optional(),
  safeErrorCode: z.string().min(1).max(128).optional(),
  resultManifest: z.array(nodeArtifactRefSchema).max(256).optional(),
});
export type NodeJobEvent = z.infer<typeof nodeJobEventSchema>;

export const nodeControlFrameSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("hello"),
    frameId: boundedIdSchema,
    manifest: nodeCapabilityManifestV2Schema,
  }),
  z.strictObject({
    type: z.literal("health"),
    frameId: boundedIdSchema,
    nodeId: boundedIdSchema,
    health: z.array(nodeCapabilityHealthSchema).max(32),
  }),
  z.strictObject({
    type: z.literal("job-offer"),
    frameId: boundedIdSchema,
    job: nodeJobV1Schema,
  }),
  z.strictObject({
    type: z.literal("job-cancel"),
    frameId: boundedIdSchema,
    nodeId: boundedIdSchema,
    jobId: boundedIdSchema,
    reason: z.string().min(1).max(512),
  }),
  z.strictObject({
    type: z.literal("job-ack"),
    frameId: boundedIdSchema,
    nodeId: boundedIdSchema,
    jobId: boundedIdSchema,
    sequence: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal("shutdown"),
    frameId: boundedIdSchema,
    nodeId: boundedIdSchema,
    reason: z.string().min(1).max(512),
  }),
]);
export type NodeControlFrame = z.infer<typeof nodeControlFrameSchema>;

export const nodeStreamFrameSchema = z.strictObject({
  streamId: boundedIdSchema,
  runId: boundedIdSchema,
  sequence: z.number().int().positive(),
  ack: z.number().int().nonnegative(),
  kind: z.enum(["event", "cancel", "end"]),
  payload: z.string().max(MAX_NODE_STREAM_FRAME_BYTES),
  terminal: z.boolean(),
});
export type NodeStreamFrame = z.infer<typeof nodeStreamFrameSchema>;

export const capabilityPlacementSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("core"), providerId: boundedIdSchema }),
  z.strictObject({
    kind: z.literal("node"),
    nodeId: boundedIdSchema,
    providerId: boundedIdSchema,
  }),
  z.strictObject({ kind: z.literal("managed"), providerId: boundedIdSchema }),
  z.strictObject({ kind: z.literal("byok"), providerId: boundedIdSchema }),
]);
export type CapabilityPlacement = z.infer<typeof capabilityPlacementSchema>;

export const capabilityRequestSchema = z.strictObject({
  userId: boundedIdSchema,
  capability: nodeCapabilityIdSchema,
  selected: capabilityPlacementSchema,
  durablePlacement: capabilityPlacementSchema.optional(),
  requiredCapabilityVersion: z.number().int().positive(),
  requiredIsolation: z
    .enum(["none", "runc", "gvisor", "kata", "microvm"])
    .optional(),
  requiredRendererDigest: digestSchema.optional(),
  expectedInputBytes: z.number().int().nonnegative().default(0),
  allowDataTransfer: z.boolean().default(false),
  fallbackChain: z.array(capabilityPlacementSchema).max(8).default([]),
});
export type CapabilityRequest = z.infer<typeof capabilityRequestSchema>;
export type CapabilityRequestInput = z.input<typeof capabilityRequestSchema>;

export const routingReasonSchema = z.enum([
  "selected-placement-ready",
  "durable-placement-required",
  "explicit-fallback",
]);
export const capabilityRoutingDecisionSchema = z.strictObject({
  placement: capabilityPlacementSchema,
  reason: routingReasonSchema,
  fallbackUsed: z.boolean(),
  transferRequired: z.boolean(),
  inspectedAt: timestampSchema,
  manifestConfigRevision: digestSchema.optional(),
});
export type CapabilityRoutingDecision = z.infer<
  typeof capabilityRoutingDecisionSchema
>;

export type RoutedOperation = {
  request: CapabilityRequest;
  operationId: string;
  payload: unknown;
};
export type RoutedHandle = {
  operationId: string;
  decision: CapabilityRoutingDecision;
  placementHandle: string;
};
export interface ExecutionRouter {
  resolve(input: CapabilityRequest): Promise<CapabilityRoutingDecision>;
  dispatch(input: RoutedOperation): Promise<RoutedHandle>;
}

export const remoteDeletionStateSchema = z.enum([
  "pending_remote_deletion",
  "verified_deleted",
  "revoked_unreachable",
  "user_action_required",
]);
export type RemoteDeletionState = z.infer<typeof remoteDeletionStateSchema>;

export const unsignedNodeDeletionManifestSchema = z.strictObject({
  version: z.literal(1),
  nodeId: boundedIdSchema,
  userId: boundedIdSchema,
  nonce: boundedIdSchema,
  refs: z.array(nodeArtifactRefSchema).min(1).max(1_000),
  issuedAt: timestampSchema,
  expiresAt: timestampSchema,
});
export type UnsignedNodeDeletionManifest = z.infer<
  typeof unsignedNodeDeletionManifestSchema
>;

export const nodeDeletionManifestSchema =
  unsignedNodeDeletionManifestSchema.extend({
    digest: digestSchema,
    keyId: boundedIdSchema,
    signature: signatureSchema,
  });
export type NodeDeletionManifest = z.infer<typeof nodeDeletionManifestSchema>;

export const unsignedNodeDeletionReceiptSchema = z.strictObject({
  nodeId: boundedIdSchema,
  nonce: boundedIdSchema,
  manifestDigest: digestSchema,
  deletedCount: z.number().int().nonnegative(),
  verifiedAt: timestampSchema,
});
export type UnsignedNodeDeletionReceipt = z.infer<
  typeof unsignedNodeDeletionReceiptSchema
>;

export const nodeDeletionReceiptSchema =
  unsignedNodeDeletionReceiptSchema.extend({
    keyId: boundedIdSchema,
    signature: signatureSchema,
  });
export type NodeDeletionReceipt = z.infer<typeof nodeDeletionReceiptSchema>;
