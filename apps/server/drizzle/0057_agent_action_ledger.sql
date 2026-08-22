CREATE TABLE `agent_action_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`threadId` text,
	`branchId` text,
	`runId` text,
	`label` text,
	`status` text DEFAULT 'open' NOT NULL,
	`domainCursorBeforeRef` text NOT NULL,
	`domainCursorAfterRef` text,
	`createdAt` integer NOT NULL,
	`completedAt` integer,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "agent_action_batches_status_check" CHECK("agent_action_batches"."status" in ('open', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `agent_action_batches_user_created_idx` ON `agent_action_batches` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `agent_action_batches_branch_idx` ON `agent_action_batches` (`userId`,`branchId`);--> statement-breakpoint
CREATE TABLE `agent_action_dependencies` (
	`userId` text NOT NULL,
	`actionId` text NOT NULL,
	`dependsOnActionId` text NOT NULL,
	`scopeKind` text NOT NULL,
	`scopeId` text NOT NULL,
	`relation` text NOT NULL,
	`fenceVersion` integer NOT NULL,
	`createdAt` integer NOT NULL,
	PRIMARY KEY(`userId`, `actionId`, `dependsOnActionId`, `scopeKind`, `scopeId`),
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`actionId`) REFERENCES `agent_actions`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`dependsOnActionId`) REFERENCES `agent_actions`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "agent_action_dependencies_no_self_check" CHECK("agent_action_dependencies"."actionId" <> "agent_action_dependencies"."dependsOnActionId"),
	CONSTRAINT "agent_action_dependencies_scope_check" CHECK("agent_action_dependencies"."scopeKind" in ('branch', 'domain'))
);
--> statement-breakpoint
CREATE INDEX `agent_action_dependencies_reverse_idx` ON `agent_action_dependencies` (`userId`,`dependsOnActionId`);--> statement-breakpoint
CREATE TABLE `agent_action_dependency_fences` (
	`userId` text PRIMARY KEY NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `agent_action_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actionId` text NOT NULL,
	`sequence` integer NOT NULL,
	`eventKey` text NOT NULL,
	`type` text NOT NULL,
	`payloadJson` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`actionId`) REFERENCES `agent_actions`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_action_events_sequence_unique` ON `agent_action_events` (`actionId`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_action_events_key_unique` ON `agent_action_events` (`actionId`,`eventKey`);--> statement-breakpoint
CREATE TABLE `agent_action_resources` (
	`actionId` text NOT NULL,
	`resourceKind` text NOT NULL,
	`resourceId` text NOT NULL,
	`operation` text NOT NULL,
	`beforeRevision` text,
	`afterRevision` text,
	`beforeSnapshotJson` text,
	`afterSnapshotJson` text,
	`contentRefBefore` text,
	`contentRefAfter` text,
	PRIMARY KEY(`actionId`, `resourceKind`, `resourceId`, `operation`),
	FOREIGN KEY (`actionId`) REFERENCES `agent_actions`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "agent_action_resources_operation_check" CHECK("agent_action_resources"."operation" in ('create', 'update', 'trash', 'restore', 'delete', 'attach', 'detach', 'external'))
);
--> statement-breakpoint
CREATE INDEX `agent_action_resources_lookup_idx` ON `agent_action_resources` (`resourceKind`,`resourceId`,`actionId`);--> statement-breakpoint
CREATE TABLE `agent_action_sequences` (
	`userId` text PRIMARY KEY NOT NULL,
	`nextSequence` integer DEFAULT 0 NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `agent_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`batchId` text,
	`userId` text NOT NULL,
	`actorKind` text NOT NULL,
	`actorClientId` text,
	`threadId` text,
	`branchId` text,
	`runId` text,
	`toolCallId` text,
	`domainScopeKind` text,
	`domainScopeId` text,
	`toolId` text NOT NULL,
	`toolVersion` integer NOT NULL,
	`effect` text NOT NULL,
	`risk` text NOT NULL,
	`argumentsHash` text NOT NULL,
	`idempotencyKey` text NOT NULL,
	`actionSequence` integer NOT NULL,
	`redactedInputJson` text NOT NULL,
	`previewJson` text,
	`previewHash` text NOT NULL,
	`status` text DEFAULT 'reserved' NOT NULL,
	`resultSummaryJson` text,
	`modelProjectionJson` text,
	`uiProjectionJson` text,
	`safeError` text,
	`compensatorId` text,
	`compensationOfActionId` text,
	`crashRecovery` text DEFAULT 'inspect-required' NOT NULL,
	`startedAt` integer,
	`completedAt` integer,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`batchId`) REFERENCES `agent_action_batches`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`compensationOfActionId`) REFERENCES `agent_actions`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "agent_actions_sequence_check" CHECK("agent_actions"."actionSequence" > 0),
	CONSTRAINT "agent_actions_tool_version_check" CHECK("agent_actions"."toolVersion" > 0),
	CONSTRAINT "agent_actions_status_check" CHECK("agent_actions"."status" in ('reserved', 'awaiting-approval', 'executing', 'rejected', 'expired', 'completed', 'failed', 'inspect-required')),
	CONSTRAINT "agent_actions_actor_check" CHECK("agent_actions"."actorKind" in ('embedded-agent', 'mcp', 'user-undo', 'system'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_actions_idempotency_unique` ON `agent_actions` (`userId`,`toolId`,`toolVersion`,`idempotencyKey`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_actions_user_sequence_unique` ON `agent_actions` (`userId`,`actionSequence`);--> statement-breakpoint
CREATE INDEX `agent_actions_user_created_idx` ON `agent_actions` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `agent_actions_thread_idx` ON `agent_actions` (`userId`,`threadId`);--> statement-breakpoint
CREATE INDEX `agent_actions_scope_idx` ON `agent_actions` (`userId`,`domainScopeKind`,`domainScopeId`);--> statement-breakpoint
CREATE INDEX `agent_actions_compensation_idx` ON `agent_actions` (`userId`,`compensationOfActionId`);--> statement-breakpoint
CREATE TABLE `agent_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`actionId` text NOT NULL,
	`userId` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`argumentsHash` text NOT NULL,
	`previewHash` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`resolvedAt` integer,
	`resolutionContextJson` text,
	`leaseOwner` text,
	`leaseExpiresAt` integer,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`actionId`) REFERENCES `agent_actions`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "agent_approvals_state_check" CHECK("agent_approvals"."state" in ('pending', 'approved', 'rejected', 'expired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_approvals_action_unique` ON `agent_approvals` (`actionId`);--> statement-breakpoint
CREATE INDEX `agent_approvals_expiry_idx` ON `agent_approvals` (`state`,`expiresAt`);--> statement-breakpoint
ALTER TABLE `planning_tasks` ADD `revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `planning_tasks` ADD `trashedAt` integer;--> statement-breakpoint
CREATE INDEX `planning_tasks_user_trash_idx` ON `planning_tasks` (`userId`,`trashedAt`);