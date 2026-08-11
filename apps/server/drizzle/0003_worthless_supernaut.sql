CREATE TABLE `preset_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`featured` integer DEFAULT false NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`currentVersion` integer DEFAULT 1 NOT NULL,
	`createdByUserId` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `preset_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`presetId` text NOT NULL,
	`version` integer NOT NULL,
	`configuration` text NOT NULL,
	`changeNote` text DEFAULT '' NOT NULL,
	`createdByUserId` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`presetId`) REFERENCES `preset_definitions`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `preset_versions_number_unique` ON `preset_versions` (`presetId`,`version`);--> statement-breakpoint
CREATE INDEX `preset_versions_preset_idx` ON `preset_versions` (`presetId`);--> statement-breakpoint
CREATE TABLE `year_preset_memberships` (
	`yearId` text PRIMARY KEY NOT NULL,
	`presetId` text NOT NULL,
	`appliedVersion` integer NOT NULL,
	`mode` text DEFAULT 'linked' NOT NULL,
	`detachedReason` text,
	`detachedAt` integer,
	`lastSyncedAt` integer NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`yearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`presetId`) REFERENCES `preset_definitions`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `year_preset_memberships_preset_idx` ON `year_preset_memberships` (`presetId`);--> statement-breakpoint
CREATE INDEX `year_preset_memberships_user_idx` ON `year_preset_memberships` (`userId`);--> statement-breakpoint
CREATE TABLE `year_setup_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`idempotencyKey` text NOT NULL,
	`inputHash` text NOT NULL,
	`yearId` text NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`yearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `year_setup_requests_user_key_unique` ON `year_setup_requests` (`userId`,`idempotencyKey`);--> statement-breakpoint
CREATE INDEX `year_setup_requests_year_idx` ON `year_setup_requests` (`yearId`);--> statement-breakpoint
ALTER TABLE `custom_averages` ADD `presetNodeKey` text;--> statement-breakpoint
CREATE UNIQUE INDEX `custom_averages_year_preset_node_unique` ON `custom_averages` (`yearId`,`presetNodeKey`);--> statement-breakpoint
ALTER TABLE `subjects` ADD `presetNodeKey` text;--> statement-breakpoint
CREATE UNIQUE INDEX `subjects_year_preset_node_unique` ON `subjects` (`yearId`,`presetNodeKey`);