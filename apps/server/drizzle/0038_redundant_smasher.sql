CREATE TABLE `rate_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`subjectHash` text NOT NULL,
	`action` text NOT NULL,
	`windowStart` integer NOT NULL,
	`expiresAt` integer NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rate_limits_scope_window_unique` ON `rate_limits` (`subjectHash`,`action`,`windowStart`);--> statement-breakpoint
CREATE INDEX `rate_limits_expiry_idx` ON `rate_limits` (`expiresAt`);--> statement-breakpoint
CREATE TABLE `sync_subject_mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`connectionId` text NOT NULL,
	`providerSubjectExternalId` text NOT NULL,
	`providerSubjectName` text NOT NULL,
	`subjectId` text,
	`matchStatus` text NOT NULL,
	`yearId` text NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`connectionId`) REFERENCES `sync_connections`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`subjectId`) REFERENCES `subjects`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`yearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sync_subject_mappings_conn_external_unique` ON `sync_subject_mappings` (`connectionId`,`providerSubjectExternalId`);--> statement-breakpoint
CREATE INDEX `sync_subject_mappings_owner_year_idx` ON `sync_subject_mappings` (`userId`,`yearId`);--> statement-breakpoint
CREATE INDEX `sync_subject_mappings_subject_idx` ON `sync_subject_mappings` (`subjectId`);