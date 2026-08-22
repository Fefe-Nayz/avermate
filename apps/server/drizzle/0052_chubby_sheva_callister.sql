CREATE TABLE `document_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`documentId` text NOT NULL,
	`kind` text NOT NULL,
	`variant` text DEFAULT 'default' NOT NULL,
	`sourceRevision` integer NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`fileId` text,
	`log` text,
	`metaVersion` integer DEFAULT 1 NOT NULL,
	`metaJson` text,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`documentId`) REFERENCES `study_documents`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`fileId`) REFERENCES `files`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_artifacts_unique` ON `document_artifacts` (`documentId`,`kind`,`variant`,`sourceRevision`);--> statement-breakpoint
CREATE INDEX `document_artifacts_document_idx` ON `document_artifacts` (`documentId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `document_artifacts_file_idx` ON `document_artifacts` (`fileId`);--> statement-breakpoint
INSERT OR IGNORE INTO `document_artifacts` (`id`, `documentId`, `kind`, `variant`, `sourceRevision`, `status`, `fileId`, `log`, `metaVersion`, `metaJson`, `userId`, `createdAt`, `updatedAt`)
SELECT 'dart_' || `id`, `documentId`, 'pdf', 'default', `revision`, `status`, `pdfFileId`, `log`, 1, NULL, `userId`, `createdAt`, `updatedAt`
FROM `study_document_builds`;--> statement-breakpoint
INSERT OR IGNORE INTO `document_artifacts` (`id`, `documentId`, `kind`, `variant`, `sourceRevision`, `status`, `fileId`, `log`, `metaVersion`, `metaJson`, `userId`, `createdAt`, `updatedAt`)
SELECT 'dart_pptx_' || `documentId` || '_' || `revision`, `documentId`, 'pptx', 'default', `revision`, 'succeeded', `fileId`, NULL, 1, NULL, `userId`, `createdAt`, `updatedAt`
FROM `study_document_exports`;--> statement-breakpoint
CREATE TABLE `quiz_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`documentId` text NOT NULL,
	`sourceRevision` integer NOT NULL,
	`questionsJson` text NOT NULL,
	`startedAt` integer NOT NULL,
	`completedAt` integer,
	`score` real,
	`outOf` real,
	`answersJson` text,
	`subjectId` text,
	`yearId` text NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`documentId`) REFERENCES `study_documents`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`subjectId`) REFERENCES `subjects`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`yearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `quiz_attempts_document_idx` ON `quiz_attempts` (`documentId`,`startedAt`);--> statement-breakpoint
CREATE INDEX `quiz_attempts_subject_idx` ON `quiz_attempts` (`userId`,`subjectId`);--> statement-breakpoint
CREATE INDEX `quiz_attempts_year_idx` ON `quiz_attempts` (`userId`,`yearId`);--> statement-breakpoint
ALTER TABLE `content_connections` ADD `subscriptionResourceId` text;
