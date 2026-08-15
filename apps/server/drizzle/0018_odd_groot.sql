CREATE TABLE `card_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`surfaces` text NOT NULL,
	`category` text DEFAULT 'general' NOT NULL,
	`definitionVersion` integer NOT NULL,
	`definitionJson` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`sortOrder` integer DEFAULT 0 NOT NULL,
	`createdByUserId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
