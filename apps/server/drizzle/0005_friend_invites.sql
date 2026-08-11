CREATE TABLE `friend_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`createdByUserId` text NOT NULL,
	`tokenHash` text NOT NULL,
	`tokenPrefix` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`consumedAt` integer,
	`consumedByUserId` text,
	`revokedAt` integer,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`consumedByUserId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `friend_invitations_token_unique` ON `friend_invitations` (`tokenHash`);--> statement-breakpoint
CREATE INDEX `friend_invitations_owner_idx` ON `friend_invitations` (`createdByUserId`,`expiresAt`);