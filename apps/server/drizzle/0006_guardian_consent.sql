CREATE TABLE `guardian_consent_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`childUserId` text NOT NULL,
	`guardianEmailHash` text NOT NULL,
	`tokenHash` text NOT NULL,
	`tokenPrefix` text NOT NULL,
	`policyVersion` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expiresAt` integer NOT NULL,
	`respondedAt` integer,
	`guardianUserId` text,
	`guardianProviderRef` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`childUserId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`guardianUserId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `guardian_consent_requests_token_unique` ON `guardian_consent_requests` (`tokenHash`);--> statement-breakpoint
CREATE INDEX `guardian_consent_requests_child_status_idx` ON `guardian_consent_requests` (`childUserId`,`status`);--> statement-breakpoint
CREATE INDEX `guardian_consent_requests_expiry_idx` ON `guardian_consent_requests` (`expiresAt`);