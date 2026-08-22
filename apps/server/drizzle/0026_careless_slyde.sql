CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text DEFAULT 'local' NOT NULL,
	`storageKey` text NOT NULL,
	`url` text NOT NULL,
	`mimeType` text NOT NULL,
	`byteSize` integer NOT NULL,
	`purpose` text NOT NULL,
	`status` text DEFAULT 'stored' NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `files_user_id_idx` ON `files` (`userId`);--> statement-breakpoint
CREATE INDEX `files_purpose_idx` ON `files` (`purpose`);--> statement-breakpoint
CREATE UNIQUE INDEX `files_provider_key_unique` ON `files` (`provider`,`storageKey`);
