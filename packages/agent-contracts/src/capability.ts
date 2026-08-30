import { z } from "zod";
import { objectSha256Schema, ownedObjectRefSchema } from "./storage";

const boundedIdSchema = z.string().trim().min(1).max(256);
const boundedRevisionSchema = z.string().trim().min(1).max(256);
const boundedProviderSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9._-]*$/u);
const timestampSchema = z.iso.datetime({ offset: true });

/** RFC-8785-like canonical JSON for already validated contract values. */
export function canonicalCapabilityJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("canonical capability JSON rejects non-finite numbers");
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalCapabilityJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => {
        if (object[key] === undefined) {
          throw new TypeError("canonical capability JSON rejects undefined values");
        }
        return `${JSON.stringify(key)}:${canonicalCapabilityJson(object[key])}`;
      })
      .join(",")}}`;
  }
  throw new TypeError(`canonical capability JSON rejects ${typeof value}`);
}

export const capabilityKindSchema = z.enum([
  "language.generate",
  "embedding.generate",
  "rerank.score",
  "speech.transcribe",
  "speech.synthesize",
  "document.ocr",
  "document.extract",
  "image.generate",
  "video.generate",
]);
export type CapabilityKind = z.infer<typeof capabilityKindSchema>;

export const capabilityPurposeSchema = z
  .string()
  .trim()
  .min(3)
  .max(128)
  .regex(/^[a-z][a-z0-9.-]*$/u);
export type CapabilityPurpose = z.infer<typeof capabilityPurposeSchema>;

export const capabilityPurposePatternSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^(?:\*|[a-z][a-z0-9.-]*(?:\.\*)?)$/u);
export type CapabilityPurposePattern = z.infer<
  typeof capabilityPurposePatternSchema
>;

export const capabilityPlacementKindSchema = z.enum([
  "core",
  "managed",
  "direct-byok",
  "node",
  "full-self-host",
]);
export type CapabilityPlacementKind = z.infer<
  typeof capabilityPlacementKindSchema
>;

export const capabilityOfferingPlacementSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("core"),
    instanceId: boundedIdSchema,
  }),
  z.strictObject({
    kind: z.literal("managed"),
    pool: boundedIdSchema,
    region: z.string().trim().min(1).max(128),
  }),
  z.strictObject({
    kind: z.literal("direct-byok"),
    origin: z.url().max(2_048),
  }),
  z.strictObject({
    kind: z.literal("node"),
    nodeId: boundedIdSchema,
    configRevision: objectSha256Schema,
  }),
  z.strictObject({
    kind: z.literal("full-self-host"),
    instanceId: boundedIdSchema,
  }),
]);
export type CapabilityOfferingPlacement = z.infer<
  typeof capabilityOfferingPlacementSchema
>;

export const dataEgressClassSchema = z.enum([
  "none",
  "owner-node",
  "avermate-managed",
  "external-provider",
]);
export type DataEgressClass = z.infer<typeof dataEgressClassSchema>;

export const dataHandlingDescriptorSchema = z.strictObject({
  egress: dataEgressClassSchema,
  providerName: z.string().trim().min(1).max(128).nullable(),
  region: z.string().trim().min(1).max(128).nullable(),
  disclosureRevision: boundedRevisionSchema,
  retentionDisclosureRevision: boundedRevisionSchema.nullable(),
  trainingDisclosureRevision: boundedRevisionSchema.nullable(),
  requiresExplicitConsent: z.boolean(),
});
export type DataHandlingDescriptor = z.infer<
  typeof dataHandlingDescriptorSchema
>;

export const capabilityArtifactRefSchema = z.strictObject({
  object: ownedObjectRefSchema,
  digest: objectSha256Schema,
  byteSize: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  mimeType: z.string().trim().min(1).max(255),
});
export type CapabilityArtifactRef = z.infer<
  typeof capabilityArtifactRefSchema
>;

export const languageGenerationSpecificationSchema = z.strictObject({
  inputModalities: z
    .array(z.enum(["text", "image", "pdf", "audio", "video"]))
    .min(1)
    .max(5),
  contextWindow: z.union([
    z.number().int().positive().max(100_000_000),
    z.literal("unknown"),
  ]),
  maximumOutputTokens: z.union([
    z.number().int().positive().max(100_000_000),
    z.literal("unknown"),
  ]),
  tools: z.boolean(),
  parallelTools: z.boolean(),
  structuredOutput: z.boolean(),
  streaming: z.boolean(),
  reasoningSummary: z.boolean(),
  opaqueReasoningContinuation: z.boolean(),
  cachedUsage: z.boolean(),
});
export type LanguageGenerationSpecification = z.infer<
  typeof languageGenerationSpecificationSchema
>;

export const embeddingSpecificationSchema = z.strictObject({
  modalities: z
    .array(z.enum(["text", "image", "pdf-page", "audio", "video"]))
    .min(1)
    .max(5),
  dimensions: z.number().int().positive().max(65_536),
  normalization: z.enum(["provider-unit", "client-unit", "none"]),
  maximumInputs: z.number().int().positive().max(100_000),
  maximumTokensPerInput: z.number().int().positive().max(10_000_000),
  preprocessingRevision: boundedRevisionSchema,
  embeddingSpaceId: boundedIdSchema,
});
export type EmbeddingSpecification = z.infer<
  typeof embeddingSpecificationSchema
>;

export const rerankSpecificationSchema = z.strictObject({
  modalities: z.array(z.enum(["text", "image"])).min(1).max(2),
  maxCandidates: z.number().int().positive().max(100_000),
  maxTokensPerCandidate: z.number().int().positive().max(10_000_000),
  languages: z.union([
    z.array(z.string().trim().min(2).max(35)).max(512),
    z.enum(["multilingual", "unknown"]),
  ]),
  scoreSemantics: z.enum([
    "relative",
    "probability-like",
    "provider-specific",
  ]),
});
export type RerankSpecification = z.infer<typeof rerankSpecificationSchema>;

export const transcriptionSpecificationSchema = z.strictObject({
  modes: z.array(z.enum(["batch", "streaming"])).min(1).max(2),
  timestamps: z.array(z.enum(["none", "segment", "word"])).min(1).max(3),
  diarization: z.boolean(),
  languageDetection: z.boolean(),
  languageHint: z.boolean(),
  vocabularyHints: z.boolean(),
  inputMimeTypes: z.array(z.string().trim().min(1).max(255)).min(1).max(256),
  maxBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  maxDurationSeconds: z.number().positive().max(31_536_000),
  maximumSpeakers: z.number().int().positive().max(1_000).nullable(),
});
export type TranscriptionSpecification = z.infer<
  typeof transcriptionSpecificationSchema
>;

export const speechSynthesisSpecificationSchema = z.strictObject({
  streaming: z.boolean(),
  inputLanguages: z.union([
    z.array(z.string().trim().min(2).max(35)).max(512),
    z.literal("unknown"),
  ]),
  outputFormats: z
    .array(
      z.strictObject({
        container: z.enum(["mp3", "wav", "ogg", "raw"]),
        codec: z.string().trim().min(1).max(64),
        sampleRates: z
          .array(z.number().int().positive().max(768_000))
          .min(1)
          .max(32),
      }),
    )
    .min(1)
    .max(64),
  speedControl: z.boolean(),
  pitchControl: z.boolean(),
  styleControl: z.boolean(),
  alignment: z.array(z.enum(["none", "word", "character"])).min(1).max(3),
  voiceCatalogue: z.enum(["static", "remote", "manual"]),
  voiceCloning: z.boolean(),
});
export type SpeechSynthesisSpecification = z.infer<
  typeof speechSynthesisSpecificationSchema
>;

export const ocrSpecificationSchema = z.strictObject({
  inputMimeTypes: z.array(z.string().trim().min(1).max(255)).min(1).max(256),
  nativePdf: z.boolean(),
  scannedPdf: z.boolean(),
  images: z.boolean(),
  handwriting: z.boolean(),
  layout: z.boolean(),
  tables: z.boolean(),
  formulas: z.boolean(),
  embeddedImages: z.boolean(),
  boundingBoxes: z.enum(["none", "normalized-page"]),
  confidence: z.boolean(),
  maxPages: z.number().int().positive().max(100_000),
  maxBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
export type OcrSpecification = z.infer<typeof ocrSpecificationSchema>;

export const documentExtractionSpecificationSchema = z.strictObject({
  inputMimeTypes: z.array(z.string().trim().min(1).max(255)).min(1).max(256),
  deterministic: z.boolean(),
  preservesSourceLocators: z.boolean(),
  supportsAssets: z.boolean(),
  maxBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
export type DocumentExtractionSpecification = z.infer<
  typeof documentExtractionSpecificationSchema
>;

export const imageGenerationSpecificationSchema = z.strictObject({
  inputModalities: z.array(z.enum(["text", "image"])).min(1).max(2),
  outputMimeTypes: z.array(z.string().trim().min(1).max(255)).min(1).max(32),
  maximumImages: z.number().int().positive().max(256),
});
export type ImageGenerationSpecification = z.infer<
  typeof imageGenerationSpecificationSchema
>;

export const videoGenerationSpecificationSchema = z.strictObject({
  inputModalities: z.array(z.enum(["text", "image", "video"])).min(1).max(3),
  outputMimeTypes: z.array(z.string().trim().min(1).max(255)).min(1).max(32),
  maximumDurationSeconds: z.number().positive().max(86_400),
});
export type VideoGenerationSpecification = z.infer<
  typeof videoGenerationSpecificationSchema
>;

const offeringBase = {
  schemaVersion: z.literal(1),
  id: boundedIdSchema,
  connectionId: boundedIdSchema,
  connectionRevision: z.number().int().positive(),
  pluginId: boundedProviderSchema,
  pluginVersion: boundedRevisionSchema,
  adapterRevision: boundedRevisionSchema,
  capabilityProtocolVersion: z.literal(1),
  provider: boundedProviderSchema,
  modelId: boundedIdSchema,
  modelRevision: boundedRevisionSchema,
  placement: capabilityOfferingPlacementSchema,
  dataHandling: dataHandlingDescriptorSchema,
  limits: z.strictObject({
    maxInputBytes: z.number().int().positive().nullable(),
    maxOutputBytes: z.number().int().positive().nullable(),
    maxBatchSize: z.number().int().positive().nullable(),
    maxConcurrency: z.number().int().positive().nullable(),
  }),
  supportedLanguages: z.union([
    z.array(z.string().trim().min(2).max(35)).max(512),
    z.literal("unknown"),
  ]),
  healthCheckKind: z.enum(["active-probe", "passive", "node-attested"]),
} as const;

export const capabilityOfferingSchema = z.discriminatedUnion("capability", [
  z.strictObject({
    ...offeringBase,
    capability: z.literal("language.generate"),
    specification: languageGenerationSpecificationSchema,
  }),
  z.strictObject({
    ...offeringBase,
    capability: z.literal("embedding.generate"),
    specification: embeddingSpecificationSchema,
  }),
  z.strictObject({
    ...offeringBase,
    capability: z.literal("rerank.score"),
    specification: rerankSpecificationSchema,
  }),
  z.strictObject({
    ...offeringBase,
    capability: z.literal("speech.transcribe"),
    specification: transcriptionSpecificationSchema,
  }),
  z.strictObject({
    ...offeringBase,
    capability: z.literal("speech.synthesize"),
    specification: speechSynthesisSpecificationSchema,
  }),
  z.strictObject({
    ...offeringBase,
    capability: z.literal("document.ocr"),
    specification: ocrSpecificationSchema,
  }),
  z.strictObject({
    ...offeringBase,
    capability: z.literal("document.extract"),
    specification: documentExtractionSpecificationSchema,
  }),
  z.strictObject({
    ...offeringBase,
    capability: z.literal("image.generate"),
    specification: imageGenerationSpecificationSchema,
  }),
  z.strictObject({
    ...offeringBase,
    capability: z.literal("video.generate"),
    specification: videoGenerationSpecificationSchema,
  }),
]);
export type CapabilityOffering = z.infer<typeof capabilityOfferingSchema>;
/** Public descriptors contain immutable routing metadata and never credentials. */
export const capabilityOfferingPublicDescriptorSchema =
  capabilityOfferingSchema;
export type CapabilityOfferingPublicDescriptor = CapabilityOffering;
export type CapabilityOfferingSnapshot<K extends CapabilityKind> = Extract<
  CapabilityOffering,
  { capability: K }
>;

export const providerConnectionOwnerKindSchema = z.enum([
  "instance",
  "user",
  "node",
]);
export type ProviderConnectionOwnerKind = z.infer<
  typeof providerConnectionOwnerKindSchema
>;

export const providerConnectionStatusSchema = z.enum([
  "draft",
  "validating",
  "ready",
  "degraded",
  "disabled",
  "invalid",
  "deleted",
]);
export type ProviderConnectionStatus = z.infer<
  typeof providerConnectionStatusSchema
>;

export const providerConnectionPublicSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: boundedIdSchema,
  ownerKind: providerConnectionOwnerKindSchema,
  ownerId: boundedIdSchema,
  pluginId: boundedProviderSchema,
  pluginVersion: boundedRevisionSchema,
  displayName: z.string().trim().min(1).max(256),
  placement: capabilityOfferingPlacementSchema,
  configVersion: z.number().int().positive(),
  config: z.record(z.string().min(1).max(128), z.json()),
  configDigest: objectSha256Schema,
  status: providerConnectionStatusSchema,
  revision: z.number().int().positive(),
  lastValidatedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  deletedAt: timestampSchema.nullable(),
});
export type ProviderConnectionPublicSnapshot = z.infer<
  typeof providerConnectionPublicSnapshotSchema
>;

export const capabilityPolicyScopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("instance"), id: boundedIdSchema }),
  z.strictObject({ kind: z.literal("managed-plan"), id: boundedIdSchema }),
  z.strictObject({ kind: z.literal("user"), id: boundedIdSchema }),
  z.strictObject({ kind: z.literal("project"), id: boundedIdSchema }),
  z.strictObject({ kind: z.literal("workflow"), id: boundedIdSchema }),
]);
export type CapabilityPolicyScope = z.infer<
  typeof capabilityPolicyScopeSchema
>;

export const capabilityPolicyModeSchema = z.enum([
  "disabled",
  "automatic",
  "pinned",
  "ordered",
]);
export type CapabilityPolicyMode = z.infer<typeof capabilityPolicyModeSchema>;

export const capabilityPolicyConstraintsSchema = z.strictObject({
  requiredFeatures: z.array(z.string().trim().min(1).max(128)).max(256),
  allowedPlacements: z.array(capabilityPlacementKindSchema).min(1).max(5),
  allowedProviders: z.array(boundedProviderSchema).max(256).nullable(),
  deniedProviders: z.array(boundedProviderSchema).max(256),
  maximumDataEgress: dataEgressClassSchema,
  allowPrivacyEscalationOnFallback: z.boolean(),
  maximumEstimatedCostMinor: z.number().int().nonnegative().nullable(),
  preferredLatencyClass: z.enum(["interactive", "normal", "batch"]),
  requireUserCredential: z.boolean(),
  allowManagedCredential: z.boolean(),
  requireHealthy: z.boolean(),
});
export type CapabilityPolicyConstraints = z.infer<
  typeof capabilityPolicyConstraintsSchema
>;

export const capabilityPolicySchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: boundedIdSchema,
    ownerId: boundedIdSchema,
    scope: capabilityPolicyScopeSchema,
    capability: capabilityKindSchema,
    purposePattern: capabilityPurposePatternSchema,
    mode: capabilityPolicyModeSchema,
    primaryOfferingId: boundedIdSchema.nullable(),
    fallbackOfferingIds: z.array(boundedIdSchema).max(32),
    constraints: capabilityPolicyConstraintsSchema,
    revision: z.number().int().positive(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    deletedAt: timestampSchema.nullable(),
  })
  .superRefine((policy, context) => {
    if (policy.mode === "disabled") {
      if (policy.primaryOfferingId || policy.fallbackOfferingIds.length > 0) {
        context.addIssue({
          code: "custom",
          path: ["mode"],
          message: "disabled policies cannot select offerings",
        });
      }
      return;
    }
    if (
      (policy.mode === "pinned" || policy.mode === "ordered") &&
      !policy.primaryOfferingId
    ) {
      context.addIssue({
        code: "custom",
        path: ["primaryOfferingId"],
        message: `${policy.mode} policies require a primary offering`,
      });
    }
    if (policy.mode === "pinned" && policy.fallbackOfferingIds.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["fallbackOfferingIds"],
        message: "pinned policies cannot define fallbacks",
      });
    }
    const route = [
      ...(policy.primaryOfferingId ? [policy.primaryOfferingId] : []),
      ...policy.fallbackOfferingIds,
    ];
    if (new Set(route).size !== route.length) {
      context.addIssue({
        code: "custom",
        path: ["fallbackOfferingIds"],
        message: "policy routes must not contain duplicate offerings",
      });
    }
  });
export type CapabilityPolicy = z.infer<typeof capabilityPolicySchema>;

export const frozenCapabilityRouteSchema = z.strictObject({
  offeringId: boundedIdSchema,
  offeringDescriptorDigest: objectSha256Schema,
  connectionId: boundedIdSchema,
  connectionRevision: z.number().int().positive(),
  credentialSlots: z
    .array(
      z.strictObject({
        slot: z.string().trim().min(1).max(128),
        expectedVersion: z.number().int().positive(),
      }),
    )
    .max(32),
  consentGrants: z
    .array(
      z.strictObject({
        id: boundedIdSchema,
        expectedRevision: z.number().int().positive(),
      }),
    )
    .max(64),
  pluginId: boundedProviderSchema,
  pluginVersion: boundedRevisionSchema,
  adapterRevision: boundedRevisionSchema,
  modelId: boundedIdSchema,
  modelRevision: boundedRevisionSchema,
  placement: capabilityOfferingPlacementSchema,
  dataEgress: dataEgressClassSchema,
  pricingSnapshotId: boundedIdSchema.nullable(),
});
export type FrozenCapabilityRoute = z.infer<
  typeof frozenCapabilityRouteSchema
>;

export const frozenCapabilityRoutePlanSchema = z
  .strictObject({
    version: z.literal(1),
    operationId: boundedIdSchema,
    ownerId: boundedIdSchema,
    capability: capabilityKindSchema,
    purpose: capabilityPurposeSchema,
    policySnapshotDigest: objectSha256Schema,
    primary: frozenCapabilityRouteSchema,
    fallbacks: z.array(frozenCapabilityRouteSchema).max(32),
    constraints: capabilityPolicyConstraintsSchema,
    createdAt: timestampSchema,
    digest: objectSha256Schema,
  })
  .superRefine((plan, context) => {
    const ids = [plan.primary, ...plan.fallbacks].map(
      (route) => route.offeringId,
    );
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        path: ["fallbacks"],
        message: "frozen routes must not repeat an offering",
      });
    }
  });
export type FrozenCapabilityRoutePlan = z.infer<
  typeof frozenCapabilityRoutePlanSchema
>;

export const providerSecretSlotDescriptorSchema = z.strictObject({
  name: z.string().trim().min(1).max(128),
  required: z.boolean(),
  kind: z.enum([
    "bearer-token",
    "api-key",
    "client-secret",
    "private-key",
    "opaque",
  ]),
  validation: z.enum(["none", "format", "remote-minimal-call", "node-local"]),
});
export type ProviderSecretSlotDescriptor = z.infer<
  typeof providerSecretSlotDescriptorSchema
>;

export const providerPluginManifestSchema = z.strictObject({
  apiVersion: z.literal("avermate.provider-plugin/v1"),
  id: boundedProviderSchema,
  version: boundedRevisionSchema,
  displayName: z.string().trim().min(1).max(256),
  executionTrust: z.enum([
    "core-reviewed",
    "node-reviewed",
    "node-user-controlled",
  ]),
  capabilities: z.array(capabilityKindSchema).min(1).max(32),
  connectionSchemaVersion: z.number().int().positive(),
  configurationFields: z
    .array(
      z.strictObject({
        key: z
          .string()
          .trim()
          .min(1)
          .max(128)
          .regex(/^[a-z][a-zA-Z0-9]*$/u),
        label: z.string().trim().min(1).max(256),
        kind: z.enum(["text", "url", "select", "boolean", "number"]),
        required: z.boolean(),
        options: z
          .array(
            z.strictObject({
              value: z.string().trim().min(1).max(256),
              label: z.string().trim().min(1).max(256),
            }),
          )
          .max(256),
        placeholder: z.string().max(512).nullable(),
        help: z.string().trim().min(1).max(1_024),
      }),
    )
    .max(64),
  secretSlots: z.array(providerSecretSlotDescriptorSchema).max(32),
});
export type ProviderPluginManifest = z.infer<
  typeof providerPluginManifestSchema
>;
