CREATE TABLE `study_document_references` (
	`documentId` text NOT NULL,
	`kind` text NOT NULL,
	`referenceId` text NOT NULL,
	PRIMARY KEY(`documentId`, `kind`, `referenceId`),
	FOREIGN KEY (`documentId`) REFERENCES `study_documents`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `study_document_references_lookup_idx` ON `study_document_references` (`kind`,`referenceId`);--> statement-breakpoint
CREATE TABLE `study_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text DEFAULT 'fiche' NOT NULL,
	`title` text NOT NULL,
	`bodyMarkdown` text DEFAULT '' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`metaVersion` integer DEFAULT 1 NOT NULL,
	`metaJson` text,
	`folderId` text,
	`subjectId` text,
	`yearId` text NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`folderId`) REFERENCES `material_folders`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`subjectId`) REFERENCES `subjects`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`yearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `study_documents_year_idx` ON `study_documents` (`yearId`);--> statement-breakpoint
CREATE INDEX `study_documents_folder_idx` ON `study_documents` (`folderId`);