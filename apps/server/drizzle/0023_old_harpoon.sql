CREATE TABLE `grade_types` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`titlePrefix` text DEFAULT '' NOT NULL,
	`coefficient` real DEFAULT 1 NOT NULL,
	`outOf` real DEFAULT 20 NOT NULL,
	`accent` text,
	`sortOrder` integer DEFAULT 0 NOT NULL,
	`presetNodeKey` text,
	`yearId` text NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`yearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `grade_types_year_id_idx` ON `grade_types` (`yearId`);--> statement-breakpoint
CREATE UNIQUE INDEX `grade_types_year_preset_node_unique` ON `grade_types` (`yearId`,`presetNodeKey`);--> statement-breakpoint
ALTER TABLE `grades` ADD `typeId` text REFERENCES grade_types(id) ON UPDATE cascade ON DELETE set null;--> statement-breakpoint
CREATE INDEX `grades_type_id_idx` ON `grades` (`typeId`);