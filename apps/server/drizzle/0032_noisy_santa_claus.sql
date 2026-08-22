CREATE TABLE `sync_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`label` text NOT NULL,
	`baseUrl` text NOT NULL,
	`sealedCredentials` text NOT NULL,
	`caCertPem` text,
	`capabilities` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`lastSyncAt` integer,
	`lastError` text,
	`yearId` text NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`yearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sync_connections_user_idx` ON `sync_connections` (`userId`);--> statement-breakpoint
CREATE INDEX `sync_connections_year_idx` ON `sync_connections` (`yearId`);--> statement-breakpoint
CREATE TABLE `synced_resources` (
	`id` text PRIMARY KEY NOT NULL,
	`connectionId` text NOT NULL,
	`capability` text NOT NULL,
	`externalId` text NOT NULL,
	`externalModifiedAt` integer,
	`contentHash` text,
	`localKind` text NOT NULL,
	`localId` text NOT NULL,
	`syncedAt` integer NOT NULL,
	`userId` text NOT NULL,
	FOREIGN KEY (`connectionId`) REFERENCES `sync_connections`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `synced_resources_conn_ext_unique` ON `synced_resources` (`connectionId`,`externalId`);--> statement-breakpoint
CREATE INDEX `synced_resources_local_idx` ON `synced_resources` (`localKind`,`localId`);