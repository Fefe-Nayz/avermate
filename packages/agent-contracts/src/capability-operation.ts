import { z } from "zod";
import {
  capabilityArtifactRefSchema,
  capabilityKindSchema,
  capabilityOfferingSchema,
  capabilityPurposeSchema,
  dataEgressClassSchema,
  frozenCapabilityRoutePlanSchema,
  providerConnectionPublicSnapshotSchema,
  providerPluginManifestSchema,
  type CapabilityKind,
  type CapabilityOffering,
  type CapabilityOfferingSnapshot,
  type ProviderConnectionPublicSnapshot,
  type ProviderPluginManifest,
} from "./capability";
import { objectSha256Schema } from "./storage";

const boundedIdSchema = z.string().trim().min(1).max(256);
const timestampSchema = z.iso.datetime({ offset: true });
const finiteNumberSchema = z.number().finite();

export const capabilityUsageUnitSchema = z.enum([
  "request",
  "input-token",
  "output-token",
  "input-byte",
  "output-byte",
  "reasoning-token",
  "cached-input-token",
  "character",
  "audio-second",
  "video-second",
  "page",
  "image",
  "megapixel",
  "candidate",
  "vector",
]);
export type CapabilityUsageUnit = z.infer<typeof capabilityUsageUnitSchema>;

export const capabilityUsageItemSchema = z.strictObject({
  unit: capabilityUsageUnitSchema,
  quantity: z
    .string()
    .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,12})?$/u)
    .max(64),
  source: z.enum(["provider", "measured", "estimated", "unknown"]),
});
export type CapabilityUsageItem = z.infer<typeof capabilityUsageItemSchema>;

export const capabilityUsageSchema = z.strictObject({
  version: z.literal(1),
  items: z.array(capabilityUsageItemSchema).max(256),
  cost: z.strictObject({
    amountMinor: z
      .string()
      .regex(/^(?:0|[1-9]\d*)$/u)
      .max(64)
      .nullable(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/u)
      .nullable(),
    authoritative: z.boolean(),
    pricingSnapshotId: boundedIdSchema.nullable(),
  }),
});
export type CapabilityUsage = z.infer<typeof capabilityUsageSchema>;

export const emptyCapabilityUsage = (): CapabilityUsage => ({
  version: 1,
  items: [],
  cost: {
    amountMinor: null,
    currency: null,
    authoritative: false,
    pricingSnapshotId: null,
  },
});

export const boundedProviderMetadataSchema = z
  .record(
    z.string().trim().min(1).max(128),
    z.union([
      z.string().max(4_096),
      z.number().finite(),
      z.boolean(),
      z.null(),
    ]),
  )
  .refine((value) => Object.keys(value).length <= 64, {
    message: "provider metadata is limited to 64 scalar entries",
  });
export type BoundedProviderMetadata = z.infer<
  typeof boundedProviderMetadataSchema
>;

const languagePartSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("text"), text: z.string().max(4_000_000) }),
  z.strictObject({
    type: z.literal("artifact"),
    artifact: capabilityArtifactRefSchema,
  }),
]);

const MAX_LANGUAGE_TOOL_SCHEMA_BYTES = 256 * 1_024;
const MAX_LANGUAGE_TOOL_SCHEMA_NODES = 10_000;
const MAX_LANGUAGE_TOOL_SCHEMA_DEPTH = 32;

function isBoundedJsonSchema(value: unknown) {
  let nodes = 0;
  const visit = (entry: unknown, depth: number): boolean => {
    nodes += 1;
    if (
      nodes > MAX_LANGUAGE_TOOL_SCHEMA_NODES ||
      depth > MAX_LANGUAGE_TOOL_SCHEMA_DEPTH
    ) {
      return false;
    }
    if (
      entry === null ||
      typeof entry === "boolean" ||
      typeof entry === "string"
    ) {
      return typeof entry !== "string" || entry.length <= 64 * 1_024;
    }
    if (typeof entry === "number") return Number.isFinite(entry);
    if (Array.isArray(entry)) {
      return (
        entry.length <= 10_000 && entry.every((item) => visit(item, depth + 1))
      );
    }
    if (typeof entry !== "object") return false;
    const prototype = Object.getPrototypeOf(entry);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const entries = Object.entries(entry as Record<string, unknown>);
    return (
      entries.length <= 10_000 &&
      entries.every(
        ([key, item]) => key.length <= 1_024 && visit(item, depth + 1),
      )
    );
  };
  if (!visit(value, 0)) return false;
  try {
    return (
      new TextEncoder().encode(JSON.stringify(value)).byteLength <=
      MAX_LANGUAGE_TOOL_SCHEMA_BYTES
    );
  } catch {
    return false;
  }
}

export const languageToolV1Schema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/u),
  description: z.string().max(4_096),
  inputSchema: z
    .record(z.string().max(1_024), z.unknown())
    .refine(isBoundedJsonSchema, "Tool input schema must be bounded JSON"),
});
export type LanguageToolV1 = z.infer<typeof languageToolV1Schema>;

export const languageGenerationRequestV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  messages: z
    .array(
      z.strictObject({
        role: z.enum(["system", "user", "assistant", "tool"]),
        parts: z.array(languagePartSchema).min(1).max(512),
      }),
    )
    .min(1)
    .max(10_000),
  tools: z
    .array(languageToolV1Schema)
    .max(128)
    .default([])
    .refine(
      (tools) => new Set(tools.map((tool) => tool.name)).size === tools.length,
      "Tool names must be unique",
    ),
  maximumOutputTokens: z.number().int().positive().max(10_000_000),
  temperature: z.number().min(0).max(2).optional(),
  responseFormat: z.enum(["text", "json"]).default("text"),
});
export type LanguageGenerationRequestV1 = z.infer<
  typeof languageGenerationRequestV1Schema
>;

export const languageGenerationResultV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  text: z.string().max(16_000_000),
  /** Durable semantic stream payload for idempotent tool-call replay. */
  toolCalls: z
    .array(
      z.strictObject({
        callId: boundedIdSchema,
        toolName: languageToolV1Schema.shape.name,
        argumentsJson: z
          .string()
          .max(256 * 1_024)
          .refine((value) => {
            try {
              return isBoundedJsonSchema(JSON.parse(value));
            } catch {
              return false;
            }
          }, "Tool arguments must be bounded valid JSON"),
      }),
    )
    .max(128)
    .refine(
      (calls) =>
        new Set(calls.map((call) => call.callId)).size === calls.length,
      "Tool call IDs must be unique",
    )
    .optional(),
  finishReason: z.enum([
    "stop",
    "length",
    "tool-call",
    "content-filter",
    "error",
    "unknown",
  ]),
  usage: capabilityUsageSchema,
  providerMetadata: boundedProviderMetadataSchema.nullable(),
});
export type LanguageGenerationResultV1 = z.infer<
  typeof languageGenerationResultV1Schema
>;

export const embeddingInputV1Schema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("text"),
    contentHash: objectSha256Schema,
    text: z.string().max(4_000_000),
    purpose: z.enum(["query", "document"]),
    title: z.string().max(2_048).optional(),
  }),
  z.strictObject({
    type: z.literal("image"),
    contentHash: objectSha256Schema,
    assetRef: capabilityArtifactRefSchema,
    mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  }),
  z.strictObject({
    type: z.literal("pdf-page"),
    contentHash: objectSha256Schema,
    assetRef: capabilityArtifactRefSchema,
    page: z.number().int().positive().max(100_000),
  }),
  z.strictObject({
    type: z.literal("audio"),
    contentHash: objectSha256Schema,
    assetRef: capabilityArtifactRefSchema,
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
  }),
  z.strictObject({
    type: z.literal("video"),
    contentHash: objectSha256Schema,
    assetRef: capabilityArtifactRefSchema,
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
  }),
]);
export type EmbeddingInputV1 = z.infer<typeof embeddingInputV1Schema>;

export const embeddingRequestV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  inputs: z.array(embeddingInputV1Schema).min(1).max(100_000),
});
export type EmbeddingRequestV1 = z.infer<typeof embeddingRequestV1Schema>;

export const embeddingResultV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  vectors: z
    .array(z.array(finiteNumberSchema).min(1).max(65_536))
    .min(1)
    .max(100_000),
  dimensions: z.number().int().positive().max(65_536),
  embeddingSpaceId: boundedIdSchema,
  usage: capabilityUsageSchema,
  providerMetadata: boundedProviderMetadataSchema.nullable(),
});
export type EmbeddingResultV1 = z.infer<typeof embeddingResultV1Schema>;

export const rerankRequestV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  query: z.string().min(1).max(4_000_000),
  candidates: z
    .array(
      z.strictObject({
        id: boundedIdSchema,
        text: z.string().min(1).max(4_000_000),
      }),
    )
    .min(1)
    .max(100_000),
  topK: z.number().int().positive().max(100_000),
});
export type RerankRequestV1 = z.infer<typeof rerankRequestV1Schema>;

export const rerankResultV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  scores: z
    .array(
      z.strictObject({
        id: boundedIdSchema,
        score: finiteNumberSchema,
        rank: z.number().int().nonnegative(),
      }),
    )
    .max(100_000),
  usage: capabilityUsageSchema,
  providerMetadata: boundedProviderMetadataSchema.nullable(),
});
export type RerankResultV1 = z.infer<typeof rerankResultV1Schema>;

export const transcriptionRequestV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  source: capabilityArtifactRefSchema,
  mimeType: z.string().trim().min(1).max(255),
  language: z.string().trim().min(2).max(35).optional(),
  timestamps: z.enum(["none", "segment", "word"]),
  diarization: z.boolean(),
  vocabulary: z.array(z.string().trim().min(1).max(256)).max(10_000).optional(),
  maximumSeconds: z.number().positive().max(31_536_000),
});
export type TranscriptionRequestV1 = z.infer<
  typeof transcriptionRequestV1Schema
>;

const timedSpeechSchema = z
  .strictObject({
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().nonnegative(),
  })
  .refine((value) => value.endMs >= value.startMs, {
    message: "speech timestamp end must not precede start",
  });

export const transcriptionResultV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  text: z.string().max(16_000_000),
  language: z.union([z.string().trim().min(2).max(35), z.literal("unknown")]),
  durationSeconds: z.union([
    z.number().nonnegative().max(31_536_000),
    z.literal("unknown"),
  ]),
  segments: z
    .array(
      timedSpeechSchema.extend({
        id: boundedIdSchema,
        text: z.string().max(4_000_000),
        speakerId: boundedIdSchema.nullable(),
        confidence: z.number().min(0).max(1).nullable(),
      }),
    )
    .max(1_000_000),
  words: z
    .array(
      timedSpeechSchema.extend({
        word: z.string().max(4_096),
        speakerId: boundedIdSchema.nullable(),
        confidence: z.number().min(0).max(1).nullable(),
      }),
    )
    .max(5_000_000)
    .nullable(),
  usage: capabilityUsageSchema,
  providerMetadata: boundedProviderMetadataSchema.nullable(),
});
export type TranscriptionResultV1 = z.infer<typeof transcriptionResultV1Schema>;

export const speechSynthesisRequestV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  text: z.string().min(1).max(4_000_000),
  voice: z.discriminatedUnion("mode", [
    z.strictObject({
      mode: z.literal("exact"),
      voiceId: boundedIdSchema,
      voiceRevision: z.string().trim().min(1).max(256).optional(),
    }),
    z.strictObject({ mode: z.literal("profile"), profileId: boundedIdSchema }),
  ]),
  language: z.string().trim().min(2).max(35).optional(),
  speed: z.number().positive().max(4).optional(),
  output: z.strictObject({
    container: z.enum(["mp3", "wav", "ogg"]),
    sampleRate: z.number().int().positive().max(768_000).optional(),
  }),
  alignment: z.enum(["none", "word", "character"]),
});
export type SpeechSynthesisRequestV1 = z.infer<
  typeof speechSynthesisRequestV1Schema
>;

export const speechSynthesisResultV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  audio: capabilityArtifactRefSchema,
  mimeType: z.string().trim().min(1).max(255),
  durationSeconds: z.union([
    z.number().nonnegative().max(31_536_000),
    z.literal("unknown"),
  ]),
  voice: z.strictObject({
    providerVoiceId: boundedIdSchema,
    revision: z.string().trim().min(1).max(256).nullable(),
  }),
  alignment: z
    .array(timedSpeechSchema.extend({ text: z.string().min(1).max(4_096) }))
    .max(5_000_000)
    .nullable(),
  usage: capabilityUsageSchema,
  providerMetadata: boundedProviderMetadataSchema.nullable(),
});
export type SpeechSynthesisResultV1 = z.infer<
  typeof speechSynthesisResultV1Schema
>;

export const ocrRequestV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  source: capabilityArtifactRefSchema,
  mimeType: z.string().trim().min(1).max(255),
  pages: z
    .array(z.number().int().positive().max(100_000))
    .max(100_000)
    .optional(),
  languageHints: z.array(z.string().trim().min(2).max(35)).max(512).optional(),
  requestedFeatures: z.strictObject({
    markdown: z.boolean(),
    blocks: z.boolean(),
    tables: z.boolean(),
    formulas: z.boolean(),
    images: z.boolean(),
  }),
  maximumPages: z.number().int().positive().max(100_000),
});
export type OcrRequestV1 = z.infer<typeof ocrRequestV1Schema>;

export const ocrResultV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  pages: z
    .array(
      z.strictObject({
        page: z.number().int().positive().max(100_000),
        markdown: z.string().max(16_000_000).nullable(),
        plainText: z.string().max(16_000_000).nullable(),
        blocks: z
          .array(
            z.strictObject({
              id: boundedIdSchema,
              kind: z.enum([
                "paragraph",
                "heading",
                "table",
                "formula",
                "image",
                "list",
                "other",
              ]),
              text: z.string().max(4_000_000).nullable(),
              bbox: z
                .tuple([
                  z.number().min(0).max(1),
                  z.number().min(0).max(1),
                  z.number().min(0).max(1),
                  z.number().min(0).max(1),
                ])
                .nullable(),
              confidence: z.number().min(0).max(1).nullable(),
              assetRef: capabilityArtifactRefSchema.nullable(),
            }),
          )
          .max(1_000_000),
      }),
    )
    .max(100_000),
  pageCount: z.number().int().nonnegative().max(100_000),
  language: z.union([z.string().trim().min(2).max(35), z.literal("unknown")]),
  usage: capabilityUsageSchema,
  providerMetadata: boundedProviderMetadataSchema.nullable(),
});
export type OcrResultV1 = z.infer<typeof ocrResultV1Schema>;

export const documentExtractionRequestV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  source: capabilityArtifactRefSchema,
  mimeType: z.string().trim().min(1).max(255),
  maximumBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
export type DocumentExtractionRequestV1 = z.infer<
  typeof documentExtractionRequestV1Schema
>;

const sourceLocatorSchema = z.strictObject({
  kind: z.enum(["page", "slide", "sheet", "section", "offset"]),
  value: z.string().trim().min(1).max(2_048),
});

export const documentExtractionResultV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  document: z.strictObject({
    title: z.string().max(2_048).nullable(),
    language: z.string().trim().min(2).max(35).nullable(),
    sections: z
      .array(
        z.strictObject({
          headingPath: z.array(z.string().max(2_048)).max(64),
          markdown: z.string().max(16_000_000),
          sourceLocator: sourceLocatorSchema,
        }),
      )
      .max(1_000_000),
    assets: z
      .array(
        z.strictObject({
          ref: capabilityArtifactRefSchema,
          role: z.enum(["inline-image", "attachment", "thumbnail"]),
          sourceLocator: sourceLocatorSchema,
        }),
      )
      .max(100_000),
  }),
  extractionPath: z
    .array(
      z.strictObject({
        stage: z.string().trim().min(1).max(128),
        implementation: z.string().trim().min(1).max(256),
        revision: z.string().trim().min(1).max(256),
      }),
    )
    .min(1)
    .max(64),
  usage: capabilityUsageSchema,
  providerMetadata: boundedProviderMetadataSchema.nullable(),
});
export type DocumentExtractionResultV1 = z.infer<
  typeof documentExtractionResultV1Schema
>;

export const imageGenerationRequestV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  prompt: z.string().min(1).max(4_000_000),
  references: z.array(capabilityArtifactRefSchema).max(64),
  count: z.number().int().positive().max(256),
  outputMimeType: z.string().trim().min(1).max(255),
});
export type ImageGenerationRequestV1 = z.infer<
  typeof imageGenerationRequestV1Schema
>;

export const imageGenerationResultV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  images: z.array(capabilityArtifactRefSchema).min(1).max(256),
  usage: capabilityUsageSchema,
  providerMetadata: boundedProviderMetadataSchema.nullable(),
});
export type ImageGenerationResultV1 = z.infer<
  typeof imageGenerationResultV1Schema
>;

export const videoGenerationRequestV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  prompt: z.string().min(1).max(4_000_000),
  references: z.array(capabilityArtifactRefSchema).max(64),
  maximumDurationSeconds: z.number().positive().max(86_400),
  outputMimeType: z.string().trim().min(1).max(255),
});
export type VideoGenerationRequestV1 = z.infer<
  typeof videoGenerationRequestV1Schema
>;

export const videoGenerationResultV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  video: capabilityArtifactRefSchema,
  durationSeconds: z.number().nonnegative().max(86_400),
  usage: capabilityUsageSchema,
  providerMetadata: boundedProviderMetadataSchema.nullable(),
});
export type VideoGenerationResultV1 = z.infer<
  typeof videoGenerationResultV1Schema
>;

export interface CapabilityRequestMap {
  "language.generate": LanguageGenerationRequestV1;
  "embedding.generate": EmbeddingRequestV1;
  "rerank.score": RerankRequestV1;
  "speech.transcribe": TranscriptionRequestV1;
  "speech.synthesize": SpeechSynthesisRequestV1;
  "document.ocr": OcrRequestV1;
  "document.extract": DocumentExtractionRequestV1;
  "image.generate": ImageGenerationRequestV1;
  "video.generate": VideoGenerationRequestV1;
}

export interface CapabilityResultMap {
  "language.generate": LanguageGenerationResultV1;
  "embedding.generate": EmbeddingResultV1;
  "rerank.score": RerankResultV1;
  "speech.transcribe": TranscriptionResultV1;
  "speech.synthesize": SpeechSynthesisResultV1;
  "document.ocr": OcrResultV1;
  "document.extract": DocumentExtractionResultV1;
  "image.generate": ImageGenerationResultV1;
  "video.generate": VideoGenerationResultV1;
}

export const capabilityRequestSchemas = Object.freeze({
  "language.generate": languageGenerationRequestV1Schema,
  "embedding.generate": embeddingRequestV1Schema,
  "rerank.score": rerankRequestV1Schema,
  "speech.transcribe": transcriptionRequestV1Schema,
  "speech.synthesize": speechSynthesisRequestV1Schema,
  "document.ocr": ocrRequestV1Schema,
  "document.extract": documentExtractionRequestV1Schema,
  "image.generate": imageGenerationRequestV1Schema,
  "video.generate": videoGenerationRequestV1Schema,
} satisfies Record<CapabilityKind, z.ZodType>);

export const capabilityResultSchemas = Object.freeze({
  "language.generate": languageGenerationResultV1Schema,
  "embedding.generate": embeddingResultV1Schema,
  "rerank.score": rerankResultV1Schema,
  "speech.transcribe": transcriptionResultV1Schema,
  "speech.synthesize": speechSynthesisResultV1Schema,
  "document.ocr": ocrResultV1Schema,
  "document.extract": documentExtractionResultV1Schema,
  "image.generate": imageGenerationResultV1Schema,
  "video.generate": videoGenerationResultV1Schema,
} satisfies Record<CapabilityKind, z.ZodType>);

export const capabilityErrorCodeSchema = z.enum([
  "AUTHENTICATION_REQUIRED",
  "CREDENTIAL_INVALID",
  "CONSENT_REQUIRED",
  "CAPABILITY_UNAVAILABLE",
  "UNSUPPORTED_INPUT",
  "INPUT_TOO_LARGE",
  "OUTPUT_TOO_LARGE",
  "RATE_LIMITED",
  "QUOTA_EXCEEDED",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_TIMEOUT",
  "PROVIDER_MALFORMED_RESPONSE",
  "CONTENT_FILTERED",
  "CANCELLED",
  "POLICY_CHANGED",
  "CREDENTIAL_CHANGED",
  "INSPECT_REQUIRED",
  "INTERNAL_ERROR",
]);
export type CapabilityErrorCode = z.infer<typeof capabilityErrorCodeSchema>;

export const capabilityErrorSchema = z.strictObject({
  version: z.literal(1),
  code: capabilityErrorCodeSchema,
  message: z.string().trim().min(1).max(1_024),
  retryable: z.boolean(),
  ambiguous: z.boolean(),
  providerRequestId: z.string().trim().min(1).max(512).nullable(),
  safeDiagnostic: boundedProviderMetadataSchema.nullable(),
});
export type CapabilityError = z.infer<typeof capabilityErrorSchema>;

export const capabilityOperationStateSchema = z.enum([
  "reserved",
  "routing",
  "ready",
  "dispatching",
  "acknowledged",
  "waiting-provider",
  "completed",
  "failed",
  "cancelled",
  "inspect-required",
]);
export type CapabilityOperationState = z.infer<
  typeof capabilityOperationStateSchema
>;

export const capabilityOperationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: boundedIdSchema,
  ownerId: boundedIdSchema,
  capability: capabilityKindSchema,
  purpose: capabilityPurposeSchema,
  inputDigest: objectSha256Schema,
  idempotencyKey: boundedIdSchema,
  policySnapshot: z.json(),
  policySnapshotDigest: objectSha256Schema,
  routePlan: frozenCapabilityRoutePlanSchema.nullable(),
  routePlanDigest: objectSha256Schema.nullable(),
  state: capabilityOperationStateSchema,
  result: z.json().nullable(),
  resultDigest: objectSha256Schema.nullable(),
  safeErrorCode: capabilityErrorCodeSchema.nullable(),
  revision: z.number().int().positive(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  completedAt: timestampSchema.nullable(),
});
export type CapabilityOperation = z.infer<typeof capabilityOperationSchema>;

export const capabilityAttemptStateSchema = z.enum([
  "reserved",
  "dispatching",
  "acknowledged",
  "waiting-provider",
  "completed",
  "failed",
  "cancelled",
  "inspect-required",
]);
export type CapabilityAttemptState = z.infer<
  typeof capabilityAttemptStateSchema
>;

export const capabilityAttemptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: boundedIdSchema,
  operationId: boundedIdSchema,
  ordinal: z.number().int().nonnegative().max(10_000),
  offeringId: boundedIdSchema,
  requestDigest: objectSha256Schema,
  state: capabilityAttemptStateSchema,
  providerRequestId: z.string().trim().min(1).max(512).nullable(),
  credentialVersion: z.number().int().positive().nullable(),
  consentRevision: z.number().int().positive().nullable(),
  errorClass: capabilityErrorCodeSchema.nullable(),
  retryable: z.boolean(),
  safeDiagnostic: boundedProviderMetadataSchema.nullable(),
  startedAt: timestampSchema,
  acknowledgedAt: timestampSchema.nullable(),
  completedAt: timestampSchema.nullable(),
});
export type CapabilityAttempt = z.infer<typeof capabilityAttemptSchema>;

export const capabilityOperationEventSchema = z.strictObject({
  version: z.literal(1),
  operationId: boundedIdSchema,
  attemptId: boundedIdSchema,
  sequence: z.number().int().nonnegative(),
  type: z.enum([
    "reserved",
    "authorized",
    "dispatched",
    "acknowledged",
    "usage",
    "completed",
    "failed",
    "cancelled",
  ]),
  occurredAt: timestampSchema,
  details: boundedProviderMetadataSchema.nullable(),
});
export type CapabilityOperationEvent = z.infer<
  typeof capabilityOperationEventSchema
>;

export type CredentialLease = {
  readonly connectionId: string;
  readonly slot: string;
  readonly version: number;
  readonly attemptId: string;
  readonly secret: string;
  readonly expiresAt: Date;
};

export type CapabilityAttemptContext = {
  ownerId: string;
  operationId: string;
  attemptId: string;
  attemptNumber: number;
  purpose: string;
  offering: CapabilityOffering;
  routePlanDigest: string;
  deadline: Date;
  signal: AbortSignal;
  authorize(): Promise<void>;
  credential(slot: string): Promise<CredentialLease | null>;
  emit(event: CapabilityOperationEvent): Promise<void>;
};

export interface UnaryCapabilityAdapter<K extends CapabilityKind> {
  readonly kind: K;
  descriptor(): CapabilityOfferingSnapshot<K>;
  invoke(
    context: CapabilityAttemptContext,
    input: CapabilityRequestMap[K],
  ): Promise<CapabilityResultMap[K]>;
}

export interface StreamingCapabilityAdapter<K extends CapabilityKind, Event> {
  readonly kind: K;
  descriptor(): CapabilityOfferingSnapshot<K>;
  stream(
    context: CapabilityAttemptContext,
    input: CapabilityRequestMap[K],
  ): AsyncIterable<Event>;
}

export type CapabilityAdapter<K extends CapabilityKind = CapabilityKind> =
  UnaryCapabilityAdapter<K> | StreamingCapabilityAdapter<K, unknown>;

export type ProviderConnectionValidationResult =
  | { valid: true; safeMetadata: BoundedProviderMetadata | null }
  | { valid: false; error: CapabilityError };

export type ProviderValidationContext = {
  ownerId: string;
  signal: AbortSignal;
  /** Ephemeral credential access for a minimal validation call; never serialize it. */
  credential(slot: string): Promise<{
    secret: string;
    version: number;
  } | null>;
};

export type ProviderDiscoveryContext = ProviderValidationContext & {
  now: Date;
};

export type ProviderAdapterContext = ProviderValidationContext & {
  connection: ProviderConnectionPublicSnapshot;
};

export interface ProviderPlugin {
  readonly manifest: ProviderPluginManifest;
  validateConnection(
    context: ProviderValidationContext,
    config: unknown,
  ): Promise<ProviderConnectionValidationResult>;
  discoverOfferings(
    context: ProviderDiscoveryContext,
    connection: ProviderConnectionPublicSnapshot,
  ): Promise<CapabilityOffering[]>;
  createAdapter<K extends CapabilityKind>(
    context: ProviderAdapterContext,
    offering: CapabilityOfferingSnapshot<K>,
  ): Promise<CapabilityAdapter<K>>;
}

export const capabilityInvokeInputSchema = z.strictObject({
  ownerId: boundedIdSchema,
  capability: capabilityKindSchema,
  purpose: capabilityPurposeSchema,
  input: z.unknown(),
  idempotencyKey: boundedIdSchema,
  pinnedOfferingId: boundedIdSchema.optional(),
  maximumDataEgress: dataEgressClassSchema.optional(),
});
export type CapabilityInvokeInput = z.infer<typeof capabilityInvokeInputSchema>;

// Keep these references visible in generated declarations and guard accidental
// divergence between the public connection/offering contracts and plugin APIs.
void capabilityOfferingSchema;
void providerConnectionPublicSnapshotSchema;
void providerPluginManifestSchema;
