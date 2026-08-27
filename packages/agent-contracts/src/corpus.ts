import { z } from "zod";

const boundedId = z.string().min(1).max(256);
const contentHash = z.string().regex(/^[a-f0-9]{64}$/);

const pdfLocatorSchema = z.strictObject({
  kind: z.literal("pdf"),
  page: z.number().int().positive(),
  bbox: z
    .tuple([z.number(), z.number(), z.number(), z.number()])
    .refine(
      ([left, top, right, bottom]) =>
        left >= 0 &&
        top >= 0 &&
        right <= 1 &&
        bottom <= 1 &&
        right > left &&
        bottom > top,
      "A PDF bounding box must be normalized and non-empty",
    )
    .optional(),
});

const markdownLocatorSchema = z
  .strictObject({
    kind: z.literal("markdown"),
    headingPath: z.array(z.string().min(1).max(500)).max(64),
    startLine: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional(),
  })
  .refine(
    ({ startLine, endLine }) =>
      startLine === undefined || endLine === undefined || endLine >= startLine,
    "Markdown line ranges must be ordered",
  );

const textLocatorSchema = z
  .strictObject({
    kind: z.literal("text"),
    startOffset: z.number().int().nonnegative(),
    endOffset: z.number().int().positive(),
  })
  .refine(
    ({ startOffset, endOffset }) => endOffset > startOffset,
    "Text ranges must be non-empty",
  );

const timedLocatorSchema = z
  .strictObject({
    kind: z.enum(["audio", "video"]),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
  })
  .refine(
    ({ startMs, endMs }) => endMs > startMs,
    "Timed ranges must be non-empty",
  );

export const sourceLocatorV1Schema = z.discriminatedUnion("kind", [
  pdfLocatorSchema,
  markdownLocatorSchema,
  textLocatorSchema,
  timedLocatorSchema,
  z.strictObject({
    kind: z.literal("slides"),
    slide: z.number().int().positive(),
    elementId: boundedId.optional(),
  }),
  z.strictObject({
    kind: z.literal("spreadsheet"),
    sheet: z.string().min(1).max(256),
    range: z.string().min(1).max(256),
  }),
  z.strictObject({
    kind: z.literal("grade"),
    gradeId: boundedId,
    field: z.string().min(1).max(128).optional(),
  }),
  z
    .strictObject({
      kind: z.literal("conversation"),
      threadId: boundedId,
      messageId: boundedId,
      partId: boundedId,
      startOffset: z.number().int().nonnegative().optional(),
      endOffset: z.number().int().positive().optional(),
    })
    .refine(
      ({ startOffset, endOffset }) =>
        (startOffset === undefined && endOffset === undefined) ||
        (startOffset !== undefined &&
          endOffset !== undefined &&
          endOffset > startOffset),
      "Conversation ranges must be complete and non-empty",
    ),
]);
export type SourceLocatorV1 = z.infer<typeof sourceLocatorV1Schema>;

export const corpusOriginKindSchema = z.enum([
  "material",
  "study-document",
  "recording",
  "grade",
  "subject",
  "conversation",
  "artifact",
]);
export type CorpusOriginKind = z.infer<typeof corpusOriginKindSchema>;

export const corpusCoverageSchema = z.enum([
  "searchable-native-text",
  "searchable-ocr",
  "metadata-and-locators-only",
  "unsupported",
]);
export type CorpusCoverage = z.infer<typeof corpusCoverageSchema>;

export const corpusPlacementSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("core") }),
  z.strictObject({ kind: z.literal("node"), nodeId: boundedId }),
]);
export type CorpusPlacement = z.infer<typeof corpusPlacementSchema>;

export const ownedSourceIdentitySchema = z.strictObject({
  ownerId: boundedId,
  originKind: corpusOriginKindSchema,
  originId: boundedId,
});
export type OwnedSourceIdentity = z.infer<typeof ownedSourceIdentitySchema>;

export const contentSourceRecordSchema = ownedSourceIdentitySchema.extend({
  id: boundedId,
  yearId: boundedId.nullable(),
  subjectId: boundedId.nullable(),
  currentVersionId: boundedId.nullable(),
  status: z.enum(["registered", "indexing", "ready", "partial", "failed"]),
  coverage: corpusCoverageSchema,
  placement: corpusPlacementSchema,
  placementRef: boundedId.nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type ContentSourceRecord = z.infer<typeof contentSourceRecordSchema>;

export const stagedContentChunkSchema = z.strictObject({
  /** Stable committed identifier when a corpus index is copied between planes. */
  chunkId: boundedId.optional(),
  ordinal: z.number().int().nonnegative(),
  text: z.string().max(262_144),
  normalizedText: z.string().max(262_144),
  tokenEstimate: z.number().int().nonnegative(),
  contentHash,
  locator: sourceLocatorV1Schema,
  headingPath: z.array(z.string().min(1).max(500)).max(64).nullable(),
  evidenceKind: z.enum(["native-text", "ocr", "transcript", "visual-only"]),
});
export type StagedContentChunk = z.infer<typeof stagedContentChunkSchema>;

export const stagedContentVersionSchema = z.strictObject({
  identity: ownedSourceIdentitySchema,
  sourceId: boundedId,
  versionKey: z.string().min(1).max(512),
  contentHash,
  extractorId: boundedId,
  extractorVersion: z.string().min(1).max(128),
  mimeType: z.string().min(1).max(256).nullable(),
  language: z.string().min(1).max(64).nullable(),
  byteSize: z.number().int().nonnegative().nullable(),
  locatorSchemaVersion: z.literal(1),
  metadata: z.record(z.string(), z.unknown()),
  chunks: z.array(stagedContentChunkSchema).max(100_000),
});
export type StagedContentVersion = z.infer<typeof stagedContentVersionSchema>;

export const contentVersionRecordSchema = stagedContentVersionSchema
  .omit({ identity: true, chunks: true })
  .extend({
    id: boundedId,
    createdAt: z.iso.datetime({ offset: true }),
  });
export type ContentVersionRecord = z.infer<typeof contentVersionRecordSchema>;

export const ownedVersionRefSchema = z.strictObject({
  ownerId: boundedId,
  sourceId: boundedId,
  versionId: boundedId,
});
export type OwnedVersionRef = z.infer<typeof ownedVersionRefSchema>;

export type StagedVersionRef = OwnedVersionRef & { stagingId: string };
export type CommittedVersionRef = OwnedVersionRef & { contentHash: string };

export type CommitVersionInput = {
  ownerId: string;
  stagingId: string;
  expectedSourceId: string;
  expectedPreviousVersionId: string | null;
};

export const contentVersionReferenceSchema = z.strictObject({
  id: boundedId,
  ownerId: boundedId,
  ownerKind: z.enum([
    "project-item",
    "assistant-citation",
    "conversation-summary",
    "artifact-revision",
    "export",
  ]),
  ownerIdWithinKind: boundedId,
  sourceVersionId: boundedId,
  chunkId: boundedId.nullable(),
  locatorSchemaVersion: z.literal(1),
  locator: sourceLocatorV1Schema,
  quotedContentHash: contentHash.nullable(),
  referenceKey: contentHash,
  createdAt: z.iso.datetime({ offset: true }),
});
export type ContentVersionReference = z.infer<
  typeof contentVersionReferenceSchema
>;

export interface CorpusStore {
  getSource(identity: OwnedSourceIdentity): Promise<ContentSourceRecord | null>;
  stageVersion(input: StagedContentVersion): Promise<StagedVersionRef>;
  commitVersion(input: CommitVersionInput): Promise<CommittedVersionRef>;
  resolveVersion(ref: OwnedVersionRef): Promise<ContentVersionRecord>;
  listReferences(versionId: string): Promise<ContentVersionReference[]>;
  markVersionForGc(versionId: string): Promise<void>;
}

export const lexicalSearchModeSchema = z.enum([
  "terms",
  "phrase",
  "prefix",
  "exact",
]);
export type LexicalSearchMode = z.infer<typeof lexicalSearchModeSchema>;

/**
 * Describes why corpus context is being requested. Project sources marked
 * `on-demand` are deliberately unavailable to automatic answer preloading,
 * but remain available to an explicit agent search. Direct source attachments
 * are always fenced by `sourceIds` and may opt into `explicit-attachment`.
 */
export const corpusContextAccessSchema = z.enum([
  "automatic",
  "agent-request",
  "explicit-attachment",
]);
export type CorpusContextAccess = z.infer<typeof corpusContextAccessSchema>;

export const ownedLexicalQuerySchema = z.strictObject({
  ownerId: boundedId,
  query: z.string().min(1).max(2_000),
  mode: lexicalSearchModeSchema,
  projectIds: z.array(boundedId).max(100),
  /**
   * Directly selected immutable sources. They form a union with eligible
   * project items (and are the complete fence when no project is supplied).
   */
  sourceIds: z.array(boundedId).max(100).optional(),
  /**
   * Internal immutable-version fence used when Core dispatches an already
   * authorized project scope to a paired Node. It can only narrow a query.
   */
  versionIds: z.array(boundedId).max(10_000).optional(),
  yearIds: z.array(boundedId).max(100),
  subjectIds: z.array(boundedId).max(100),
  originKinds: z.array(corpusOriginKindSchema).max(16),
  contextAccess: corpusContextAccessSchema.optional(),
  limit: z.number().int().positive().max(100),
  cursor: z.string().max(512).nullable(),
  fallbackPolicy: z
    .enum(["fail", "lexical-only", "hybrid-without-rerank"])
    .optional(),
  operationId: boundedId.optional(),
  evaluationCorrelationId: boundedId.nullable().optional(),
});
export type OwnedLexicalQuery = z.infer<typeof ownedLexicalQuerySchema>;

export const lexicalCandidateSchema = z.strictObject({
  sourceId: boundedId,
  versionId: boundedId,
  chunkId: boundedId,
  ordinal: z.number().int().nonnegative(),
  score: z.number().finite(),
  snippet: z.string().max(16_384),
  locator: sourceLocatorV1Schema,
  contentHash,
  evidenceKind: z.enum(["native-text", "ocr", "transcript", "visual-only"]),
});
export type LexicalCandidate = z.infer<typeof lexicalCandidateSchema>;

export type LexicalSearchCapabilities = {
  available: boolean;
  implementation: string;
  modes: readonly LexicalSearchMode[];
};

export const lexicalVersionInputSchema = z.strictObject({
  ownerId: boundedId,
  source: contentSourceRecordSchema,
  version: contentVersionRecordSchema,
  chunks: z.array(stagedContentChunkSchema).max(100_000),
});
export type LexicalVersionInput = z.infer<typeof lexicalVersionInputSchema>;

export type LexicalConsistencyReport = {
  consistent: boolean;
  indexedVersions: number;
  missingVersionIds: readonly string[];
  orphanedVersionIds: readonly string[];
};

export interface LexicalSearchBackend {
  capabilities(): Promise<LexicalSearchCapabilities>;
  upsertVersion(input: LexicalVersionInput): Promise<void>;
  removeVersion(versionId: string): Promise<void>;
  search(input: OwnedLexicalQuery): Promise<LexicalCandidate[]>;
  verify(): Promise<LexicalConsistencyReport>;
}

export const ownedCitationRefSchema = z.strictObject({
  ownerId: boundedId,
  referenceId: boundedId,
});
export type OwnedCitationRef = z.infer<typeof ownedCitationRefSchema>;

export const resolvedCitationSchema = z.strictObject({
  referenceId: boundedId,
  sourceId: boundedId,
  versionId: boundedId,
  chunkId: boundedId.nullable(),
  displayTitle: z.string().min(1).max(1_000),
  locator: sourceLocatorV1Schema,
  contentHash,
  quotedContentHash: contentHash.nullable(),
  openTarget: z.strictObject({
    kind: z.enum([
      "material",
      "study-document",
      "recording",
      "grade",
      "subject",
      "conversation",
      "artifact",
    ]),
    resourceId: boundedId,
    locator: sourceLocatorV1Schema,
  }),
});
export type ResolvedCitation = z.infer<typeof resolvedCitationSchema>;
export type OwnedOpenTarget = ResolvedCitation["openTarget"];

export interface CitationResolver {
  resolve(input: OwnedCitationRef): Promise<ResolvedCitation>;
  open(input: OwnedCitationRef): Promise<OwnedOpenTarget>;
}

export const embeddingModalitySchema = z.enum([
  "text",
  "image",
  "pdf-page",
  "audio",
  "video",
]);
export type EmbeddingModality = z.infer<typeof embeddingModalitySchema>;

/**
 * Every field participates in the immutable space identity. In particular,
 * dimensions and preprocessing instructions cannot be changed in place.
 */
export const embeddingSpaceDescriptorSchema = z.strictObject({
  id: boundedId,
  provider: boundedId,
  model: boundedId,
  modelRevision: z.string().min(1).max(256),
  dimensions: z.number().int().positive().max(65_536),
  modalities: z.array(embeddingModalitySchema).min(1).max(5),
  normalization: z.enum(["provider-unit", "client-unit"]),
  preprocessingRevision: z.string().min(1).max(256),
  placement: z.enum(["core", "node", "managed"]),
});
export type EmbeddingSpaceDescriptor = z.infer<
  typeof embeddingSpaceDescriptorSchema
>;

export const providerConsentSchema = z.strictObject({
  provider: boundedId,
  disclosureRevision: z.string().min(1).max(256),
  capability: z.enum(["embedding", "rerank"]),
  grantedAt: z.iso.datetime({ offset: true }),
});
export type ProviderConsent = z.infer<typeof providerConsentSchema>;

export type EmbeddingRequestContext = {
  operationId: string;
  signal: AbortSignal;
  consent: ProviderConsent;
  /** Revalidate mutable authorization immediately before provider dispatch. */
  authorize?: () => Promise<void>;
};

export type TextEmbeddingInput = {
  contentHash: string;
  text: string;
  purpose?: "query" | "document";
  title?: string | null;
};
export type MediaEmbeddingInput = {
  contentHash: string;
  modality: Exclude<EmbeddingModality, "text">;
  mediaType: string;
  opaqueFileHandle: string;
  locator: SourceLocatorV1;
  byteLength: number;
  estimatedInputTokens: number;
  durationMs?: number;
};
export type EmbeddingUsageMetadata = {
  inputTokens: number | null;
  providerRequestId: string | null;
};
export type EmbeddingVector = {
  contentHash: string;
  values: readonly number[];
  usage?: EmbeddingUsageMetadata;
};

export interface EmbeddingProvider {
  descriptor(): EmbeddingSpaceDescriptor;
  embedText(
    input: readonly TextEmbeddingInput[],
    context?: EmbeddingRequestContext,
  ): Promise<EmbeddingVector[]>;
  embedMedia?(
    input: readonly MediaEmbeddingInput[],
    context: EmbeddingRequestContext,
  ): Promise<EmbeddingVector[]>;
}

export const rerankCandidateSchema = z.strictObject({
  id: boundedId,
  text: z
    .string()
    .min(1)
    .max(64 * 1024),
  tokenEstimate: z.number().int().nonnegative().max(32_768),
});
export type RerankCandidate = z.infer<typeof rerankCandidateSchema>;

export const rerankScoreSchema = z.strictObject({
  operationId: boundedId,
  candidateId: boundedId,
  score: z.number().finite(),
  rank: z.number().int().nonnegative(),
});
export type RerankScore = z.infer<typeof rerankScoreSchema>;

export const rerankSpaceDescriptorSchema = z.strictObject({
  id: boundedId,
  provider: boundedId,
  model: boundedId,
  modelRevision: z.string().min(1).max(256),
  languages: z.array(z.string().min(1).max(64)).min(1).max(256),
  modalities: z.array(z.literal("text")).length(1),
  maximumCandidates: z.number().int().positive().max(10_000),
  maximumTokensPerCandidate: z.number().int().positive().max(1_000_000),
  scoreSemantics: z.enum([
    "relevance-ordered",
    "sigmoid-relevance",
    "raw-logit",
  ]),
  placement: z.enum(["core", "node", "managed"]),
  costUnit: z.enum(["search-unit", "compute-token", "none"]),
});
export type RerankSpaceDescriptor = z.infer<typeof rerankSpaceDescriptorSchema>;

export interface RerankProvider {
  descriptor(): RerankSpaceDescriptor;
  rerank(input: {
    operationId: string;
    query: string;
    candidates: readonly RerankCandidate[];
    topN: number;
    signal: AbortSignal;
  }): Promise<readonly RerankScore[]>;
}

export const retrievalFallbackPolicySchema = z.enum([
  "fail",
  "lexical-only",
  "hybrid-without-rerank",
]);
export type RetrievalFallbackPolicy = z.infer<
  typeof retrievalFallbackPolicySchema
>;

export const retrievalStageTraceSchema = z.strictObject({
  stage: z.enum([
    "scope",
    "lexical",
    "dense",
    "fusion",
    "diversity",
    "rerank",
    "expansion",
    "packing",
  ]),
  descriptorId: boundedId.nullable(),
  inputCount: z.number().int().nonnegative(),
  outputCount: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  status: z.enum(["used", "skipped", "degraded", "failed"]),
  safeReason: z.string().min(1).max(512).nullable(),
});
export type RetrievalStageTrace = z.infer<typeof retrievalStageTraceSchema>;

export const retrievalTraceSchema = z.strictObject({
  operationId: boundedId,
  ownerId: boundedId,
  queryDigest: contentHash,
  corpusGenerationId: boundedId.nullable(),
  scopeDigest: contentHash,
  stages: z.array(retrievalStageTraceSchema).max(32),
  fallbackPolicy: retrievalFallbackPolicySchema,
  fallbackReason: z.string().min(1).max(512).nullable(),
  packedEvidenceIds: z.array(boundedId).max(256),
  evaluationCorrelationId: boundedId.nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type RetrievalTrace = z.infer<typeof retrievalTraceSchema>;

export type IndexedVector = {
  ownerId: string;
  spaceId: string;
  sourceId: string;
  versionId: string;
  chunkId: string;
  values: readonly number[];
};
export type VectorQuery = {
  ownerId: string;
  spaceId: string;
  values: readonly number[];
  limit: number;
};
export type VectorCandidate = {
  sourceId: string;
  versionId: string;
  chunkId: string;
  score: number;
};
export type VectorCapabilities = {
  available: boolean;
  implementation: string;
  dimensions: readonly number[];
};

export interface VectorIndex {
  capabilities(): Promise<VectorCapabilities>;
  upsert(batch: readonly IndexedVector[]): Promise<void>;
  remove(versionIds: readonly string[]): Promise<void>;
  search(query: VectorQuery): Promise<VectorCandidate[]>;
}
