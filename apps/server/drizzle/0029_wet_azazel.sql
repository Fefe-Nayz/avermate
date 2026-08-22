CREATE TABLE `material_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`folderId` text,
	`sourceType` text DEFAULT 'file' NOT NULL,
	`fileId` text,
	`sourceUrl` text,
	`textContent` text,
	`origin` text DEFAULT 'manual' NOT NULL,
	`metaVersion` integer,
	`metaJson` text,
	`yearId` text NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`folderId`) REFERENCES `material_folders`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`fileId`) REFERENCES `files`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`yearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `material_documents_folder_idx` ON `material_documents` (`folderId`);--> statement-breakpoint
CREATE INDEX `material_documents_year_idx` ON `material_documents` (`yearId`);--> statement-breakpoint
CREATE TABLE `material_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`parentId` text,
	`subjectId` text,
	`origin` text DEFAULT 'manual' NOT NULL,
	`sortOrder` integer DEFAULT 0 NOT NULL,
	`yearId` text NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`subjectId`) REFERENCES `subjects`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`yearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `material_folders_year_idx` ON `material_folders` (`yearId`);--> statement-breakpoint
CREATE INDEX `material_folders_parent_idx` ON `material_folders` (`parentId`);