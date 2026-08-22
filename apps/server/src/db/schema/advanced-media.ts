import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type {
  ArtifactWorkflowStatus,
  GeneratedArtifactKind,
  GeneratedArtifactManifestV1,
  IngestionReasonCode,
  IngestionStrategy,
  SourceLocatorV1,
  VideoTimelineV1,
} from "@avermate/agent-contracts";
import { newId } from "../../lib/id";
import { agentActions } from "./actions";
import { users } from "./auth";
import {
  contentAssets,
  contentVersions,
  studyProjects,
} from "./corpus";
import { files } from "./files";
import { jobs } from "./jobs";
import { materialDocuments } from "./materials";

export type SourceIngestionState =
  | "planned"
  | "queued"
  | "running"
  | "ready"
  | "failed"
  | "cancelled"
  | "superseded";
export type CapturedSourceAssetState = "stored" | "blocked" | "missing";
export type GeneratedArtifactState = "active" | "archived" | "trashed";
export type GeneratedArtifactRevisionState = "ready" | "failed" | "archived";

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

/** One append-only, explicitly selected ingestion attempt for a material link. */
export const sourceIngestionRevisions = sqliteTable(
  "source_ingestion_revisions",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("irev")),
    userId: owner(),
    documentId: text()
      .notNull()
      .references(() => materialDocuments.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    revision: integer().notNull(),
    strategy: text().$type<IngestionStrategy>().notNull(),
    state: text().$type<SourceIngestionState>().notNull().default("planned"),
    reasonCode: text().$type<IngestionReasonCode>(),
    safeError: text(),
    canonicalUrl: text().notNull(),
    finalUrl: text(),
    language: text(),
    policyRef: text().notNull(),
    policyDigest: text(),
    settingsVersion: integer().notNull().default(1),
    settingsJson: text({ mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    diagnosticsVersion: integer(),
    diagnosticsJson: text({ mode: "json" }).$type<Record<string, unknown>>(),
    resultDigest: text(),
    sourceVersionId: text().references(() => contentVersions.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    jobId: text().references(() => jobs.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    actionId: text().references(() => agentActions.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    startedAt: integer({ mode: "timestamp" }),
    completedAt: integer({ mode: "timestamp" }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("source_ingestion_revisions_document_revision_unique").on(
      table.documentId,
      table.revision,
    ),
    index("source_ingestion_revisions_owner_state_idx").on(
      table.userId,
      table.state,
      table.createdAt,
    ),
    index("source_ingestion_revisions_job_idx").on(table.jobId),
    check("source_ingestion_revision_positive", sql`${table.revision} >= 1`),
    check(
      "source_ingestion_strategy_check",
      sql`${table.strategy} in ('static-html', 'browser-render', 'pdf', 'youtube')`,
    ),
    check(
      "source_ingestion_state_check",
      sql`${table.state} in ('planned', 'queued', 'running', 'ready', 'failed', 'cancelled', 'superseded')`,
    ),
    check(
      "source_ingestion_reason_check",
      sql`${table.reasonCode} is null or ${table.reasonCode} in ('static_empty', 'dynamic_required', 'blocked_destination', 'authentication_required', 'content_too_large', 'publisher_denied', 'unsupported_content', 'captions_unavailable', 'permission_required', 'extractor_blocked', 'duration_limit', 'transcription_unavailable', 'upstream_changed', 'placement_unavailable', 'capability_disabled', 'request_limit', 'cancelled', 'internal_failure')`,
    ),
    check(
      "source_ingestion_result_digest_check",
      sql`${table.resultDigest} is null or (length(${table.resultDigest}) = 64 and ${table.resultDigest} not glob '*[^0-9a-f]*')`,
    ),
  ],
);

/** Private, validated assets selected from an extracted source revision. */
export const capturedSourceAssets = sqliteTable(
  "captured_source_assets",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("sasset")),
    userId: owner(),
    ingestionRevisionId: text()
      .notNull()
      .references(() => sourceIngestionRevisions.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    fileId: text().references(() => files.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    contentAssetId: text().references(() => contentAssets.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    state: text()
      .$type<CapturedSourceAssetState>()
      .notNull()
      .default("stored"),
    originalUrl: text().notNull(),
    locatorJson: text({ mode: "json" }).$type<SourceLocatorV1>(),
    mimeType: text(),
    width: integer(),
    height: integer(),
    byteSize: integer(),
    digest: text(),
    storagePlacement: text().$type<"core" | "node">(),
    attribution: text(),
    reasonCode: text().$type<IngestionReasonCode>(),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("captured_source_assets_revision_url_unique").on(
      table.ingestionRevisionId,
      table.originalUrl,
    ),
    index("captured_source_assets_file_idx").on(table.fileId),
    check(
      "captured_source_assets_state_check",
      sql`${table.state} in ('stored', 'blocked', 'missing')`,
    ),
    check(
      "captured_source_assets_stored_shape_check",
      sql`(${table.state} = 'stored' and ${table.fileId} is not null and ${table.mimeType} is not null and ${table.width} > 0 and ${table.height} > 0 and ${table.byteSize} > 0 and length(${table.digest}) = 64 and ${table.storagePlacement} in ('core', 'node')) or (${table.state} != 'stored' and ${table.fileId} is null)`,
    ),
  ],
);

export const sourceIngestionConsents = sqliteTable(
  "source_ingestion_consents",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("iconsent")),
    userId: owner(),
    purpose: text().$type<"video-audio-extraction">().notNull(),
    revision: text().notNull(),
    noticeDigest: text().notNull(),
    acceptedAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    revokedAt: integer({ mode: "timestamp" }),
  },
  (table) => [
    uniqueIndex("source_ingestion_consents_owner_purpose_revision_unique").on(
      table.userId,
      table.purpose,
      table.revision,
    ),
    check(
      "source_ingestion_consent_digest_check",
      sql`length(${table.noticeDigest}) = 64 and ${table.noticeDigest} not glob '*[^0-9a-f]*'`,
    ),
  ],
);

/** Mutable identity/current pointer only; reproducible edges use revision IDs. */
export const generatedArtifacts = sqliteTable(
  "generated_artifacts",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("gart")),
    userId: owner(),
    projectId: text().references(() => studyProjects.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    kind: text().$type<GeneratedArtifactKind>().notNull(),
    title: text().notNull(),
    state: text().$type<GeneratedArtifactState>().notNull().default("active"),
    currentRevisionId: text().references(
      (): AnySQLiteColumn => generatedArtifactRevisions.id,
      { onDelete: "set null", onUpdate: "cascade" },
    ),
    revision: integer().notNull().default(1),
    ...timestamps,
  },
  (table) => [
    index("generated_artifacts_owner_project_idx").on(
      table.userId,
      table.projectId,
      table.state,
    ),
    check("generated_artifacts_revision_check", sql`${table.revision} >= 1`),
    check(
      "generated_artifacts_kind_check",
      sql`${table.kind} in ('markdown', 'latex-source', 'pdf', 'slides-source', 'pptx', 'quiz', 'audio', 'image', 'anki', 'html', 'video-timeline', 'video', 'thumbnail')`,
    ),
    check(
      "generated_artifacts_state_check",
      sql`${table.state} in ('active', 'archived', 'trashed')`,
    ),
  ],
);

/** Immutable generated representation and provenance manifest. */
export const generatedArtifactRevisions = sqliteTable(
  "generated_artifact_revisions",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("garv")),
    artifactId: text()
      .notNull()
      .references(() => generatedArtifacts.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: owner(),
    revision: integer().notNull(),
    kind: text().$type<GeneratedArtifactKind>().notNull(),
    state: text()
      .$type<GeneratedArtifactRevisionState>()
      .notNull()
      .default("ready"),
    manifestVersion: integer().notNull().default(1),
    manifestJson: text({ mode: "json" })
      .$type<GeneratedArtifactManifestV1>()
      .notNull(),
    manifestDigest: text().notNull(),
    outputFileId: text().references(() => files.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    outputDigest: text().notNull(),
    outputMime: text().notNull(),
    byteSize: integer(),
    workflowRunId: text(),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("generated_artifact_revisions_artifact_revision_unique").on(
      table.artifactId,
      table.revision,
    ),
    index("generated_artifact_revisions_owner_idx").on(table.userId, table.id),
    index("generated_artifact_revisions_output_file_idx").on(
      table.outputFileId,
    ),
    check("generated_artifact_revision_positive", sql`${table.revision} >= 1`),
    check("generated_artifact_manifest_version_check", sql`${table.manifestVersion} = 1`),
    check(
      "generated_artifact_revision_state_check",
      sql`${table.state} in ('ready', 'failed', 'archived')`,
    ),
    check(
      "generated_artifact_revision_digest_check",
      sql`length(${table.manifestDigest}) = 64 and ${table.manifestDigest} not glob '*[^0-9a-f]*' and length(${table.outputDigest}) = 64 and ${table.outputDigest} not glob '*[^0-9a-f]*'`,
    ),
    check(
      "generated_artifact_revision_bytes_check",
      sql`${table.byteSize} is null or ${table.byteSize} >= 0`,
    ),
  ],
);

export const artifactRevisionParents = sqliteTable(
  "artifact_revision_parents",
  {
    artifactRevisionId: text()
      .notNull()
      .references(() => generatedArtifactRevisions.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    parentArtifactRevisionId: text()
      .notNull()
      .references(() => generatedArtifactRevisions.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
  },
  (table) => [
    primaryKey({ columns: [table.artifactRevisionId, table.parentArtifactRevisionId] }),
    index("artifact_revision_parents_parent_idx").on(
      table.parentArtifactRevisionId,
    ),
    check(
      "artifact_revision_parents_no_self_check",
      sql`${table.artifactRevisionId} != ${table.parentArtifactRevisionId}`,
    ),
  ],
);

export const artifactRevisionSources = sqliteTable(
  "artifact_revision_sources",
  {
    artifactRevisionId: text()
      .notNull()
      .references(() => generatedArtifactRevisions.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    sourceVersionId: text()
      .notNull()
      .references(() => contentVersions.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
  },
  (table) => [
    primaryKey({ columns: [table.artifactRevisionId, table.sourceVersionId] }),
    index("artifact_revision_sources_source_idx").on(table.sourceVersionId),
  ],
);

export const artifactWorkflowRuns = sqliteTable(
  "artifact_workflow_runs",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("awrun")),
    userId: owner(),
    projectId: text().references(() => studyProjects.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    artifactId: text()
      .notNull()
      .references(() => generatedArtifacts.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    kind: text().$type<GeneratedArtifactKind>().notNull(),
    status: text()
      .$type<ArtifactWorkflowStatus>()
      .notNull()
      .default("planned"),
    workflowId: text().notNull(),
    workflowVersion: integer().notNull(),
    inputDigest: text().notNull(),
    placement: text().$type<"core" | "node" | "unavailable">().notNull(),
    placementRef: text(),
    policyRef: text().notNull(),
    actionId: text().references(() => agentActions.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    currentStagePosition: integer().notNull().default(0),
    cancelRequestedAt: integer({ mode: "timestamp" }),
    safeError: text(),
    reasonCode: text().$type<IngestionReasonCode>(),
    startedAt: integer({ mode: "timestamp" }),
    completedAt: integer({ mode: "timestamp" }),
    ...timestamps,
  },
  (table) => [
    index("artifact_workflow_runs_owner_status_idx").on(
      table.userId,
      table.status,
      table.createdAt,
    ),
    index("artifact_workflow_runs_artifact_idx").on(table.artifactId),
    check(
      "artifact_workflow_runs_status_check",
      sql`${table.status} in ('planned', 'queued', 'running', 'awaiting_approval', 'completed', 'failed', 'cancelled', 'superseded')`,
    ),
    check(
      "artifact_workflow_runs_placement_check",
      sql`${table.placement} in ('core', 'node', 'unavailable')`,
    ),
    check(
      "artifact_workflow_runs_input_digest_check",
      sql`length(${table.inputDigest}) = 64 and ${table.inputDigest} not glob '*[^0-9a-f]*'`,
    ),
  ],
);

export const artifactWorkflowStages = sqliteTable(
  "artifact_workflow_stages",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("awstage")),
    userId: owner(),
    runId: text()
      .notNull()
      .references(() => artifactWorkflowRuns.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    key: text().notNull(),
    position: integer().notNull(),
    status: text()
      .$type<ArtifactWorkflowStatus>()
      .notNull()
      .default("planned"),
    attempt: integer().notNull().default(0),
    inputDigest: text().notNull(),
    outputArtifactRevisionId: text().references(
      () => generatedArtifactRevisions.id,
      { onDelete: "set null", onUpdate: "cascade" },
    ),
    jobId: text().references(() => jobs.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    placement: text().$type<"core" | "node" | "unavailable">().notNull(),
    processed: integer().notNull().default(0),
    total: integer().notNull().default(1),
    unit: text().notNull().default("stage"),
    message: text(),
    reasonCode: text().$type<IngestionReasonCode>(),
    safeError: text(),
    startedAt: integer({ mode: "timestamp" }),
    completedAt: integer({ mode: "timestamp" }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("artifact_workflow_stages_run_key_unique").on(
      table.runId,
      table.key,
    ),
    uniqueIndex("artifact_workflow_stages_run_position_unique").on(
      table.runId,
      table.position,
    ),
    index("artifact_workflow_stages_job_idx").on(table.jobId),
    check(
      "artifact_workflow_stages_status_check",
      sql`${table.status} in ('planned', 'queued', 'running', 'awaiting_approval', 'completed', 'failed', 'cancelled', 'superseded')`,
    ),
    check(
      "artifact_workflow_stages_progress_check",
      sql`${table.position} >= 0 and ${table.attempt} >= 0 and ${table.processed} >= 0 and ${table.total} > 0 and ${table.processed} <= ${table.total}`,
    ),
    check(
      "artifact_workflow_stages_input_digest_check",
      sql`length(${table.inputDigest}) = 64 and ${table.inputDigest} not glob '*[^0-9a-f]*'`,
    ),
  ],
);

export const artifactWorkflowStageAttempts = sqliteTable(
  "artifact_workflow_stage_attempts",
  {
    id: text()
      .notNull()
      .primaryKey()
      .$defaultFn(() => newId("awattempt")),
    userId: owner(),
    stageId: text()
      .notNull()
      .references(() => artifactWorkflowStages.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    attempt: integer().notNull(),
    jobId: text().references(() => jobs.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    status: text()
      .$type<"running" | "completed" | "failed" | "cancelled">()
      .notNull(),
    rendererProfile: text(),
    rendererImageDigest: text(),
    usageJson: text({ mode: "json" }).$type<Record<string, unknown>>(),
    safeError: text(),
    startedAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    completedAt: integer({ mode: "timestamp" }),
  },
  (table) => [
    uniqueIndex("artifact_workflow_stage_attempt_unique").on(
      table.stageId,
      table.attempt,
    ),
    index("artifact_workflow_stage_attempt_job_idx").on(table.jobId),
    check("artifact_workflow_stage_attempt_positive", sql`${table.attempt} >= 1`),
    check(
      "artifact_workflow_stage_attempt_status_check",
      sql`${table.status} in ('running', 'completed', 'failed', 'cancelled')`,
    ),
  ],
);

/** Typed timeline body for a video-timeline revision; immutable with its owner. */
export const videoTimelineManifests = sqliteTable(
  "video_timeline_manifests",
  {
    artifactRevisionId: text()
      .primaryKey()
      .references(() => generatedArtifactRevisions.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: owner(),
    schemaVersion: integer().notNull().default(1),
    timelineJson: text({ mode: "json" }).$type<VideoTimelineV1>().notNull(),
    digest: text().notNull(),
    durationMs: integer().notNull(),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("video_timeline_manifests_owner_idx").on(table.userId),
    check("video_timeline_schema_version_check", sql`${table.schemaVersion} = 1`),
    check("video_timeline_duration_check", sql`${table.durationMs} > 0`),
    check(
      "video_timeline_digest_check",
      sql`length(${table.digest}) = 64 and ${table.digest} not glob '*[^0-9a-f]*'`,
    ),
  ],
);
