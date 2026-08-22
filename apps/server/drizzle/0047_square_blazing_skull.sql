CREATE TABLE `sync_grade_records` (
	`id` text PRIMARY KEY NOT NULL,
	`connectionId` text NOT NULL,
	`externalId` text NOT NULL,
	`externalModifiedAt` integer,
	`title` text NOT NULL,
	`providerSubjectExternalId` text NOT NULL,
	`providerSubjectName` text NOT NULL,
	`providerPeriodExternalId` text,
	`providerPeriodName` text,
	`passedAt` integer NOT NULL,
	`value` real,
	`outOf` real,
	`coefficient` real DEFAULT 1 NOT NULL,
	`significant` integer DEFAULT true NOT NULL,
	`syncState` text DEFAULT 'managed' NOT NULL,
	`localGradeId` text,
	`yearId` text NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`connectionId`) REFERENCES `sync_connections`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`localGradeId`) REFERENCES `grades`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`yearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "sync_grade_records_state_check" CHECK("sync_grade_records"."syncState" in ('managed', 'missing', 'dismissed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sync_grade_records_conn_external_unique` ON `sync_grade_records` (`connectionId`,`externalId`);--> statement-breakpoint
CREATE UNIQUE INDEX `sync_grade_records_local_grade_unique` ON `sync_grade_records` (`localGradeId`);--> statement-breakpoint
CREATE INDEX `sync_grade_records_owner_year_idx` ON `sync_grade_records` (`userId`,`yearId`);--> statement-breakpoint
CREATE INDEX `sync_grade_records_conn_state_idx` ON `sync_grade_records` (`connectionId`,`syncState`);--> statement-breakpoint
CREATE INDEX `sync_grade_records_subject_external_idx` ON `sync_grade_records` (`connectionId`,`providerSubjectExternalId`);--> statement-breakpoint
CREATE INDEX `sync_grade_records_period_external_idx` ON `sync_grade_records` (`connectionId`,`providerPeriodExternalId`);--> statement-breakpoint
CREATE TABLE `sync_period_mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`connectionId` text NOT NULL,
	`providerPeriodExternalId` text NOT NULL,
	`providerPeriodName` text NOT NULL,
	`periodId` text,
	`matchStatus` text NOT NULL,
	`yearId` text NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`connectionId`) REFERENCES `sync_connections`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`periodId`) REFERENCES `periods`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`yearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sync_period_mappings_conn_external_unique` ON `sync_period_mappings` (`connectionId`,`providerPeriodExternalId`);--> statement-breakpoint
CREATE INDEX `sync_period_mappings_owner_year_idx` ON `sync_period_mappings` (`userId`,`yearId`);--> statement-breakpoint
CREATE INDEX `sync_period_mappings_period_idx` ON `sync_period_mappings` (`periodId`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sync_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`label` text NOT NULL,
	`baseUrl` text NOT NULL,
	`sealedCredentials` text,
	`caCertPem` text,
	`capabilities` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`lastSyncAt` integer,
	`lastError` text,
	`remoteStudentId` text,
	`remoteAcademicYearId` text,
	`gradesAuthority` integer DEFAULT false NOT NULL,
	`disconnectedAt` integer,
	`yearId` text,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`yearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_sync_connections`("id", "provider", "label", "baseUrl", "sealedCredentials", "caCertPem", "capabilities", "status", "lastSyncAt", "lastError", "remoteStudentId", "remoteAcademicYearId", "gradesAuthority", "disconnectedAt", "yearId", "userId", "createdAt", "updatedAt") SELECT "id", "provider", "label", "baseUrl", "sealedCredentials", "caCertPem", "capabilities", "status", "lastSyncAt", "lastError", NULL, NULL, false, NULL, "yearId", "userId", "createdAt", "updatedAt" FROM `sync_connections`;--> statement-breakpoint
DROP TABLE `sync_connections`;--> statement-breakpoint
ALTER TABLE `__new_sync_connections` RENAME TO `sync_connections`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `sync_connections_user_idx` ON `sync_connections` (`userId`);--> statement-breakpoint
CREATE INDEX `sync_connections_year_idx` ON `sync_connections` (`yearId`);--> statement-breakpoint
CREATE UNIQUE INDEX `sync_connections_grades_authority_unique` ON `sync_connections` (`yearId`) WHERE "sync_connections"."gradesAuthority" = true and "sync_connections"."yearId" is not null;--> statement-breakpoint
ALTER TABLE `grades` ADD `excludedFromAverage` integer DEFAULT false NOT NULL;
