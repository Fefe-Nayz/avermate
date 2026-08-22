import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import type {
  CorpusCoverage,
  CorpusOriginKind,
  EmbeddingSpaceDescriptor,
  RetrievalFallbackPolicy,
  RetrievalStageTrace,
  SourceLocatorV1,
} from "@avermate/agent-contracts";
import { newId } from "../../lib/id";
import { subjects, years } from "./app";
import { materialArtifacts } from "./artifacts";
import { users } from "./auth";
import { files } from "./files";

export type StudyProjectItemKind = CorpusOriginKind;
export type StudyProjectContextMode = "include" | "on-demand" | "exclude";
export type StudyProjectTrackingMode = "pinned" | "follow-head";
export type StudyProjectRetrievalMode = "lexical-only" | "advanced-auto";
export type ContentSourceStatus =
  "registered" | "indexing" | "ready" | "partial" | "failed";
export type ContentPlacement = "core" | "node";
export type CorpusEvidenceKind =
  "native-text" | "ocr" | "transcript" | "visual-only";
export type ContentAssetRole =
  "inline-image" | "page-image" | "thumbnail" | "attachment";
export type ContentVersionReferenceOwnerKind =
  | "project-item"
  | "assistant-citation"
  | "conversation-summary"
  | "artifact-revision"
  | "export";

const timestamps = {
  createdAt: integer({ mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer({ mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
};

const owner = () =>
  text()
    .notNull()
    .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" });

/** An owned NotebookLM-style workspace. References never move source rows. */
export const studyProjects = sqliteTable(
  "study_projects",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("proj")),
    userId: owner(),
    title: text().notNull(),
    description: text().notNull().default(""),
    yearId: text().references(() => years.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    subjectId: text().references(() => subjects.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    instructionsMarkdown: text(),
    contextPolicyVersion: integer().notNull().default(1),
    contextPolicyJson: text({ mode: "json" }).$type<Record<string, unknown>>(),
    emoji: text(),
    color: text(),
    revision: integer().notNull().default(1),
    retrievalMode: text()
      .$type<StudyProjectRetrievalMode>()
      .notNull()
      .default("lexical-only"),
    retrievalFallbackPolicy: text()
      .$type<RetrievalFallbackPolicy>()
      .notNull()
      .default("lexical-only"),
    embeddingSpaceId: text(),
    rerankSpaceId: text(),
    starredAt: integer({ mode: "timestamp" }),
    deletedAt: integer({ mode: "timestamp" }),
    ...timestamps,
  },
  (table) => [
    index("study_projects_owner_updated_idx").on(
      table.userId,
      table.deletedAt,
      table.updatedAt,
    ),
    index("study_projects_year_idx").on(table.userId, table.yearId),
    check(
      "study_projects_revision_check",
      sql`${table.revision} >= 1 and ${table.contextPolicyVersion} >= 1`,
    ),
    check(
      "study_projects_retrieval_mode_check",
      sql`${table.retrievalMode} in ('lexical-only', 'advanced-auto')`,
    ),
    check(
      "study_projects_retrieval_fallback_check",
      sql`${table.retrievalFallbackPolicy} in ('fail', 'lexical-only', 'hybrid-without-rerank')`,
    ),
  ],
);

/** Polymorphic, owner-validated project membership; conversation stays API-disabled in 028. */
export const studyProjectItems = sqliteTable(
  "study_project_items",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("pitem")),
    projectId: text()
      .notNull()
      .references(() => studyProjects.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    kind: text().$type<StudyProjectItemKind>().notNull(),
    referenceId: text().notNull(),
    sourceVersionId: text().references(
      (): AnySQLiteColumn => contentVersions.id,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),
    conversationBranchId: text(),
    conversationHeadMessageId: text(),
    trackingMode: text()
      .$type<StudyProjectTrackingMode>()
      .notNull()
      .default("follow-head"),
    selectorReviewRequired: integer({ mode: "boolean" })
      .notNull()
      .default(false),
    position: integer().notNull().default(0),
    contextMode: text()
      .$type<StudyProjectContextMode>()
      .notNull()
      .default("include"),
    label: text(),
    addedAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("study_project_items_reference_unique").on(
      table.projectId,
      table.kind,
      table.referenceId,
    ),
    index("study_project_items_order_idx").on(
      table.projectId,
      table.position,
      table.id,
    ),
    check(
      "study_project_items_kind_check",
      sql`${table.kind} in ('material', 'study-document', 'recording', 'grade', 'subject', 'conversation', 'artifact')`,
    ),
    check(
      "study_project_items_context_mode_check",
      sql`${table.contextMode} in ('include', 'on-demand', 'exclude')`,
    ),
    check(
      "study_project_items_tracking_mode_check",
      sql`${table.trackingMode} in ('pinned', 'follow-head')`,
    ),
    check(
      "study_project_items_conversation_selector_check",
      sql`(${table.kind} = 'conversation' and ${table.trackingMode} = 'pinned' and ((${table.conversationBranchId} is not null and ${table.conversationHeadMessageId} is not null) or (${table.selectorReviewRequired} = 1 and ${table.conversationBranchId} is null and ${table.conversationHeadMessageId} is null))) or (${table.kind} != 'conversation' and ${table.conversationBranchId} is null and ${table.conversationHeadMessageId} is null)`,
    ),
    check("study_project_items_position_check", sql`${table.position} >= 0`),
  ],
);

/** Stable identity for one owned domain source, independent of immutable versions. */
export const contentSources = sqliteTable(
  "content_sources",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("csrc")),
    userId: owner(),
    yearId: text().references(() => years.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    subjectId: text().references(() => subjects.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    originKind: text().$type<CorpusOriginKind>().notNull(),
    originId: text().notNull(),
    currentVersionId: text(),
    status: text().$type<ContentSourceStatus>().notNull().default("registered"),
    coverage: text().$type<CorpusCoverage>().notNull().default("unsupported"),
    placement: text().$type<ContentPlacement>().notNull().default("core"),
    placementRef: text(),
    error: text(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("content_sources_identity_unique").on(
      table.userId,
      table.originKind,
      table.originId,
    ),
    index("content_sources_owner_scope_idx").on(
      table.userId,
      table.yearId,
      table.subjectId,
      table.originKind,
    ),
    index("content_sources_current_version_idx").on(table.currentVersionId),
    check(
      "content_sources_origin_kind_check",
      sql`${table.originKind} in ('material', 'study-document', 'recording', 'grade', 'subject', 'conversation', 'artifact')`,
    ),
    check(
      "content_sources_status_check",
      sql`${table.status} in ('registered', 'indexing', 'ready', 'partial', 'failed')`,
    ),
    check(
      "content_sources_coverage_check",
      sql`${table.coverage} in ('searchable-native-text', 'searchable-ocr', 'metadata-and-locators-only', 'unsupported')`,
    ),
    check(
      "content_sources_placement_check",
      sql`(${table.placement} = 'core' and ${table.placementRef} is null) or (${table.placement} = 'node' and ${table.placementRef} is not null)`,
    ),
  ],
);

/** Immutable extraction revision. Updates are rejected by migration triggers. */
export const contentVersions = sqliteTable(
  "content_versions",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("cver")),
    sourceId: text()
      .notNull()
      .references(() => contentSources.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    versionKey: text().notNull(),
    contentHash: text().notNull(),
    extractorId: text().notNull(),
    extractorVersion: text().notNull(),
    mimeType: text(),
    language: text(),
    byteSize: integer(),
    locatorSchemaVersion: integer().notNull().default(1),
    metadataJson: text({ mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    gcRequestedAt: integer({ mode: "timestamp" }),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("content_versions_source_key_unique").on(
      table.sourceId,
      table.versionKey,
    ),
    index("content_versions_gc_idx").on(table.gcRequestedAt),
    check(
      "content_versions_hash_check",
      sql`length(${table.contentHash}) = 64 and ${table.contentHash} not glob '*[^0-9a-f]*'`,
    ),
    check(
      "content_versions_locator_version_check",
      sql`${table.locatorSchemaVersion} = 1`,
    ),
    check(
      "content_versions_byte_size_check",
      sql`${table.byteSize} is null or ${table.byteSize} >= 0`,
    ),
  ],
);

/** Immutable locator-aware evidence chunk. */
export const contentChunks = sqliteTable(
  "content_chunks",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("chk")),
    versionId: text()
      .notNull()
      .references(() => contentVersions.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    ordinal: integer().notNull(),
    text: text().notNull(),
    normalizedText: text().notNull(),
    tokenEstimate: integer().notNull(),
    contentHash: text().notNull(),
    locatorJson: text({ mode: "json" }).$type<SourceLocatorV1>().notNull(),
    headingPathJson: text({ mode: "json" }).$type<string[]>(),
    evidenceKind: text().$type<CorpusEvidenceKind>().notNull(),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("content_chunks_version_ordinal_unique").on(
      table.versionId,
      table.ordinal,
    ),
    index("content_chunks_version_idx").on(table.versionId, table.id),
    check("content_chunks_ordinal_check", sql`${table.ordinal} >= 0`),
    check(
      "content_chunks_token_estimate_check",
      sql`${table.tokenEstimate} >= 0`,
    ),
    check(
      "content_chunks_hash_check",
      sql`length(${table.contentHash}) = 64 and ${table.contentHash} not glob '*[^0-9a-f]*'`,
    ),
    check(
      "content_chunks_evidence_check",
      sql`${table.evidenceKind} in ('native-text', 'ocr', 'transcript', 'visual-only')`,
    ),
  ],
);

/**
 * Transaction-scoped authority for changing only the encrypted recovery
 * payload of immutable chunks while their Core/Node placement is switched.
 * Rows are inserted and removed in the same write transaction.
 */
export const corpusPayloadRewriteLeases = sqliteTable(
  "corpus_payload_rewrite_leases",
  {
    id: text().notNull().primaryKey(),
    userId: owner(),
    sourceId: text()
      .notNull()
      .references(() => contentSources.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    sourcePlacement: text().$type<ContentPlacement>().notNull(),
    sourceNodeId: text(),
    destinationPlacement: text().$type<ContentPlacement>().notNull(),
    destinationNodeId: text(),
    expiresAt: integer({ mode: "timestamp" }).notNull(),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("corpus_payload_rewrite_source_unique").on(table.sourceId),
    index("corpus_payload_rewrite_expiry_idx").on(table.expiresAt),
    check(
      "corpus_payload_rewrite_source_check",
      sql`(${table.sourcePlacement} = 'core' and ${table.sourceNodeId} is null)
        or (${table.sourcePlacement} = 'node' and ${table.sourceNodeId} is not null)`,
    ),
    check(
      "corpus_payload_rewrite_destination_check",
      sql`(${table.destinationPlacement} = 'core' and ${table.destinationNodeId} is null)
        or (${table.destinationPlacement} = 'node' and ${table.destinationNodeId} is not null)`,
    ),
  ],
);

export const contentAssets = sqliteTable(
  "content_assets",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("casset")),
    versionId: text()
      .notNull()
      .references(() => contentVersions.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    fileId: text()
      .notNull()
      .references(() => files.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    role: text().$type<ContentAssetRole>().notNull(),
    locatorJson: text({ mode: "json" }).$type<SourceLocatorV1>(),
    altText: text(),
    contentHash: text().notNull(),
  },
  (table) => [
    index("content_assets_version_idx").on(table.versionId),
    index("content_assets_file_idx").on(table.fileId),
    check(
      "content_assets_role_check",
      sql`${table.role} in ('inline-image', 'page-image', 'thumbnail', 'attachment')`,
    ),
    check(
      "content_assets_hash_check",
      sql`length(${table.contentHash}) = 64 and ${table.contentHash} not glob '*[^0-9a-f]*'`,
    ),
  ],
);

export type ContentDerivativeKind =
  | "pdf-page"
  | "page-image"
  | "slide-image"
  | "sheet-image"
  | "audio-segment"
  | "video-segment";
export type ContentDerivativeStatus =
  | "pending"
  | "ready"
  | "failed"
  | "deleted";

/** Exact, disposable visual/media units produced only by an attested worker. */
export const contentDerivatives = sqliteTable(
  "content_derivatives",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("cder")),
    versionId: text()
      .notNull()
      .references(() => contentVersions.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    chunkId: text().references(() => contentChunks.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    fileId: text()
      .notNull()
      .references(() => files.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    kind: text().$type<ContentDerivativeKind>().notNull(),
    status: text().$type<ContentDerivativeStatus>().notNull().default("pending"),
    locatorSchemaVersion: integer().notNull().default(1),
    locatorJson: text({ mode: "json" }).$type<SourceLocatorV1>().notNull(),
    contentHash: text().notNull(),
    mimeType: text().notNull(),
    byteSize: integer().notNull(),
    estimatedInputTokens: integer().notNull(),
    durationMs: integer(),
    rendererProfile: text().notNull(),
    rendererImageDigest: text().notNull(),
    metadataJson: text({ mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    errorCode: text(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("content_derivatives_version_kind_locator_unique").on(
      table.versionId,
      table.kind,
      table.locatorJson,
    ),
    index("content_derivatives_version_status_idx").on(
      table.versionId,
      table.status,
    ),
    index("content_derivatives_file_idx").on(table.fileId),
    check(
      "content_derivatives_kind_check",
      sql`${table.kind} in ('pdf-page', 'page-image', 'slide-image', 'sheet-image', 'audio-segment', 'video-segment')`,
    ),
    check(
      "content_derivatives_status_check",
      sql`${table.status} in ('pending', 'ready', 'failed', 'deleted')`,
    ),
    check(
      "content_derivatives_hash_check",
      sql`length(${table.contentHash}) = 64 and ${table.contentHash} not glob '*[^0-9a-f]*'`,
    ),
    check(
      "content_derivatives_size_check",
      sql`${table.byteSize} >= 0 and ${table.estimatedInputTokens} between 1 and 8192 and (${table.durationMs} is null or ${table.durationMs} > 0)`,
    ),
    check(
      "content_derivatives_renderer_digest_check",
      sql`${table.rendererImageDigest} glob 'sha256:*' and length(${table.rendererImageDigest}) = 71`,
    ),
  ],
);

/** Provider-neutral immutable vector-space registry. */
export const corpusEmbeddingSpaces = sqliteTable(
  "corpus_embedding_spaces",
  {
    id: text().primaryKey(),
    descriptorJson: text({ mode: "json" })
      .$type<EmbeddingSpaceDescriptor>()
      .notNull(),
    descriptorDigest: text().notNull(),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("corpus_embedding_spaces_digest_unique").on(
      table.descriptorDigest,
    ),
    check(
      "corpus_embedding_spaces_digest_check",
      sql`length(${table.descriptorDigest}) = 64 and ${table.descriptorDigest} not glob '*[^0-9a-f]*'`,
    ),
  ],
);

export type CorpusEmbeddingGenerationState =
  | "staging"
  | "active"
  | "failed"
  | "superseded";

/** A generation is published only after its complete version set is indexed. */
export const corpusEmbeddingGenerations = sqliteTable(
  "corpus_embedding_generations",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => newId("egen")),
    userId: owner(),
    spaceId: text()
      .notNull()
      .references(() => corpusEmbeddingSpaces.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    state: text()
      .$type<CorpusEmbeddingGenerationState>()
      .notNull()
      .default("staging"),
    versionSetDigest: text().notNull(),
    expectedVersionCount: integer().notNull(),
    indexedVersionCount: integer().notNull().default(0),
    activatedAt: integer({ mode: "timestamp" }),
    errorCode: text(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("corpus_embedding_generations_active_unique")
      .on(table.userId, table.spaceId)
      .where(sql`${table.state} = 'active'`),
    index("corpus_embedding_generations_owner_state_idx").on(
      table.userId,
      table.state,
    ),
    check(
      "corpus_embedding_generations_state_check",
      sql`${table.state} in ('staging', 'active', 'failed', 'superseded')`,
    ),
    check(
      "corpus_embedding_generations_counts_check",
      sql`${table.expectedVersionCount} >= 0 and ${table.indexedVersionCount} >= 0 and ${table.indexedVersionCount} <= ${table.expectedVersionCount}`,
    ),
    check(
      "corpus_embedding_generations_digest_check",
      sql`length(${table.versionSetDigest}) = 64 and ${table.versionSetDigest} not glob '*[^0-9a-f]*'`,
    ),
  ],
);

export const corpusEmbeddingGenerationVersions = sqliteTable(
  "corpus_embedding_generation_versions",
  {
    generationId: text()
      .notNull()
      .references(() => corpusEmbeddingGenerations.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    versionId: text()
      .notNull()
      .references(() => contentVersions.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    vectorCount: integer().notNull().default(0),
    indexedAt: integer({ mode: "timestamp" }),
  },
  (table) => [
    uniqueIndex("corpus_embedding_generation_versions_unique").on(
      table.generationId,
      table.versionId,
    ),
    index("corpus_embedding_generation_versions_version_idx").on(
      table.versionId,
    ),
    check(
      "corpus_embedding_generation_versions_count_check",
      sql`${table.vectorCount} >= 0`,
    ),
  ],
);

export const retrievalProviderConsents = sqliteTable(
  "retrieval_provider_consents",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => newId("rcons")),
    userId: owner(),
    provider: text().notNull(),
    capability: text().$type<"embedding" | "rerank">().notNull(),
    disclosureRevision: text().notNull(),
    policyRevision: text().notNull(),
    grantedAt: integer({ mode: "timestamp" }).notNull(),
    revokedAt: integer({ mode: "timestamp" }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("retrieval_provider_consents_unique").on(
      table.userId,
      table.provider,
      table.capability,
    ),
    check(
      "retrieval_provider_consents_capability_check",
      sql`${table.capability} in ('embedding', 'rerank')`,
    ),
  ],
);

/** Privacy-safe retrieval execution trace: no raw query or evidence body. */
export const retrievalTraces = sqliteTable(
  "retrieval_traces",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => newId("rtrace")),
    operationId: text().notNull(),
    userId: owner(),
    queryDigest: text().notNull(),
    corpusGenerationId: text().references(() => corpusEmbeddingGenerations.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    scopeDigest: text().notNull(),
    stagesJson: text({ mode: "json" })
      .$type<RetrievalStageTrace[]>()
      .notNull(),
    fallbackPolicy: text().$type<RetrievalFallbackPolicy>().notNull(),
    fallbackReason: text(),
    packedEvidenceIdsJson: text({ mode: "json" }).$type<string[]>().notNull(),
    evaluationCorrelationId: text(),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("retrieval_traces_owner_operation_unique").on(
      table.userId,
      table.operationId,
    ),
    index("retrieval_traces_owner_created_idx").on(
      table.userId,
      table.createdAt,
    ),
    check(
      "retrieval_traces_query_digest_check",
      sql`length(${table.queryDigest}) = 64 and ${table.queryDigest} not glob '*[^0-9a-f]*'`,
    ),
    check(
      "retrieval_traces_scope_digest_check",
      sql`length(${table.scopeDigest}) = 64 and ${table.scopeDigest} not glob '*[^0-9a-f]*'`,
    ),
    check(
      "retrieval_traces_fallback_check",
      sql`${table.fallbackPolicy} in ('fail', 'lexical-only', 'hybrid-without-rerank')`,
    ),
  ],
);

export const corpusEmbeddingUsage = sqliteTable(
  "corpus_embedding_usage",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => newId("eusage")),
    operationId: text().notNull(),
    userId: owner(),
    spaceId: text()
      .notNull()
      .references(() => corpusEmbeddingSpaces.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    versionId: text().references(() => contentVersions.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    inputCount: integer().notNull(),
    inputTokens: integer(),
    providerRequestId: text(),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("corpus_embedding_usage_owner_created_idx").on(
      table.userId,
      table.createdAt,
    ),
    check(
      "corpus_embedding_usage_counts_check",
      sql`${table.inputCount} > 0 and (${table.inputTokens} is null or ${table.inputTokens} >= 0)`,
    ),
  ],
);

export type RetrievalEvaluationStatus = "running" | "succeeded" | "failed";

/** Versioned aggregate evaluation output; fixture questions/bodies stay in git. */
export const retrievalEvaluations = sqliteTable(
  "retrieval_evaluations",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => newId("reval")),
    userId: owner(),
    fixtureRevision: text().notNull(),
    corpusDigest: text().notNull(),
    configurationDigest: text().notNull(),
    status: text().$type<RetrievalEvaluationStatus>().notNull(),
    metricsJson: text({ mode: "json" }).$type<Record<string, number>>(),
    ablationsJson: text({ mode: "json" }).$type<
      Array<{ configuration: string; metrics: Record<string, number> }>
    >(),
    errorCode: text(),
    evaluatedAt: integer({ mode: "timestamp" }),
    ...timestamps,
  },
  (table) => [
    index("retrieval_evaluations_owner_created_idx").on(
      table.userId,
      table.createdAt,
    ),
    check(
      "retrieval_evaluations_status_check",
      sql`${table.status} in ('running', 'succeeded', 'failed')`,
    ),
    check(
      "retrieval_evaluations_corpus_digest_check",
      sql`length(${table.corpusDigest}) = 64 and ${table.corpusDigest} not glob '*[^0-9a-f]*'`,
    ),
    check(
      "retrieval_evaluations_configuration_digest_check",
      sql`length(${table.configurationDigest}) = 64 and ${table.configurationDigest} not glob '*[^0-9a-f]*'`,
    ),
  ],
);

/** Durable reachability edge for an exact immutable citation or project snapshot. */
export const contentVersionReferences = sqliteTable(
  "content_version_references",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("cref")),
    userId: owner(),
    ownerKind: text().$type<ContentVersionReferenceOwnerKind>().notNull(),
    ownerId: text().notNull(),
    sourceVersionId: text()
      .notNull()
      .references(() => contentVersions.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    chunkId: text().references(() => contentChunks.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    locatorSchemaVersion: integer().notNull().default(1),
    locatorJson: text({ mode: "json" }).$type<SourceLocatorV1>().notNull(),
    quotedContentHash: text(),
    referenceKey: text().notNull(),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("content_version_references_owner_key_unique").on(
      table.ownerKind,
      table.ownerId,
      table.referenceKey,
    ),
    index("content_version_references_version_idx").on(table.sourceVersionId),
    index("content_version_references_user_idx").on(table.userId, table.id),
    check(
      "content_version_references_owner_kind_check",
      sql`${table.ownerKind} in ('project-item', 'assistant-citation', 'conversation-summary', 'artifact-revision', 'export')`,
    ),
    check(
      "content_version_references_locator_version_check",
      sql`${table.locatorSchemaVersion} = 1`,
    ),
    check(
      "content_version_references_key_check",
      sql`length(${table.referenceKey}) = 64 and ${table.referenceKey} not glob '*[^0-9a-f]*'`,
    ),
    check(
      "content_version_references_quote_hash_check",
      sql`${table.quotedContentHash} is null or (length(${table.quotedContentHash}) = 64 and ${table.quotedContentHash} not glob '*[^0-9a-f]*')`,
    ),
  ],
);

/** Durable staging makes indexing resumable without publishing partial versions. */
export const corpusVersionStages = sqliteTable(
  "corpus_version_stages",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("cstage")),
    versionId: text().notNull(),
    sourceId: text()
      .notNull()
      .references(() => contentSources.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: owner(),
    versionKey: text().notNull(),
    contentHash: text().notNull(),
    extractorId: text().notNull(),
    extractorVersion: text().notNull(),
    mimeType: text(),
    language: text(),
    byteSize: integer(),
    locatorSchemaVersion: integer().notNull().default(1),
    metadataJson: text({ mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    coverage: text().$type<CorpusCoverage>().notNull(),
    alreadyCommitted: integer({ mode: "boolean" }).notNull().default(false),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("corpus_version_stages_owner_idx").on(table.userId, table.sourceId),
    uniqueIndex("corpus_version_stages_source_key_unique").on(
      table.sourceId,
      table.versionKey,
    ),
  ],
);

export const corpusChunkStages = sqliteTable(
  "corpus_chunk_stages",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("schk")),
    stagingId: text()
      .notNull()
      .references(() => corpusVersionStages.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    chunkId: text().notNull(),
    ordinal: integer().notNull(),
    text: text().notNull(),
    normalizedText: text().notNull(),
    tokenEstimate: integer().notNull(),
    contentHash: text().notNull(),
    locatorJson: text({ mode: "json" }).$type<SourceLocatorV1>().notNull(),
    headingPathJson: text({ mode: "json" }).$type<string[]>(),
    evidenceKind: text().$type<CorpusEvidenceKind>().notNull(),
  },
  (table) => [
    uniqueIndex("corpus_chunk_stages_ordinal_unique").on(
      table.stagingId,
      table.ordinal,
    ),
  ],
);

/** Exact structured boundaries emitted at OCR/transcription time, never inferred later. */
export const materialArtifactSegments = sqliteTable(
  "material_artifact_segments",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("maseg")),
    artifactId: text()
      .notNull()
      .references(() => materialArtifacts.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    ordinal: integer().notNull(),
    text: text().notNull(),
    locatorJson: text({ mode: "json" }).$type<SourceLocatorV1>().notNull(),
    contentHash: text().notNull(),
  },
  (table) => [
    uniqueIndex("material_artifact_segments_ordinal_unique").on(
      table.artifactId,
      table.ordinal,
    ),
    check(
      "material_artifact_segments_ordinal_check",
      sql`${table.ordinal} >= 0`,
    ),
  ],
);
