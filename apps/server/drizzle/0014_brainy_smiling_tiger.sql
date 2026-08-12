CREATE TABLE `group_comparisons` (
	`id` text PRIMARY KEY NOT NULL,
	`groupId` text NOT NULL,
	`kind` text DEFAULT 'general' NOT NULL,
	`subjectName` text,
	`sortOrder` integer DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`groupId`) REFERENCES `social_groups`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `group_comparisons_group_idx` ON `group_comparisons` (`groupId`);--> statement-breakpoint
-- Every existing group compared exactly one thing; carry that into rows.
INSERT INTO `group_comparisons` (`id`, `groupId`, `kind`, `subjectName`, `sortOrder`, `createdAt`)
SELECT 'sgcmp_' || lower(hex(randomblob(12))), `id`, 'general', NULL, 0, strftime('%s','now') FROM `social_groups`;--> statement-breakpoint
INSERT INTO `group_comparisons` (`id`, `groupId`, `kind`, `subjectName`, `sortOrder`, `createdAt`)
SELECT 'sgcmp_' || lower(hex(randomblob(12))), `id`, 'subject', `comparedSubjectName`, 1, strftime('%s','now') FROM `social_groups` WHERE `comparedSubjectName` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `social_groups` DROP COLUMN `comparedSubjectName`;
