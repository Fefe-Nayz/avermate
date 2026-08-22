CREATE TABLE `material_tag_links` (
	`tagId` text NOT NULL,
	`targetKind` text NOT NULL,
	`targetId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	PRIMARY KEY(`tagId`, `targetKind`, `targetId`),
	FOREIGN KEY (`tagId`) REFERENCES `material_tags`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `material_tag_links_target_idx` ON `material_tag_links` (`targetKind`,`targetId`);--> statement-breakpoint
CREATE TABLE `material_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`subjectId` text,
	`yearId` text NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`subjectId`) REFERENCES `subjects`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`yearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `material_tags_year_idx` ON `material_tags` (`yearId`);--> statement-breakpoint
CREATE TABLE `content_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`accountLabel` text NOT NULL,
	`status` text DEFAULT 'connected' NOT NULL,
	`cursor` text,
	`subscriptionId` text,
	`subscriptionExpiresAt` integer,
	`lastSyncedAt` integer,
	`lastError` text,
	`scopeJson` text,
	`sealedCredentials` text NOT NULL,
	`webhookSecretHash` text,
	`yearId` text NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`yearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `content_connections_owner_year_idx` ON `content_connections` (`userId`,`yearId`);--> statement-breakpoint
CREATE INDEX `content_connections_subscription_idx` ON `content_connections` (`subscriptionId`);--> statement-breakpoint
CREATE TABLE `content_oauth_states` (
	`id` text PRIMARY KEY NOT NULL,
	`stateHash` text NOT NULL,
	`provider` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`yearId` text NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`yearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_oauth_states_hash_unique` ON `content_oauth_states` (`stateHash`);--> statement-breakpoint
CREATE INDEX `content_oauth_states_expiry_idx` ON `content_oauth_states` (`expiresAt`);--> statement-breakpoint
CREATE TABLE `study_document_builds` (
	`id` text PRIMARY KEY NOT NULL,
	`documentId` text NOT NULL,
	`revision` integer NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`pdfFileId` text,
	`log` text,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`documentId`) REFERENCES `study_documents`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`pdfFileId`) REFERENCES `files`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `study_document_builds_revision_unique` ON `study_document_builds` (`documentId`,`revision`);--> statement-breakpoint
CREATE INDEX `study_document_builds_document_idx` ON `study_document_builds` (`documentId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `study_document_builds_file_idx` ON `study_document_builds` (`pdfFileId`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_files` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text DEFAULT 'local' NOT NULL,
	`storageKey` text NOT NULL,
	`url` text NOT NULL,
	`mimeType` text NOT NULL,
	`byteSize` integer NOT NULL,
	`purpose` text NOT NULL,
	`status` text DEFAULT 'stored' NOT NULL,
	`previewFileId` text,
	`previewStatus` text DEFAULT 'pending' NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`previewFileId`) REFERENCES `files`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_files`("id", "provider", "storageKey", "url", "mimeType", "byteSize", "purpose", "status", "previewFileId", "previewStatus", "userId", "createdAt", "updatedAt") SELECT "id", "provider", "storageKey", "url", "mimeType", "byteSize", "purpose", "status", NULL, 'pending', "userId", "createdAt", "updatedAt" FROM `files`;--> statement-breakpoint
DROP TABLE `files`;--> statement-breakpoint
ALTER TABLE `__new_files` RENAME TO `files`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `files_user_id_idx` ON `files` (`userId`);--> statement-breakpoint
CREATE INDEX `files_purpose_idx` ON `files` (`purpose`);--> statement-breakpoint
CREATE UNIQUE INDEX `files_provider_key_unique` ON `files` (`provider`,`storageKey`);--> statement-breakpoint
CREATE INDEX `files_preview_file_idx` ON `files` (`previewFileId`);--> statement-breakpoint
ALTER TABLE `material_documents` ADD `connectionId` text REFERENCES content_connections(id) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `material_documents` ADD `externalId` text;--> statement-breakpoint
ALTER TABLE `material_documents` ADD `starredAt` integer;--> statement-breakpoint
ALTER TABLE `material_documents` ADD `deletedAt` integer;--> statement-breakpoint
ALTER TABLE `material_documents` ADD `deletedFrom` text;--> statement-breakpoint
CREATE UNIQUE INDEX `material_documents_connection_external_unique` ON `material_documents` (`connectionId`,`externalId`);--> statement-breakpoint
CREATE INDEX `material_documents_deleted_idx` ON `material_documents` (`userId`,`deletedAt`);--> statement-breakpoint
ALTER TABLE `material_folders` ADD `connectionId` text REFERENCES content_connections(id) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `material_folders` ADD `externalId` text;--> statement-breakpoint
ALTER TABLE `material_folders` ADD `starredAt` integer;--> statement-breakpoint
ALTER TABLE `material_folders` ADD `deletedAt` integer;--> statement-breakpoint
ALTER TABLE `material_folders` ADD `deletedFrom` text;--> statement-breakpoint
CREATE UNIQUE INDEX `material_folders_connection_external_unique` ON `material_folders` (`connectionId`,`externalId`);--> statement-breakpoint
CREATE INDEX `material_folders_deleted_idx` ON `material_folders` (`userId`,`deletedAt`);--> statement-breakpoint
ALTER TABLE `study_documents` ADD `starredAt` integer;--> statement-breakpoint
ALTER TABLE `study_documents` ADD `deletedAt` integer;--> statement-breakpoint
ALTER TABLE `study_documents` ADD `deletedFrom` text;--> statement-breakpoint
CREATE INDEX `study_documents_deleted_idx` ON `study_documents` (`userId`,`deletedAt`);--> statement-breakpoint
ALTER TABLE `lecture_recordings` ADD `starredAt` integer;--> statement-breakpoint
ALTER TABLE `lecture_recordings` ADD `deletedAt` integer;--> statement-breakpoint
ALTER TABLE `lecture_recordings` ADD `deletedFrom` text;--> statement-breakpoint
CREATE INDEX `lecture_recordings_deleted_idx` ON `lecture_recordings` (`userId`,`deletedAt`);
