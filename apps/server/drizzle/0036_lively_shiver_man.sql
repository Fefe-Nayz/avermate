ALTER TABLE `oauth_clients` RENAME COLUMN "type" TO "applicationType";--> statement-breakpoint
CREATE TABLE `oauth_client_assertions` (
	`id` text PRIMARY KEY NOT NULL,
	`expiresAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `oauth_client_resources` (
	`id` text PRIMARY KEY NOT NULL,
	`clientId` text NOT NULL,
	`resourceId` text NOT NULL,
	`metadata` text,
	`createdAt` integer,
	FOREIGN KEY (`clientId`) REFERENCES `oauth_clients`(`clientId`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resourceId`) REFERENCES `oauth_resources`(`identifier`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oauth_client_resources_client_id_idx` ON `oauth_client_resources` (`clientId`);--> statement-breakpoint
CREATE INDEX `oauth_client_resources_resource_id_idx` ON `oauth_client_resources` (`resourceId`);--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_client_resources_client_resource_uidx` ON `oauth_client_resources` (`clientId`,`resourceId`);--> statement-breakpoint
CREATE TABLE `oauth_resources` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`name` text NOT NULL,
	`accessTokenTtl` integer,
	`refreshTokenTtl` integer,
	`signingAlgorithm` text,
	`signingKeyId` text,
	`allowedScopes` text,
	`customClaims` text,
	`dpopBoundAccessTokensRequired` integer DEFAULT false,
	`disabled` integer DEFAULT false,
	`createdAt` integer,
	`updatedAt` integer,
	`policyVersion` integer DEFAULT 1,
	`metadata` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_resources_identifier_unique` ON `oauth_resources` (`identifier`);--> statement-breakpoint
CREATE TABLE `academic_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`instructions` text,
	`assignedAt` integer,
	`dueAt` integer,
	`localNote` text,
	`completedAt` integer,
	`subjectId` text,
	`yearId` text NOT NULL,
	`userId` text NOT NULL,
	`sourceConnectionId` text,
	`externalId` text,
	`syncState` text DEFAULT 'detached' NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`subjectId`) REFERENCES `subjects`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`yearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`sourceConnectionId`) REFERENCES `sync_connections`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "academic_assignments_sync_state_check" CHECK("academic_assignments"."syncState" in ('managed', 'detached', 'missing', 'dismissed'))
);
--> statement-breakpoint
CREATE INDEX `academic_assignments_year_due_idx` ON `academic_assignments` (`yearId`,`dueAt`);--> statement-breakpoint
CREATE INDEX `academic_assignments_user_idx` ON `academic_assignments` (`userId`);--> statement-breakpoint
CREATE UNIQUE INDEX `academic_assignments_source_external_unique` ON `academic_assignments` (`sourceConnectionId`,`externalId`);--> statement-breakpoint
CREATE TABLE `calendar_events` (
	`id` text PRIMARY KEY NOT NULL,
	`eventKind` text DEFAULT 'event' NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`localNote` text,
	`startsAt` integer NOT NULL,
	`endsAt` integer,
	`allDay` integer DEFAULT false NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`location` text,
	`subjectId` text,
	`yearId` text NOT NULL,
	`userId` text NOT NULL,
	`sourceConnectionId` text,
	`externalId` text,
	`syncState` text DEFAULT 'detached' NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`subjectId`) REFERENCES `subjects`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`yearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`sourceConnectionId`) REFERENCES `sync_connections`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "calendar_events_kind_check" CHECK("calendar_events"."eventKind" in ('event', 'block', 'holiday', 'workday')),
	CONSTRAINT "calendar_events_window_check" CHECK("calendar_events"."endsAt" is null or "calendar_events"."endsAt" >= "calendar_events"."startsAt"),
	CONSTRAINT "calendar_events_sync_state_check" CHECK("calendar_events"."syncState" in ('managed', 'detached', 'missing', 'dismissed'))
);
--> statement-breakpoint
CREATE INDEX `calendar_events_year_window_idx` ON `calendar_events` (`yearId`,`startsAt`,`endsAt`);--> statement-breakpoint
CREATE INDEX `calendar_events_user_idx` ON `calendar_events` (`userId`);--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_events_source_external_unique` ON `calendar_events` (`sourceConnectionId`,`externalId`);--> statement-breakpoint
CREATE TABLE `planning_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`notes` text,
	`localNote` text,
	`scheduledAt` integer,
	`dueAt` integer,
	`status` text DEFAULT 'todo' NOT NULL,
	`completedAt` integer,
	`subjectId` text,
	`sortOrder` integer DEFAULT 0 NOT NULL,
	`yearId` text NOT NULL,
	`userId` text NOT NULL,
	`sourceConnectionId` text,
	`externalId` text,
	`syncState` text DEFAULT 'detached' NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`subjectId`) REFERENCES `subjects`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`yearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`sourceConnectionId`) REFERENCES `sync_connections`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "planning_tasks_status_check" CHECK("planning_tasks"."status" in ('todo', 'doing', 'done')),
	CONSTRAINT "planning_tasks_sync_state_check" CHECK("planning_tasks"."syncState" in ('managed', 'detached', 'missing', 'dismissed'))
);
--> statement-breakpoint
CREATE INDEX `planning_tasks_year_schedule_idx` ON `planning_tasks` (`yearId`,`scheduledAt`,`dueAt`);--> statement-breakpoint
CREATE INDEX `planning_tasks_user_status_idx` ON `planning_tasks` (`userId`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `planning_tasks_source_external_unique` ON `planning_tasks` (`sourceConnectionId`,`externalId`);--> statement-breakpoint
CREATE TABLE `timetable_occurrences` (
	`id` text PRIMARY KEY NOT NULL,
	`seriesId` text,
	`occurrenceDate` text NOT NULL,
	`title` text NOT NULL,
	`notes` text,
	`localNote` text,
	`startsAt` integer NOT NULL,
	`endsAt` integer NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`isException` integer DEFAULT false NOT NULL,
	`location` text,
	`subjectId` text,
	`yearId` text NOT NULL,
	`userId` text NOT NULL,
	`sourceConnectionId` text,
	`externalId` text,
	`syncState` text DEFAULT 'detached' NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`seriesId`) REFERENCES `timetable_series`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`subjectId`) REFERENCES `subjects`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`yearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`sourceConnectionId`) REFERENCES `sync_connections`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "timetable_occurrences_status_check" CHECK("timetable_occurrences"."status" in ('scheduled', 'cancelled')),
	CONSTRAINT "timetable_occurrences_window_check" CHECK("timetable_occurrences"."endsAt" > "timetable_occurrences"."startsAt"),
	CONSTRAINT "timetable_occurrences_sync_state_check" CHECK("timetable_occurrences"."syncState" in ('managed', 'detached', 'missing', 'dismissed'))
);
--> statement-breakpoint
CREATE INDEX `timetable_occurrences_year_window_idx` ON `timetable_occurrences` (`yearId`,`startsAt`,`endsAt`);--> statement-breakpoint
CREATE INDEX `timetable_occurrences_user_idx` ON `timetable_occurrences` (`userId`);--> statement-breakpoint
CREATE UNIQUE INDEX `timetable_occurrences_series_date_unique` ON `timetable_occurrences` (`seriesId`,`occurrenceDate`);--> statement-breakpoint
CREATE UNIQUE INDEX `timetable_occurrences_source_external_unique` ON `timetable_occurrences` (`sourceConnectionId`,`externalId`);--> statement-breakpoint
CREATE TABLE `timetable_series` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`notes` text,
	`localNote` text,
	`startsOn` text NOT NULL,
	`endsOn` text,
	`startMinutes` integer NOT NULL,
	`durationMinutes` integer NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`recurrenceFrequency` text DEFAULT 'weekly' NOT NULL,
	`recurrenceInterval` integer DEFAULT 1 NOT NULL,
	`recurrenceWeekdays` text NOT NULL,
	`location` text,
	`subjectId` text,
	`yearId` text NOT NULL,
	`userId` text NOT NULL,
	`sourceConnectionId` text,
	`externalId` text,
	`syncState` text DEFAULT 'detached' NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`subjectId`) REFERENCES `subjects`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`yearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`sourceConnectionId`) REFERENCES `sync_connections`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "timetable_series_frequency_check" CHECK("timetable_series"."recurrenceFrequency" in ('daily', 'weekly')),
	CONSTRAINT "timetable_series_interval_check" CHECK("timetable_series"."recurrenceInterval" >= 1 and "timetable_series"."recurrenceInterval" <= 52),
	CONSTRAINT "timetable_series_minutes_check" CHECK("timetable_series"."startMinutes" >= 0 and "timetable_series"."startMinutes" < 1440 and "timetable_series"."durationMinutes" > 0 and "timetable_series"."durationMinutes" <= 1440),
	CONSTRAINT "timetable_series_dates_check" CHECK("timetable_series"."endsOn" is null or "timetable_series"."endsOn" >= "timetable_series"."startsOn"),
	CONSTRAINT "timetable_series_sync_state_check" CHECK("timetable_series"."syncState" in ('managed', 'detached', 'missing', 'dismissed'))
);
--> statement-breakpoint
CREATE INDEX `timetable_series_year_dates_idx` ON `timetable_series` (`yearId`,`startsOn`,`endsOn`);--> statement-breakpoint
CREATE INDEX `timetable_series_user_idx` ON `timetable_series` (`userId`);--> statement-breakpoint
CREATE UNIQUE INDEX `timetable_series_source_external_unique` ON `timetable_series` (`sourceConnectionId`,`externalId`);--> statement-breakpoint
CREATE TABLE `period_general_adjustments` (
	`periodId` text PRIMARY KEY NOT NULL,
	`points` real NOT NULL,
	`yearId` text NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`periodId`) REFERENCES `periods`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`yearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `period_general_adjustments_year_idx` ON `period_general_adjustments` (`yearId`);--> statement-breakpoint
CREATE INDEX `period_general_adjustments_user_idx` ON `period_general_adjustments` (`userId`);--> statement-breakpoint
CREATE TABLE `subject_period_adjustments` (
	`periodId` text NOT NULL,
	`subjectId` text NOT NULL,
	`points` real NOT NULL,
	`yearId` text NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	PRIMARY KEY(`periodId`, `subjectId`),
	FOREIGN KEY (`periodId`) REFERENCES `periods`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`subjectId`) REFERENCES `subjects`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`yearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `subject_period_adjustments_year_idx` ON `subject_period_adjustments` (`yearId`);--> statement-breakpoint
CREATE INDEX `subject_period_adjustments_subject_idx` ON `subject_period_adjustments` (`subjectId`);--> statement-breakpoint
CREATE INDEX `subject_period_adjustments_user_idx` ON `subject_period_adjustments` (`userId`);--> statement-breakpoint
ALTER TABLE `oauth_clients` ADD `clientDiscoveryId` text;--> statement-breakpoint
ALTER TABLE `oauth_clients` ADD `clientCredentialsScopes` text;--> statement-breakpoint
ALTER TABLE `oauth_clients` ADD `backchannelLogoutUri` text;--> statement-breakpoint
ALTER TABLE `oauth_clients` ADD `backchannelLogoutSessionRequired` integer;--> statement-breakpoint
ALTER TABLE `oauth_clients` ADD `jwks` text;--> statement-breakpoint
ALTER TABLE `oauth_clients` ADD `jwksUri` text;--> statement-breakpoint
ALTER TABLE `oauth_clients` ADD `dpopBoundAccessTokens` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `oauth_clients` DROP COLUMN `public`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`accountId` text NOT NULL,
	`providerId` text NOT NULL,
	`issuer` text NOT NULL,
	`userId` text NOT NULL,
	`accessToken` text,
	`accessTokenExpiresAt` integer,
	`refreshToken` text,
	`refreshTokenExpiresAt` integer,
	`scope` text,
	`idToken` text,
	`password` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `__new_accounts` (
	`id`,
	`accountId`,
	`providerId`,
	`issuer`,
	`userId`,
	`accessToken`,
	`accessTokenExpiresAt`,
	`refreshToken`,
	`refreshTokenExpiresAt`,
	`scope`,
	`idToken`,
	`password`,
	`createdAt`,
	`updatedAt`
)
SELECT
	`id`,
	`accountId`,
	`providerId`,
	CASE
		WHEN `providerId` = 'credential' THEN 'local:credential'
		WHEN `providerId` = 'google' THEN 'https://accounts.google.com'
		ELSE 'local:oauth:' || `providerId`
	END,
	`userId`,
	`accessToken`,
	`accessTokenExpiresAt`,
	`refreshToken`,
	`refreshTokenExpiresAt`,
	`scope`,
	`idToken`,
	`password`,
	`createdAt`,
	`updatedAt`
FROM `accounts`;--> statement-breakpoint
DROP TABLE `accounts`;--> statement-breakpoint
ALTER TABLE `__new_accounts` RENAME TO `accounts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `accounts_user_id_idx` ON `accounts` (`userId`);--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_issuer_account_id_uidx` ON `accounts` (`issuer`,`accountId`);--> statement-breakpoint
ALTER TABLE `jwks` ADD `alg` text;--> statement-breakpoint
ALTER TABLE `jwks` ADD `crv` text;--> statement-breakpoint
ALTER TABLE `oauth_access_tokens` ADD `authorizationCodeId` text;--> statement-breakpoint
ALTER TABLE `oauth_access_tokens` ADD `resources` text;--> statement-breakpoint
ALTER TABLE `oauth_access_tokens` ADD `requestedUserInfoClaims` text;--> statement-breakpoint
ALTER TABLE `oauth_access_tokens` ADD `revoked` integer;--> statement-breakpoint
ALTER TABLE `oauth_access_tokens` ADD `confirmation` text;--> statement-breakpoint
CREATE INDEX `oauth_access_tokens_authorization_code_id_idx` ON `oauth_access_tokens` (`authorizationCodeId`);--> statement-breakpoint
ALTER TABLE `oauth_consents` ADD `resources` text;--> statement-breakpoint
ALTER TABLE `oauth_consents` ADD `requestedUserInfoClaims` text;--> statement-breakpoint
ALTER TABLE `oauth_refresh_tokens` ADD `authorizationCodeId` text;--> statement-breakpoint
ALTER TABLE `oauth_refresh_tokens` ADD `resources` text;--> statement-breakpoint
ALTER TABLE `oauth_refresh_tokens` ADD `requestedUserInfoClaims` text;--> statement-breakpoint
ALTER TABLE `oauth_refresh_tokens` ADD `rotatedAt` integer;--> statement-breakpoint
ALTER TABLE `oauth_refresh_tokens` ADD `rotationReplayResponse` text;--> statement-breakpoint
ALTER TABLE `oauth_refresh_tokens` ADD `rotationReplayExpiresAt` integer;--> statement-breakpoint
ALTER TABLE `oauth_refresh_tokens` ADD `confirmation` text;--> statement-breakpoint
CREATE INDEX `oauth_refresh_tokens_authorization_code_id_idx` ON `oauth_refresh_tokens` (`authorizationCodeId`);
