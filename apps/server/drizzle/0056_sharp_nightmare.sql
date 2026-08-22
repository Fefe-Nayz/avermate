CREATE TABLE `assistant_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`messageId` text NOT NULL,
	`kind` text NOT NULL,
	`referenceId` text NOT NULL,
	`snapshotVersion` text,
	`label` text NOT NULL,
	`fileId` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`messageId`) REFERENCES `assistant_messages`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`fileId`) REFERENCES `files`(`id`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_attachments_message_reference_unique` ON `assistant_attachments` (`messageId`,`kind`,`referenceId`);--> statement-breakpoint
CREATE INDEX `assistant_attachments_file_idx` ON `assistant_attachments` (`fileId`);--> statement-breakpoint
CREATE TABLE `assistant_branches` (
	`id` text PRIMARY KEY NOT NULL,
	`threadId` text NOT NULL,
	`name` text,
	`forkedFromMessageId` text,
	`headMessageId` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`threadId`) REFERENCES `assistant_threads`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assistant_branches_thread_idx` ON `assistant_branches` (`threadId`,`updatedAt`);--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_branches_thread_id_unique` ON `assistant_branches` (`threadId`,`id`);--> statement-breakpoint
CREATE TABLE `assistant_citations` (
	`id` text PRIMARY KEY NOT NULL,
	`messageId` text NOT NULL,
	`runId` text NOT NULL,
	`ordinal` integer NOT NULL,
	`proofHandleId` text NOT NULL,
	`claimPartId` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`messageId`) REFERENCES `assistant_messages`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`runId`) REFERENCES `assistant_runs`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`proofHandleId`) REFERENCES `assistant_context_proof_handles`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "assistant_citations_ordinal_check" CHECK("assistant_citations"."ordinal" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_citations_message_ordinal_unique` ON `assistant_citations` (`messageId`,`ordinal`);--> statement-breakpoint
CREATE INDEX `assistant_citations_proof_idx` ON `assistant_citations` (`proofHandleId`);--> statement-breakpoint
CREATE TABLE `assistant_context_manifests` (
	`id` text PRIMARY KEY NOT NULL,
	`runId` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`revision` integer NOT NULL,
	`budgetJson` text NOT NULL,
	`itemsJson` text NOT NULL,
	`digest` text NOT NULL,
	`committedAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`runId`) REFERENCES `assistant_runs`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "assistant_context_manifests_version_check" CHECK("assistant_context_manifests"."version" > 0),
	CONSTRAINT "assistant_context_manifests_revision_check" CHECK("assistant_context_manifests"."revision" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_context_manifests_revision_unique` ON `assistant_context_manifests` (`runId`,`revision`);--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_context_manifests_run_id_unique` ON `assistant_context_manifests` (`runId`,`id`);--> statement-breakpoint
CREATE TABLE `assistant_context_proof_handles` (
	`id` text PRIMARY KEY NOT NULL,
	`contextManifestId` text NOT NULL,
	`runId` text NOT NULL,
	`ordinal` integer NOT NULL,
	`contentVersionReferenceId` text NOT NULL,
	`sourceVersionId` text NOT NULL,
	`chunkId` text,
	`locatorSchemaVersion` integer DEFAULT 1 NOT NULL,
	`locatorJson` text NOT NULL,
	`evidenceDigest` text NOT NULL,
	`quotedContentHash` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`contextManifestId`) REFERENCES `assistant_context_manifests`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`runId`) REFERENCES `assistant_runs`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`contentVersionReferenceId`) REFERENCES `content_version_references`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`sourceVersionId`) REFERENCES `content_versions`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`chunkId`) REFERENCES `content_chunks`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "assistant_proof_handles_ordinal_check" CHECK("assistant_context_proof_handles"."ordinal" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_proof_handles_run_id_unique` ON `assistant_context_proof_handles` (`runId`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_proof_handles_manifest_ordinal_unique` ON `assistant_context_proof_handles` (`contextManifestId`,`ordinal`);--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_proof_handles_run_proof_unique` ON `assistant_context_proof_handles` (`runId`,`id`);--> statement-breakpoint
CREATE INDEX `assistant_proof_handles_reference_idx` ON `assistant_context_proof_handles` (`contentVersionReferenceId`);--> statement-breakpoint
CREATE TABLE `assistant_conversation_checkpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`threadId` text NOT NULL,
	`branchId` text NOT NULL,
	`runId` text NOT NULL,
	`inputMessageId` text NOT NULL,
	`outputMessageId` text,
	`parentCheckpointId` text,
	`appendKey` text NOT NULL,
	`afterEventSequence` integer NOT NULL,
	`runtimeId` text NOT NULL,
	`runtimeVersion` text NOT NULL,
	`graphSchemaVersion` integer NOT NULL,
	`stateDigest` text NOT NULL,
	`stateByteLength` integer NOT NULL,
	`temporaryBlobRef` text,
	`stateBlobRef` text,
	`status` text DEFAULT 'staging' NOT NULL,
	`failureCode` text,
	`committedAt` integer,
	`gcMarkedAt` integer,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`threadId`) REFERENCES `assistant_threads`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`branchId`) REFERENCES `assistant_branches`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`runId`) REFERENCES `assistant_runs`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`inputMessageId`) REFERENCES `assistant_messages`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`outputMessageId`) REFERENCES `assistant_messages`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`parentCheckpointId`) REFERENCES `assistant_conversation_checkpoints`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "assistant_checkpoints_status_check" CHECK("assistant_conversation_checkpoints"."status" in ('staging', 'committed', 'failed')),
	CONSTRAINT "assistant_checkpoints_sequence_check" CHECK("assistant_conversation_checkpoints"."afterEventSequence" >= 0),
	CONSTRAINT "assistant_checkpoints_length_check" CHECK("assistant_conversation_checkpoints"."stateByteLength" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_checkpoints_user_append_unique` ON `assistant_conversation_checkpoints` (`userId`,`appendKey`);--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_checkpoints_run_event_unique` ON `assistant_conversation_checkpoints` (`runId`,`afterEventSequence`) WHERE "assistant_conversation_checkpoints"."status" = 'committed';--> statement-breakpoint
CREATE INDEX `assistant_checkpoints_branch_created_idx` ON `assistant_conversation_checkpoints` (`branchId`,`createdAt`);--> statement-breakpoint
CREATE TABLE `assistant_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`threadId` text NOT NULL,
	`parentMessageId` text,
	`role` text NOT NULL,
	`authorship` text NOT NULL,
	`status` text NOT NULL,
	`partsVersion` integer DEFAULT 1 NOT NULL,
	`partsJson` text NOT NULL,
	`createdByRunId` text,
	`replacesMessageId` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`threadId`) REFERENCES `assistant_threads`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`parentMessageId`) REFERENCES `assistant_messages`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`replacesMessageId`) REFERENCES `assistant_messages`(`id`) ON UPDATE cascade ON DELETE set null,
	CONSTRAINT "assistant_messages_role_check" CHECK("assistant_messages"."role" in ('user', 'assistant', 'system', 'tool')),
	CONSTRAINT "assistant_messages_authorship_check" CHECK("assistant_messages"."authorship" in ('user', 'model', 'user-edited-model', 'application')),
	CONSTRAINT "assistant_messages_status_check" CHECK("assistant_messages"."status" in ('pending', 'streaming', 'complete', 'failed', 'cancelled')),
	CONSTRAINT "assistant_messages_parts_version_check" CHECK("assistant_messages"."partsVersion" > 0)
);
--> statement-breakpoint
CREATE INDEX `assistant_messages_thread_parent_idx` ON `assistant_messages` (`threadId`,`parentMessageId`,`createdAt`);--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_messages_thread_id_unique` ON `assistant_messages` (`threadId`,`id`);--> statement-breakpoint
CREATE TABLE `assistant_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`runId` text,
	`checkpointId` text,
	`eventId` text,
	`kind` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`availableAt` integer NOT NULL,
	`leaseOwner` text,
	`leaseExpiresAt` integer,
	`payloadDigest` text NOT NULL,
	`safeError` text,
	`publishedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`runId`) REFERENCES `assistant_runs`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`checkpointId`) REFERENCES `assistant_conversation_checkpoints`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "assistant_outbox_state_check" CHECK("assistant_outbox"."state" in ('pending', 'leased', 'published', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_outbox_event_unique` ON `assistant_outbox` (`eventId`) WHERE "assistant_outbox"."eventId" is not null;--> statement-breakpoint
CREATE INDEX `assistant_outbox_ready_idx` ON `assistant_outbox` (`state`,`availableAt`,`leaseExpiresAt`);--> statement-breakpoint
CREATE TABLE `assistant_run_events` (
	`id` text PRIMARY KEY NOT NULL,
	`runId` text NOT NULL,
	`sequence` integer NOT NULL,
	`eventId` text NOT NULL,
	`type` text NOT NULL,
	`payloadJson` text NOT NULL,
	`terminal` integer DEFAULT false NOT NULL,
	`emittedAt` integer NOT NULL,
	`persistedAt` integer NOT NULL,
	FOREIGN KEY (`runId`) REFERENCES `assistant_runs`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "assistant_run_events_sequence_check" CHECK("assistant_run_events"."sequence" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_run_events_sequence_unique` ON `assistant_run_events` (`runId`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_run_events_event_unique` ON `assistant_run_events` (`runId`,`eventId`);--> statement-breakpoint
CREATE INDEX `assistant_run_events_replay_idx` ON `assistant_run_events` (`runId`,`sequence`);--> statement-breakpoint
CREATE TABLE `assistant_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`threadId` text NOT NULL,
	`branchId` text NOT NULL,
	`inputMessageId` text NOT NULL,
	`outputMessageId` text,
	`reservedOutputMessageId` text NOT NULL,
	`parentRunId` text,
	`clientRequestId` text NOT NULL,
	`runtimeId` text NOT NULL,
	`runtimeVersion` text NOT NULL,
	`graphSchemaVersion` integer NOT NULL,
	`modelKey` text NOT NULL,
	`providerKey` text NOT NULL,
	`modelResolvedId` text,
	`status` text DEFAULT 'reserved' NOT NULL,
	`approvalMode` text DEFAULT 'read-only' NOT NULL,
	`providerRequestKey` text,
	`providerDispatchState` text DEFAULT 'pending' NOT NULL,
	`contextManifestId` text,
	`conversationCheckpointRef` text,
	`workspaceSnapshotRef` text,
	`sandboxRuntimeCheckpointRef` text,
	`domainCursorRef` text,
	`startedAt` integer,
	`completedAt` integer,
	`errorCode` text,
	`safeError` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`threadId`) REFERENCES `assistant_threads`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`branchId`) REFERENCES `assistant_branches`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`inputMessageId`) REFERENCES `assistant_messages`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`outputMessageId`) REFERENCES `assistant_messages`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`parentRunId`) REFERENCES `assistant_runs`(`id`) ON UPDATE cascade ON DELETE set null,
	CONSTRAINT "assistant_runs_status_check" CHECK("assistant_runs"."status" in ('reserved', 'running', 'waiting-for-user', 'complete', 'failed', 'cancelled')),
	CONSTRAINT "assistant_runs_approval_mode_check" CHECK("assistant_runs"."approvalMode" in ('read-only', 'confirm-writes', 'auto-reversible')),
	CONSTRAINT "assistant_runs_dispatch_state_check" CHECK("assistant_runs"."providerDispatchState" in ('pending', 'dispatching', 'acknowledged', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_runs_thread_client_request_unique` ON `assistant_runs` (`threadId`,`clientRequestId`);--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_runs_output_message_unique` ON `assistant_runs` (`outputMessageId`);--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_runs_reserved_output_unique` ON `assistant_runs` (`reservedOutputMessageId`);--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_runs_branch_active_unique` ON `assistant_runs` (`branchId`) WHERE "assistant_runs"."status" in ('reserved', 'running', 'waiting-for-user');--> statement-breakpoint
CREATE INDEX `assistant_runs_thread_created_idx` ON `assistant_runs` (`threadId`,`createdAt`);--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_runs_thread_id_unique` ON `assistant_runs` (`threadId`,`id`);--> statement-breakpoint
CREATE TABLE `assistant_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`title` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`activeBranchId` text,
	`projectId` text,
	`placement` text DEFAULT 'core' NOT NULL,
	`placementRef` text,
	`starredAt` integer,
	`archivedAt` integer,
	`deletedAt` integer,
	`purgeAfter` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`projectId`) REFERENCES `study_projects`(`id`) ON UPDATE cascade ON DELETE set null,
	CONSTRAINT "assistant_threads_placement_check" CHECK("assistant_threads"."placement" in ('core', 'node')),
	CONSTRAINT "assistant_threads_placement_ref_check" CHECK(("assistant_threads"."placement" = 'core' and "assistant_threads"."placementRef" is null) or ("assistant_threads"."placement" = 'node' and "assistant_threads"."placementRef" is not null)),
	CONSTRAINT "assistant_threads_revision_check" CHECK("assistant_threads"."revision" >= 1)
);
--> statement-breakpoint
CREATE INDEX `assistant_threads_user_updated_idx` ON `assistant_threads` (`userId`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `assistant_threads_user_deleted_idx` ON `assistant_threads` (`userId`,`deletedAt`);--> statement-breakpoint
CREATE TABLE `assistant_usage` (
	`runId` text PRIMARY KEY NOT NULL,
	`providerKey` text NOT NULL,
	`modelKey` text NOT NULL,
	`pricingSnapshotId` text,
	`inputTokens` integer,
	`outputTokens` integer,
	`reasoningTokens` integer,
	`cachedReadTokens` integer,
	`cachedWriteTokens` integer,
	`estimatedCost` text,
	`currency` text,
	`final` integer DEFAULT false NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`runId`) REFERENCES `assistant_runs`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "assistant_usage_nonnegative_check" CHECK(coalesce("assistant_usage"."inputTokens", 0) >= 0 and coalesce("assistant_usage"."outputTokens", 0) >= 0 and coalesce("assistant_usage"."reasoningTokens", 0) >= 0 and coalesce("assistant_usage"."cachedReadTokens", 0) >= 0 and coalesce("assistant_usage"."cachedWriteTokens", 0) >= 0)
);
--> statement-breakpoint
CREATE TRIGGER assistant_threads_active_branch_insert
BEFORE INSERT ON assistant_threads
WHEN NEW.activeBranchId IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM assistant_branches b
    WHERE b.id = NEW.activeBranchId AND b.threadId = NEW.id
  ) THEN RAISE(ABORT, 'assistant active branch must belong to thread') END;
END;
--> statement-breakpoint
CREATE TRIGGER assistant_threads_active_branch_update
BEFORE UPDATE OF activeBranchId ON assistant_threads
WHEN NEW.activeBranchId IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM assistant_branches b
    WHERE b.id = NEW.activeBranchId AND b.threadId = NEW.id
  ) THEN RAISE(ABORT, 'assistant active branch must belong to thread') END;
END;
--> statement-breakpoint
CREATE TRIGGER assistant_threads_project_owner_insert
BEFORE INSERT ON assistant_threads
WHEN NEW.projectId IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM study_projects p
    WHERE p.id = NEW.projectId AND p.userId = NEW.userId
  ) THEN RAISE(ABORT, 'assistant project must be owned by thread owner') END;
END;
--> statement-breakpoint
CREATE TRIGGER assistant_threads_project_owner_update
BEFORE UPDATE OF projectId, userId ON assistant_threads
WHEN NEW.projectId IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM study_projects p
    WHERE p.id = NEW.projectId AND p.userId = NEW.userId
  ) THEN RAISE(ABORT, 'assistant project must be owned by thread owner') END;
END;
--> statement-breakpoint
CREATE TRIGGER assistant_branches_links_insert
BEFORE INSERT ON assistant_branches
BEGIN
  SELECT CASE WHEN NEW.forkedFromMessageId IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM assistant_messages m
    WHERE m.id = NEW.forkedFromMessageId AND m.threadId = NEW.threadId
  ) THEN RAISE(ABORT, 'assistant branch fork must belong to thread') END;
  SELECT CASE WHEN NEW.headMessageId IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM assistant_messages m
    WHERE m.id = NEW.headMessageId AND m.threadId = NEW.threadId
  ) THEN RAISE(ABORT, 'assistant branch head must belong to thread') END;
END;
--> statement-breakpoint
CREATE TRIGGER assistant_branches_links_update
BEFORE UPDATE OF threadId, forkedFromMessageId, headMessageId ON assistant_branches
BEGIN
  SELECT CASE WHEN NEW.threadId <> OLD.threadId
    THEN RAISE(ABORT, 'assistant branch thread is immutable') END;
  SELECT CASE WHEN NEW.forkedFromMessageId IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM assistant_messages m
    WHERE m.id = NEW.forkedFromMessageId AND m.threadId = NEW.threadId
  ) THEN RAISE(ABORT, 'assistant branch fork must belong to thread') END;
  SELECT CASE WHEN NEW.headMessageId IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM assistant_messages m
    WHERE m.id = NEW.headMessageId AND m.threadId = NEW.threadId
  ) THEN RAISE(ABORT, 'assistant branch head must belong to thread') END;
END;
--> statement-breakpoint
CREATE TRIGGER assistant_messages_links_insert
BEFORE INSERT ON assistant_messages
BEGIN
  SELECT CASE WHEN NEW.parentMessageId IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM assistant_messages m
    WHERE m.id = NEW.parentMessageId AND m.threadId = NEW.threadId
  ) THEN RAISE(ABORT, 'assistant message parent must belong to thread') END;
  SELECT CASE WHEN NEW.replacesMessageId IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM assistant_messages m
    WHERE m.id = NEW.replacesMessageId AND m.threadId = NEW.threadId
  ) THEN RAISE(ABORT, 'assistant replacement must belong to thread') END;
  SELECT CASE WHEN NEW.createdByRunId IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM assistant_runs r
    WHERE r.id = NEW.createdByRunId AND r.threadId = NEW.threadId
  ) THEN RAISE(ABORT, 'assistant message run must belong to thread') END;
END;
--> statement-breakpoint
CREATE TRIGGER assistant_messages_immutable_update
BEFORE UPDATE ON assistant_messages
BEGIN
  SELECT RAISE(ABORT, 'assistant messages are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER assistant_runs_links_insert
BEFORE INSERT ON assistant_runs
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM assistant_threads t
    WHERE t.id = NEW.threadId AND t.userId = NEW.userId AND t.placement = 'core'
  ) THEN RAISE(ABORT, 'assistant run thread is not owned core placement') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM assistant_branches b
    WHERE b.id = NEW.branchId AND b.threadId = NEW.threadId
  ) THEN RAISE(ABORT, 'assistant run branch must belong to thread') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM assistant_messages m
    WHERE m.id = NEW.inputMessageId AND m.threadId = NEW.threadId
  ) THEN RAISE(ABORT, 'assistant run input must belong to thread') END;
  SELECT CASE WHEN NEW.parentRunId IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM assistant_runs r
    WHERE r.id = NEW.parentRunId AND r.threadId = NEW.threadId
  ) THEN RAISE(ABORT, 'assistant parent run must belong to thread') END;
END;
--> statement-breakpoint
CREATE TRIGGER assistant_runs_links_update
BEFORE UPDATE ON assistant_runs
BEGIN
  SELECT CASE WHEN NEW.userId <> OLD.userId OR NEW.threadId <> OLD.threadId
    OR NEW.branchId <> OLD.branchId OR NEW.inputMessageId <> OLD.inputMessageId
    OR NEW.reservedOutputMessageId <> OLD.reservedOutputMessageId
    OR NEW.clientRequestId <> OLD.clientRequestId
    THEN RAISE(ABORT, 'assistant run identity is immutable') END;
  SELECT CASE WHEN OLD.status IN ('complete', 'failed', 'cancelled')
    AND (NEW.status <> OLD.status OR NEW.outputMessageId IS NOT OLD.outputMessageId
      OR NEW.completedAt IS NOT OLD.completedAt OR NEW.safeError IS NOT OLD.safeError)
    THEN RAISE(ABORT, 'assistant terminal run is immutable') END;
  SELECT CASE WHEN NEW.outputMessageId IS NOT NULL
    AND NEW.outputMessageId <> NEW.reservedOutputMessageId
    THEN RAISE(ABORT, 'assistant output must match reservation') END;
  SELECT CASE WHEN NEW.outputMessageId IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM assistant_messages m
    WHERE m.id = NEW.outputMessageId AND m.threadId = NEW.threadId
      AND m.createdByRunId = NEW.id
  ) THEN RAISE(ABORT, 'assistant output message must be created by run') END;
  SELECT CASE WHEN NEW.contextManifestId IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM assistant_context_manifests c
    WHERE c.id = NEW.contextManifestId AND c.runId = NEW.id
  ) THEN RAISE(ABORT, 'assistant context manifest must belong to run') END;
END;
--> statement-breakpoint
CREATE TRIGGER assistant_run_events_append_only
BEFORE INSERT ON assistant_run_events
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM assistant_run_events e WHERE e.runId = NEW.runId AND e.terminal = 1
  ) THEN RAISE(ABORT, 'assistant event cannot follow terminal event') END;
  SELECT CASE WHEN NEW.sequence <> coalesce((
    SELECT max(e.sequence) + 1 FROM assistant_run_events e WHERE e.runId = NEW.runId
  ), 1) THEN RAISE(ABORT, 'assistant event sequence must be gapless') END;
  SELECT CASE WHEN NEW.terminal <> CASE
    WHEN NEW.type IN ('run.finished', 'run.failed', 'run.cancelled') THEN 1 ELSE 0 END
    THEN RAISE(ABORT, 'assistant terminal event flag is invalid') END;
  SELECT CASE WHEN NEW.terminal = 0 AND EXISTS (
    SELECT 1 FROM assistant_runs r WHERE r.id = NEW.runId
      AND r.status IN ('complete', 'failed', 'cancelled')
  ) THEN RAISE(ABORT, 'assistant nonterminal event cannot target terminal run') END;
  SELECT CASE WHEN NEW.terminal = 1 AND NOT EXISTS (
    SELECT 1 FROM assistant_runs r WHERE r.id = NEW.runId
      AND ((r.status = 'complete' AND NEW.type = 'run.finished')
        OR (r.status = 'failed' AND NEW.type = 'run.failed')
        OR (r.status = 'cancelled' AND NEW.type = 'run.cancelled'))
  ) THEN RAISE(ABORT, 'assistant terminal event must match terminal run') END;
END;
--> statement-breakpoint
CREATE TRIGGER assistant_run_events_immutable_update
BEFORE UPDATE ON assistant_run_events
BEGIN
  SELECT RAISE(ABORT, 'assistant run events are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER assistant_context_manifests_immutable_update
BEFORE UPDATE ON assistant_context_manifests
BEGIN
  SELECT RAISE(ABORT, 'assistant context manifests are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER assistant_proof_handles_validate_insert
BEFORE INSERT ON assistant_context_proof_handles
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM assistant_context_manifests m
    WHERE m.id = NEW.contextManifestId AND m.runId = NEW.runId
  ) THEN RAISE(ABORT, 'assistant proof manifest must belong to run') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM content_version_references r
    JOIN assistant_runs run ON run.id = NEW.runId
    WHERE r.id = NEW.contentVersionReferenceId
      AND r.userId = run.userId
      AND r.ownerKind = 'assistant-citation'
      AND r.ownerId = NEW.runId
      AND r.sourceVersionId = NEW.sourceVersionId
      AND r.chunkId IS NEW.chunkId
      AND r.locatorSchemaVersion = NEW.locatorSchemaVersion
      AND r.locatorJson = NEW.locatorJson
      AND r.quotedContentHash IS NEW.quotedContentHash
  ) THEN RAISE(ABORT, 'assistant proof must match owned immutable reference') END;
  SELECT CASE WHEN NEW.chunkId IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM content_chunks c
    WHERE c.id = NEW.chunkId AND c.versionId = NEW.sourceVersionId
  ) THEN RAISE(ABORT, 'assistant proof chunk must belong to source version') END;
END;
--> statement-breakpoint
CREATE TRIGGER assistant_proof_handles_immutable_update
BEFORE UPDATE ON assistant_context_proof_handles
BEGIN
  SELECT RAISE(ABORT, 'assistant proof handles are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER assistant_citations_validate_insert
BEFORE INSERT ON assistant_citations
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM assistant_context_proof_handles p
    JOIN assistant_runs r ON r.id = NEW.runId
    WHERE p.id = NEW.proofHandleId AND p.runId = NEW.runId
      AND r.outputMessageId = NEW.messageId
      AND r.contextManifestId = p.contextManifestId
  ) THEN RAISE(ABORT, 'assistant citation must use run committed proof and output') END;
END;
--> statement-breakpoint
CREATE TRIGGER assistant_citations_immutable_update
BEFORE UPDATE ON assistant_citations
BEGIN
  SELECT RAISE(ABORT, 'assistant citations are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER assistant_attachments_validate_insert
BEFORE INSERT ON assistant_attachments
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM assistant_messages m JOIN assistant_threads t ON t.id = m.threadId
    WHERE m.id = NEW.messageId AND (
      (NEW.kind = 'file' AND EXISTS (SELECT 1 FROM files f WHERE f.id = NEW.referenceId AND f.userId = t.userId)) OR
      (NEW.kind = 'year' AND EXISTS (SELECT 1 FROM years y WHERE y.id = NEW.referenceId AND y.userId = t.userId)) OR
      (NEW.kind = 'subject' AND EXISTS (SELECT 1 FROM subjects s WHERE s.id = NEW.referenceId AND s.userId = t.userId)) OR
      (NEW.kind = 'grade' AND EXISTS (SELECT 1 FROM grades g WHERE g.id = NEW.referenceId AND g.userId = t.userId)) OR
      (NEW.kind = 'task' AND (EXISTS (SELECT 1 FROM planner_items p WHERE p.id = NEW.referenceId AND p.userId = t.userId) OR EXISTS (SELECT 1 FROM planning_tasks p WHERE p.id = NEW.referenceId AND p.userId = t.userId))) OR
      (NEW.kind = 'material' AND EXISTS (SELECT 1 FROM material_documents d WHERE d.id = NEW.referenceId AND d.userId = t.userId)) OR
      (NEW.kind = 'transcript' AND EXISTS (SELECT 1 FROM recording_transcripts x JOIN lecture_recordings r ON r.id = x.recordingId WHERE x.recordingId = NEW.referenceId AND r.userId = t.userId)) OR
      (NEW.kind = 'project' AND EXISTS (SELECT 1 FROM study_projects p WHERE p.id = NEW.referenceId AND p.userId = t.userId)) OR
      (NEW.kind = 'document' AND EXISTS (SELECT 1 FROM study_documents d WHERE d.id = NEW.referenceId AND d.userId = t.userId)) OR
      (NEW.kind = 'artifact' AND EXISTS (SELECT 1 FROM document_artifacts a WHERE a.id = NEW.referenceId AND a.userId = t.userId))
    )
  ) THEN RAISE(ABORT, 'assistant attachment reference is not owned') END;
  SELECT CASE WHEN NEW.kind = 'file' AND NEW.fileId IS NOT NEW.referenceId
    THEN RAISE(ABORT, 'assistant file attachment must bind the same file') END;
END;
--> statement-breakpoint
CREATE TRIGGER assistant_checkpoints_validate_insert
BEFORE INSERT ON assistant_conversation_checkpoints
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM assistant_runs r
    JOIN assistant_threads t ON t.id = r.threadId
    WHERE r.id = NEW.runId AND r.userId = NEW.userId
      AND r.threadId = NEW.threadId AND r.branchId = NEW.branchId
      AND r.inputMessageId = NEW.inputMessageId AND t.userId = NEW.userId
  ) THEN RAISE(ABORT, 'assistant checkpoint linkage is invalid') END;
  SELECT CASE WHEN NEW.outputMessageId IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM assistant_messages m
    WHERE m.id = NEW.outputMessageId AND m.threadId = NEW.threadId
  ) THEN RAISE(ABORT, 'assistant checkpoint output must belong to thread') END;
  SELECT CASE WHEN NEW.parentCheckpointId IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM assistant_conversation_checkpoints p
    WHERE p.id = NEW.parentCheckpointId AND p.userId = NEW.userId
      AND p.threadId = NEW.threadId AND p.branchId = NEW.branchId
      AND p.status = 'committed'
  ) THEN RAISE(ABORT, 'assistant checkpoint parent must be committed on branch') END;
  SELECT CASE WHEN NEW.afterEventSequence > 0 AND NOT EXISTS (
    SELECT 1 FROM assistant_run_events e
    WHERE e.runId = NEW.runId AND e.sequence = NEW.afterEventSequence
  ) THEN RAISE(ABORT, 'assistant checkpoint event does not exist') END;
  SELECT CASE WHEN length(NEW.stateDigest) <> 64 OR NEW.stateDigest GLOB '*[^0-9a-f]*'
    THEN RAISE(ABORT, 'assistant checkpoint digest is invalid') END;
  SELECT CASE WHEN NEW.status <> 'staging' OR NEW.stateBlobRef IS NOT NULL
      OR NEW.committedAt IS NOT NULL OR NEW.failureCode IS NOT NULL
    THEN RAISE(ABORT, 'assistant checkpoint must begin staging') END;
END;
--> statement-breakpoint
CREATE TRIGGER assistant_checkpoints_validate_update
BEFORE UPDATE ON assistant_conversation_checkpoints
BEGIN
  SELECT CASE WHEN NEW.id <> OLD.id OR NEW.userId <> OLD.userId
      OR NEW.threadId <> OLD.threadId OR NEW.branchId <> OLD.branchId
      OR NEW.runId <> OLD.runId OR NEW.inputMessageId <> OLD.inputMessageId
      OR NEW.outputMessageId IS NOT OLD.outputMessageId
      OR NEW.parentCheckpointId IS NOT OLD.parentCheckpointId
      OR NEW.appendKey <> OLD.appendKey
      OR NEW.afterEventSequence <> OLD.afterEventSequence
      OR NEW.runtimeId <> OLD.runtimeId OR NEW.runtimeVersion <> OLD.runtimeVersion
      OR NEW.graphSchemaVersion <> OLD.graphSchemaVersion
      OR NEW.stateDigest <> OLD.stateDigest OR NEW.stateByteLength <> OLD.stateByteLength
    THEN RAISE(ABORT, 'assistant checkpoint identity is immutable') END;
  SELECT CASE WHEN OLD.status = 'staging' AND NEW.status NOT IN ('staging', 'committed', 'failed')
    THEN RAISE(ABORT, 'assistant checkpoint transition is invalid') END;
  SELECT CASE WHEN OLD.status IN ('committed', 'failed') AND NEW.status <> OLD.status
    THEN RAISE(ABORT, 'assistant checkpoint is terminal') END;
  SELECT CASE WHEN NEW.status = 'committed' AND (
      NEW.stateBlobRef IS NULL OR NEW.temporaryBlobRef IS NOT NULL
      OR NEW.committedAt IS NULL OR NEW.failureCode IS NOT NULL)
    THEN RAISE(ABORT, 'assistant committed checkpoint has invalid blob state') END;
  SELECT CASE WHEN NEW.status = 'failed' AND (
      NEW.failureCode IS NULL OR NEW.stateBlobRef IS NOT NULL OR NEW.committedAt IS NOT NULL)
    THEN RAISE(ABORT, 'assistant failed checkpoint has invalid state') END;
  SELECT CASE WHEN OLD.status = 'committed' AND (
      NEW.temporaryBlobRef IS NOT OLD.temporaryBlobRef
      OR NEW.stateBlobRef IS NOT OLD.stateBlobRef
      OR NEW.failureCode IS NOT OLD.failureCode
      OR NEW.committedAt IS NOT OLD.committedAt)
    THEN RAISE(ABORT, 'assistant committed checkpoint is immutable') END;
END;
--> statement-breakpoint
CREATE TRIGGER assistant_outbox_validate_insert
BEFORE INSERT ON assistant_outbox
BEGIN
  SELECT CASE WHEN NEW.kind IN ('event', 'terminal') AND (
    NEW.runId IS NULL OR NEW.eventId IS NULL OR NOT EXISTS (
      SELECT 1 FROM assistant_run_events e
      JOIN assistant_runs r ON r.id = e.runId
      WHERE e.eventId = NEW.eventId AND e.runId = NEW.runId AND r.userId = NEW.userId
        AND (NEW.kind <> 'terminal' OR e.terminal = 1)
    )
  ) THEN RAISE(ABORT, 'assistant event outbox linkage is invalid') END;
  SELECT CASE WHEN NEW.kind IN ('checkpoint-committed', 'checkpoint-gc') AND (
    NEW.checkpointId IS NULL OR NOT EXISTS (
      SELECT 1 FROM assistant_conversation_checkpoints c
      WHERE c.id = NEW.checkpointId AND c.userId = NEW.userId
    )
  ) THEN RAISE(ABORT, 'assistant checkpoint outbox linkage is invalid') END;
END;
