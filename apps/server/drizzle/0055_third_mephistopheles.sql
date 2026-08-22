CREATE TABLE `content_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`versionId` text NOT NULL,
	`fileId` text NOT NULL,
	`role` text NOT NULL,
	`locatorJson` text,
	`altText` text,
	`contentHash` text NOT NULL,
	FOREIGN KEY (`versionId`) REFERENCES `content_versions`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`fileId`) REFERENCES `files`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "content_assets_role_check" CHECK("content_assets"."role" in ('inline-image', 'page-image', 'thumbnail', 'attachment')),
	CONSTRAINT "content_assets_hash_check" CHECK(length("content_assets"."contentHash") = 64 and "content_assets"."contentHash" not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE INDEX `content_assets_version_idx` ON `content_assets` (`versionId`);--> statement-breakpoint
CREATE INDEX `content_assets_file_idx` ON `content_assets` (`fileId`);--> statement-breakpoint
CREATE TABLE `content_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`versionId` text NOT NULL,
	`ordinal` integer NOT NULL,
	`text` text NOT NULL,
	`normalizedText` text NOT NULL,
	`tokenEstimate` integer NOT NULL,
	`contentHash` text NOT NULL,
	`locatorJson` text NOT NULL,
	`headingPathJson` text,
	`evidenceKind` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`versionId`) REFERENCES `content_versions`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "content_chunks_ordinal_check" CHECK("content_chunks"."ordinal" >= 0),
	CONSTRAINT "content_chunks_token_estimate_check" CHECK("content_chunks"."tokenEstimate" >= 0),
	CONSTRAINT "content_chunks_hash_check" CHECK(length("content_chunks"."contentHash") = 64 and "content_chunks"."contentHash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "content_chunks_evidence_check" CHECK("content_chunks"."evidenceKind" in ('native-text', 'ocr', 'transcript', 'visual-only'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_chunks_version_ordinal_unique` ON `content_chunks` (`versionId`,`ordinal`);--> statement-breakpoint
CREATE INDEX `content_chunks_version_idx` ON `content_chunks` (`versionId`,`id`);--> statement-breakpoint
CREATE TABLE `content_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`yearId` text,
	`subjectId` text,
	`originKind` text NOT NULL,
	`originId` text NOT NULL,
	`currentVersionId` text,
	`status` text DEFAULT 'registered' NOT NULL,
	`coverage` text DEFAULT 'unsupported' NOT NULL,
	`placement` text DEFAULT 'core' NOT NULL,
	`placementRef` text,
	`error` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`yearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`subjectId`) REFERENCES `subjects`(`id`) ON UPDATE cascade ON DELETE set null,
	CONSTRAINT "content_sources_origin_kind_check" CHECK("content_sources"."originKind" in ('material', 'study-document', 'recording', 'grade', 'subject', 'conversation', 'artifact')),
	CONSTRAINT "content_sources_status_check" CHECK("content_sources"."status" in ('registered', 'indexing', 'ready', 'partial', 'failed')),
	CONSTRAINT "content_sources_coverage_check" CHECK("content_sources"."coverage" in ('searchable-native-text', 'searchable-ocr', 'metadata-and-locators-only', 'unsupported')),
	CONSTRAINT "content_sources_placement_check" CHECK(("content_sources"."placement" = 'core' and "content_sources"."placementRef" is null) or ("content_sources"."placement" = 'node' and "content_sources"."placementRef" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_sources_identity_unique` ON `content_sources` (`userId`,`originKind`,`originId`);--> statement-breakpoint
CREATE INDEX `content_sources_owner_scope_idx` ON `content_sources` (`userId`,`yearId`,`subjectId`,`originKind`);--> statement-breakpoint
CREATE INDEX `content_sources_current_version_idx` ON `content_sources` (`currentVersionId`);--> statement-breakpoint
CREATE TABLE `content_version_references` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`ownerKind` text NOT NULL,
	`ownerId` text NOT NULL,
	`sourceVersionId` text NOT NULL,
	`chunkId` text,
	`locatorSchemaVersion` integer DEFAULT 1 NOT NULL,
	`locatorJson` text NOT NULL,
	`quotedContentHash` text,
	`referenceKey` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`sourceVersionId`) REFERENCES `content_versions`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`chunkId`) REFERENCES `content_chunks`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "content_version_references_owner_kind_check" CHECK("content_version_references"."ownerKind" in ('project-item', 'assistant-citation', 'conversation-summary', 'artifact-revision', 'export')),
	CONSTRAINT "content_version_references_locator_version_check" CHECK("content_version_references"."locatorSchemaVersion" = 1),
	CONSTRAINT "content_version_references_key_check" CHECK(length("content_version_references"."referenceKey") = 64 and "content_version_references"."referenceKey" not glob '*[^0-9a-f]*'),
	CONSTRAINT "content_version_references_quote_hash_check" CHECK("content_version_references"."quotedContentHash" is null or (length("content_version_references"."quotedContentHash") = 64 and "content_version_references"."quotedContentHash" not glob '*[^0-9a-f]*'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_version_references_owner_key_unique` ON `content_version_references` (`ownerKind`,`ownerId`,`referenceKey`);--> statement-breakpoint
CREATE INDEX `content_version_references_version_idx` ON `content_version_references` (`sourceVersionId`);--> statement-breakpoint
CREATE INDEX `content_version_references_user_idx` ON `content_version_references` (`userId`,`id`);--> statement-breakpoint
CREATE TABLE `content_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`sourceId` text NOT NULL,
	`versionKey` text NOT NULL,
	`contentHash` text NOT NULL,
	`extractorId` text NOT NULL,
	`extractorVersion` text NOT NULL,
	`mimeType` text,
	`language` text,
	`byteSize` integer,
	`locatorSchemaVersion` integer DEFAULT 1 NOT NULL,
	`metadataJson` text DEFAULT '{}' NOT NULL,
	`gcRequestedAt` integer,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`sourceId`) REFERENCES `content_sources`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "content_versions_hash_check" CHECK(length("content_versions"."contentHash") = 64 and "content_versions"."contentHash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "content_versions_locator_version_check" CHECK("content_versions"."locatorSchemaVersion" = 1),
	CONSTRAINT "content_versions_byte_size_check" CHECK("content_versions"."byteSize" is null or "content_versions"."byteSize" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_versions_source_key_unique` ON `content_versions` (`sourceId`,`versionKey`);--> statement-breakpoint
CREATE INDEX `content_versions_gc_idx` ON `content_versions` (`gcRequestedAt`);--> statement-breakpoint
CREATE TABLE `corpus_chunk_stages` (
	`id` text PRIMARY KEY NOT NULL,
	`stagingId` text NOT NULL,
	`chunkId` text NOT NULL,
	`ordinal` integer NOT NULL,
	`text` text NOT NULL,
	`normalizedText` text NOT NULL,
	`tokenEstimate` integer NOT NULL,
	`contentHash` text NOT NULL,
	`locatorJson` text NOT NULL,
	`headingPathJson` text,
	`evidenceKind` text NOT NULL,
	FOREIGN KEY (`stagingId`) REFERENCES `corpus_version_stages`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `corpus_chunk_stages_ordinal_unique` ON `corpus_chunk_stages` (`stagingId`,`ordinal`);--> statement-breakpoint
CREATE TABLE `corpus_version_stages` (
	`id` text PRIMARY KEY NOT NULL,
	`versionId` text NOT NULL,
	`sourceId` text NOT NULL,
	`userId` text NOT NULL,
	`versionKey` text NOT NULL,
	`contentHash` text NOT NULL,
	`extractorId` text NOT NULL,
	`extractorVersion` text NOT NULL,
	`mimeType` text,
	`language` text,
	`byteSize` integer,
	`locatorSchemaVersion` integer DEFAULT 1 NOT NULL,
	`metadataJson` text DEFAULT '{}' NOT NULL,
	`coverage` text NOT NULL,
	`alreadyCommitted` integer DEFAULT false NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`sourceId`) REFERENCES `content_sources`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `corpus_version_stages_owner_idx` ON `corpus_version_stages` (`userId`,`sourceId`);--> statement-breakpoint
CREATE UNIQUE INDEX `corpus_version_stages_source_key_unique` ON `corpus_version_stages` (`sourceId`,`versionKey`);--> statement-breakpoint
CREATE TABLE `material_artifact_segments` (
	`id` text PRIMARY KEY NOT NULL,
	`artifactId` text NOT NULL,
	`ordinal` integer NOT NULL,
	`text` text NOT NULL,
	`locatorJson` text NOT NULL,
	`contentHash` text NOT NULL,
	FOREIGN KEY (`artifactId`) REFERENCES `material_artifacts`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "material_artifact_segments_ordinal_check" CHECK("material_artifact_segments"."ordinal" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `material_artifact_segments_ordinal_unique` ON `material_artifact_segments` (`artifactId`,`ordinal`);--> statement-breakpoint
CREATE TABLE `study_project_items` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`kind` text NOT NULL,
	`referenceId` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`contextMode` text DEFAULT 'include' NOT NULL,
	`label` text,
	`addedAt` integer NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `study_projects`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "study_project_items_kind_check" CHECK("study_project_items"."kind" in ('material', 'study-document', 'recording', 'grade', 'subject', 'conversation', 'artifact')),
	CONSTRAINT "study_project_items_context_mode_check" CHECK("study_project_items"."contextMode" in ('include', 'on-demand', 'exclude')),
	CONSTRAINT "study_project_items_position_check" CHECK("study_project_items"."position" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `study_project_items_reference_unique` ON `study_project_items` (`projectId`,`kind`,`referenceId`);--> statement-breakpoint
CREATE INDEX `study_project_items_order_idx` ON `study_project_items` (`projectId`,`position`,`id`);--> statement-breakpoint
CREATE TABLE `study_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`yearId` text,
	`subjectId` text,
	`instructionsMarkdown` text,
	`contextPolicyVersion` integer DEFAULT 1 NOT NULL,
	`contextPolicyJson` text,
	`emoji` text,
	`color` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`starredAt` integer,
	`deletedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`yearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`subjectId`) REFERENCES `subjects`(`id`) ON UPDATE cascade ON DELETE set null,
	CONSTRAINT "study_projects_revision_check" CHECK("study_projects"."revision" >= 1 and "study_projects"."contextPolicyVersion" >= 1)
);
--> statement-breakpoint
CREATE INDEX `study_projects_owner_updated_idx` ON `study_projects` (`userId`,`deletedAt`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `study_projects_year_idx` ON `study_projects` (`userId`,`yearId`);--> statement-breakpoint

-- FTS bodies are an acceleration structure only. Ownership and filters always
-- come from the normal source/version/chunk/project tables before a body is read.
CREATE VIRTUAL TABLE `content_chunks_fts` USING fts5(
	`chunkId` UNINDEXED,
	`versionId` UNINDEXED,
	`sourceId` UNINDEXED,
	`ownerId` UNINDEXED,
	`text`,
	`normalizedText`,
	tokenize = 'unicode61 remove_diacritics 2',
	prefix = '2 3 4'
);--> statement-breakpoint

CREATE TRIGGER `content_chunks_fts_insert`
AFTER INSERT ON `content_chunks`
BEGIN
	INSERT INTO `content_chunks_fts` (`chunkId`, `versionId`, `sourceId`, `ownerId`, `text`, `normalizedText`)
	SELECT NEW.`id`, NEW.`versionId`, versions.`sourceId`, sources.`userId`, NEW.`text`, NEW.`normalizedText`
	FROM `content_versions` AS versions
	JOIN `content_sources` AS sources ON sources.`id` = versions.`sourceId`
	WHERE versions.`id` = NEW.`versionId`;
END;--> statement-breakpoint

CREATE TRIGGER `content_chunks_fts_delete`
AFTER DELETE ON `content_chunks`
BEGIN
	DELETE FROM `content_chunks_fts` WHERE `chunkId` = OLD.`id`;
END;--> statement-breakpoint

CREATE TRIGGER `content_versions_immutable_update`
BEFORE UPDATE OF `id`, `sourceId`, `versionKey`, `contentHash`, `extractorId`, `extractorVersion`, `mimeType`, `language`, `byteSize`, `locatorSchemaVersion`, `metadataJson`, `createdAt`
ON `content_versions`
BEGIN
	SELECT RAISE(ABORT, 'content versions are immutable');
END;--> statement-breakpoint

CREATE TRIGGER `content_chunks_immutable_update`
BEFORE UPDATE ON `content_chunks`
BEGIN
	SELECT RAISE(ABORT, 'content chunks are immutable');
END;--> statement-breakpoint

CREATE TRIGGER `material_artifact_segments_immutable_update`
BEFORE UPDATE ON `material_artifact_segments`
BEGIN
	SELECT RAISE(ABORT, 'material artifact segments are immutable');
END;--> statement-breakpoint

CREATE TRIGGER `content_sources_scope_insert`
BEFORE INSERT ON `content_sources`
WHEN
	(NEW.`yearId` IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM `years` WHERE `id` = NEW.`yearId` AND `userId` = NEW.`userId`
	)) OR
	(NEW.`subjectId` IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM `subjects`
		WHERE `id` = NEW.`subjectId` AND `userId` = NEW.`userId`
		AND (NEW.`yearId` IS NULL OR `yearId` = NEW.`yearId`)
	))
BEGIN
	SELECT RAISE(ABORT, 'content source scope is not owned');
END;--> statement-breakpoint

CREATE TRIGGER `content_sources_scope_update`
BEFORE UPDATE OF `userId`, `yearId`, `subjectId` ON `content_sources`
WHEN
	(NEW.`yearId` IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM `years` WHERE `id` = NEW.`yearId` AND `userId` = NEW.`userId`
	)) OR
	(NEW.`subjectId` IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM `subjects`
		WHERE `id` = NEW.`subjectId` AND `userId` = NEW.`userId`
		AND (NEW.`yearId` IS NULL OR `yearId` = NEW.`yearId`)
	))
BEGIN
	SELECT RAISE(ABORT, 'content source scope is not owned');
END;--> statement-breakpoint

CREATE TRIGGER `content_sources_current_version_update`
BEFORE UPDATE OF `currentVersionId` ON `content_sources`
WHEN NEW.`currentVersionId` IS NOT NULL AND NOT EXISTS (
	SELECT 1 FROM `content_versions`
	WHERE `id` = NEW.`currentVersionId` AND `sourceId` = NEW.`id`
)
BEGIN
	SELECT RAISE(ABORT, 'current version belongs to another source');
END;--> statement-breakpoint

CREATE TRIGGER `study_projects_scope_insert`
BEFORE INSERT ON `study_projects`
WHEN
	(NEW.`yearId` IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM `years` WHERE `id` = NEW.`yearId` AND `userId` = NEW.`userId`
	)) OR
	(NEW.`subjectId` IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM `subjects`
		WHERE `id` = NEW.`subjectId` AND `userId` = NEW.`userId`
		AND (NEW.`yearId` IS NULL OR `yearId` = NEW.`yearId`)
	))
BEGIN
	SELECT RAISE(ABORT, 'study project scope is not owned');
END;--> statement-breakpoint

CREATE TRIGGER `study_projects_scope_update`
BEFORE UPDATE OF `userId`, `yearId`, `subjectId` ON `study_projects`
WHEN
	(NEW.`yearId` IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM `years` WHERE `id` = NEW.`yearId` AND `userId` = NEW.`userId`
	)) OR
	(NEW.`subjectId` IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM `subjects`
		WHERE `id` = NEW.`subjectId` AND `userId` = NEW.`userId`
		AND (NEW.`yearId` IS NULL OR `yearId` = NEW.`yearId`)
	))
BEGIN
	SELECT RAISE(ABORT, 'study project scope is not owned');
END;--> statement-breakpoint

CREATE TRIGGER `study_project_items_scope_insert`
BEFORE INSERT ON `study_project_items`
WHEN NOT EXISTS (
	SELECT 1
	FROM `study_projects` AS projects
	JOIN `content_sources` AS sources
		ON sources.`userId` = projects.`userId`
		AND sources.`originKind` = NEW.`kind`
		AND sources.`originId` = NEW.`referenceId`
	WHERE projects.`id` = NEW.`projectId`
		AND (projects.`yearId` IS NULL OR sources.`yearId` IS NULL OR projects.`yearId` = sources.`yearId`)
)
BEGIN
	SELECT RAISE(ABORT, 'project item source is not owned or year-compatible');
END;--> statement-breakpoint

CREATE TRIGGER `study_project_items_scope_update`
BEFORE UPDATE OF `projectId`, `kind`, `referenceId` ON `study_project_items`
WHEN NOT EXISTS (
	SELECT 1
	FROM `study_projects` AS projects
	JOIN `content_sources` AS sources
		ON sources.`userId` = projects.`userId`
		AND sources.`originKind` = NEW.`kind`
		AND sources.`originId` = NEW.`referenceId`
	WHERE projects.`id` = NEW.`projectId`
		AND (projects.`yearId` IS NULL OR sources.`yearId` IS NULL OR projects.`yearId` = sources.`yearId`)
)
BEGIN
	SELECT RAISE(ABORT, 'project item source is not owned or year-compatible');
END;--> statement-breakpoint

CREATE TRIGGER `content_version_references_integrity_insert`
BEFORE INSERT ON `content_version_references`
WHEN NOT EXISTS (
	SELECT 1
	FROM `content_versions` AS versions
	JOIN `content_sources` AS sources ON sources.`id` = versions.`sourceId`
	WHERE versions.`id` = NEW.`sourceVersionId`
		AND sources.`userId` = NEW.`userId`
		AND (
			NEW.`chunkId` IS NULL OR EXISTS (
				SELECT 1 FROM `content_chunks`
				WHERE `id` = NEW.`chunkId` AND `versionId` = NEW.`sourceVersionId`
			)
		)
)
BEGIN
	SELECT RAISE(ABORT, 'citation version/chunk is not owned or mismatched');
END;--> statement-breakpoint

CREATE TRIGGER `content_version_references_integrity_update`
BEFORE UPDATE ON `content_version_references`
BEGIN
	SELECT RAISE(ABORT, 'content version references are immutable');
END;--> statement-breakpoint

CREATE TRIGGER `content_assets_owner_insert`
BEFORE INSERT ON `content_assets`
WHEN NOT EXISTS (
	SELECT 1
	FROM `content_versions` AS versions
	JOIN `content_sources` AS sources ON sources.`id` = versions.`sourceId`
	JOIN `files` ON files.`id` = NEW.`fileId` AND files.`userId` = sources.`userId`
	WHERE versions.`id` = NEW.`versionId`
)
BEGIN
	SELECT RAISE(ABORT, 'content asset file is not owned');
END;
