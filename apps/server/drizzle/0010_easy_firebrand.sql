CREATE TABLE `announcement_preset_targets` (
	`announcementId` text NOT NULL,
	`presetId` text NOT NULL,
	FOREIGN KEY (`announcementId`) REFERENCES `announcements`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`presetId`) REFERENCES `preset_definitions`(`id`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `announcement_preset_targets_unique` ON `announcement_preset_targets` (`announcementId`,`presetId`);--> statement-breakpoint
CREATE INDEX `announcement_preset_targets_preset_idx` ON `announcement_preset_targets` (`presetId`);--> statement-breakpoint
ALTER TABLE `announcements` ADD `audience` text DEFAULT 'global' NOT NULL;--> statement-breakpoint
CREATE INDEX `announcements_audience_idx` ON `announcements` (`audience`);