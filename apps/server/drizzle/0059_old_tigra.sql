CREATE TABLE `artifact_revision_parents` (
	`artifactRevisionId` text NOT NULL,
	`parentArtifactRevisionId` text NOT NULL,
	PRIMARY KEY(`artifactRevisionId`, `parentArtifactRevisionId`),
	FOREIGN KEY (`artifactRevisionId`) REFERENCES `generated_artifact_revisions`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`parentArtifactRevisionId`) REFERENCES `generated_artifact_revisions`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "artifact_revision_parents_no_self_check" CHECK("artifact_revision_parents"."artifactRevisionId" != "artifact_revision_parents"."parentArtifactRevisionId")
);
--> statement-breakpoint
CREATE INDEX `artifact_revision_parents_parent_idx` ON `artifact_revision_parents` (`parentArtifactRevisionId`);--> statement-breakpoint
CREATE TABLE `artifact_revision_sources` (
	`artifactRevisionId` text NOT NULL,
	`sourceVersionId` text NOT NULL,
	PRIMARY KEY(`artifactRevisionId`, `sourceVersionId`),
	FOREIGN KEY (`artifactRevisionId`) REFERENCES `generated_artifact_revisions`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`sourceVersionId`) REFERENCES `content_versions`(`id`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `artifact_revision_sources_source_idx` ON `artifact_revision_sources` (`sourceVersionId`);--> statement-breakpoint
CREATE TABLE `artifact_workflow_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`projectId` text,
	`artifactId` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`workflowId` text NOT NULL,
	`workflowVersion` integer NOT NULL,
	`inputDigest` text NOT NULL,
	`placement` text NOT NULL,
	`placementRef` text,
	`policyRef` text NOT NULL,
	`actionId` text,
	`currentStagePosition` integer DEFAULT 0 NOT NULL,
	`cancelRequestedAt` integer,
	`safeError` text,
	`reasonCode` text,
	`startedAt` integer,
	`completedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`projectId`) REFERENCES `study_projects`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`artifactId`) REFERENCES `generated_artifacts`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`actionId`) REFERENCES `agent_actions`(`id`) ON UPDATE cascade ON DELETE set null,
	CONSTRAINT "artifact_workflow_runs_status_check" CHECK("artifact_workflow_runs"."status" in ('planned', 'queued', 'running', 'awaiting_approval', 'completed', 'failed', 'cancelled', 'superseded')),
	CONSTRAINT "artifact_workflow_runs_placement_check" CHECK("artifact_workflow_runs"."placement" in ('core', 'node', 'unavailable')),
	CONSTRAINT "artifact_workflow_runs_input_digest_check" CHECK(length("artifact_workflow_runs"."inputDigest") = 64 and "artifact_workflow_runs"."inputDigest" not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE INDEX `artifact_workflow_runs_owner_status_idx` ON `artifact_workflow_runs` (`userId`,`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `artifact_workflow_runs_artifact_idx` ON `artifact_workflow_runs` (`artifactId`);--> statement-breakpoint
CREATE TABLE `artifact_workflow_stage_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`stageId` text NOT NULL,
	`attempt` integer NOT NULL,
	`jobId` text,
	`status` text NOT NULL,
	`rendererProfile` text,
	`rendererImageDigest` text,
	`usageJson` text,
	`safeError` text,
	`startedAt` integer NOT NULL,
	`completedAt` integer,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`stageId`) REFERENCES `artifact_workflow_stages`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`jobId`) REFERENCES `jobs`(`id`) ON UPDATE cascade ON DELETE set null,
	CONSTRAINT "artifact_workflow_stage_attempt_positive" CHECK("artifact_workflow_stage_attempts"."attempt" >= 1),
	CONSTRAINT "artifact_workflow_stage_attempt_status_check" CHECK("artifact_workflow_stage_attempts"."status" in ('running', 'completed', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `artifact_workflow_stage_attempt_unique` ON `artifact_workflow_stage_attempts` (`stageId`,`attempt`);--> statement-breakpoint
CREATE INDEX `artifact_workflow_stage_attempt_job_idx` ON `artifact_workflow_stage_attempts` (`jobId`);--> statement-breakpoint
CREATE TABLE `artifact_workflow_stages` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`runId` text NOT NULL,
	`key` text NOT NULL,
	`position` integer NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`inputDigest` text NOT NULL,
	`outputArtifactRevisionId` text,
	`jobId` text,
	`placement` text NOT NULL,
	`processed` integer DEFAULT 0 NOT NULL,
	`total` integer DEFAULT 1 NOT NULL,
	`unit` text DEFAULT 'stage' NOT NULL,
	`message` text,
	`reasonCode` text,
	`safeError` text,
	`startedAt` integer,
	`completedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`runId`) REFERENCES `artifact_workflow_runs`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`outputArtifactRevisionId`) REFERENCES `generated_artifact_revisions`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`jobId`) REFERENCES `jobs`(`id`) ON UPDATE cascade ON DELETE set null,
	CONSTRAINT "artifact_workflow_stages_status_check" CHECK("artifact_workflow_stages"."status" in ('planned', 'queued', 'running', 'awaiting_approval', 'completed', 'failed', 'cancelled', 'superseded')),
	CONSTRAINT "artifact_workflow_stages_progress_check" CHECK("artifact_workflow_stages"."position" >= 0 and "artifact_workflow_stages"."attempt" >= 0 and "artifact_workflow_stages"."processed" >= 0 and "artifact_workflow_stages"."total" > 0 and "artifact_workflow_stages"."processed" <= "artifact_workflow_stages"."total"),
	CONSTRAINT "artifact_workflow_stages_input_digest_check" CHECK(length("artifact_workflow_stages"."inputDigest") = 64 and "artifact_workflow_stages"."inputDigest" not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `artifact_workflow_stages_run_key_unique` ON `artifact_workflow_stages` (`runId`,`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `artifact_workflow_stages_run_position_unique` ON `artifact_workflow_stages` (`runId`,`position`);--> statement-breakpoint
CREATE INDEX `artifact_workflow_stages_job_idx` ON `artifact_workflow_stages` (`jobId`);--> statement-breakpoint
CREATE TABLE `captured_source_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`ingestionRevisionId` text NOT NULL,
	`fileId` text,
	`contentAssetId` text,
	`state` text DEFAULT 'stored' NOT NULL,
	`originalUrl` text NOT NULL,
	`locatorJson` text,
	`mimeType` text,
	`width` integer,
	`height` integer,
	`byteSize` integer,
	`digest` text,
	`storagePlacement` text,
	`attribution` text,
	`reasonCode` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`ingestionRevisionId`) REFERENCES `source_ingestion_revisions`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`fileId`) REFERENCES `files`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`contentAssetId`) REFERENCES `content_assets`(`id`) ON UPDATE cascade ON DELETE set null,
	CONSTRAINT "captured_source_assets_state_check" CHECK("captured_source_assets"."state" in ('stored', 'blocked', 'missing')),
	CONSTRAINT "captured_source_assets_stored_shape_check" CHECK(("captured_source_assets"."state" = 'stored' and "captured_source_assets"."fileId" is not null and "captured_source_assets"."mimeType" is not null and "captured_source_assets"."width" > 0 and "captured_source_assets"."height" > 0 and "captured_source_assets"."byteSize" > 0 and length("captured_source_assets"."digest") = 64 and "captured_source_assets"."storagePlacement" in ('core', 'node')) or ("captured_source_assets"."state" != 'stored' and "captured_source_assets"."fileId" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `captured_source_assets_revision_url_unique` ON `captured_source_assets` (`ingestionRevisionId`,`originalUrl`);--> statement-breakpoint
CREATE INDEX `captured_source_assets_file_idx` ON `captured_source_assets` (`fileId`);--> statement-breakpoint
CREATE TABLE `generated_artifact_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`artifactId` text NOT NULL,
	`userId` text NOT NULL,
	`revision` integer NOT NULL,
	`kind` text NOT NULL,
	`state` text DEFAULT 'ready' NOT NULL,
	`manifestVersion` integer DEFAULT 1 NOT NULL,
	`manifestJson` text NOT NULL,
	`manifestDigest` text NOT NULL,
	`outputFileId` text,
	`outputDigest` text NOT NULL,
	`outputMime` text NOT NULL,
	`byteSize` integer,
	`workflowRunId` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`artifactId`) REFERENCES `generated_artifacts`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`outputFileId`) REFERENCES `files`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "generated_artifact_revision_positive" CHECK("generated_artifact_revisions"."revision" >= 1),
	CONSTRAINT "generated_artifact_manifest_version_check" CHECK("generated_artifact_revisions"."manifestVersion" = 1),
	CONSTRAINT "generated_artifact_revision_state_check" CHECK("generated_artifact_revisions"."state" in ('ready', 'failed', 'archived')),
	CONSTRAINT "generated_artifact_revision_digest_check" CHECK(length("generated_artifact_revisions"."manifestDigest") = 64 and "generated_artifact_revisions"."manifestDigest" not glob '*[^0-9a-f]*' and length("generated_artifact_revisions"."outputDigest") = 64 and "generated_artifact_revisions"."outputDigest" not glob '*[^0-9a-f]*'),
	CONSTRAINT "generated_artifact_revision_bytes_check" CHECK("generated_artifact_revisions"."byteSize" is null or "generated_artifact_revisions"."byteSize" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `generated_artifact_revisions_artifact_revision_unique` ON `generated_artifact_revisions` (`artifactId`,`revision`);--> statement-breakpoint
CREATE INDEX `generated_artifact_revisions_owner_idx` ON `generated_artifact_revisions` (`userId`,`id`);--> statement-breakpoint
CREATE INDEX `generated_artifact_revisions_output_file_idx` ON `generated_artifact_revisions` (`outputFileId`);--> statement-breakpoint
CREATE TABLE `generated_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`projectId` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`currentRevisionId` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`projectId`) REFERENCES `study_projects`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`currentRevisionId`) REFERENCES `generated_artifact_revisions`(`id`) ON UPDATE cascade ON DELETE set null,
	CONSTRAINT "generated_artifacts_revision_check" CHECK("generated_artifacts"."revision" >= 1),
	CONSTRAINT "generated_artifacts_kind_check" CHECK("generated_artifacts"."kind" in ('markdown', 'latex-source', 'pdf', 'slides-source', 'pptx', 'quiz', 'audio', 'image', 'anki', 'html', 'video-timeline', 'video', 'thumbnail')),
	CONSTRAINT "generated_artifacts_state_check" CHECK("generated_artifacts"."state" in ('active', 'archived', 'trashed'))
);
--> statement-breakpoint
CREATE INDEX `generated_artifacts_owner_project_idx` ON `generated_artifacts` (`userId`,`projectId`,`state`);--> statement-breakpoint
CREATE TABLE `source_ingestion_consents` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`purpose` text NOT NULL,
	`revision` text NOT NULL,
	`noticeDigest` text NOT NULL,
	`acceptedAt` integer NOT NULL,
	`revokedAt` integer,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "source_ingestion_consent_digest_check" CHECK(length("source_ingestion_consents"."noticeDigest") = 64 and "source_ingestion_consents"."noticeDigest" not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_ingestion_consents_owner_purpose_revision_unique` ON `source_ingestion_consents` (`userId`,`purpose`,`revision`);--> statement-breakpoint
CREATE TABLE `source_ingestion_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`documentId` text NOT NULL,
	`revision` integer NOT NULL,
	`strategy` text NOT NULL,
	`state` text DEFAULT 'planned' NOT NULL,
	`reasonCode` text,
	`safeError` text,
	`canonicalUrl` text NOT NULL,
	`finalUrl` text,
	`language` text,
	`policyRef` text NOT NULL,
	`policyDigest` text,
	`settingsVersion` integer DEFAULT 1 NOT NULL,
	`settingsJson` text DEFAULT '{}' NOT NULL,
	`diagnosticsVersion` integer,
	`diagnosticsJson` text,
	`resultDigest` text,
	`sourceVersionId` text,
	`jobId` text,
	`actionId` text,
	`startedAt` integer,
	`completedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`documentId`) REFERENCES `material_documents`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`sourceVersionId`) REFERENCES `content_versions`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`jobId`) REFERENCES `jobs`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`actionId`) REFERENCES `agent_actions`(`id`) ON UPDATE cascade ON DELETE set null,
	CONSTRAINT "source_ingestion_revision_positive" CHECK("source_ingestion_revisions"."revision" >= 1),
	CONSTRAINT "source_ingestion_strategy_check" CHECK("source_ingestion_revisions"."strategy" in ('static-html', 'browser-render', 'pdf', 'youtube')),
	CONSTRAINT "source_ingestion_state_check" CHECK("source_ingestion_revisions"."state" in ('planned', 'queued', 'running', 'ready', 'failed', 'cancelled', 'superseded')),
	CONSTRAINT "source_ingestion_reason_check" CHECK("source_ingestion_revisions"."reasonCode" is null or "source_ingestion_revisions"."reasonCode" in ('static_empty', 'dynamic_required', 'blocked_destination', 'authentication_required', 'content_too_large', 'publisher_denied', 'unsupported_content', 'captions_unavailable', 'permission_required', 'extractor_blocked', 'duration_limit', 'transcription_unavailable', 'upstream_changed', 'placement_unavailable', 'capability_disabled', 'request_limit', 'cancelled', 'internal_failure')),
	CONSTRAINT "source_ingestion_result_digest_check" CHECK("source_ingestion_revisions"."resultDigest" is null or (length("source_ingestion_revisions"."resultDigest") = 64 and "source_ingestion_revisions"."resultDigest" not glob '*[^0-9a-f]*'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_ingestion_revisions_document_revision_unique` ON `source_ingestion_revisions` (`documentId`,`revision`);--> statement-breakpoint
CREATE INDEX `source_ingestion_revisions_owner_state_idx` ON `source_ingestion_revisions` (`userId`,`state`,`createdAt`);--> statement-breakpoint
CREATE INDEX `source_ingestion_revisions_job_idx` ON `source_ingestion_revisions` (`jobId`);--> statement-breakpoint
CREATE TABLE `video_timeline_manifests` (
	`artifactRevisionId` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`schemaVersion` integer DEFAULT 1 NOT NULL,
	`timelineJson` text NOT NULL,
	`digest` text NOT NULL,
	`durationMs` integer NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`artifactRevisionId`) REFERENCES `generated_artifact_revisions`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "video_timeline_schema_version_check" CHECK("video_timeline_manifests"."schemaVersion" = 1),
	CONSTRAINT "video_timeline_duration_check" CHECK("video_timeline_manifests"."durationMs" > 0),
	CONSTRAINT "video_timeline_digest_check" CHECK(length("video_timeline_manifests"."digest") = 64 and "video_timeline_manifests"."digest" not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE INDEX `video_timeline_manifests_owner_idx` ON `video_timeline_manifests` (`userId`);
--> statement-breakpoint
CREATE TRIGGER `generated_artifact_revisions_immutable`
BEFORE UPDATE ON `generated_artifact_revisions`
BEGIN
  SELECT RAISE(ABORT, 'generated artifact revisions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `artifact_revision_parents_immutable`
BEFORE UPDATE ON `artifact_revision_parents`
BEGIN
  SELECT RAISE(ABORT, 'artifact revision parent edges are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `artifact_revision_sources_immutable`
BEFORE UPDATE ON `artifact_revision_sources`
BEGIN
  SELECT RAISE(ABORT, 'artifact revision source edges are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `video_timeline_manifests_immutable`
BEFORE UPDATE ON `video_timeline_manifests`
BEGIN
  SELECT RAISE(ABORT, 'video timeline manifests are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `artifact_revision_parent_owner_guard`
BEFORE INSERT ON `artifact_revision_parents`
WHEN NOT EXISTS (
  SELECT 1
  FROM `generated_artifact_revisions` child
  JOIN `generated_artifact_revisions` parent
    ON parent.`id` = NEW.`parentArtifactRevisionId`
  WHERE child.`id` = NEW.`artifactRevisionId`
    AND child.`userId` = parent.`userId`
)
BEGIN
  SELECT RAISE(ABORT, 'artifact revision parents must share an owner');
END;
--> statement-breakpoint
CREATE TRIGGER `artifact_revision_parent_cycle_guard`
BEFORE INSERT ON `artifact_revision_parents`
WHEN EXISTS (
  WITH RECURSIVE ancestors(`id`) AS (
    SELECT NEW.`parentArtifactRevisionId`
    UNION
    SELECT edge.`parentArtifactRevisionId`
    FROM `artifact_revision_parents` edge
    JOIN ancestors ON edge.`artifactRevisionId` = ancestors.`id`
  )
  SELECT 1 FROM ancestors WHERE `id` = NEW.`artifactRevisionId`
)
BEGIN
  SELECT RAISE(ABORT, 'artifact revision parent graph must be acyclic');
END;
--> statement-breakpoint
CREATE TRIGGER `artifact_revision_source_owner_guard`
BEFORE INSERT ON `artifact_revision_sources`
WHEN NOT EXISTS (
  SELECT 1
  FROM `generated_artifact_revisions` revision
  JOIN `content_versions` version
    ON version.`id` = NEW.`sourceVersionId`
  JOIN `content_sources` source
    ON source.`id` = version.`sourceId`
  WHERE revision.`id` = NEW.`artifactRevisionId`
    AND revision.`userId` = source.`userId`
)
BEGIN
  SELECT RAISE(ABORT, 'artifact revision sources must share an owner');
END;
--> statement-breakpoint
CREATE TRIGGER `generated_artifact_current_revision_insert_guard`
BEFORE INSERT ON `generated_artifacts`
WHEN NEW.`currentRevisionId` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `generated_artifact_revisions` revision
  WHERE revision.`id` = NEW.`currentRevisionId`
    AND revision.`artifactId` = NEW.`id`
    AND revision.`userId` = NEW.`userId`
    AND revision.`kind` = NEW.`kind`
    AND revision.`state` = 'ready'
)
BEGIN
  SELECT RAISE(ABORT, 'current revision must be a ready revision of the artifact');
END;
--> statement-breakpoint
CREATE TRIGGER `generated_artifact_current_revision_update_guard`
BEFORE UPDATE OF `currentRevisionId` ON `generated_artifacts`
WHEN NEW.`currentRevisionId` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `generated_artifact_revisions` revision
  WHERE revision.`id` = NEW.`currentRevisionId`
    AND revision.`artifactId` = NEW.`id`
    AND revision.`userId` = NEW.`userId`
    AND revision.`kind` = NEW.`kind`
    AND revision.`state` = 'ready'
)
BEGIN
  SELECT RAISE(ABORT, 'current revision must be a ready revision of the artifact');
END;
--> statement-breakpoint
CREATE TRIGGER `video_timeline_manifest_owner_guard`
BEFORE INSERT ON `video_timeline_manifests`
WHEN NOT EXISTS (
  SELECT 1 FROM `generated_artifact_revisions` revision
  WHERE revision.`id` = NEW.`artifactRevisionId`
    AND revision.`userId` = NEW.`userId`
    AND revision.`kind` = 'video-timeline'
)
BEGIN
  SELECT RAISE(ABORT, 'timeline manifest must belong to a video-timeline revision');
END;
