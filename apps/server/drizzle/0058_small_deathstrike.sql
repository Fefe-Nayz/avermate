CREATE TABLE `job_runtime_events` (
	`id` text PRIMARY KEY NOT NULL,
	`jobId` text NOT NULL,
	`userId` text NOT NULL,
	`sequence` integer NOT NULL,
	`type` text NOT NULL,
	`eventJson` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`jobId`) REFERENCES `jobs`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "job_runtime_events_sequence_check" CHECK("job_runtime_events"."sequence" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_runtime_events_job_sequence_unique` ON `job_runtime_events` (`jobId`,`sequence`);--> statement-breakpoint
CREATE INDEX `job_runtime_events_user_job_sequence_idx` ON `job_runtime_events` (`userId`,`jobId`,`sequence`);--> statement-breakpoint
CREATE TABLE `job_runtime_metadata` (
	`jobId` text PRIMARY KEY NOT NULL,
	`stage` text DEFAULT 'queued' NOT NULL,
	`cancellation` text DEFAULT 'none' NOT NULL,
	`leaseToken` text,
	`lastEventSequence` integer DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`jobId`) REFERENCES `jobs`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "job_runtime_metadata_stage_check" CHECK("job_runtime_metadata"."stage" in ('queued', 'leased', 'provisioning', 'running', 'snapshotting', 'adopting', 'terminal')),
	CONSTRAINT "job_runtime_metadata_cancellation_check" CHECK("job_runtime_metadata"."cancellation" in ('none', 'requested', 'acknowledged')),
	CONSTRAINT "job_runtime_metadata_sequence_check" CHECK("job_runtime_metadata"."lastEventSequence" >= 0)
);
--> statement-breakpoint
CREATE INDEX `job_runtime_metadata_stage_idx` ON `job_runtime_metadata` (`stage`,`cancellation`);--> statement-breakpoint
CREATE TABLE `workspace_snapshot_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`workspaceSnapshotId` text NOT NULL,
	`kind` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`availableAt` integer NOT NULL,
	`leaseOwner` text,
	`leaseExpiresAt` integer,
	`payloadDigest` text NOT NULL,
	`safeError` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`completedAt` integer,
	FOREIGN KEY (`workspaceSnapshotId`) REFERENCES `workspace_snapshots`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "workspace_snapshot_outbox_state_check" CHECK("workspace_snapshot_outbox"."state" in ('pending', 'leased', 'completed', 'failed')),
	CONSTRAINT "workspace_snapshot_outbox_kind_check" CHECK("workspace_snapshot_outbox"."kind" in ('capture', 'adopt', 'publish', 'gc')),
	CONSTRAINT "workspace_snapshot_outbox_attempt_check" CHECK("workspace_snapshot_outbox"."attempt" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_snapshot_outbox_record_kind_unique` ON `workspace_snapshot_outbox` (`workspaceSnapshotId`,`kind`);--> statement-breakpoint
CREATE INDEX `workspace_snapshot_outbox_ready_idx` ON `workspace_snapshot_outbox` (`state`,`availableAt`,`leaseExpiresAt`);--> statement-breakpoint
CREATE TABLE `workspace_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`threadId` text NOT NULL,
	`branchId` text NOT NULL,
	`sequence` integer NOT NULL,
	`requestId` text NOT NULL,
	`conversationCheckpointRef` text NOT NULL,
	`parentWorkspaceSnapshotRefJson` text,
	`imageTemplateRefJson` text NOT NULL,
	`imageDigest` text NOT NULL,
	`executionProfileId` text NOT NULL,
	`executionProfileVersion` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`workspaceSnapshotRefJson` text,
	`sandboxRuntimeCheckpointRefJson` text,
	`trustedObjectRef` text,
	`portableManifestDigest` text,
	`byteSize` integer,
	`fileCount` integer,
	`capturedProviderRefJson` text,
	`capturedTrustedObjectRef` text,
	`capturedManifestDigest` text,
	`capturedByteSize` integer,
	`capturedFileCount` integer,
	`safeError` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`committedAt` integer,
	`failedAt` integer,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`threadId`) REFERENCES `assistant_threads`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`branchId`) REFERENCES `assistant_branches`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`conversationCheckpointRef`) REFERENCES `assistant_conversation_checkpoints`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "workspace_snapshots_state_check" CHECK("workspace_snapshots"."state" in ('pending', 'committed', 'failed')),
	CONSTRAINT "workspace_snapshots_sequence_check" CHECK("workspace_snapshots"."sequence" >= 1),
	CONSTRAINT "workspace_snapshots_sizes_check" CHECK(("workspace_snapshots"."byteSize" is null or "workspace_snapshots"."byteSize" >= 0) and ("workspace_snapshots"."fileCount" is null or "workspace_snapshots"."fileCount" >= 0) and ("workspace_snapshots"."capturedByteSize" is null or "workspace_snapshots"."capturedByteSize" >= 0) and ("workspace_snapshots"."capturedFileCount" is null or "workspace_snapshots"."capturedFileCount" >= 0)),
	CONSTRAINT "workspace_snapshots_terminal_shape_check" CHECK(("workspace_snapshots"."state" = 'pending' and "workspace_snapshots"."committedAt" is null and "workspace_snapshots"."failedAt" is null) or ("workspace_snapshots"."state" = 'committed' and "workspace_snapshots"."workspaceSnapshotRefJson" is not null and "workspace_snapshots"."trustedObjectRef" is not null and "workspace_snapshots"."portableManifestDigest" is not null and "workspace_snapshots"."committedAt" is not null and "workspace_snapshots"."failedAt" is null) or ("workspace_snapshots"."state" = 'failed' and "workspace_snapshots"."failedAt" is not null and "workspace_snapshots"."committedAt" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_snapshots_user_request_unique` ON `workspace_snapshots` (`userId`,`requestId`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_snapshots_branch_sequence_unique` ON `workspace_snapshots` (`userId`,`branchId`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_snapshots_branch_checkpoint_committed_unique` ON `workspace_snapshots` (`userId`,`branchId`,`conversationCheckpointRef`) WHERE "workspace_snapshots"."state" = 'committed';--> statement-breakpoint
CREATE INDEX `workspace_snapshots_compatible_idx` ON `workspace_snapshots` (`userId`,`threadId`,`branchId`,`executionProfileId`,`executionProfileVersion`,`imageDigest`,`sequence`);