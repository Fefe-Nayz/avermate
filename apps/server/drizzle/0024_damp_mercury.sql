ALTER TABLE `custom_averages` ADD `bonus` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `grades` ADD `bonus` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `subjects` ADD `bonus` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `years` ADD `mainAverageId` text;--> statement-breakpoint
ALTER TABLE `years` ADD `generalBonus` real DEFAULT 0 NOT NULL;