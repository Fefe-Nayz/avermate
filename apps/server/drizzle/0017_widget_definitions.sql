CREATE TABLE `dashboard_card_references` (
	`cardId` text NOT NULL,
	`kind` text NOT NULL,
	`referenceId` text NOT NULL,
	PRIMARY KEY(`cardId`, `kind`, `referenceId`),
	FOREIGN KEY (`cardId`) REFERENCES `dashboard_cards`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `dashboard_card_references_lookup_idx` ON `dashboard_card_references` (`kind`,`referenceId`);--> statement-breakpoint
ALTER TABLE `dashboard_cards` ADD `definitionVersion` integer;--> statement-breakpoint
ALTER TABLE `dashboard_cards` ADD `definitionJson` text;--> statement-breakpoint
INSERT OR IGNORE INTO `dashboard_card_references` (`cardId`, `kind`, `referenceId`)
SELECT
	`id`,
	CASE `targetKind`
		WHEN 'subject' THEN 'subject'
		WHEN 'custom' THEN 'custom-average'
	END,
	`targetId`
FROM `dashboard_cards`
WHERE `targetId` IS NOT NULL AND `targetKind` IN ('subject', 'custom');--> statement-breakpoint
INSERT OR IGNORE INTO `dashboard_card_references` (`cardId`, `kind`, `referenceId`)
SELECT `id`, 'goal', `goalId`
FROM `dashboard_cards`
WHERE `goalId` IS NOT NULL;--> statement-breakpoint
CREATE TRIGGER `dashboard_card_subject_deleted`
AFTER DELETE ON `subjects`
BEGIN
	DELETE FROM `dashboard_cards`
	WHERE `id` IN (
		SELECT `cardId`
		FROM `dashboard_card_references`
		WHERE `kind` = 'subject' AND `referenceId` = OLD.`id`
	);
END;--> statement-breakpoint
CREATE TRIGGER `dashboard_card_custom_average_deleted`
AFTER DELETE ON `custom_averages`
BEGIN
	DELETE FROM `dashboard_cards`
	WHERE `id` IN (
		SELECT `cardId`
		FROM `dashboard_card_references`
		WHERE `kind` = 'custom-average' AND `referenceId` = OLD.`id`
	);
END;--> statement-breakpoint
CREATE TRIGGER `dashboard_card_goal_deleted`
AFTER DELETE ON `goals`
BEGIN
	DELETE FROM `dashboard_cards`
	WHERE `id` IN (
		SELECT `cardId`
		FROM `dashboard_card_references`
		WHERE `kind` = 'goal' AND `referenceId` = OLD.`id`
	);
END;--> statement-breakpoint
CREATE TRIGGER `dashboard_card_period_deleted`
AFTER DELETE ON `periods`
BEGIN
	DELETE FROM `dashboard_cards`
	WHERE `id` IN (
		SELECT `cardId`
		FROM `dashboard_card_references`
		WHERE `kind` = 'period' AND `referenceId` = OLD.`id`
	);
END;
