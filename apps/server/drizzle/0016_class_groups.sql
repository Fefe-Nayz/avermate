PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_group_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`groupId` text NOT NULL,
	`userId` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`shareAverage` integer DEFAULT false NOT NULL,
	`yearId` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`groupId`) REFERENCES `social_groups`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`yearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_group_memberships`("id", "groupId", "userId", "role", "shareAverage", "yearId", "createdAt", "updatedAt") SELECT "id", "groupId", "userId", "role", "shareAverage", NULL, "createdAt", "updatedAt" FROM `group_memberships`;--> statement-breakpoint
DROP TABLE `group_memberships`;--> statement-breakpoint
ALTER TABLE `__new_group_memberships` RENAME TO `group_memberships`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `group_memberships_user_unique` ON `group_memberships` (`groupId`,`userId`);--> statement-breakpoint
CREATE INDEX `group_memberships_user_idx` ON `group_memberships` (`userId`);--> statement-breakpoint
CREATE INDEX `group_memberships_year_idx` ON `group_memberships` (`yearId`);--> statement-breakpoint
ALTER TABLE `group_comparisons` ADD `subjectKey` text;--> statement-breakpoint
ALTER TABLE `social_groups` ADD `classTemplate` text;
