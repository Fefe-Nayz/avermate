CREATE TABLE `user_service_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`sealedKey` text NOT NULL,
	`hint` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_service_keys_user_kind_unique` ON `user_service_keys` (`userId`,`kind`);