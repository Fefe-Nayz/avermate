import { z } from "zod";
import { modelDescriptorSchema } from "./model-gateway";
import { sandboxProfileIdSchema } from "./sandbox";
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
  "mcp",
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
export const nodeJobExecutionProfileSchema = z.strictObject({
  /** Versioned job kind exactly as advertised in jobs.kinds. */
  kind: z.string().min(3).max(128).regex(/^[a-z0-9.-]+@[1-9]\d*$/u),
  sandboxProfileId: sandboxProfileIdSchema,
  profileVersion: z.string().min(1).max(128),
  imageDigest: digestSchema,
  egressPolicyDigest: digestSchema,
});
export type NodeJobExecutionProfile = z.infer<
  typeof nodeJobExecutionProfileSchema
>;

const nodeJobsCapabilitySchema = z
  .strictObject({
    version: versionOneSchema,
    kinds: z.array(z.string().min(1).max(128)).max(256),
    maxConcurrent: z.number().int().positive().max(10_000),
    executionProfiles: z.array(nodeJobExecutionProfileSchema).max(256).optional(),
  })
  .superRefine((jobs, context) => {
    const advertised = new Set(jobs.kinds);
    const profiled = new Set<string>();
    for (const [index, profile] of (jobs.executionProfiles ?? []).entries()) {
      if (!advertised.has(profile.kind) || profiled.has(profile.kind)) {
        context.addIssue({
          code: "custom",
          path: ["executionProfiles", index, "kind"],
          message:
            "execution profile kinds must be unique and present in jobs.kinds",
        });
      }
      profiled.add(profile.kind);
    }
  });

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
      providers: z
        .array(
          z.strictObject({
            purpose: z.enum(["embedding", "rerank"]),
            provider: z.string().min(1).max(128),
            model: z.string().min(1).max(256),
            modelRevision: z.string().min(1).max(256),
            dimensions: z.number().int().positive().max(65_536).optional(),
            imageDigest: digestSchema.optional(),
            runtimeRevision: z.string().min(1).max(256).optional(),
          }),
        )
        .max(16)
        .optional(),
    })
    .optional(),
  models: z
    .strictObject({
      version: versionOneSchema,
      models: z.array(modelDescriptorSchema).max(256),
      revisions: z
        .record(z.string().min(1).max(256), z.string().min(1).max(256))
        .optional(),
    })
    .optional(),
  jobs: nodeJobsCapabilitySchema.optional(),
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
  mcp: z
    .strictObject({
      version: versionOneSchema,
      transports: z.array(z.literal("streamable-http")).length(1),
      maxCatalogueTools: z.number().int().positive().max(500),
      maxRequestBytes: z.number().int().positive().max(256 * 1024),
      maxResponseBytes: z.number().int().positive().max(4 * 1024 * 1024),
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

export const unsignedNodePairingRegistrationProofSchema = z.strictObject({
  protocol: z.literal(AVERMATE_NODE_PROTOCOL),
  pairingAttemptId: boundedIdSchema,
  nodeId: boundedIdSchema,
  keyId: boundedIdSchema,
  offerDigest: digestSchema,
  manifestDigest: digestSchema,
  nonce: boundedIdSchema,
  issuedAt: timestampSchema,
});
export const nodePairingRegistrationProofSchema =
  unsignedNodePairingRegistrationProofSchema.extend({ signature: signatureSchema });
export const nodePairingRegistrationSchema = z.strictObject({
  offer: nodePairingOfferSchema,
  manifest: nodeCapabilityManifestV2Schema,
  proof: nodePairingRegistrationProofSchema,
});
export type NodePairingRegistration = z.infer<
  typeof nodePairingRegistrationSchema
>;

export const unsignedNodeCredentialDeliveryProofSchema = z.strictObject({
  protocol: z.literal(AVERMATE_NODE_PROTOCOL),
  action: z.enum(["deliver", "ack"]),
  nodeId: boundedIdSchema,
  pairingAttemptId: boundedIdSchema.optional(),
  credentialIds: z.array(boundedIdSchema).max(8).default([]),
  nonce: boundedIdSchema,
  issuedAt: timestampSchema,
});
export const nodeCredentialDeliveryProofSchema =
  unsignedNodeCredentialDeliveryProofSchema.extend({ signature: signatureSchema });
export type NodeCredentialDeliveryProof = z.infer<
  typeof nodeCredentialDeliveryProofSchema
>;

export const nodeCredentialDeliverySchema = z.strictObject({
  nodeId: boundedIdSchema,
  coreGrantSigningKey: z
    .strictObject({
      keyId: boundedIdSchema,
      publicSigningKey: z.string().min(32).max(512),
    })
    .optional(),
  credentials: z
    .array(
      z.strictObject({
        id: boundedIdSchema,
        kind: z.enum(["relay", "capability"]),
        generation: z.number().int().positive(),
        credential: z.string().min(32).max(8_192),
        activeFrom: timestampSchema,
        expiresAt: timestampSchema,
        overlapUntil: timestampSchema.nullable(),
      }),
    )
    .min(1)
    .max(8),
});
export type NodeCredentialDelivery = z.infer<
  typeof nodeCredentialDeliverySchema
>;

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
  /** Required by relay operations; omitted only by durable NodeJob envelopes. */
  operation: z.string().min(1).max(128).optional(),
  /** Canonical digest of the exact relay request, including config revision. */
  requestDigest: digestSchema.optional(),
  /** Signed revision fence for relay operations. */
  configRevision: digestSchema.optional(),
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
  /** Exact signed runtime fence selected by Core for sandbox-backed jobs. */
  executionProfile: nodeJobExecutionProfileSchema.optional(),
  inputRefs: z.array(nodeArtifactRefSchema).max(256),
  /**
   * Complete object authority for the job. `inputRefs` stays the small set of
   * entry manifests while this list also covers immutable objects referenced
   * by those manifests. Older envelopes omit it and retain the exact
   * inputRefs-only authority model.
   */
  resourceRefs: z.array(ownedObjectRefSchema).min(1).max(256).optional(),
  policyRef: boundedIdSchema,
  limits: nodeJobLimitsSchema,
  idempotencyKey: boundedIdSchema,
}).superRefine((job, context) => {
  if (!job.resourceRefs) return;
  const resources = new Set(
    job.resourceRefs.map((resource) =>
      `${resource.ownerId}\0${resource.namespace}\0${resource.key}`,
    ),
  );
  if (resources.size !== job.resourceRefs.length) {
    context.addIssue({
      code: "custom",
      path: ["resourceRefs"],
      message: "job resource authority cannot contain duplicate objects",
    });
  }
  for (const [index, artifact] of job.inputRefs.entries()) {
    const key = `${artifact.object.ownerId}\0${artifact.object.namespace}\0${artifact.object.key}`;
    if (!resources.has(key)) {
      context.addIssue({
        code: "custom",
        path: ["inputRefs", index, "object"],
        message: "every entry manifest must be included in resource authority",
      });
    }
  }
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
    type: z.literal("relay-ready"),
    frameId: boundedIdSchema,
    nodeId: boundedIdSchema,
    protocolMajor: z.literal(AVERMATE_NODE_PROTOCOL_MAJOR),
    connectionEpoch: z.number().int().positive(),
    credentialGeneration: z.number().int().positive(),
    acceptedConfigRevision: digestSchema,
    heartbeatIntervalMs: z.number().int().min(1_000).max(5 * 60_000),
  }),
  z.strictObject({
    type: z.literal("heartbeat"),
    frameId: boundedIdSchema,
    nodeId: boundedIdSchema,
    connectionEpoch: z.number().int().positive(),
    sentAt: timestampSchema,
  }),
  z.strictObject({
    type: z.literal("heartbeat-ack"),
    frameId: boundedIdSchema,
    nodeId: boundedIdSchema,
    connectionEpoch: z.number().int().positive(),
    sentAt: timestampSchema,
    receivedAt: timestampSchema,
  }),
  z.strictObject({
    type: z.literal("job-event"),
    frameId: boundedIdSchema,
    nodeId: boundedIdSchema,
    connectionEpoch: z.number().int().positive(),
    event: nodeJobEventSchema,
  }),
  z.strictObject({
    type: z.literal("operation-request"),
    frameId: boundedIdSchema,
    nodeId: boundedIdSchema,
    connectionEpoch: z.number().int().positive(),
    operationId: boundedIdSchema,
    capability: nodeCapabilityIdSchema,
    capabilityVersion: z.number().int().positive(),
    operation: z.string().min(1).max(128),
    configRevision: digestSchema,
    deadline: timestampSchema,
    grant: signedNodeCapabilityGrantSchema,
    payload: z.unknown(),
  }),
  z.strictObject({
    type: z.literal("operation-result"),
    frameId: boundedIdSchema,
    nodeId: boundedIdSchema,
    connectionEpoch: z.number().int().positive(),
    operationId: boundedIdSchema,
    sequence: z.number().int().positive(),
    ok: z.boolean(),
    payload: z.unknown().optional(),
    safeErrorCode: z.string().min(1).max(128).optional(),
    retryable: z.boolean().default(false),
    terminal: z.boolean(),
  }),
  z.strictObject({
    type: z.literal("operation-cancel"),
    frameId: boundedIdSchema,
    nodeId: boundedIdSchema,
    connectionEpoch: z.number().int().positive(),
    operationId: boundedIdSchema,
    reason: z.string().min(1).max(512),
  }),
  z.strictObject({
    type: z.literal("shutdown"),
    frameId: boundedIdSchema,
    nodeId: boundedIdSchema,
    reason: z.string().min(1).max(512),
  }),
]).superRefine((frame, context) => {
  if (frame.type !== "operation-result") return;
  if (frame.ok && frame.safeErrorCode !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["safeErrorCode"],
      message: "successful operation results cannot contain an error code",
    });
  }
  if (!frame.ok && !frame.safeErrorCode) {
    context.addIssue({
      code: "custom",
      path: ["safeErrorCode"],
      message: "failed operation results require a safe error code",
    });
  }
  if (!frame.ok && !frame.terminal) {
    context.addIssue({
      code: "custom",
      path: ["terminal"],
      message: "failed operation results must be terminal",
    });
  }
});
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
