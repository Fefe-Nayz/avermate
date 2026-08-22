CREATE TABLE `content_derivatives` (
	`id` text PRIMARY KEY NOT NULL,
	`versionId` text NOT NULL,
	`chunkId` text,
	`fileId` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`locatorSchemaVersion` integer DEFAULT 1 NOT NULL,
	`locatorJson` text NOT NULL,
	`contentHash` text NOT NULL,
	`mimeType` text NOT NULL,
	`byteSize` integer NOT NULL,
	`estimatedInputTokens` integer NOT NULL,
	`durationMs` integer,
	`rendererProfile` text NOT NULL,
	`rendererImageDigest` text NOT NULL,
	`metadataJson` text DEFAULT '{}' NOT NULL,
	`errorCode` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`versionId`) REFERENCES `content_versions`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`chunkId`) REFERENCES `content_chunks`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`fileId`) REFERENCES `files`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "content_derivatives_kind_check" CHECK("content_derivatives"."kind" in ('pdf-page', 'page-image', 'slide-image', 'sheet-image', 'audio-segment', 'video-segment')),
	CONSTRAINT "content_derivatives_status_check" CHECK("content_derivatives"."status" in ('pending', 'ready', 'failed', 'deleted')),
	CONSTRAINT "content_derivatives_hash_check" CHECK(length("content_derivatives"."contentHash") = 64 and "content_derivatives"."contentHash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "content_derivatives_size_check" CHECK("content_derivatives"."byteSize" >= 0 and "content_derivatives"."estimatedInputTokens" between 1 and 8192 and ("content_derivatives"."durationMs" is null or "content_derivatives"."durationMs" > 0)),
	CONSTRAINT "content_derivatives_renderer_digest_check" CHECK("content_derivatives"."rendererImageDigest" glob 'sha256:*' and length("content_derivatives"."rendererImageDigest") = 71)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_derivatives_version_kind_locator_unique` ON `content_derivatives` (`versionId`,`kind`,`locatorJson`);--> statement-breakpoint
CREATE INDEX `content_derivatives_version_status_idx` ON `content_derivatives` (`versionId`,`status`);--> statement-breakpoint
CREATE INDEX `content_derivatives_file_idx` ON `content_derivatives` (`fileId`);--> statement-breakpoint
CREATE TABLE `corpus_embedding_generation_versions` (
	`generationId` text NOT NULL,
	`versionId` text NOT NULL,
	`vectorCount` integer DEFAULT 0 NOT NULL,
	`indexedAt` integer,
	FOREIGN KEY (`generationId`) REFERENCES `corpus_embedding_generations`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`versionId`) REFERENCES `content_versions`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "corpus_embedding_generation_versions_count_check" CHECK("corpus_embedding_generation_versions"."vectorCount" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `corpus_embedding_generation_versions_unique` ON `corpus_embedding_generation_versions` (`generationId`,`versionId`);--> statement-breakpoint
CREATE INDEX `corpus_embedding_generation_versions_version_idx` ON `corpus_embedding_generation_versions` (`versionId`);--> statement-breakpoint
CREATE TABLE `corpus_embedding_generations` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`spaceId` text NOT NULL,
	`state` text DEFAULT 'staging' NOT NULL,
	`versionSetDigest` text NOT NULL,
	`expectedVersionCount` integer NOT NULL,
	`indexedVersionCount` integer DEFAULT 0 NOT NULL,
	`activatedAt` integer,
	`errorCode` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`spaceId`) REFERENCES `corpus_embedding_spaces`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "corpus_embedding_generations_state_check" CHECK("corpus_embedding_generations"."state" in ('staging', 'active', 'failed', 'superseded')),
	CONSTRAINT "corpus_embedding_generations_counts_check" CHECK("corpus_embedding_generations"."expectedVersionCount" >= 0 and "corpus_embedding_generations"."indexedVersionCount" >= 0 and "corpus_embedding_generations"."indexedVersionCount" <= "corpus_embedding_generations"."expectedVersionCount"),
	CONSTRAINT "corpus_embedding_generations_digest_check" CHECK(length("corpus_embedding_generations"."versionSetDigest") = 64 and "corpus_embedding_generations"."versionSetDigest" not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `corpus_embedding_generations_active_unique` ON `corpus_embedding_generations` (`userId`,`spaceId`) WHERE "corpus_embedding_generations"."state" = 'active';--> statement-breakpoint
CREATE INDEX `corpus_embedding_generations_owner_state_idx` ON `corpus_embedding_generations` (`userId`,`state`);--> statement-breakpoint
CREATE TABLE `corpus_embedding_spaces` (
	`id` text PRIMARY KEY NOT NULL,
	`descriptorJson` text NOT NULL,
	`descriptorDigest` text NOT NULL,
	`createdAt` integer NOT NULL,
	CONSTRAINT "corpus_embedding_spaces_digest_check" CHECK(length("corpus_embedding_spaces"."descriptorDigest") = 64 and "corpus_embedding_spaces"."descriptorDigest" not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `corpus_embedding_spaces_digest_unique` ON `corpus_embedding_spaces` (`descriptorDigest`);--> statement-breakpoint
CREATE TABLE `corpus_embedding_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`operationId` text NOT NULL,
	`userId` text NOT NULL,
	`spaceId` text NOT NULL,
	`versionId` text,
	`inputCount` integer NOT NULL,
	`inputTokens` integer,
	`providerRequestId` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`spaceId`) REFERENCES `corpus_embedding_spaces`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`versionId`) REFERENCES `content_versions`(`id`) ON UPDATE cascade ON DELETE set null,
	CONSTRAINT "corpus_embedding_usage_counts_check" CHECK("corpus_embedding_usage"."inputCount" > 0 and ("corpus_embedding_usage"."inputTokens" is null or "corpus_embedding_usage"."inputTokens" >= 0))
);
--> statement-breakpoint
CREATE INDEX `corpus_embedding_usage_owner_created_idx` ON `corpus_embedding_usage` (`userId`,`createdAt`);--> statement-breakpoint
CREATE TABLE `retrieval_evaluations` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`fixtureRevision` text NOT NULL,
	`corpusDigest` text NOT NULL,
	`configurationDigest` text NOT NULL,
	`status` text NOT NULL,
	`metricsJson` text,
	`ablationsJson` text,
	`errorCode` text,
	`evaluatedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "retrieval_evaluations_status_check" CHECK("retrieval_evaluations"."status" in ('running', 'succeeded', 'failed')),
	CONSTRAINT "retrieval_evaluations_corpus_digest_check" CHECK(length("retrieval_evaluations"."corpusDigest") = 64 and "retrieval_evaluations"."corpusDigest" not glob '*[^0-9a-f]*'),
	CONSTRAINT "retrieval_evaluations_configuration_digest_check" CHECK(length("retrieval_evaluations"."configurationDigest") = 64 and "retrieval_evaluations"."configurationDigest" not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE INDEX `retrieval_evaluations_owner_created_idx` ON `retrieval_evaluations` (`userId`,`createdAt`);--> statement-breakpoint
CREATE TABLE `retrieval_provider_consents` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`provider` text NOT NULL,
	`capability` text NOT NULL,
	`disclosureRevision` text NOT NULL,
	`policyRevision` text NOT NULL,
	`grantedAt` integer NOT NULL,
	`revokedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "retrieval_provider_consents_capability_check" CHECK("retrieval_provider_consents"."capability" in ('embedding', 'rerank'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `retrieval_provider_consents_unique` ON `retrieval_provider_consents` (`userId`,`provider`,`capability`);--> statement-breakpoint
CREATE TABLE `retrieval_traces` (
	`id` text PRIMARY KEY NOT NULL,
	`operationId` text NOT NULL,
	`userId` text NOT NULL,
	`queryDigest` text NOT NULL,
	`corpusGenerationId` text,
	`scopeDigest` text NOT NULL,
	`stagesJson` text NOT NULL,
	`fallbackPolicy` text NOT NULL,
	`fallbackReason` text,
	`packedEvidenceIdsJson` text NOT NULL,
	`evaluationCorrelationId` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`corpusGenerationId`) REFERENCES `corpus_embedding_generations`(`id`) ON UPDATE cascade ON DELETE set null,
	CONSTRAINT "retrieval_traces_query_digest_check" CHECK(length("retrieval_traces"."queryDigest") = 64 and "retrieval_traces"."queryDigest" not glob '*[^0-9a-f]*'),
	CONSTRAINT "retrieval_traces_scope_digest_check" CHECK(length("retrieval_traces"."scopeDigest") = 64 and "retrieval_traces"."scopeDigest" not glob '*[^0-9a-f]*'),
	CONSTRAINT "retrieval_traces_fallback_check" CHECK("retrieval_traces"."fallbackPolicy" in ('fail', 'lexical-only', 'hybrid-without-rerank'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `retrieval_traces_owner_operation_unique` ON `retrieval_traces` (`userId`,`operationId`);--> statement-breakpoint
CREATE INDEX `retrieval_traces_owner_created_idx` ON `retrieval_traces` (`userId`,`createdAt`);--> statement-breakpoint
CREATE TABLE `assistant_model_preferences` (
	`userId` text PRIMARY KEY NOT NULL,
	`defaultModelKey` text,
	`route` text DEFAULT 'selected-only' NOT NULL,
	`fallback` text DEFAULT 'none' NOT NULL,
	`maximumInputTokens` integer,
	`maximumOutputTokens` integer,
	`maximumEstimatedCostMinor` integer,
	`currency` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "assistant_model_preferences_route_check" CHECK("assistant_model_preferences"."route" in ('selected-only', 'prefer-node', 'prefer-core', 'managed-only')),
	CONSTRAINT "assistant_model_preferences_fallback_check" CHECK("assistant_model_preferences"."fallback" in ('none', 'same-provider', 'configured-routes')),
	CONSTRAINT "assistant_model_preferences_budget_check" CHECK(("assistant_model_preferences"."maximumInputTokens" is null or "assistant_model_preferences"."maximumInputTokens" > 0)
        and ("assistant_model_preferences"."maximumOutputTokens" is null or "assistant_model_preferences"."maximumOutputTokens" > 0)
        and ("assistant_model_preferences"."maximumEstimatedCostMinor" is null or "assistant_model_preferences"."maximumEstimatedCostMinor" >= 0)),
	CONSTRAINT "assistant_model_preferences_currency_check" CHECK("assistant_model_preferences"."currency" is null or length("assistant_model_preferences"."currency") = 3),
	CONSTRAINT "assistant_model_preferences_revision_check" CHECK("assistant_model_preferences"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE `assistant_provider_dispatch_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`runId` text NOT NULL,
	`dispatchKey` text NOT NULL,
	`requestDigest` text NOT NULL,
	`providerKey` text NOT NULL,
	`providerRevision` text NOT NULL,
	`modelKey` text NOT NULL,
	`modelRevision` text NOT NULL,
	`placementJson` text NOT NULL,
	`providerSupportsStableRequestKey` integer DEFAULT false NOT NULL,
	`stableRequestKey` text,
	`state` text DEFAULT 'claimed' NOT NULL,
	`inspectReason` text,
	`claimedAt` integer NOT NULL,
	`dispatchStartedAt` integer,
	`acknowledgedAt` integer,
	`completedAt` integer,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`runId`) REFERENCES `assistant_runs`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "assistant_provider_claims_state_check" CHECK("assistant_provider_dispatch_claims"."state" in ('claimed', 'dispatching', 'acknowledged', 'completed', 'failed', 'cancelled', 'inspect-required')),
	CONSTRAINT "assistant_provider_claims_request_digest_check" CHECK(length("assistant_provider_dispatch_claims"."requestDigest") = 64 and "assistant_provider_dispatch_claims"."requestDigest" not glob '*[^0-9a-f]*'),
	CONSTRAINT "assistant_provider_claims_stable_key_check" CHECK(("assistant_provider_dispatch_claims"."providerSupportsStableRequestKey" = 0 and "assistant_provider_dispatch_claims"."stableRequestKey" is null) or ("assistant_provider_dispatch_claims"."providerSupportsStableRequestKey" = 1 and "assistant_provider_dispatch_claims"."stableRequestKey" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_provider_claims_run_dispatch_unique` ON `assistant_provider_dispatch_claims` (`userId`,`runId`,`dispatchKey`);--> statement-breakpoint
CREATE INDEX `assistant_provider_claims_reconcile_idx` ON `assistant_provider_dispatch_claims` (`state`,`updatedAt`);--> statement-breakpoint
CREATE TABLE `assistant_run_leases` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`runId` text NOT NULL,
	`workerId` text NOT NULL,
	`fencingToken` integer NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`acquiredAt` integer NOT NULL,
	`heartbeatAt` integer NOT NULL,
	`expiresAt` integer NOT NULL,
	`releasedAt` integer,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`runId`) REFERENCES `assistant_runs`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "assistant_run_leases_state_check" CHECK("assistant_run_leases"."state" in ('active', 'released', 'expired', 'fenced')),
	CONSTRAINT "assistant_run_leases_fencing_token_check" CHECK("assistant_run_leases"."fencingToken" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_run_leases_run_token_unique` ON `assistant_run_leases` (`runId`,`fencingToken`);--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_run_leases_run_active_unique` ON `assistant_run_leases` (`runId`) WHERE "assistant_run_leases"."state" = 'active';--> statement-breakpoint
CREATE INDEX `assistant_run_leases_expiry_idx` ON `assistant_run_leases` (`state`,`expiresAt`);--> statement-breakpoint
CREATE TABLE `avermate_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`protocolMajor` integer NOT NULL,
	`publicSigningKey` text NOT NULL,
	`keyId` text NOT NULL,
	`fingerprint` text NOT NULL,
	`state` text DEFAULT 'pairing' NOT NULL,
	`revokedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	CONSTRAINT "avermate_nodes_state_check" CHECK("avermate_nodes"."state" in ('pairing', 'active', 'offline', 'revoked')),
	CONSTRAINT "avermate_nodes_protocol_check" CHECK("avermate_nodes"."protocolMajor" = 2)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `avermate_nodes_key_id_unique` ON `avermate_nodes` (`keyId`);--> statement-breakpoint
CREATE UNIQUE INDEX `avermate_nodes_fingerprint_unique` ON `avermate_nodes` (`fingerprint`);--> statement-breakpoint
CREATE TABLE `node_account_bindings` (
	`id` text PRIMARY KEY NOT NULL,
	`nodeId` text NOT NULL,
	`userId` text NOT NULL,
	`pairingAttemptId` text NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`createdAt` integer NOT NULL,
	`revokedAt` integer,
	FOREIGN KEY (`nodeId`) REFERENCES `avermate_nodes`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`pairingAttemptId`) REFERENCES `node_pairing_attempts`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "node_account_binding_state_check" CHECK("node_account_bindings"."state" in ('active', 'revoked'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `node_account_binding_active_node_unique` ON `node_account_bindings` (`nodeId`) WHERE "node_account_bindings"."state" = 'active';--> statement-breakpoint
CREATE INDEX `node_account_binding_user_state_idx` ON `node_account_bindings` (`userId`,`state`);--> statement-breakpoint
CREATE TABLE `node_capability_manifests` (
	`id` text PRIMARY KEY NOT NULL,
	`nodeId` text NOT NULL,
	`configRevision` text NOT NULL,
	`manifestDigest` text NOT NULL,
	`manifestJson` text NOT NULL,
	`issuedAt` integer NOT NULL,
	`expiresAt` integer NOT NULL,
	`verifiedAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`nodeId`) REFERENCES `avermate_nodes`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `node_manifest_digest_unique` ON `node_capability_manifests` (`nodeId`,`manifestDigest`);--> statement-breakpoint
CREATE INDEX `node_manifest_revision_verified_idx` ON `node_capability_manifests` (`nodeId`,`configRevision`,`verifiedAt`);--> statement-breakpoint
CREATE TABLE `node_capability_placement_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`capability` text NOT NULL,
	`revision` integer NOT NULL,
	`placementKind` text NOT NULL,
	`nodeId` text,
	`providerId` text NOT NULL,
	`durableData` integer NOT NULL,
	`consequencesJson` text NOT NULL,
	`migrationState` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`nodeId`) REFERENCES `avermate_nodes`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "node_placement_kind_check" CHECK("node_capability_placement_revisions"."placementKind" in ('core', 'node', 'managed', 'byok')),
	CONSTRAINT "node_placement_revision_check" CHECK("node_capability_placement_revisions"."revision" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `node_placement_user_cap_revision_unique` ON `node_capability_placement_revisions` (`userId`,`capability`,`revision`);--> statement-breakpoint
CREATE INDEX `node_placement_current_idx` ON `node_capability_placement_revisions` (`userId`,`capability`,`revision`);--> statement-breakpoint
CREATE TABLE `node_connection_epochs` (
	`id` text PRIMARY KEY NOT NULL,
	`nodeId` text NOT NULL,
	`epoch` integer NOT NULL,
	`relayCredentialGeneration` integer NOT NULL,
	`manifestDigest` text NOT NULL,
	`state` text NOT NULL,
	`connectedAt` integer NOT NULL,
	`lastHeartbeatAt` integer NOT NULL,
	`disconnectedAt` integer,
	`safeCloseCode` text,
	FOREIGN KEY (`nodeId`) REFERENCES `avermate_nodes`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "node_connection_state_check" CHECK("node_connection_epochs"."state" in ('connected', 'disconnected', 'fenced')),
	CONSTRAINT "node_connection_epoch_check" CHECK("node_connection_epochs"."epoch" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `node_connection_epoch_unique` ON `node_connection_epochs` (`nodeId`,`epoch`);--> statement-breakpoint
CREATE UNIQUE INDEX `node_connection_primary_unique` ON `node_connection_epochs` (`nodeId`) WHERE "node_connection_epochs"."state" = 'connected';--> statement-breakpoint
CREATE INDEX `node_connection_heartbeat_idx` ON `node_connection_epochs` (`state`,`lastHeartbeatAt`);--> statement-breakpoint
CREATE TABLE `node_credential_generations` (
	`id` text PRIMARY KEY NOT NULL,
	`nodeId` text NOT NULL,
	`userId` text NOT NULL,
	`kind` text NOT NULL,
	`generation` integer NOT NULL,
	`credentialHash` text NOT NULL,
	`sealedCredential` text,
	`activeFrom` integer NOT NULL,
	`expiresAt` integer NOT NULL,
	`overlapUntil` integer,
	`deliveredAt` integer,
	`revokedAt` integer,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`nodeId`) REFERENCES `avermate_nodes`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "node_credential_kind_check" CHECK("node_credential_generations"."kind" in ('relay', 'capability')),
	CONSTRAINT "node_credential_generation_check" CHECK("node_credential_generations"."generation" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `node_credential_kind_generation_unique` ON `node_credential_generations` (`nodeId`,`kind`,`generation`);--> statement-breakpoint
CREATE UNIQUE INDEX `node_credential_hash_unique` ON `node_credential_generations` (`credentialHash`);--> statement-breakpoint
CREATE INDEX `node_credential_auth_idx` ON `node_credential_generations` (`kind`,`credentialHash`,`revokedAt`,`expiresAt`);--> statement-breakpoint
CREATE TABLE `node_lifecycle_events` (
	`id` text PRIMARY KEY NOT NULL,
	`nodeId` text NOT NULL,
	`userId` text,
	`eventType` text NOT NULL,
	`safeMetadataJson` text DEFAULT '{}' NOT NULL,
	`occurredAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `node_lifecycle_node_time_idx` ON `node_lifecycle_events` (`nodeId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `node_lifecycle_user_time_idx` ON `node_lifecycle_events` (`userId`,`occurredAt`);--> statement-breakpoint
CREATE TABLE `node_object_adoptions` (
	`id` text PRIMARY KEY NOT NULL,
	`providerId` text NOT NULL,
	`ownerId` text NOT NULL,
	`namespace` text NOT NULL,
	`objectKey` text NOT NULL,
	`byteSize` integer NOT NULL,
	`mimeType` text NOT NULL,
	`expectedDigest` text NOT NULL,
	`idempotencyKey` text NOT NULL,
	`state` text NOT NULL,
	`objectMetadataJson` text,
	`canonicalRecordId` text,
	`safeErrorCode` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	CONSTRAINT "node_object_adoption_state_check" CHECK("node_object_adoptions"."state" in ('reserved', 'object_committed', 'adopted', 'needs_operator'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `node_object_adoption_idempotency_unique` ON `node_object_adoptions` (`ownerId`,`providerId`,`idempotencyKey`);--> statement-breakpoint
CREATE INDEX `node_object_adoption_pending_idx` ON `node_object_adoptions` (`state`,`updatedAt`);--> statement-breakpoint
CREATE TABLE `node_pairing_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`nodeId` text NOT NULL,
	`codeHash` text NOT NULL,
	`offerJson` text NOT NULL,
	`registrationProofDigest` text NOT NULL,
	`manifestDigest` text NOT NULL,
	`state` text DEFAULT 'offered' NOT NULL,
	`claimedUserId` text,
	`confirmedCapabilitiesJson` text,
	`expiresAt` integer NOT NULL,
	`claimedAt` integer,
	`confirmedAt` integer,
	`consumedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`nodeId`) REFERENCES `avermate_nodes`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`claimedUserId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "node_pairing_state_check" CHECK("node_pairing_attempts"."state" in ('offered', 'claimed', 'confirmed', 'credentials-ready', 'consumed', 'expired', 'revoked'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `node_pairing_code_hash_unique` ON `node_pairing_attempts` (`codeHash`);--> statement-breakpoint
CREATE INDEX `node_pairing_state_expiry_idx` ON `node_pairing_attempts` (`state`,`expiresAt`);--> statement-breakpoint
CREATE INDEX `node_pairing_claimed_user_idx` ON `node_pairing_attempts` (`claimedUserId`,`state`);--> statement-breakpoint
CREATE TABLE `node_proof_nonces` (
	`nodeId` text NOT NULL,
	`nonce` text NOT NULL,
	`action` text NOT NULL,
	`issuedAt` integer NOT NULL,
	`acceptedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `node_proof_nonce_unique` ON `node_proof_nonces` (`nodeId`,`nonce`);--> statement-breakpoint
CREATE INDEX `node_proof_nonce_accepted_idx` ON `node_proof_nonces` (`acceptedAt`);--> statement-breakpoint
CREATE TABLE `node_relay_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`nodeId` text NOT NULL,
	`userId` text NOT NULL,
	`capability` text NOT NULL,
	`configRevision` text NOT NULL,
	`requestDigest` text NOT NULL,
	`state` text NOT NULL,
	`lastSequence` integer DEFAULT 0 NOT NULL,
	`acknowledgedSequence` integer DEFAULT 0 NOT NULL,
	`deadline` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`nodeId`) REFERENCES `avermate_nodes`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "node_relay_operation_state_check" CHECK("node_relay_operations"."state" in ('offered', 'running', 'cancel-requested', 'completed', 'failed')),
	CONSTRAINT "node_relay_operation_sequence_check" CHECK("node_relay_operations"."lastSequence" >= 0 and "node_relay_operations"."acknowledgedSequence" >= 0 and "node_relay_operations"."acknowledgedSequence" <= "node_relay_operations"."lastSequence")
);
--> statement-breakpoint
CREATE INDEX `node_relay_operation_node_state_idx` ON `node_relay_operations` (`nodeId`,`state`);--> statement-breakpoint
CREATE TABLE `node_remote_deletion_refs` (
	`manifestDigest` text NOT NULL,
	`ownerId` text NOT NULL,
	`namespace` text NOT NULL,
	`objectKey` text NOT NULL,
	FOREIGN KEY (`manifestDigest`) REFERENCES `node_remote_deletions`(`manifestDigest`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `node_remote_deletion_ref_unique` ON `node_remote_deletion_refs` (`manifestDigest`,`ownerId`,`namespace`,`objectKey`);--> statement-breakpoint
CREATE INDEX `node_remote_deletion_tombstone_idx` ON `node_remote_deletion_refs` (`ownerId`,`namespace`,`objectKey`);--> statement-breakpoint
CREATE TABLE `node_remote_deletions` (
	`manifestDigest` text PRIMARY KEY NOT NULL,
	`nodeId` text NOT NULL,
	`userId` text NOT NULL,
	`manifestJson` text NOT NULL,
	`state` text NOT NULL,
	`receiptJson` text,
	`acceptedReceiptDigest` text,
	`safeOperatorInstruction` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	CONSTRAINT "node_remote_deletion_state_check" CHECK("node_remote_deletions"."state" in ('pending_remote_deletion', 'verified_deleted', 'revoked_unreachable', 'user_action_required'))
);
--> statement-breakpoint
CREATE INDEX `node_remote_deletion_pending_idx` ON `node_remote_deletions` (`nodeId`,`state`);--> statement-breakpoint
CREATE TABLE `node_runtime_checkpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`nodeId` text NOT NULL,
	`workspaceSnapshotId` text NOT NULL,
	`checkpointRefJson` text NOT NULL,
	`provider` text NOT NULL,
	`opaqueProviderRef` text NOT NULL,
	`region` text NOT NULL,
	`architecture` text NOT NULL,
	`runtimeKind` text NOT NULL,
	`runtimeVersion` text NOT NULL,
	`imageDigest` text NOT NULL,
	`profileId` text NOT NULL,
	`profileVersion` text NOT NULL,
	`sourceWorkspaceSnapshotJson` text NOT NULL,
	`captureState` text NOT NULL,
	`adoptedObjectRefsJson` text DEFAULT '[]' NOT NULL,
	`capturedAt` integer NOT NULL,
	`expiresAt` integer NOT NULL,
	`deletedAt` integer,
	`safeErrorCode` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`nodeId`) REFERENCES `avermate_nodes`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "node_runtime_checkpoint_state_check" CHECK("node_runtime_checkpoints"."captureState" in ('captured', 'adopted', 'failed', 'deleted'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `node_runtime_checkpoint_provider_ref_unique` ON `node_runtime_checkpoints` (`provider`,`opaqueProviderRef`);--> statement-breakpoint
CREATE INDEX `node_runtime_checkpoint_expiry_idx` ON `node_runtime_checkpoints` (`captureState`,`expiresAt`);--> statement-breakpoint
CREATE INDEX `node_runtime_checkpoint_workspace_idx` ON `node_runtime_checkpoints` (`userId`,`workspaceSnapshotId`);--> statement-breakpoint
CREATE TABLE `learning_concept_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`sourceSetId` text,
	`targetSetId` text,
	`beforeJson` text NOT NULL,
	`afterJson` text NOT NULL,
	`previewDigest` text NOT NULL,
	`idempotencyKey` text NOT NULL,
	`yearId` text NOT NULL,
	`subjectId` text,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`sourceSetId`) REFERENCES `learning_concept_sets`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`targetSetId`) REFERENCES `learning_concept_sets`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`yearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`subjectId`) REFERENCES `subjects`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "learning_concept_operations_kind_check" CHECK("learning_concept_operations"."kind" in ('import', 'merge', 'split', 'archive'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `learning_concept_operations_key_unique` ON `learning_concept_operations` (`userId`,`idempotencyKey`);--> statement-breakpoint
CREATE INDEX `learning_concept_operations_scope_idx` ON `learning_concept_operations` (`userId`,`yearId`,`subjectId`,`createdAt`);--> statement-breakpoint
CREATE TABLE `learning_concept_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`namespace` text DEFAULT 'local' NOT NULL,
	`source` text,
	`sourceVersion` text,
	`locale` text DEFAULT 'fr' NOT NULL,
	`importDigest` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`archivedAt` integer,
	`yearId` text NOT NULL,
	`subjectId` text,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`yearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`subjectId`) REFERENCES `subjects`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "learning_concept_sets_namespace_check" CHECK("learning_concept_sets"."namespace" in ('local', 'curriculum', 'provider'))
);
--> statement-breakpoint
CREATE INDEX `learning_concept_sets_scope_idx` ON `learning_concept_sets` (`userId`,`yearId`,`subjectId`);--> statement-breakpoint
CREATE UNIQUE INDEX `learning_concept_sets_import_unique` ON `learning_concept_sets` (`userId`,`namespace`,`importDigest`);--> statement-breakpoint
CREATE TABLE `learning_concepts` (
	`id` text PRIMARY KEY NOT NULL,
	`setId` text NOT NULL,
	`parentId` text,
	`stableKey` text NOT NULL,
	`canonicalLabel` text NOT NULL,
	`localLabel` text,
	`description` text,
	`sortOrder` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`archivedAt` integer,
	`yearId` text NOT NULL,
	`subjectId` text,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`setId`) REFERENCES `learning_concept_sets`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`yearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`subjectId`) REFERENCES `subjects`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `learning_concepts_set_key_unique` ON `learning_concepts` (`setId`,`stableKey`);--> statement-breakpoint
CREATE INDEX `learning_concepts_tree_idx` ON `learning_concepts` (`setId`,`parentId`,`sortOrder`);--> statement-breakpoint
CREATE INDEX `learning_concepts_scope_idx` ON `learning_concepts` (`userId`,`yearId`,`subjectId`);--> statement-breakpoint
CREATE TABLE `learning_copy_analyses` (
	`id` text PRIMARY KEY NOT NULL,
	`attachmentId` text NOT NULL,
	`gradeId` text NOT NULL,
	`sourceFileId` text NOT NULL,
	`sourceDigest` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`modelRevision` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`jobId` text,
	`pageCount` integer,
	`proposalVersion` integer DEFAULT 1 NOT NULL,
	`proposalJson` text,
	`safeError` text,
	`yearId` text NOT NULL,
	`periodId` text,
	`subjectId` text NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`attachmentId`) REFERENCES `grade_attachments`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`gradeId`) REFERENCES `grades`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`sourceFileId`) REFERENCES `files`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`jobId`) REFERENCES `jobs`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`yearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`periodId`) REFERENCES `periods`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`subjectId`) REFERENCES `subjects`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "learning_copy_analyses_status_check" CHECK("learning_copy_analyses"."status" in ('queued', 'running', 'proposed', 'confirmed', 'dismissed', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `learning_copy_analyses_revision_unique` ON `learning_copy_analyses` (`userId`,`attachmentId`,`modelRevision`,`sourceDigest`);--> statement-breakpoint
CREATE INDEX `learning_copy_analyses_grade_idx` ON `learning_copy_analyses` (`userId`,`gradeId`);--> statement-breakpoint
CREATE INDEX `learning_copy_analyses_job_idx` ON `learning_copy_analyses` (`jobId`);--> statement-breakpoint
CREATE TABLE `learning_copy_analysis_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`analysisId` text NOT NULL,
	`kind` text NOT NULL,
	`fromRevision` integer NOT NULL,
	`toRevision` integer NOT NULL,
	`selectionJson` text NOT NULL,
	`idempotencyKey` text NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`analysisId`) REFERENCES `learning_copy_analyses`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `learning_copy_analysis_reviews_key_unique` ON `learning_copy_analysis_reviews` (`userId`,`idempotencyKey`);--> statement-breakpoint
CREATE INDEX `learning_copy_analysis_reviews_analysis_idx` ON `learning_copy_analysis_reviews` (`analysisId`,`createdAt`);--> statement-breakpoint
CREATE TABLE `learning_error_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`evidenceId` text NOT NULL,
	`objectiveId` text NOT NULL,
	`conceptId` text NOT NULL,
	`taxonomy` text NOT NULL,
	`quotedEvidence` text,
	`locatorVersion` integer DEFAULT 1 NOT NULL,
	`locatorJson` text NOT NULL,
	`explanation` text NOT NULL,
	`severity` real NOT NULL,
	`confidence` real NOT NULL,
	`status` text NOT NULL,
	`correctionOfObservationId` text,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`evidenceId`) REFERENCES `learning_evidence`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`objectiveId`) REFERENCES `learning_objectives`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`conceptId`) REFERENCES `learning_concepts`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "learning_error_observations_status_check" CHECK("learning_error_observations"."status" in ('proposed', 'confirmed', 'corrected', 'dismissed')),
	CONSTRAINT "learning_error_observations_severity_check" CHECK("learning_error_observations"."severity" >= 0 and "learning_error_observations"."severity" <= 1),
	CONSTRAINT "learning_error_observations_confidence_check" CHECK("learning_error_observations"."confidence" >= 0 and "learning_error_observations"."confidence" <= 1)
);
--> statement-breakpoint
CREATE INDEX `learning_error_observations_evidence_idx` ON `learning_error_observations` (`evidenceId`);--> statement-breakpoint
CREATE INDEX `learning_error_observations_objective_idx` ON `learning_error_observations` (`userId`,`objectiveId`,`createdAt`);--> statement-breakpoint
CREATE TABLE `learning_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`objectiveId` text NOT NULL,
	`sourceKind` text NOT NULL,
	`sourceId` text NOT NULL,
	`sourceVersion` text NOT NULL,
	`locatorVersion` integer DEFAULT 1 NOT NULL,
	`locatorJson` text NOT NULL,
	`observedOutcome` real,
	`denominator` real,
	`rubricJson` text,
	`difficulty` real,
	`reliability` real NOT NULL,
	`occurredAt` integer NOT NULL,
	`producerKind` text NOT NULL,
	`producerDescriptor` text,
	`algorithmRevision` text NOT NULL,
	`confidence` real,
	`correctionOfEvidenceId` text,
	`yearId` text NOT NULL,
	`periodId` text,
	`subjectId` text NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`objectiveId`) REFERENCES `learning_objectives`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`yearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`periodId`) REFERENCES `periods`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`subjectId`) REFERENCES `subjects`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "learning_evidence_kind_check" CHECK("learning_evidence"."kind" in ('school-grade', 'copy-region', 'teacher-comment', 'quiz-question', 'exercise', 'self-assessment', 'manual-observation', 'provider-snapshot')),
	CONSTRAINT "learning_evidence_reliability_check" CHECK("learning_evidence"."reliability" >= 0 and "learning_evidence"."reliability" <= 1),
	CONSTRAINT "learning_evidence_difficulty_check" CHECK("learning_evidence"."difficulty" is null or ("learning_evidence"."difficulty" >= 0 and "learning_evidence"."difficulty" <= 1)),
	CONSTRAINT "learning_evidence_confidence_check" CHECK("learning_evidence"."confidence" is null or ("learning_evidence"."confidence" >= 0 and "learning_evidence"."confidence" <= 1))
);
--> statement-breakpoint
CREATE INDEX `learning_evidence_objective_cursor_idx` ON `learning_evidence` (`userId`,`objectiveId`,`createdAt`,`id`);--> statement-breakpoint
CREATE INDEX `learning_evidence_source_idx` ON `learning_evidence` (`userId`,`sourceKind`,`sourceId`);--> statement-breakpoint
CREATE TABLE `learning_evidence_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`evidenceId` text NOT NULL,
	`state` text NOT NULL,
	`reason` text,
	`actor` text DEFAULT 'user' NOT NULL,
	`idempotencyKey` text NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`evidenceId`) REFERENCES `learning_evidence`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "learning_evidence_decisions_state_check" CHECK("learning_evidence_decisions"."state" in ('included', 'excluded'))
);
--> statement-breakpoint
CREATE INDEX `learning_evidence_decisions_latest_idx` ON `learning_evidence_decisions` (`evidenceId`,`createdAt`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `learning_evidence_decisions_key_unique` ON `learning_evidence_decisions` (`userId`,`idempotencyKey`);--> statement-breakpoint
CREATE TABLE `learning_mastery_current` (
	`objectiveId` text PRIMARY KEY NOT NULL,
	`projectionId` text NOT NULL,
	`generation` integer NOT NULL,
	`evidenceCursor` text NOT NULL,
	`userId` text NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`objectiveId`) REFERENCES `learning_objectives`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`projectionId`) REFERENCES `learning_mastery_projections`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `learning_mastery_current_user_idx` ON `learning_mastery_current` (`userId`);--> statement-breakpoint
CREATE TABLE `learning_mastery_projections` (
	`id` text PRIMARY KEY NOT NULL,
	`objectiveId` text NOT NULL,
	`generation` integer NOT NULL,
	`algorithmRevision` text NOT NULL,
	`evidenceCursor` text NOT NULL,
	`asOf` integer NOT NULL,
	`estimate` real NOT NULL,
	`low` real NOT NULL,
	`high` real NOT NULL,
	`alpha` real NOT NULL,
	`beta` real NOT NULL,
	`evidenceCount` integer NOT NULL,
	`freshnessDays` real,
	`explanationVersion` integer DEFAULT 1 NOT NULL,
	`explanationJson` text NOT NULL,
	`digest` text NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`objectiveId`) REFERENCES `learning_objectives`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "learning_mastery_projection_interval_check" CHECK("learning_mastery_projections"."low" >= 0 and "learning_mastery_projections"."low" <= "learning_mastery_projections"."estimate" and "learning_mastery_projections"."estimate" <= "learning_mastery_projections"."high" and "learning_mastery_projections"."high" <= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `learning_mastery_projection_generation_unique` ON `learning_mastery_projections` (`objectiveId`,`generation`);--> statement-breakpoint
CREATE UNIQUE INDEX `learning_mastery_projection_replay_unique` ON `learning_mastery_projections` (`objectiveId`,`algorithmRevision`,`evidenceCursor`,`asOf`);--> statement-breakpoint
CREATE INDEX `learning_mastery_projection_history_idx` ON `learning_mastery_projections` (`userId`,`objectiveId`,`createdAt`);--> statement-breakpoint
CREATE TABLE `learning_objective_prerequisites` (
	`objectiveId` text NOT NULL,
	`prerequisiteObjectiveId` text NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	PRIMARY KEY(`objectiveId`, `prerequisiteObjectiveId`),
	FOREIGN KEY (`objectiveId`) REFERENCES `learning_objectives`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`prerequisiteObjectiveId`) REFERENCES `learning_objectives`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "learning_objective_prerequisites_no_self_check" CHECK("learning_objective_prerequisites"."objectiveId" <> "learning_objective_prerequisites"."prerequisiteObjectiveId")
);
--> statement-breakpoint
CREATE INDEX `learning_objective_prerequisites_reverse_idx` ON `learning_objective_prerequisites` (`prerequisiteObjectiveId`);--> statement-breakpoint
CREATE TABLE `learning_objectives` (
	`id` text PRIMARY KEY NOT NULL,
	`conceptId` text NOT NULL,
	`statement` text NOT NULL,
	`expectedLevel` integer DEFAULT 3 NOT NULL,
	`curriculumCode` text,
	`activeFrom` integer,
	`activeTo` integer,
	`revision` integer DEFAULT 1 NOT NULL,
	`archivedAt` integer,
	`yearId` text NOT NULL,
	`subjectId` text,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`conceptId`) REFERENCES `learning_concepts`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`yearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`subjectId`) REFERENCES `subjects`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "learning_objectives_expected_level_check" CHECK("learning_objectives"."expectedLevel" between 1 and 5)
);
--> statement-breakpoint
CREATE INDEX `learning_objectives_concept_idx` ON `learning_objectives` (`conceptId`);--> statement-breakpoint
CREATE INDEX `learning_objectives_scope_idx` ON `learning_objectives` (`userId`,`yearId`,`subjectId`);--> statement-breakpoint
CREATE TABLE `learning_plan_items` (
	`id` text PRIMARY KEY NOT NULL,
	`objectiveId` text NOT NULL,
	`rationaleJson` text NOT NULL,
	`evidenceCursor` text NOT NULL,
	`activityKind` text NOT NULL,
	`difficulty` real,
	`estimatedMinutes` integer NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`planningTaskId` text,
	`projectId` text,
	`documentId` text,
	`artifactId` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`yearId` text NOT NULL,
	`subjectId` text,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`objectiveId`) REFERENCES `learning_objectives`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`planningTaskId`) REFERENCES `planning_tasks`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`projectId`) REFERENCES `study_projects`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`documentId`) REFERENCES `study_documents`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`yearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`subjectId`) REFERENCES `subjects`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "learning_plan_items_status_check" CHECK("learning_plan_items"."status" in ('proposed', 'accepted', 'in-progress', 'completed', 'dismissed')),
	CONSTRAINT "learning_plan_items_duration_check" CHECK("learning_plan_items"."estimatedMinutes" between 5 and 480)
);
--> statement-breakpoint
CREATE INDEX `learning_plan_items_status_idx` ON `learning_plan_items` (`userId`,`yearId`,`status`);--> statement-breakpoint
CREATE INDEX `learning_plan_items_objective_idx` ON `learning_plan_items` (`objectiveId`);--> statement-breakpoint
CREATE TABLE `learning_preferences` (
	`userId` text PRIMARY KEY NOT NULL,
	`analysisEnabled` integer DEFAULT false NOT NULL,
	`latencyCollectionEnabled` integer DEFAULT false NOT NULL,
	`trainingExportOptIn` integer DEFAULT false NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "learning_preferences_revision_check" CHECK("learning_preferences"."revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE `learning_quiz_attempt_items` (
	`id` text PRIMARY KEY NOT NULL,
	`attemptId` text NOT NULL,
	`questionVersionId` text NOT NULL,
	`questionId` text NOT NULL,
	`answerJson` text NOT NULL,
	`normalizedOutcome` real,
	`feedback` text,
	`latencyMs` integer,
	`hintsUsed` integer DEFAULT 0 NOT NULL,
	`evidenceId` text,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`attemptId`) REFERENCES `quiz_attempts`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`questionVersionId`) REFERENCES `learning_quiz_question_versions`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`evidenceId`) REFERENCES `learning_evidence`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "learning_quiz_attempt_items_outcome_check" CHECK("learning_quiz_attempt_items"."normalizedOutcome" >= 0 and "learning_quiz_attempt_items"."normalizedOutcome" <= 1),
	CONSTRAINT "learning_quiz_attempt_items_latency_check" CHECK("learning_quiz_attempt_items"."latencyMs" is null or "learning_quiz_attempt_items"."latencyMs" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `learning_quiz_attempt_item_unique` ON `learning_quiz_attempt_items` (`attemptId`,`questionId`);--> statement-breakpoint
CREATE INDEX `learning_quiz_attempt_items_evidence_idx` ON `learning_quiz_attempt_items` (`evidenceId`);--> statement-breakpoint
CREATE TABLE `learning_quiz_attempt_modes` (
	`attemptId` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	`latencyConsent` integer DEFAULT false NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`attemptId`) REFERENCES `quiz_attempts`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "learning_quiz_attempt_modes_mode_check" CHECK("learning_quiz_attempt_modes"."mode" in ('practice', 'progress'))
);
--> statement-breakpoint
CREATE TABLE `learning_quiz_question_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`documentId` text NOT NULL,
	`documentRevision` integer NOT NULL,
	`questionId` text NOT NULL,
	`kind` text NOT NULL,
	`prompt` text NOT NULL,
	`objectiveIdsJson` text NOT NULL,
	`difficulty` real,
	`sourceProofsJson` text NOT NULL,
	`rubricRevision` text NOT NULL,
	`rubricJson` text NOT NULL,
	`generationProvenanceJson` text,
	`validationState` text NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`documentId`) REFERENCES `study_documents`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `learning_quiz_question_version_unique` ON `learning_quiz_question_versions` (`documentId`,`documentRevision`,`questionId`);--> statement-breakpoint
CREATE INDEX `learning_quiz_question_objective_idx` ON `learning_quiz_question_versions` (`userId`,`documentId`);--> statement-breakpoint
CREATE TABLE `managed_beta_accounts` (
	`accountId` text PRIMARY KEY NOT NULL,
	`inviteId` text,
	`cohort` text NOT NULL,
	`region` text NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`acceptedTermsRevision` text NOT NULL,
	`acceptedPrivacyRevision` text NOT NULL,
	`managedDataConsent` integer DEFAULT false NOT NULL,
	`consentedCategoriesJson` text NOT NULL,
	`capabilitiesJson` text NOT NULL,
	`policyRevision` text NOT NULL,
	`activatedAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`accountId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`inviteId`) REFERENCES `managed_beta_invites`(`id`) ON UPDATE cascade ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `managed_beta_accounts_state_cohort_idx` ON `managed_beta_accounts` (`state`,`cohort`);--> statement-breakpoint
CREATE TABLE `managed_beta_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`tokenDigest` text NOT NULL,
	`emailDigest` text,
	`cohort` text NOT NULL,
	`region` text NOT NULL,
	`capabilitiesJson` text NOT NULL,
	`termsRevision` text NOT NULL,
	`privacyRevision` text NOT NULL,
	`status` text DEFAULT 'issued' NOT NULL,
	`expiresAt` integer NOT NULL,
	`createdByUserId` text NOT NULL,
	`redeemedByAccountId` text,
	`redeemedAt` integer,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`redeemedByAccountId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `managed_beta_invites_token_unique` ON `managed_beta_invites` (`tokenDigest`);--> statement-breakpoint
CREATE INDEX `managed_beta_invites_status_expiry_idx` ON `managed_beta_invites` (`status`,`expiresAt`);--> statement-breakpoint
CREATE TABLE `managed_beta_waitlist` (
	`id` text PRIMARY KEY NOT NULL,
	`accountId` text NOT NULL,
	`preferredRegion` text NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`accountId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `managed_beta_waitlist_account_unique` ON `managed_beta_waitlist` (`accountId`);--> statement-breakpoint
CREATE INDEX `managed_beta_waitlist_status_idx` ON `managed_beta_waitlist` (`status`,`createdAt`);--> statement-breakpoint
CREATE TABLE `managed_billing_price_mappings` (
	`provider` text NOT NULL,
	`externalPriceRef` text NOT NULL,
	`planRevision` text NOT NULL,
	`currency` text NOT NULL,
	`entitlementTemplateJson` text NOT NULL,
	`active` integer DEFAULT false NOT NULL,
	`createdByUserId` text NOT NULL,
	`createdAt` integer NOT NULL,
	PRIMARY KEY(`provider`, `externalPriceRef`),
	FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `managed_billing_price_plan_revision_unique` ON `managed_billing_price_mappings` (`provider`,`planRevision`);--> statement-breakpoint
CREATE TABLE `managed_incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`safeSummary` text NOT NULL,
	`severity` text NOT NULL,
	`status` text NOT NULL,
	`affectedCapabilitiesJson` text NOT NULL,
	`provider` text,
	`publiclyVisible` integer DEFAULT false NOT NULL,
	`startedAt` integer NOT NULL,
	`resolvedAt` integer,
	`updatedByUserId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`updatedByUserId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `managed_incidents_public_status_idx` ON `managed_incidents` (`publiclyVisible`,`status`,`startedAt`);--> statement-breakpoint
CREATE TABLE `managed_launch_gates` (
	`key` text PRIMARY KEY NOT NULL,
	`phase` text NOT NULL,
	`status` text NOT NULL,
	`evidenceId` text,
	`justification` text NOT NULL,
	`updatedByUserId` text NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`evidenceId`) REFERENCES `managed_operational_evidence`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`updatedByUserId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `managed_launch_gates_phase_status_idx` ON `managed_launch_gates` (`phase`,`status`);--> statement-breakpoint
CREATE TABLE `managed_operational_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`environment` text NOT NULL,
	`region` text,
	`provider` text,
	`releaseRevision` text NOT NULL,
	`status` text NOT NULL,
	`source` text NOT NULL,
	`safeSummary` text NOT NULL,
	`metricsJson` text NOT NULL,
	`artifactDigest` text,
	`reference` text,
	`observedAt` integer NOT NULL,
	`expiresAt` integer,
	`createdByUserId` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`createdByUserId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `managed_operational_evidence_kind_status_idx` ON `managed_operational_evidence` (`kind`,`status`,`observedAt`);--> statement-breakpoint
CREATE TABLE `managed_quota_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`scopeId` text NOT NULL,
	`capability` text DEFAULT '*' NOT NULL,
	`period` text NOT NULL,
	`hardLimit` text NOT NULL,
	`concurrency` integer NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`revision` text NOT NULL,
	`justification` text NOT NULL,
	`updatedByUserId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`updatedByUserId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "managed_quota_policies_limit_check" CHECK("managed_quota_policies"."hardLimit" glob '[0-9]*' and "managed_quota_policies"."hardLimit" <> '' and "managed_quota_policies"."concurrency" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `managed_quota_policies_identity_unique` ON `managed_quota_policies` (`scope`,`scopeId`,`capability`,`period`);--> statement-breakpoint
CREATE INDEX `managed_quota_policies_enabled_idx` ON `managed_quota_policies` (`enabled`,`scope`,`scopeId`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
DROP TRIGGER `assistant_messages_links_insert`;--> statement-breakpoint
DROP TRIGGER `assistant_runs_links_insert`;--> statement-breakpoint
DROP TRIGGER `assistant_runs_links_update`;--> statement-breakpoint
DROP TRIGGER `assistant_run_events_append_only`;--> statement-breakpoint
DROP TRIGGER `assistant_proof_handles_validate_insert`;--> statement-breakpoint
DROP TRIGGER `assistant_citations_validate_insert`;--> statement-breakpoint
DROP TRIGGER `assistant_checkpoints_validate_insert`;--> statement-breakpoint
DROP TRIGGER `assistant_outbox_validate_insert`;--> statement-breakpoint
CREATE TABLE `__new_assistant_runs` (
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
	`runtimeProtocolVersion` integer DEFAULT 1 NOT NULL,
	`graphSchemaVersion` integer NOT NULL,
	`modelKey` text NOT NULL,
	`modelRevision` text DEFAULT 'legacy/1' NOT NULL,
	`providerKey` text NOT NULL,
	`providerRevision` text DEFAULT 'legacy/1' NOT NULL,
	`modelPlacementJson` text DEFAULT '{"kind":"core","instanceId":"legacy"}' NOT NULL,
	`policyRevision` text DEFAULT 'assistant-policy/1' NOT NULL,
	`modelPolicyJson` text,
	`toolCatalogRevision` text DEFAULT 'legacy/1' NOT NULL,
	`contextManifestDigest` text,
	`branchIdentityDigest` text,
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
	`cancellationRequestedAt` integer,
	`cancellationReason` text,
	`terminalReason` text,
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
	CONSTRAINT "assistant_runs_status_check" CHECK("__new_assistant_runs"."status" in ('reserved', 'running', 'waiting-for-user', 'waiting-approval', 'cancelling', 'complete', 'failed', 'cancelled')),
	CONSTRAINT "assistant_runs_approval_mode_check" CHECK("__new_assistant_runs"."approvalMode" in ('read-only', 'confirm-writes', 'auto-reversible')),
	CONSTRAINT "assistant_runs_dispatch_state_check" CHECK("__new_assistant_runs"."providerDispatchState" in ('pending', 'dispatching', 'acknowledged', 'completed', 'failed', 'cancelled', 'inspect-required')),
	CONSTRAINT "assistant_runs_runtime_protocol_check" CHECK("__new_assistant_runs"."runtimeProtocolVersion" = 1)
);
--> statement-breakpoint
INSERT INTO `__new_assistant_runs`("id", "userId", "threadId", "branchId", "inputMessageId", "outputMessageId", "reservedOutputMessageId", "parentRunId", "clientRequestId", "runtimeId", "runtimeVersion", "runtimeProtocolVersion", "graphSchemaVersion", "modelKey", "modelRevision", "providerKey", "providerRevision", "modelPlacementJson", "policyRevision", "modelPolicyJson", "toolCatalogRevision", "contextManifestDigest", "branchIdentityDigest", "modelResolvedId", "status", "approvalMode", "providerRequestKey", "providerDispatchState", "contextManifestId", "conversationCheckpointRef", "workspaceSnapshotRef", "sandboxRuntimeCheckpointRef", "domainCursorRef", "startedAt", "completedAt", "cancellationRequestedAt", "cancellationReason", "terminalReason", "errorCode", "safeError", "createdAt", "updatedAt") SELECT "id", "userId", "threadId", "branchId", "inputMessageId", "outputMessageId", "reservedOutputMessageId", "parentRunId", "clientRequestId", "runtimeId", "runtimeVersion", 1, "graphSchemaVersion", "modelKey", 'legacy/1', "providerKey", 'legacy/1', '{"kind":"core","instanceId":"legacy"}', 'assistant-policy/1', NULL, 'legacy/1', NULL, NULL, "modelResolvedId", "status", "approvalMode", "providerRequestKey", "providerDispatchState", "contextManifestId", "conversationCheckpointRef", "workspaceSnapshotRef", "sandboxRuntimeCheckpointRef", "domainCursorRef", "startedAt", "completedAt", NULL, NULL, NULL, "errorCode", "safeError", "createdAt", "updatedAt" FROM `assistant_runs`;--> statement-breakpoint
DROP TABLE `assistant_runs`;--> statement-breakpoint
ALTER TABLE `__new_assistant_runs` RENAME TO `assistant_runs`;--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_runs_thread_client_request_unique` ON `assistant_runs` (`threadId`,`clientRequestId`);--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_runs_output_message_unique` ON `assistant_runs` (`outputMessageId`);--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_runs_reserved_output_unique` ON `assistant_runs` (`reservedOutputMessageId`);--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_runs_branch_active_unique` ON `assistant_runs` (`branchId`) WHERE "assistant_runs"."status" in ('reserved', 'running', 'waiting-for-user', 'waiting-approval', 'cancelling');--> statement-breakpoint
CREATE INDEX `assistant_runs_thread_created_idx` ON `assistant_runs` (`threadId`,`createdAt`);--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_runs_thread_id_unique` ON `assistant_runs` (`threadId`,`id`);--> statement-breakpoint
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
END;--> statement-breakpoint
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
END;--> statement-breakpoint
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
      OR NEW.completedAt IS NOT OLD.completedAt OR NEW.safeError IS NOT OLD.safeError
      OR NEW.terminalReason IS NOT OLD.terminalReason)
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
END;--> statement-breakpoint
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
END;--> statement-breakpoint
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
END;--> statement-breakpoint
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
END;--> statement-breakpoint
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
END;--> statement-breakpoint
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
END;--> statement-breakpoint
DROP INDEX `user_service_keys_user_kind_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `user_service_keys_user_kind_provider_unique` ON `user_service_keys` (`userId`,`kind`,`provider`);--> statement-breakpoint
DROP TRIGGER `study_projects_scope_insert`;--> statement-breakpoint
DROP TRIGGER `study_projects_scope_update`;--> statement-breakpoint
DROP TRIGGER `study_project_items_scope_insert`;--> statement-breakpoint
DROP TRIGGER `study_project_items_scope_update`;--> statement-breakpoint
DROP TRIGGER `assistant_threads_project_owner_insert`;--> statement-breakpoint
DROP TRIGGER `assistant_threads_project_owner_update`;--> statement-breakpoint
DROP TRIGGER `assistant_attachments_validate_insert`;--> statement-breakpoint
CREATE TABLE `__new_study_project_items` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`kind` text NOT NULL,
	`referenceId` text NOT NULL,
	`sourceVersionId` text,
	`conversationBranchId` text,
	`conversationHeadMessageId` text,
	`trackingMode` text DEFAULT 'follow-head' NOT NULL,
	`selectorReviewRequired` integer DEFAULT false NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`contextMode` text DEFAULT 'include' NOT NULL,
	`label` text,
	`addedAt` integer NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `study_projects`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`sourceVersionId`) REFERENCES `content_versions`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "study_project_items_kind_check" CHECK("__new_study_project_items"."kind" in ('material', 'study-document', 'recording', 'grade', 'subject', 'conversation', 'artifact')),
	CONSTRAINT "study_project_items_context_mode_check" CHECK("__new_study_project_items"."contextMode" in ('include', 'on-demand', 'exclude')),
	CONSTRAINT "study_project_items_tracking_mode_check" CHECK("__new_study_project_items"."trackingMode" in ('pinned', 'follow-head')),
	CONSTRAINT "study_project_items_conversation_selector_check" CHECK(("__new_study_project_items"."kind" = 'conversation' and "__new_study_project_items"."trackingMode" = 'pinned' and (("__new_study_project_items"."conversationBranchId" is not null and "__new_study_project_items"."conversationHeadMessageId" is not null) or ("__new_study_project_items"."selectorReviewRequired" = 1 and "__new_study_project_items"."conversationBranchId" is null and "__new_study_project_items"."conversationHeadMessageId" is null))) or ("__new_study_project_items"."kind" != 'conversation' and "__new_study_project_items"."conversationBranchId" is null and "__new_study_project_items"."conversationHeadMessageId" is null)),
	CONSTRAINT "study_project_items_position_check" CHECK("__new_study_project_items"."position" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_study_project_items`("id", "projectId", "kind", "referenceId", "sourceVersionId", "conversationBranchId", "conversationHeadMessageId", "trackingMode", "selectorReviewRequired", "position", "contextMode", "label", "addedAt") SELECT "id", "projectId", "kind", "referenceId", NULL, NULL, NULL, CASE WHEN "kind" = 'conversation' THEN 'pinned' ELSE 'follow-head' END, CASE WHEN "kind" = 'conversation' THEN 1 ELSE 0 END, "position", "contextMode", "label", "addedAt" FROM `study_project_items`;--> statement-breakpoint
DROP TABLE `study_project_items`;--> statement-breakpoint
ALTER TABLE `__new_study_project_items` RENAME TO `study_project_items`;--> statement-breakpoint
CREATE UNIQUE INDEX `study_project_items_reference_unique` ON `study_project_items` (`projectId`,`kind`,`referenceId`);--> statement-breakpoint
CREATE INDEX `study_project_items_order_idx` ON `study_project_items` (`projectId`,`position`,`id`);--> statement-breakpoint
CREATE TABLE `__new_study_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`yearId` text,
	`subjectId` text,
	`instructionsMarkdown` text,
	`contextPolicyVersion` integer DEFAULT 1 NOT NULL,
	`contextPolicyJson` text,
	`emoji` text,
	`color` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`retrievalMode` text DEFAULT 'lexical-only' NOT NULL,
	`retrievalFallbackPolicy` text DEFAULT 'lexical-only' NOT NULL,
	`embeddingSpaceId` text,
	`rerankSpaceId` text,
	`starredAt` integer,
	`deletedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`yearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`subjectId`) REFERENCES `subjects`(`id`) ON UPDATE cascade ON DELETE set null,
	CONSTRAINT "study_projects_revision_check" CHECK("__new_study_projects"."revision" >= 1 and "__new_study_projects"."contextPolicyVersion" >= 1),
	CONSTRAINT "study_projects_retrieval_mode_check" CHECK("__new_study_projects"."retrievalMode" in ('lexical-only', 'advanced-auto')),
	CONSTRAINT "study_projects_retrieval_fallback_check" CHECK("__new_study_projects"."retrievalFallbackPolicy" in ('fail', 'lexical-only', 'hybrid-without-rerank'))
);
--> statement-breakpoint
INSERT INTO `__new_study_projects`("id", "userId", "title", "description", "yearId", "subjectId", "instructionsMarkdown", "contextPolicyVersion", "contextPolicyJson", "emoji", "color", "revision", "retrievalMode", "retrievalFallbackPolicy", "embeddingSpaceId", "rerankSpaceId", "starredAt", "deletedAt", "createdAt", "updatedAt") SELECT "id", "userId", "title", "description", "yearId", "subjectId", "instructionsMarkdown", "contextPolicyVersion", "contextPolicyJson", "emoji", "color", "revision", 'lexical-only', 'lexical-only', NULL, NULL, "starredAt", "deletedAt", "createdAt", "updatedAt" FROM `study_projects`;--> statement-breakpoint
DROP TABLE `study_projects`;--> statement-breakpoint
ALTER TABLE `__new_study_projects` RENAME TO `study_projects`;--> statement-breakpoint
CREATE INDEX `study_projects_owner_updated_idx` ON `study_projects` (`userId`,`deletedAt`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `study_projects_year_idx` ON `study_projects` (`userId`,`yearId`);--> statement-breakpoint
CREATE TRIGGER `study_projects_scope_insert`
BEFORE INSERT ON `study_projects`
WHEN
	(NEW.`yearId` IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM `years` WHERE `id` = NEW.`yearId` AND `userId` = NEW.`userId`
	)) OR
	(NEW.`subjectId` IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM `subjects`
		WHERE `id` = NEW.`subjectId` AND `userId` = NEW.`userId`
		AND (NEW.`yearId` IS NULL OR `yearId` = NEW.`yearId`)
	))
BEGIN
	SELECT RAISE(ABORT, 'study project scope is not owned');
END;--> statement-breakpoint
CREATE TRIGGER `study_projects_scope_update`
BEFORE UPDATE OF `userId`, `yearId`, `subjectId` ON `study_projects`
WHEN
	(NEW.`yearId` IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM `years` WHERE `id` = NEW.`yearId` AND `userId` = NEW.`userId`
	)) OR
	(NEW.`subjectId` IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM `subjects`
		WHERE `id` = NEW.`subjectId` AND `userId` = NEW.`userId`
		AND (NEW.`yearId` IS NULL OR `yearId` = NEW.`yearId`)
	))
BEGIN
	SELECT RAISE(ABORT, 'study project scope is not owned');
END;--> statement-breakpoint
CREATE TRIGGER `study_project_items_scope_insert`
BEFORE INSERT ON `study_project_items`
WHEN NOT EXISTS (
	SELECT 1
	FROM `study_projects` AS projects
	JOIN `content_sources` AS sources
		ON sources.`userId` = projects.`userId`
		AND sources.`originKind` = NEW.`kind`
		AND sources.`originId` = NEW.`referenceId`
	WHERE projects.`id` = NEW.`projectId`
		AND (projects.`yearId` IS NULL OR sources.`yearId` IS NULL OR projects.`yearId` = sources.`yearId`)
)
BEGIN
	SELECT RAISE(ABORT, 'project item source is not owned or year-compatible');
END;--> statement-breakpoint
CREATE TRIGGER `study_project_items_scope_update`
BEFORE UPDATE OF `projectId`, `kind`, `referenceId` ON `study_project_items`
WHEN NOT EXISTS (
	SELECT 1
	FROM `study_projects` AS projects
	JOIN `content_sources` AS sources
		ON sources.`userId` = projects.`userId`
		AND sources.`originKind` = NEW.`kind`
		AND sources.`originId` = NEW.`referenceId`
	WHERE projects.`id` = NEW.`projectId`
		AND (projects.`yearId` IS NULL OR sources.`yearId` IS NULL OR projects.`yearId` = sources.`yearId`)
)
BEGIN
	SELECT RAISE(ABORT, 'project item source is not owned or year-compatible');
END;--> statement-breakpoint
CREATE TRIGGER assistant_threads_project_owner_insert
BEFORE INSERT ON assistant_threads
WHEN NEW.projectId IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM study_projects p
    WHERE p.id = NEW.projectId AND p.userId = NEW.userId
  ) THEN RAISE(ABORT, 'assistant project must be owned by thread owner') END;
END;--> statement-breakpoint
CREATE TRIGGER assistant_threads_project_owner_update
BEFORE UPDATE OF projectId, userId ON assistant_threads
WHEN NEW.projectId IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM study_projects p
    WHERE p.id = NEW.projectId AND p.userId = NEW.userId
  ) THEN RAISE(ABORT, 'assistant project must be owned by thread owner') END;
END;--> statement-breakpoint
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
END;--> statement-breakpoint
CREATE TABLE `__new_assistant_usage` (
	`runId` text PRIMARY KEY NOT NULL,
	`providerKey` text NOT NULL,
	`providerRevision` text DEFAULT 'legacy/1' NOT NULL,
	`modelKey` text NOT NULL,
	`modelRevision` text DEFAULT 'legacy/1' NOT NULL,
	`usageVersion` integer DEFAULT 1 NOT NULL,
	`source` text DEFAULT 'unknown' NOT NULL,
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
	CONSTRAINT "assistant_usage_version_check" CHECK("__new_assistant_usage"."usageVersion" = 1),
	CONSTRAINT "assistant_usage_source_check" CHECK("__new_assistant_usage"."source" in ('provider', 'estimated', 'unknown')),
	CONSTRAINT "assistant_usage_nonnegative_check" CHECK(coalesce("__new_assistant_usage"."inputTokens", 0) >= 0 and coalesce("__new_assistant_usage"."outputTokens", 0) >= 0 and coalesce("__new_assistant_usage"."reasoningTokens", 0) >= 0 and coalesce("__new_assistant_usage"."cachedReadTokens", 0) >= 0 and coalesce("__new_assistant_usage"."cachedWriteTokens", 0) >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_assistant_usage`("runId", "providerKey", "providerRevision", "modelKey", "modelRevision", "usageVersion", "source", "pricingSnapshotId", "inputTokens", "outputTokens", "reasoningTokens", "cachedReadTokens", "cachedWriteTokens", "estimatedCost", "currency", "final", "createdAt") SELECT "runId", "providerKey", 'legacy/1', "modelKey", 'legacy/1', 1, 'unknown', "pricingSnapshotId", "inputTokens", "outputTokens", "reasoningTokens", "cachedReadTokens", "cachedWriteTokens", "estimatedCost", "currency", "final", "createdAt" FROM `assistant_usage`;--> statement-breakpoint
DROP TABLE `assistant_usage`;--> statement-breakpoint
ALTER TABLE `__new_assistant_usage` RENAME TO `assistant_usage`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
