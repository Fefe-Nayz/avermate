PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text DEFAULT 'other' NOT NULL,
	`subject` text NOT NULL,
	`message` text NOT NULL,
	`stack` text,
	`errorDigest` text,
	`route` text,
	`attachmentUrl` text,
	`context` text DEFAULT '{}' NOT NULL,
	`fingerprint` text,
	`duplicateGroupKey` text,
	`source` text DEFAULT 'form' NOT NULL,
	`duplicateCount` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`assignedToUserId` text,
	`lastSeenAt` integer NOT NULL,
	`resolvedAt` integer,
	`revision` integer DEFAULT 1 NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`assignedToUserId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `__new_feedback` (
	`id`, `kind`, `subject`, `message`, `stack`, `errorDigest`, `route`,
	`attachmentUrl`, `context`, `fingerprint`, `duplicateGroupKey`, `source`,
	`duplicateCount`, `status`, `priority`, `assignedToUserId`, `lastSeenAt`,
	`resolvedAt`, `revision`, `userId`, `createdAt`, `updatedAt`
)
SELECT
	`id`, `kind`, `subject`, `message`, `stack`, `errorDigest`, `route`,
	`attachmentUrl`, `context`, `fingerprint`, `duplicateGroupKey`, `source`,
	`duplicateCount`, `status`, `priority`, `assignedToUserId`, `lastSeenAt`,
	`resolvedAt`, `revision`, `userId`, `createdAt`, `updatedAt`
FROM `feedback`;--> statement-breakpoint
DROP TABLE `feedback`;--> statement-breakpoint
ALTER TABLE `__new_feedback` RENAME TO `feedback`;--> statement-breakpoint
CREATE INDEX `feedback_user_id_idx` ON `feedback` (`userId`);--> statement-breakpoint
CREATE UNIQUE INDEX `feedback_fingerprint_unique` ON `feedback` (`fingerprint`);--> statement-breakpoint
CREATE INDEX `feedback_duplicate_group_idx` ON `feedback` (`duplicateGroupKey`,`lastSeenAt`);--> statement-breakpoint
CREATE INDEX `feedback_triage_idx` ON `feedback` (`status`,`priority`,`lastSeenAt`);--> statement-breakpoint
CREATE INDEX `feedback_assignee_idx` ON `feedback` (`assignedToUserId`,`status`);--> statement-breakpoint
CREATE TABLE `__new_social_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`ownerUserId` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`kind` text DEFAULT 'friends' NOT NULL,
	`showTrend` integer DEFAULT true NOT NULL,
	`showGradeCount` integer DEFAULT true NOT NULL,
	`cohortEnabled` integer DEFAULT false NOT NULL,
	`sharedSetupYearId` text,
	`sharedSetupConfig` text,
	`classTemplate` text,
	`state` text DEFAULT 'active' NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`sharedSetupYearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE set null
);--> statement-breakpoint
INSERT INTO `__new_social_groups` (
	`id`, `ownerUserId`, `name`, `description`, `kind`, `showTrend`,
	`showGradeCount`, `cohortEnabled`, `sharedSetupYearId`, `sharedSetupConfig`,
	`classTemplate`, `state`, `createdAt`, `updatedAt`
)
SELECT
	`id`, `ownerUserId`, `name`, `description`, `kind`, `showTrend`,
	`showGradeCount`, `cohortEnabled`, `sharedSetupYearId`, `sharedSetupConfig`,
	`classTemplate`, `state`, `createdAt`, `updatedAt`
FROM `social_groups`;--> statement-breakpoint
DROP TABLE `social_groups`;--> statement-breakpoint
ALTER TABLE `__new_social_groups` RENAME TO `social_groups`;--> statement-breakpoint
CREATE INDEX `social_groups_owner_idx` ON `social_groups` (`ownerUserId`);--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TEMP TABLE `__better_auth_17_credential_identity_guard` (
	`ready` integer NOT NULL,
	CONSTRAINT `better_auth_17_credential_identity_collision` CHECK (`ready` = 1)
);--> statement-breakpoint
INSERT INTO `__better_auth_17_credential_identity_guard` (`ready`)
SELECT 0
FROM `accounts`
WHERE `providerId` = 'credential'
GROUP BY `userId`
HAVING COUNT(*) > 1
LIMIT 1;--> statement-breakpoint
DROP TABLE `__better_auth_17_credential_identity_guard`;--> statement-breakpoint
UPDATE `accounts`
SET `accountId` = `userId`, `issuer` = 'local:credential'
WHERE `providerId` = 'credential'
	AND (`accountId` != `userId` OR `issuer` != 'local:credential');--> statement-breakpoint
UPDATE `accounts`
SET `issuer` = 'https://accounts.google.com'
WHERE `providerId` = 'google'
	AND `issuer` != 'https://accounts.google.com';--> statement-breakpoint
UPDATE `oauth_clients`
SET `clientCredentialsScopes` = '[]'
WHERE `clientCredentialsScopes` IS NULL;--> statement-breakpoint
UPDATE `oauth_clients`
SET `tokenEndpointAuthMethod` = 'client_secret_basic'
WHERE `tokenEndpointAuthMethod` IS NULL
	AND `clientSecret` IS NOT NULL;--> statement-breakpoint
UPDATE `oauth_clients`
SET `disabled` = true
WHERE `tokenEndpointAuthMethod` IS NULL
	OR (`applicationType` IS NOT NULL AND `applicationType` NOT IN ('web', 'native'))
	OR (`grantTypes` IS NOT NULL AND json_valid(`grantTypes`) = false)
	OR EXISTS (
		SELECT 1
		FROM json_each(CASE WHEN json_valid(`oauth_clients`.`grantTypes`) THEN `oauth_clients`.`grantTypes` ELSE '[]' END)
		WHERE json_each.value = 'client_credentials'
			AND `oauth_clients`.`clientCredentialsScopes` = '[]'
	);
