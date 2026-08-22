CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`payload` text,
	`payloadVersion` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`maxAttempts` integer DEFAULT 3 NOT NULL,
	`runAt` integer NOT NULL,
	`lockedUntil` integer,
	`lockedBy` text,
	`idempotencyKey` text,
	`result` text,
	`error` text,
	`userId` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `jobs_status_run_at_idx` ON `jobs` (`status`,`runAt`);--> statement-breakpoint
CREATE INDEX `jobs_user_id_idx` ON `jobs` (`userId`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_user_kind_key_unique` ON `jobs` (`userId`,`kind`,`idempotencyKey`) WHERE "jobs"."userId" is not null and "jobs"."idempotencyKey" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_system_kind_key_unique` ON `jobs` (`kind`,`idempotencyKey`) WHERE "jobs"."userId" is null and "jobs"."idempotencyKey" is not null;