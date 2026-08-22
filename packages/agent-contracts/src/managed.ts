import { z } from "zod";
import { capabilityPlacementSchema } from "./node";

const boundedId = z.string().trim().min(1).max(256);
const timestamp = z.iso.datetime({ offset: true });

/** Exact base-10 quantities. Persisted accounting must never use IEEE floats. */
export const usageQuantitySchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)$/u, "expected an unsigned integer quantity");
export type UsageQuantity = z.infer<typeof usageQuantitySchema>;

export const positiveUsageQuantitySchema = usageQuantitySchema.refine(
  (value) => value !== "0",
  "expected a positive integer quantity",
);

export const signedUsageQuantitySchema = z
  .string()
  .regex(/^-?(?:0|[1-9]\d*)$/u, "expected an integer quantity");

export const usageUnitSchema = z.enum([
  "bytes",
  "pages",
  "seconds",
  "tokens",
  "characters",
  "units",
  "cpu-milliseconds",
  "memory-byte-seconds",
  "egress-bytes",
  "output-seconds",
  "concurrent",
]);
export type UsageUnit = z.infer<typeof usageUnitSchema>;

export const managedCapabilitySchema = z.enum([
  "storage.bytes",
  "ocr.pages",
  "transcription.seconds",
  "model.inputTokens",
  "model.outputTokens",
  "model.cachedInputTokens",
  "embedding.units",
  "tts.characters",
  "sandbox.cpuMillis",
  "sandbox.memoryByteSeconds",
  "sandbox.egressBytes",
  "video.outputSeconds",
]);
export type ManagedCapability = z.infer<typeof managedCapabilitySchema>;

export const capabilityEntitlementSchema = z.strictObject({
  enabled: z.boolean(),
  hardLimit: usageQuantitySchema.optional(),
  softLimit: usageQuantitySchema.optional(),
  unit: usageUnitSchema.optional(),
  concurrency: z.number().int().nonnegative().optional(),
  retentionDays: z.number().int().nonnegative().optional(),
});
export type CapabilityEntitlement = z.infer<
  typeof capabilityEntitlementSchema
>;

export const entitlementSnapshotV1Schema = z.strictObject({
  version: z.literal(1),
  id: boundedId,
  accountId: boundedId,
  revision: boundedId,
  plan: z.string().min(1).max(128),
  status: z.enum(["active", "grace", "restricted", "cancelled"]),
  period: z.strictObject({ startsAt: timestamp, endsAt: timestamp }),
  capabilities: z.record(managedCapabilitySchema, capabilityEntitlementSchema),
  source: z.enum(["free", "operator", "billing-provider", "self-host"]),
  issuedAt: timestamp,
});
export type EntitlementSnapshotV1 = z.infer<
  typeof entitlementSnapshotV1Schema
>;

export const entitlementDecisionV1Schema = z.strictObject({
  version: z.literal(1),
  decisionId: boundedId,
  accountId: boundedId,
  snapshotId: boundedId,
  snapshotRevision: boundedId,
  capability: managedCapabilitySchema,
  quantity: usageQuantitySchema,
  unit: usageUnitSchema,
  mode: z.enum(["shadow", "enforce"]),
  allowed: z.boolean(),
  wouldBlock: z.boolean(),
  reason: z.enum([
    "allowed",
    "capability-disabled",
    "hard-limit-exceeded",
    "emergency-disabled",
    "entitlement-restricted",
  ]),
  decidedAt: timestamp,
});
export type EntitlementDecisionV1 = z.infer<
  typeof entitlementDecisionV1Schema
>;

export const usageDirectionSchema = z.enum([
  "reserve",
  "consume",
  "release",
  "adjust",
]);
export type UsageDirection = z.infer<typeof usageDirectionSchema>;

export const usageEventV1Schema = z
  .strictObject({
    version: z.literal(1),
    id: boundedId,
    accountId: boundedId,
    userId: boundedId.optional(),
    capability: managedCapabilitySchema,
    quantity: signedUsageQuantitySchema,
    unit: usageUnitSchema,
    direction: usageDirectionSchema,
    idempotencyKey: boundedId,
    reservationId: boundedId.optional(),
    runId: boundedId.optional(),
    jobId: boundedId.optional(),
    provider: z.string().min(1).max(128).optional(),
    model: z.string().min(1).max(256).optional(),
    placement: capabilityPlacementSchema,
    pricingSnapshotId: boundedId.optional(),
    authoritative: z.boolean(),
    estimatorVersion: z.string().min(1).max(128).optional(),
    adjustment: z
      .strictObject({
        actorId: boundedId,
        reason: z.string().min(1).max(512),
        evidenceRef: z.string().min(1).max(1024).optional(),
      })
      .optional(),
    occurredAt: timestamp,
  })
  .superRefine((value, context) => {
    if (value.direction !== "adjust" && value.quantity.startsWith("-")) {
      context.addIssue({
        code: "custom",
        path: ["quantity"],
        message: "only adjustment events may carry a negative quantity",
      });
    }
    if (value.direction === "adjust" && !value.adjustment) {
      context.addIssue({
        code: "custom",
        path: ["adjustment"],
        message: "adjustments require an actor and reason",
      });
    }
  });
export type UsageEventV1 = z.infer<typeof usageEventV1Schema>;

export const usageReservationV1Schema = z.strictObject({
  version: z.literal(1),
  id: boundedId,
  accountId: boundedId,
  userId: boundedId.optional(),
  capability: managedCapabilitySchema,
  unit: usageUnitSchema,
  reservedQuantity: usageQuantitySchema,
  consumedQuantity: usageQuantitySchema,
  releasedQuantity: usageQuantitySchema,
  status: z.enum(["reserved", "settled", "cancelled", "expired"]),
  idempotencyKey: boundedId,
  decisionId: boundedId,
  entitlementSnapshotId: boundedId,
  placement: capabilityPlacementSchema,
  runId: boundedId.optional(),
  jobId: boundedId.optional(),
  expiresAt: timestamp,
  createdAt: timestamp,
  settledAt: timestamp.optional(),
});
export type UsageReservationV1 = z.infer<typeof usageReservationV1Schema>;

export const pricingSnapshotV1Schema = z.strictObject({
  version: z.literal(1),
  id: boundedId,
  provider: z.string().min(1).max(128),
  model: z.string().min(1).max(256).optional(),
  capability: managedCapabilitySchema,
  unit: usageUnitSchema,
  currency: z.string().regex(/^[A-Z]{3}$/u),
  /** Minor currency units per `quantityScale`, stored as an exact integer. */
  rateMinor: signedUsageQuantitySchema,
  quantityScale: positiveUsageQuantitySchema,
  effectiveAt: timestamp,
  retiredAt: timestamp.optional(),
  source: z.enum(["operator", "provider"]),
});
export type PricingSnapshotV1 = z.infer<typeof pricingSnapshotV1Schema>;

export const placementDeletionStateSchema = z.enum([
  "requested",
  "core_tombstoned",
  "pending_remote_deletion",
  "verified_deleted",
  "revoked_unreachable",
  "user_action_required",
  "failed",
]);
export type PlacementDeletionState = z.infer<
  typeof placementDeletionStateSchema
>;

export const deletionReceiptV1Schema = z.strictObject({
  version: z.literal(1),
  requestId: boundedId,
  placement: capabilityPlacementSchema,
  verifierKind: z.enum(["managed-adapter", "user-node", "external"]),
  nonce: boundedId,
  manifestDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  deletedObjectClasses: z.array(z.string().min(1).max(128)).max(64),
  completedAt: timestamp,
  keyId: boundedId.optional(),
  signature: z.string().min(32).max(1024).optional(),
});
export type DeletionReceiptV1 = z.infer<typeof deletionReceiptV1Schema>;

export interface BillingAdapter {
  createCheckout(input: {
    accountId: string;
    offerReference: string;
    returnUrl: string;
    state: string;
  }): Promise<{ reference: string; url: string }>;
  createPortal(input: {
    accountId: string;
    returnUrl: string;
    state: string;
  }): Promise<{ reference: string; url: string }>;
  verifyWebhook(
    raw: Uint8Array,
    headers: Headers,
  ): Promise<{ externalId: string; type: string; payload: unknown }>;
  getSubscription(reference: string): Promise<{
    reference: string;
    status: string;
    currentPeriodEndsAt?: string;
  }>;
}
