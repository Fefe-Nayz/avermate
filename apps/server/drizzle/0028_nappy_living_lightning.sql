CREATE TABLE `grade_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`gradeId` text NOT NULL,
	`fileId` text NOT NULL,
	`label` text,
	`sortOrder` integer DEFAULT 0 NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`gradeId`) REFERENCES `grades`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`fileId`) REFERENCES `files`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `grade_attachments_grade_idx` ON `grade_attachments` (`gradeId`);--> statement-breakpoint
CREATE UNIQUE INDEX `grade_attachments_grade_file_unique` ON `grade_attachments` (`gradeId`,`fileId`);