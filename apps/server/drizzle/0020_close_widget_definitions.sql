-- Closes the widget-definition migration: the definition becomes the only
-- representation of a card, and the four columns that projected it are dropped.
--
-- PREREQUISITE: every row must already carry a definition. Run
--   bun run --cwd apps/server scripts/backfill-card-definitions.ts
-- first; it is idempotent and reconstructs a definition from the columns this
-- migration removes, so it cannot be run afterwards.
--
-- If any row is still missing one, the INSERT below fails on
-- `NOT NULL constraint failed: __new_dashboard_cards.definitionVersion` and the
-- whole migration rolls back — the old table is still there and nothing is lost.
-- That abort is the guard, deliberately: a card whose meaning cannot be read is
-- not something to carry forward quietly, and dropping the columns first would
-- destroy the only thing the backfill could have read.
--
-- The four triggers from 0017 are dropped and recreated around the rebuild.
-- Their bodies delete from `dashboard_cards`, and rebuilding a table means
-- dropping it: SQLite rewrites references inside triggers when a table is
-- renamed, so leaving them in place had them pointing at `__new_dashboard_cards`
-- after the rename — a table that no longer exists. Every cascade through the
-- reference rows then failed at run time with "no such table". They are dropped
-- before the rebuild and recreated verbatim after it.
DROP TRIGGER IF EXISTS `dashboard_card_subject_deleted`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `dashboard_card_custom_average_deleted`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `dashboard_card_goal_deleted`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `dashboard_card_period_deleted`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_dashboard_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`surface` text DEFAULT 'overview' NOT NULL,
	`goalId` text,
	`span` integer DEFAULT 1 NOT NULL,
	`title` text,
	`accent` text,
	`sortOrder` integer DEFAULT 0 NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`definitionVersion` integer NOT NULL,
	`definitionJson` text NOT NULL,
	`yearId` text NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`goalId`) REFERENCES `goals`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`yearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_dashboard_cards`("id", "surface", "goalId", "span", "title", "accent", "sortOrder", "hidden", "definitionVersion", "definitionJson", "yearId", "userId", "createdAt", "updatedAt") SELECT "id", "surface", "goalId", "span", "title", "accent", "sortOrder", "hidden", "definitionVersion", "definitionJson", "yearId", "userId", "createdAt", "updatedAt" FROM `dashboard_cards`;--> statement-breakpoint
DROP TABLE `dashboard_cards`;--> statement-breakpoint
ALTER TABLE `__new_dashboard_cards` RENAME TO `dashboard_cards`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `dashboard_cards_year_id_idx` ON `dashboard_cards` (`yearId`);--> statement-breakpoint
CREATE INDEX `dashboard_cards_user_id_idx` ON `dashboard_cards` (`userId`);--> statement-breakpoint
CREATE TRIGGER `dashboard_card_subject_deleted`
AFTER DELETE ON `subjects`
BEGIN
	DELETE FROM `dashboard_cards`
	WHERE `id` IN (
		SELECT `cardId`
		FROM `dashboard_card_references`
		WHERE `kind` = 'subject' AND `referenceId` = OLD.`id`
	);
END;
--> statement-breakpoint
CREATE TRIGGER `dashboard_card_custom_average_deleted`
AFTER DELETE ON `custom_averages`
BEGIN
	DELETE FROM `dashboard_cards`
	WHERE `id` IN (
		SELECT `cardId`
		FROM `dashboard_card_references`
		WHERE `kind` = 'custom-average' AND `referenceId` = OLD.`id`
	);
END;
--> statement-breakpoint
CREATE TRIGGER `dashboard_card_goal_deleted`
AFTER DELETE ON `goals`
BEGIN
	DELETE FROM `dashboard_cards`
	WHERE `id` IN (
		SELECT `cardId`
		FROM `dashboard_card_references`
		WHERE `kind` = 'goal' AND `referenceId` = OLD.`id`
	);
END;
--> statement-breakpoint
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
