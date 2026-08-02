CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`accountId` text NOT NULL,
	`providerId` text NOT NULL,
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
);
--> statement-breakpoint
CREATE INDEX `accounts_user_id_idx` ON `accounts` (`userId`);--> statement-breakpoint
CREATE INDEX `accounts_provider_idx` ON `accounts` (`accountId`,`providerId`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`ipAddress` text,
	`userAgent` text,
	`impersonatedBy` text,
	`userId` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_unique` ON `sessions` (`token`);--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`userId`);--> statement-breakpoint
CREATE INDEX `sessions_token_idx` ON `sessions` (`token`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`emailVerified` integer DEFAULT false NOT NULL,
	`avatarUrl` text,
	`role` text DEFAULT 'user' NOT NULL,
	`banned` integer DEFAULT false NOT NULL,
	`banReason` text,
	`banExpires` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `users_email_idx` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verifications_identifier_idx` ON `verifications` (`identifier`);--> statement-breakpoint
CREATE TABLE `announcement_views` (
	`id` text PRIMARY KEY NOT NULL,
	`announcementId` text NOT NULL,
	`userId` text NOT NULL,
	`seenAt` integer NOT NULL,
	FOREIGN KEY (`announcementId`) REFERENCES `announcements`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `announcement_views_unique` ON `announcement_views` (`announcementId`,`userId`);--> statement-breakpoint
CREATE TABLE `announcements` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`tone` text DEFAULT 'info' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`startsAt` integer,
	`endsAt` integer,
	`createdByUserId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `announcements_active_idx` ON `announcements` (`active`);--> statement-breakpoint
CREATE TABLE `custom_average_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`averageId` text NOT NULL,
	`subjectId` text NOT NULL,
	`coefficient` real,
	`includeChildren` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`averageId`) REFERENCES `custom_averages`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`subjectId`) REFERENCES `subjects`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custom_average_entries_unique` ON `custom_average_entries` (`averageId`,`subjectId`);--> statement-breakpoint
CREATE INDEX `custom_average_entries_average_idx` ON `custom_average_entries` (`averageId`);--> statement-breakpoint
CREATE TABLE `custom_averages` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`isMain` integer DEFAULT false NOT NULL,
	`sortOrder` integer DEFAULT 0 NOT NULL,
	`yearId` text NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`yearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `custom_averages_year_id_idx` ON `custom_averages` (`yearId`);--> statement-breakpoint
CREATE TABLE `dashboard_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`surface` text DEFAULT 'overview' NOT NULL,
	`metric` text NOT NULL,
	`targetKind` text DEFAULT 'general' NOT NULL,
	`targetId` text,
	`goalId` text,
	`display` text DEFAULT 'value' NOT NULL,
	`span` integer DEFAULT 1 NOT NULL,
	`title` text,
	`accent` text,
	`sortOrder` integer DEFAULT 0 NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`yearId` text NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`goalId`) REFERENCES `goals`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`yearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `dashboard_cards_year_id_idx` ON `dashboard_cards` (`yearId`);--> statement-breakpoint
CREATE INDEX `dashboard_cards_user_id_idx` ON `dashboard_cards` (`userId`);--> statement-breakpoint
CREATE TABLE `feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text DEFAULT 'other' NOT NULL,
	`subject` text NOT NULL,
	`message` text NOT NULL,
	`context` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `feedback_user_id_idx` ON `feedback` (`userId`);--> statement-breakpoint
CREATE TABLE `goals` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'general' NOT NULL,
	`referenceId` text,
	`targetRatio` real NOT NULL,
	`periodId` text,
	`dueAt` integer,
	`achievedAt` integer,
	`isPinned` integer DEFAULT false NOT NULL,
	`sortOrder` integer DEFAULT 0 NOT NULL,
	`yearId` text NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`periodId`) REFERENCES `periods`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`yearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `goals_year_id_idx` ON `goals` (`yearId`);--> statement-breakpoint
CREATE INDEX `goals_user_id_idx` ON `goals` (`userId`);--> statement-breakpoint
CREATE TABLE `grade_components` (
	`id` text PRIMARY KEY NOT NULL,
	`gradeId` text NOT NULL,
	`name` text NOT NULL,
	`value` real NOT NULL,
	`outOf` real NOT NULL,
	`coefficient` real DEFAULT 1 NOT NULL,
	`sortOrder` integer DEFAULT 0 NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`gradeId`) REFERENCES `grades`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `grade_components_grade_id_idx` ON `grade_components` (`gradeId`);--> statement-breakpoint
CREATE TABLE `grades` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`value` real NOT NULL,
	`outOf` real NOT NULL,
	`coefficient` real DEFAULT 1 NOT NULL,
	`isComposite` integer DEFAULT false NOT NULL,
	`note` text,
	`passedAt` integer NOT NULL,
	`subjectId` text NOT NULL,
	`periodId` text,
	`yearId` text NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`subjectId`) REFERENCES `subjects`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`periodId`) REFERENCES `periods`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`yearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `grades_subject_id_idx` ON `grades` (`subjectId`);--> statement-breakpoint
CREATE INDEX `grades_year_id_idx` ON `grades` (`yearId`);--> statement-breakpoint
CREATE INDEX `grades_user_id_idx` ON `grades` (`userId`);--> statement-breakpoint
CREATE INDEX `grades_passed_at_idx` ON `grades` (`passedAt`);--> statement-breakpoint
CREATE TABLE `periods` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`startAt` integer NOT NULL,
	`endAt` integer NOT NULL,
	`isCumulative` integer DEFAULT false NOT NULL,
	`sortOrder` integer DEFAULT 0 NOT NULL,
	`yearId` text NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`yearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `periods_year_id_idx` ON `periods` (`yearId`);--> statement-breakpoint
CREATE INDEX `periods_user_id_idx` ON `periods` (`userId`);--> statement-breakpoint
CREATE TABLE `preferences` (
	`userId` text PRIMARY KEY NOT NULL,
	`theme` text DEFAULT 'system' NOT NULL,
	`language` text DEFAULT 'system' NOT NULL,
	`themePreset` text DEFAULT 'default' NOT NULL,
	`customTheme` text DEFAULT '{}' NOT NULL,
	`themeShape` text DEFAULT '{}' NOT NULL,
	`seasonalThemesEnabled` integer DEFAULT true NOT NULL,
	`seasonalTheme` text DEFAULT 'auto' NOT NULL,
	`hapticsEnabled` integer DEFAULT true NOT NULL,
	`reduceMotion` integer DEFAULT false NOT NULL,
	`compactMode` integer DEFAULT false NOT NULL,
	`chartSettings` text DEFAULT '{}' NOT NULL,
	`unlockedThemes` text DEFAULT '[]' NOT NULL,
	`seenCelebrations` text DEFAULT '[]' NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `subjects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`shortName` text,
	`parentId` text,
	`coefficient` real DEFAULT 1 NOT NULL,
	`kind` text DEFAULT 'subject' NOT NULL,
	`isMain` integer DEFAULT false NOT NULL,
	`sortOrder` integer DEFAULT 0 NOT NULL,
	`yearId` text NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`yearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `subjects_year_id_idx` ON `subjects` (`yearId`);--> statement-breakpoint
CREATE INDEX `subjects_user_id_idx` ON `subjects` (`userId`);--> statement-breakpoint
CREATE INDEX `subjects_parent_id_idx` ON `subjects` (`parentId`);--> statement-breakpoint
CREATE TABLE `year_review_views` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`yearId` text NOT NULL,
	`reviewKey` text NOT NULL,
	`seenAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`yearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `year_review_views_unique` ON `year_review_views` (`userId`,`yearId`,`reviewKey`);--> statement-breakpoint
CREATE TABLE `years` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`startsAt` integer NOT NULL,
	`endsAt` integer NOT NULL,
	`scale` real DEFAULT 20 NOT NULL,
	`defaultOutOf` real DEFAULT 20 NOT NULL,
	`passingRatio` real DEFAULT 0.5 NOT NULL,
	`decimals` integer DEFAULT 2 NOT NULL,
	`presetId` text,
	`sortOrder` integer DEFAULT 0 NOT NULL,
	`archivedAt` integer,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `years_user_id_idx` ON `years` (`userId`);