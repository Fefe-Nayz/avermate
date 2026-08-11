CREATE TABLE `jwks` (
	`id` text PRIMARY KEY NOT NULL,
	`publicKey` text NOT NULL,
	`privateKey` text NOT NULL,
	`createdAt` integer NOT NULL,
	`expiresAt` integer
);
--> statement-breakpoint
CREATE TABLE `oauth_access_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`clientId` text NOT NULL,
	`sessionId` text,
	`userId` text,
	`referenceId` text,
	`refreshId` text,
	`expiresAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`scopes` text NOT NULL,
	FOREIGN KEY (`clientId`) REFERENCES `oauth_clients`(`clientId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sessionId`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`refreshId`) REFERENCES `oauth_refresh_tokens`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_access_tokens_token_unique` ON `oauth_access_tokens` (`token`);--> statement-breakpoint
CREATE INDEX `oauth_access_tokens_client_id_idx` ON `oauth_access_tokens` (`clientId`);--> statement-breakpoint
CREATE INDEX `oauth_access_tokens_session_id_idx` ON `oauth_access_tokens` (`sessionId`);--> statement-breakpoint
CREATE INDEX `oauth_access_tokens_user_id_idx` ON `oauth_access_tokens` (`userId`);--> statement-breakpoint
CREATE INDEX `oauth_access_tokens_refresh_id_idx` ON `oauth_access_tokens` (`refreshId`);--> statement-breakpoint
CREATE TABLE `oauth_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`clientId` text NOT NULL,
	`clientSecret` text,
	`disabled` integer DEFAULT false,
	`skipConsent` integer,
	`enableEndSession` integer,
	`subjectType` text,
	`scopes` text,
	`userId` text,
	`createdAt` integer,
	`updatedAt` integer,
	`name` text,
	`uri` text,
	`icon` text,
	`contacts` text,
	`tos` text,
	`policy` text,
	`softwareId` text,
	`softwareVersion` text,
	`softwareStatement` text,
	`redirectUris` text NOT NULL,
	`postLogoutRedirectUris` text,
	`tokenEndpointAuthMethod` text,
	`grantTypes` text,
	`responseTypes` text,
	`public` integer,
	`type` text,
	`requirePKCE` integer,
	`referenceId` text,
	`metadata` text,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_clients_clientId_unique` ON `oauth_clients` (`clientId`);--> statement-breakpoint
CREATE INDEX `oauth_clients_user_id_idx` ON `oauth_clients` (`userId`);--> statement-breakpoint
CREATE TABLE `oauth_consents` (
	`id` text PRIMARY KEY NOT NULL,
	`clientId` text NOT NULL,
	`userId` text,
	`referenceId` text,
	`scopes` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`clientId`) REFERENCES `oauth_clients`(`clientId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oauth_consents_client_id_idx` ON `oauth_consents` (`clientId`);--> statement-breakpoint
CREATE INDEX `oauth_consents_user_id_idx` ON `oauth_consents` (`userId`);--> statement-breakpoint
CREATE TABLE `oauth_refresh_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`clientId` text NOT NULL,
	`sessionId` text,
	`userId` text NOT NULL,
	`referenceId` text,
	`expiresAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`revoked` integer,
	`authTime` integer,
	`scopes` text NOT NULL,
	FOREIGN KEY (`clientId`) REFERENCES `oauth_clients`(`clientId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sessionId`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_refresh_tokens_token_unique` ON `oauth_refresh_tokens` (`token`);--> statement-breakpoint
CREATE INDEX `oauth_refresh_tokens_client_id_idx` ON `oauth_refresh_tokens` (`clientId`);--> statement-breakpoint
CREATE INDEX `oauth_refresh_tokens_session_id_idx` ON `oauth_refresh_tokens` (`sessionId`);--> statement-breakpoint
CREATE INDEX `oauth_refresh_tokens_user_id_idx` ON `oauth_refresh_tokens` (`userId`);--> statement-breakpoint
CREATE TABLE `mcp_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`toolName` text NOT NULL,
	`idempotencyKey` text NOT NULL,
	`argumentsHash` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`result` text,
	`createdAt` integer NOT NULL,
	`completedAt` integer,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_operations_replay_fence` ON `mcp_operations` (`userId`,`toolName`,`idempotencyKey`);--> statement-breakpoint
CREATE INDEX `mcp_operations_user_id_idx` ON `mcp_operations` (`userId`);