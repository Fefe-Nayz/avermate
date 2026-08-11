CREATE TABLE `friend_circle_members` (
	`id` text PRIMARY KEY NOT NULL,
	`circleId` text NOT NULL,
	`friendUserId` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`circleId`) REFERENCES `friend_circles`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`friendUserId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `friend_circle_members_unique` ON `friend_circle_members` (`circleId`,`friendUserId`);--> statement-breakpoint
CREATE INDEX `friend_circle_members_friend_idx` ON `friend_circle_members` (`friendUserId`);--> statement-breakpoint
CREATE TABLE `friend_circles` (
	`id` text PRIMARY KEY NOT NULL,
	`ownerUserId` text NOT NULL,
	`name` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `friend_circles_owner_idx` ON `friend_circles` (`ownerUserId`);--> statement-breakpoint
CREATE TABLE `friend_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`userLowId` text NOT NULL,
	`userHighId` text NOT NULL,
	`senderUserId` text NOT NULL,
	`recipientUserId` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`message` text,
	`expiresAt` integer NOT NULL,
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
CREATE TABLE `friendships` (
	`id` text PRIMARY KEY NOT NULL,
	`userLowId` text NOT NULL,
	`userHighId` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userLowId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userHighId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `friendships_pair_unique` ON `friendships` (`userLowId`,`userHighId`);--> statement-breakpoint
CREATE INDEX `friendships_low_idx` ON `friendships` (`userLowId`);--> statement-breakpoint
CREATE INDEX `friendships_high_idx` ON `friendships` (`userHighId`);--> statement-breakpoint
CREATE TABLE `group_invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`groupId` text NOT NULL,
	`createdByUserId` text NOT NULL,
	`policyVersion` integer NOT NULL,
	`tokenHash` text NOT NULL,
	`tokenPrefix` text NOT NULL,
	`targetEmailHash` text,
	`expiresAt` integer NOT NULL,
	`consumedAt` integer,
	`consumedByUserId` text,
	`revokedAt` integer,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`groupId`) REFERENCES `social_groups`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`consumedByUserId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_invitations_token_unique` ON `group_invitations` (`tokenHash`);--> statement-breakpoint
CREATE INDEX `group_invitations_group_idx` ON `group_invitations` (`groupId`);--> statement-breakpoint
CREATE TABLE `group_member_consent_fields` (
	`id` text PRIMARY KEY NOT NULL,
	`consentId` text NOT NULL,
	`fieldKey` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`consentId`) REFERENCES `group_member_consents`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_member_consent_fields_unique` ON `group_member_consent_fields` (`consentId`,`fieldKey`);--> statement-breakpoint
CREATE TABLE `group_member_consents` (
	`id` text PRIMARY KEY NOT NULL,
	`groupId` text NOT NULL,
	`userId` text NOT NULL,
	`policyVersion` integer NOT NULL,
	`status` text NOT NULL,
	`policyDigest` text NOT NULL,
	`acceptedAt` integer,
	`withdrawnAt` integer,
	`channel` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`groupId`) REFERENCES `social_groups`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_member_consents_policy_unique` ON `group_member_consents` (`groupId`,`userId`,`policyVersion`);--> statement-breakpoint
CREATE INDEX `group_member_consents_group_idx` ON `group_member_consents` (`groupId`,`policyVersion`);--> statement-breakpoint
CREATE TABLE `group_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`groupId` text NOT NULL,
	`userId` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`state` text DEFAULT 'consent_required' NOT NULL,
	`alias` text NOT NULL,
	`sharedYearId` text,
	`joinedAt` integer,
	`leftAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`groupId`) REFERENCES `social_groups`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`sharedYearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_memberships_user_unique` ON `group_memberships` (`groupId`,`userId`);--> statement-breakpoint
CREATE INDEX `group_memberships_user_state_idx` ON `group_memberships` (`userId`,`state`);--> statement-breakpoint
CREATE TABLE `group_policy_fields` (
	`id` text PRIMARY KEY NOT NULL,
	`policyVersionId` text NOT NULL,
	`fieldKey` text NOT NULL,
	`required` integer DEFAULT false NOT NULL,
	`exposure` text NOT NULL,
	FOREIGN KEY (`policyVersionId`) REFERENCES `group_policy_versions`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_policy_fields_unique` ON `group_policy_fields` (`policyVersionId`,`fieldKey`);--> statement-breakpoint
CREATE TABLE `group_policy_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`groupId` text NOT NULL,
	`version` integer NOT NULL,
	`purpose` text NOT NULL,
	`audienceDescription` text NOT NULL,
	`window` text NOT NULL,
	`digest` text NOT NULL,
	`rankingsEnabled` integer DEFAULT false NOT NULL,
	`createdByUserId` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`groupId`) REFERENCES `social_groups`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_policy_versions_number_unique` ON `group_policy_versions` (`groupId`,`version`);--> statement-breakpoint
CREATE INDEX `group_policy_versions_group_idx` ON `group_policy_versions` (`groupId`);--> statement-breakpoint
CREATE TABLE `group_ranking_opt_ins` (
	`id` text PRIMARY KEY NOT NULL,
	`groupId` text NOT NULL,
	`userId` text NOT NULL,
	`policyVersion` integer NOT NULL,
	`metric` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`groupId`) REFERENCES `social_groups`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_ranking_opt_ins_unique` ON `group_ranking_opt_ins` (`groupId`,`userId`,`policyVersion`,`metric`);--> statement-breakpoint
CREATE TABLE `social_aggregate_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`groupId` text NOT NULL,
	`groupRevision` integer NOT NULL,
	`policyVersion` integer NOT NULL,
	`metric` text NOT NULL,
	`payload` text NOT NULL,
	`memberCount` integer NOT NULL,
	`computedAt` integer NOT NULL,
	`expiresAt` integer NOT NULL,
	FOREIGN KEY (`groupId`) REFERENCES `social_groups`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `social_aggregate_cache_key_unique` ON `social_aggregate_cache` (`groupId`,`groupRevision`,`policyVersion`,`metric`);--> statement-breakpoint
CREATE TABLE `social_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actorUserId` text,
	`subjectUserId` text,
	`action` text NOT NULL,
	`entityType` text NOT NULL,
	`entityId` text,
	`changedKeys` text DEFAULT '[]' NOT NULL,
	`requestId` text,
	`occurredAt` integer NOT NULL,
	FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`subjectUserId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `social_audit_subject_idx` ON `social_audit_events` (`subjectUserId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `social_audit_entity_idx` ON `social_audit_events` (`entityType`,`entityId`);--> statement-breakpoint
CREATE TABLE `social_eligibility` (
	`userId` text PRIMARY KEY NOT NULL,
	`ageBand` text DEFAULT 'unknown' NOT NULL,
	`assuranceLevel` text DEFAULT 'none' NOT NULL,
	`providerRef` text,
	`verifiedAt` integer,
	`expiresAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `social_feature_consents` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`policyVersion` text NOT NULL,
	`actorType` text NOT NULL,
	`event` text NOT NULL,
	`guardianProviderRef` text,
	`channel` text NOT NULL,
	`occurredAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `social_consents_user_version_idx` ON `social_feature_consents` (`userId`,`policyVersion`);--> statement-breakpoint
CREATE INDEX `social_consents_occurred_idx` ON `social_feature_consents` (`occurredAt`);--> statement-breakpoint
CREATE TABLE `social_feature_flags` (
	`key` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`changedByUserId` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`changedByUserId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `social_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`ownerUserId` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`currentPolicyVersion` integer DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `social_groups_owner_idx` ON `social_groups` (`ownerUserId`);--> statement-breakpoint
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
CREATE TABLE `social_profile_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`fieldKey` text NOT NULL,
	`audience` text NOT NULL,
	`audienceId` text,
	`grantedAt` integer NOT NULL,
	`withdrawnAt` integer,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `social_profile_grants_scope_unique` ON `social_profile_grants` (`userId`,`fieldKey`,`audience`,`audienceId`);--> statement-breakpoint
CREATE INDEX `social_profile_grants_user_idx` ON `social_profile_grants` (`userId`);--> statement-breakpoint
CREATE TABLE `social_profiles` (
	`userId` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'off' NOT NULL,
	`discovery` text DEFAULT 'off' NOT NULL,
	`handle` text,
	`displayName` text DEFAULT '' NOT NULL,
	`bio` text DEFAULT '' NOT NULL,
	`educationBand` text DEFAULT 'unknown' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `social_profiles_handle_unique` ON `social_profiles` (`handle`);--> statement-breakpoint
CREATE TABLE `social_rate_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`subjectHash` text NOT NULL,
	`action` text NOT NULL,
	`windowStartedAt` integer NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	`expiresAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `social_rate_limits_window_unique` ON `social_rate_limits` (`subjectHash`,`action`,`windowStartedAt`);--> statement-breakpoint
CREATE INDEX `social_rate_limits_expiry_idx` ON `social_rate_limits` (`expiresAt`);--> statement-breakpoint
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
CREATE INDEX `social_reports_reporter_idx` ON `social_reports` (`reporterUserId`);--> statement-breakpoint
CREATE TABLE `user_blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`blockerUserId` text NOT NULL,
	`blockedUserId` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`blockerUserId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`blockedUserId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_blocks_direction_unique` ON `user_blocks` (`blockerUserId`,`blockedUserId`);--> statement-breakpoint
CREATE INDEX `user_blocks_blocked_idx` ON `user_blocks` (`blockedUserId`);--> statement-breakpoint
CREATE TABLE `feedback_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`feedbackId` text NOT NULL,
	`authorUserId` text,
	`body` text NOT NULL,
	`internal` integer DEFAULT true NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`feedbackId`) REFERENCES `feedback`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`authorUserId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `feedback_comments_feedback_idx` ON `feedback_comments` (`feedbackId`,`createdAt`);--> statement-breakpoint
CREATE TABLE `feedback_events` (
	`id` text PRIMARY KEY NOT NULL,
	`feedbackId` text NOT NULL,
	`actorUserId` text,
	`kind` text NOT NULL,
	`changedKeys` text DEFAULT '[]' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`feedbackId`) REFERENCES `feedback`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `feedback_events_feedback_idx` ON `feedback_events` (`feedbackId`,`createdAt`);--> statement-breakpoint
CREATE TABLE `feedback_labels` (
	`id` text PRIMARY KEY NOT NULL,
	`feedbackId` text NOT NULL,
	`label` text NOT NULL,
	`createdByUserId` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`feedbackId`) REFERENCES `feedback`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feedback_labels_unique` ON `feedback_labels` (`feedbackId`,`label`);--> statement-breakpoint
CREATE INDEX `feedback_labels_label_idx` ON `feedback_labels` (`label`);--> statement-breakpoint
ALTER TABLE `feedback` ADD `fingerprint` text;--> statement-breakpoint
ALTER TABLE `feedback` ADD `source` text DEFAULT 'form' NOT NULL;--> statement-breakpoint
ALTER TABLE `feedback` ADD `duplicateCount` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `feedback` ADD `priority` text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE `feedback` ADD `assignedToUserId` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `feedback` ADD `lastSeenAt` integer DEFAULT (unixepoch()) NOT NULL;--> statement-breakpoint
ALTER TABLE `feedback` ADD `resolvedAt` integer;--> statement-breakpoint
ALTER TABLE `feedback` ADD `revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `feedback_fingerprint_unique` ON `feedback` (`fingerprint`);--> statement-breakpoint
CREATE INDEX `feedback_triage_idx` ON `feedback` (`status`,`priority`,`lastSeenAt`);--> statement-breakpoint
CREATE INDEX `feedback_assignee_idx` ON `feedback` (`assignedToUserId`,`status`);--> statement-breakpoint
CREATE TRIGGER `group_policy_versions_immutable`
BEFORE UPDATE ON `group_policy_versions`
BEGIN
	SELECT RAISE(ABORT, 'group policy versions are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `group_policy_fields_immutable`
BEFORE UPDATE ON `group_policy_fields`
BEGIN
	SELECT RAISE(ABORT, 'group policy fields are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `social_feature_consents_append_only`
BEFORE UPDATE ON `social_feature_consents`
BEGIN
	SELECT RAISE(ABORT, 'social consent events are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `social_audit_events_append_only`
BEFORE UPDATE ON `social_audit_events`
BEGIN
	SELECT RAISE(ABORT, 'social audit events are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `feedback_events_append_only`
BEFORE UPDATE ON `feedback_events`
BEGIN
	SELECT RAISE(ABORT, 'feedback events are append-only');
END;
