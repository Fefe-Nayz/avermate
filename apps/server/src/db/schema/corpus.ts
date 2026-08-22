import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type {
  CorpusCoverage,
  CorpusOriginKind,
  SourceLocatorV1,
} from "@avermate/agent-contracts";
import { newId } from "../../lib/id";
import { subjects, years } from "./app";
import { materialArtifacts } from "./artifacts";
import { users } from "./auth";
import { files } from "./files";

export type StudyProjectItemKind = CorpusOriginKind;
export type StudyProjectContextMode = "include" | "on-demand" | "exclude";
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
