-- The social rewrite: the consent/eligibility/policy machinery is removed and
-- the surviving tables are recreated in their simplified shape. Social data is
-- deliberately not carried over — the sharing semantics changed, so keeping
-- old rows would mean guessing what people meant under a different contract.
-- Friendships and blocks are the exception: their meaning is unchanged.

-- The academic-invalidation triggers wrote to social_groups.revision, which no
-- longer exists. They go first so the drops below cannot orphan them.
DROP TRIGGER IF EXISTS `social_invalidate_grades_insert`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `social_invalidate_grades_update`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `social_invalidate_grades_delete`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `social_invalidate_subjects_insert`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `social_invalidate_subjects_update`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `social_invalidate_subjects_delete`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `social_invalidate_goals_insert`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `social_invalidate_goals_update`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `social_invalidate_goals_delete`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `social_invalidate_years_update`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `social_invalidate_years_delete`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `group_policy_versions_immutable`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `group_policy_fields_immutable`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `social_feature_consents_append_only`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `social_audit_events_append_only`;--> statement-breakpoint

-- Ceremony tables with no successor.
DROP TABLE IF EXISTS `friend_circle_members`;--> statement-breakpoint
DROP TABLE IF EXISTS `friend_circles`;--> statement-breakpoint
DROP TABLE IF EXISTS `group_member_consent_fields`;--> statement-breakpoint
DROP TABLE IF EXISTS `group_member_consents`;--> statement-breakpoint
DROP TABLE IF EXISTS `group_policy_fields`;--> statement-breakpoint
DROP TABLE IF EXISTS `group_policy_versions`;--> statement-breakpoint
DROP TABLE IF EXISTS `group_ranking_opt_ins`;--> statement-breakpoint
DROP TABLE IF EXISTS `guardian_consent_requests`;--> statement-breakpoint
DROP TABLE IF EXISTS `social_aggregate_cache`;--> statement-breakpoint
DROP TABLE IF EXISTS `social_audit_events`;--> statement-breakpoint
DROP TABLE IF EXISTS `social_eligibility`;--> statement-breakpoint
DROP TABLE IF EXISTS `social_feature_consents`;--> statement-breakpoint
DROP TABLE IF EXISTS `social_feature_flags`;--> statement-breakpoint
DROP TABLE IF EXISTS `social_profile_grants`;--> statement-breakpoint
DROP TABLE IF EXISTS `social_rate_limits`;--> statement-breakpoint

-- Reshaped tables, recreated empty.
DROP TABLE IF EXISTS `group_invitations`;--> statement-breakpoint
DROP TABLE IF EXISTS `group_memberships`;--> statement-breakpoint
DROP TABLE IF EXISTS `social_groups`;--> statement-breakpoint
DROP TABLE IF EXISTS `social_notifications`;--> statement-breakpoint
DROP TABLE IF EXISTS `social_reports`;--> statement-breakpoint
DROP TABLE IF EXISTS `social_profiles`;--> statement-breakpoint
DROP TABLE IF EXISTS `friend_requests`;--> statement-breakpoint

CREATE TABLE `social_profiles` (
	`userId` text PRIMARY KEY NOT NULL,
	`handle` text,
	`shareGeneralAverage` integer DEFAULT true NOT NULL,
	`shareSubjectsMode` text DEFAULT 'all' NOT NULL,
	`sharedYearId` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`sharedYearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `social_profiles_handle_unique` ON `social_profiles` (`handle`);--> statement-breakpoint

CREATE TABLE `social_shared_subjects` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`subjectId` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`subjectId`) REFERENCES `subjects`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `social_shared_subjects_unique` ON `social_shared_subjects` (`userId`,`subjectId`);--> statement-breakpoint
CREATE INDEX `social_shared_subjects_user_idx` ON `social_shared_subjects` (`userId`);--> statement-breakpoint

CREATE TABLE `friend_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`userLowId` text NOT NULL,
	`userHighId` text NOT NULL,
	`senderUserId` text NOT NULL,
	`recipientUserId` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`message` text,
	`respondedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userLowId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userHighId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`senderUserId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`recipientUserId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `friend_requests_pair_unique` ON `friend_requests` (`userLowId`,`userHighId`);--> statement-breakpoint
CREATE INDEX `friend_requests_recipient_status_idx` ON `friend_requests` (`recipientUserId`,`status`);--> statement-breakpoint
CREATE INDEX `friend_requests_sender_status_idx` ON `friend_requests` (`senderUserId`,`status`);--> statement-breakpoint

CREATE TABLE `social_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`ownerUserId` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `social_groups_owner_idx` ON `social_groups` (`ownerUserId`);--> statement-breakpoint

CREATE TABLE `group_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`groupId` text NOT NULL,
	`userId` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`shareAverage` integer DEFAULT true NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`groupId`) REFERENCES `social_groups`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_memberships_user_unique` ON `group_memberships` (`groupId`,`userId`);--> statement-breakpoint
CREATE INDEX `group_memberships_user_idx` ON `group_memberships` (`userId`);--> statement-breakpoint

CREATE TABLE `group_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`groupId` text NOT NULL,
	`createdByUserId` text NOT NULL,
	`tokenHash` text NOT NULL,
	`tokenPrefix` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`useCount` integer DEFAULT 0 NOT NULL,
	`revokedAt` integer,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`groupId`) REFERENCES `social_groups`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_invitations_token_unique` ON `group_invitations` (`tokenHash`);--> statement-breakpoint
CREATE INDEX `group_invitations_group_idx` ON `group_invitations` (`groupId`);--> statement-breakpoint

CREATE TABLE `social_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`kind` text NOT NULL,
	`actorUserId` text,
	`entityType` text NOT NULL,
	`entityId` text,
	`safeParams` text DEFAULT '{}' NOT NULL,
	`readAt` integer,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `social_notifications_user_read_idx` ON `social_notifications` (`userId`,`readAt`);--> statement-breakpoint

CREATE TABLE `social_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`reporterUserId` text NOT NULL,
	`targetUserId` text,
	`groupId` text,
	`category` text NOT NULL,
	`message` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`assignedToUserId` text,
	`resolvedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`reporterUserId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`targetUserId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`groupId`) REFERENCES `social_groups`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`assignedToUserId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `social_reports_status_idx` ON `social_reports` (`status`,`priority`);--> statement-breakpoint
CREATE INDEX `social_reports_reporter_idx` ON `social_reports` (`reporterUserId`)
