CREATE TABLE `assistant_tool_source_policies` (
	`sourceId` text NOT NULL,
	`remoteToolId` text NOT NULL,
	`catalogDigest` text NOT NULL,
	`classification` text DEFAULT 'unreviewed' NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`allowedDataCategoriesJson` text DEFAULT '[]' NOT NULL,
	`reviewedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	PRIMARY KEY(`sourceId`, `remoteToolId`),
	FOREIGN KEY (`sourceId`) REFERENCES `assistant_tool_sources`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "assistant_tool_source_policies_classification_check" CHECK("assistant_tool_source_policies"."classification" in ('unreviewed', 'read-only', 'blocked')),
	CONSTRAINT "assistant_tool_source_policies_enabled_check" CHECK("assistant_tool_source_policies"."enabled" = 0 or "assistant_tool_source_policies"."classification" = 'read-only'),
	CONSTRAINT "assistant_tool_source_policies_digest_check" CHECK(length("assistant_tool_source_policies"."catalogDigest") = 64)
);
--> statement-breakpoint
CREATE INDEX `assistant_tool_source_policies_source_enabled_idx` ON `assistant_tool_source_policies` (`sourceId`,`enabled`);--> statement-breakpoint
CREATE TABLE `assistant_tool_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`name` text NOT NULL,
	`endpointUrl` text NOT NULL,
	`endpointOrigin` text NOT NULL,
	`placement` text NOT NULL,
	`authKind` text NOT NULL,
	`sealedCredential` text,
	`credentialHint` text,
	`status` text DEFAULT 'review-required' NOT NULL,
	`catalogJson` text NOT NULL,
	`catalogDigest` text NOT NULL,
	`catalogRevision` integer DEFAULT 1 NOT NULL,
	`lastCheckedAt` integer NOT NULL,
	`lastError` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "assistant_tool_sources_placement_check" CHECK("assistant_tool_sources"."placement" in ('hosted-core', 'node')),
	CONSTRAINT "assistant_tool_sources_auth_check" CHECK("assistant_tool_sources"."authKind" in ('none', 'bearer', 'api-key')),
	CONSTRAINT "assistant_tool_sources_credential_check" CHECK(("assistant_tool_sources"."authKind" = 'none' and "assistant_tool_sources"."sealedCredential" is null and "assistant_tool_sources"."credentialHint" is null) or ("assistant_tool_sources"."authKind" <> 'none' and "assistant_tool_sources"."sealedCredential" is not null)),
	CONSTRAINT "assistant_tool_sources_status_check" CHECK("assistant_tool_sources"."status" in ('review-required', 'enabled', 'disabled', 'unavailable')),
	CONSTRAINT "assistant_tool_sources_digest_check" CHECK(length("assistant_tool_sources"."catalogDigest") = 64),
	CONSTRAINT "assistant_tool_sources_revision_check" CHECK("assistant_tool_sources"."catalogRevision" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_tool_sources_user_url_unique` ON `assistant_tool_sources` (`userId`,`endpointUrl`);--> statement-breakpoint
CREATE INDEX `assistant_tool_sources_user_status_idx` ON `assistant_tool_sources` (`userId`,`status`);--> statement-breakpoint
CREATE TABLE `account_execution_controls` (
	`accountId` text PRIMARY KEY NOT NULL,
	`paidExecutionDisabled` integer DEFAULT false NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`accountId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "account_execution_controls_revision_check" CHECK("account_execution_controls"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE `billing_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`accountId` text NOT NULL,
	`provider` text NOT NULL,
	`externalCustomerRef` text,
	`externalSubscriptionRef` text NOT NULL,
	`status` text NOT NULL,
	`currentPeriodEndsAt` integer,
	`observedAt` integer NOT NULL,
	FOREIGN KEY (`accountId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_subscriptions_external_unique` ON `billing_subscriptions` (`provider`,`externalSubscriptionRef`);--> statement-breakpoint
CREATE INDEX `billing_subscriptions_account_idx` ON `billing_subscriptions` (`accountId`);--> statement-breakpoint
CREATE TABLE `billing_webhook_inbox` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`externalEventId` text NOT NULL,
	`eventType` text NOT NULL,
	`payloadDigest` text NOT NULL,
	`payloadJson` text NOT NULL,
	`status` text DEFAULT 'received' NOT NULL,
	`safeErrorCode` text,
	`receivedAt` integer NOT NULL,
	`processedAt` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_webhook_inbox_external_unique` ON `billing_webhook_inbox` (`provider`,`externalEventId`);--> statement-breakpoint
CREATE INDEX `billing_webhook_inbox_status_idx` ON `billing_webhook_inbox` (`status`,`receivedAt`);--> statement-breakpoint
CREATE TABLE `entitlement_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`accountId` text NOT NULL,
	`snapshotId` text NOT NULL,
	`snapshotRevision` text NOT NULL,
	`capability` text NOT NULL,
	`quantity` text NOT NULL,
	`unit` text NOT NULL,
	`mode` text NOT NULL,
	`allowed` integer NOT NULL,
	`wouldBlock` integer NOT NULL,
	`reason` text NOT NULL,
	`aggregateBefore` text NOT NULL,
	`decidedAt` integer NOT NULL,
	FOREIGN KEY (`accountId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `entitlement_decisions_account_time_idx` ON `entitlement_decisions` (`accountId`,`decidedAt`);--> statement-breakpoint
CREATE INDEX `entitlement_decisions_shadow_idx` ON `entitlement_decisions` (`mode`,`wouldBlock`,`decidedAt`);--> statement-breakpoint
CREATE TABLE `entitlement_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`accountId` text NOT NULL,
	`capability` text NOT NULL,
	`entitlementJson` text NOT NULL,
	`reason` text NOT NULL,
	`actorId` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`revokedAt` integer,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`accountId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `entitlement_grants_active_idx` ON `entitlement_grants` (`accountId`,`capability`,`expiresAt`,`revokedAt`);--> statement-breakpoint
CREATE TABLE `entitlement_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`accountId` text NOT NULL,
	`revision` text NOT NULL,
	`plan` text NOT NULL,
	`status` text NOT NULL,
	`periodStartsAt` integer NOT NULL,
	`periodEndsAt` integer NOT NULL,
	`capabilitiesJson` text NOT NULL,
	`source` text NOT NULL,
	`issuedAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`accountId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "entitlement_snapshots_period_check" CHECK("entitlement_snapshots"."periodEndsAt" > "entitlement_snapshots"."periodStartsAt")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entitlement_snapshots_account_revision_unique` ON `entitlement_snapshots` (`accountId`,`revision`);--> statement-breakpoint
CREATE INDEX `entitlement_snapshots_current_idx` ON `entitlement_snapshots` (`accountId`,`periodStartsAt`,`periodEndsAt`,`issuedAt`);--> statement-breakpoint
CREATE TABLE `managed_abuse_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`accountId` text NOT NULL,
	`capability` text,
	`reasonCode` text NOT NULL,
	`policyVersion` text NOT NULL,
	`state` text NOT NULL,
	`appealState` text DEFAULT 'none' NOT NULL,
	`evidenceDigest` text,
	`expiresAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`accountId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `managed_abuse_decisions_account_idx` ON `managed_abuse_decisions` (`accountId`,`createdAt`);--> statement-breakpoint
CREATE TABLE `managed_circuit_breakers` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`scopeId` text NOT NULL,
	`state` text NOT NULL,
	`reasonCode` text NOT NULL,
	`actorId` text NOT NULL,
	`expiresAt` integer,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `managed_circuit_breakers_scope_unique` ON `managed_circuit_breakers` (`scope`,`scopeId`);--> statement-breakpoint
CREATE TABLE `managed_model_catalogue` (
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`revision` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`modalitiesJson` text NOT NULL,
	`contextTokens` text NOT NULL,
	`supportsTools` integer NOT NULL,
	`supportsStructuredOutput` integer NOT NULL,
	`regionsJson` text NOT NULL,
	`retentionPolicy` text NOT NULL,
	`zeroRetention` integer DEFAULT false NOT NULL,
	`trainingOptInRequired` integer DEFAULT false NOT NULL,
	`pricingSnapshotId` text,
	`updatedAt` integer NOT NULL,
	PRIMARY KEY(`provider`, `model`, `revision`),
	FOREIGN KEY (`pricingSnapshotId`) REFERENCES `pricing_snapshots`(`id`) ON UPDATE cascade ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `managed_model_catalogue_enabled_idx` ON `managed_model_catalogue` (`enabled`,`provider`,`model`);--> statement-breakpoint
CREATE TABLE `managed_storage_objects` (
	`accountId` text NOT NULL,
	`namespace` text NOT NULL,
	`logicalKey` text NOT NULL,
	`physicalKey` text NOT NULL,
	`digest` text NOT NULL,
	`byteSize` text NOT NULL,
	`mimeType` text NOT NULL,
	`category` text DEFAULT 'committed' NOT NULL,
	`placementJson` text NOT NULL,
	`reservationId` text,
	`committedAt` integer NOT NULL,
	`deletedAt` integer,
	PRIMARY KEY(`accountId`, `namespace`, `logicalKey`),
	FOREIGN KEY (`accountId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`reservationId`) REFERENCES `usage_reservations`(`id`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `managed_storage_objects_physical_unique` ON `managed_storage_objects` (`physicalKey`);--> statement-breakpoint
CREATE INDEX `managed_storage_objects_category_idx` ON `managed_storage_objects` (`accountId`,`category`);--> statement-breakpoint
CREATE TABLE `managed_worker_pools` (
	`id` text PRIMARY KEY NOT NULL,
	`pool` text NOT NULL,
	`region` text NOT NULL,
	`capability` text NOT NULL,
	`providerId` text NOT NULL,
	`status` text DEFAULT 'disabled' NOT NULL,
	`concurrencyLimit` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT 0 NOT NULL,
	`queued` integer DEFAULT 0 NOT NULL,
	`configRevision` text NOT NULL,
	`safeErrorCode` text,
	`observedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `managed_worker_pools_identity_unique` ON `managed_worker_pools` (`pool`,`region`,`capability`);--> statement-breakpoint
CREATE TABLE `placement_migrations` (
	`id` text PRIMARY KEY NOT NULL,
	`accountId` text NOT NULL,
	`resourceKind` text NOT NULL,
	`resourceId` text NOT NULL,
	`sourcePlacementJson` text NOT NULL,
	`destinationPlacementJson` text NOT NULL,
	`state` text DEFAULT 'planned' NOT NULL,
	`sourceDigest` text,
	`destinationDigest` text,
	`copiedBytes` text DEFAULT '0' NOT NULL,
	`idempotencyKey` text NOT NULL,
	`safeErrorCode` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`accountId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `placement_migrations_idempotency_unique` ON `placement_migrations` (`accountId`,`idempotencyKey`);--> statement-breakpoint
CREATE INDEX `placement_migrations_resource_idx` ON `placement_migrations` (`accountId`,`resourceKind`,`resourceId`);--> statement-breakpoint
CREATE TABLE `pricing_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`model` text,
	`capability` text NOT NULL,
	`unit` text NOT NULL,
	`currency` text NOT NULL,
	`rateMinor` text NOT NULL,
	`quantityScale` text NOT NULL,
	`effectiveAt` integer NOT NULL,
	`retiredAt` integer,
	`source` text NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pricing_snapshots_lookup_idx` ON `pricing_snapshots` (`provider`,`model`,`capability`,`effectiveAt`);--> statement-breakpoint
CREATE TABLE `privacy_operation_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`accountId` text NOT NULL,
	`kind` text NOT NULL,
	`scopeKind` text NOT NULL,
	`scopeId` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`manifestDigest` text,
	`exportObjectRefJson` text,
	`requestedAt` integer NOT NULL,
	`completedAt` integer,
	`tombstoneAt` integer,
	`safeErrorCode` text,
	FOREIGN KEY (`accountId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `privacy_operation_requests_account_idx` ON `privacy_operation_requests` (`accountId`,`requestedAt`);--> statement-breakpoint
CREATE TABLE `privacy_operation_targets` (
	`requestId` text NOT NULL,
	`placementKey` text NOT NULL,
	`placementJson` text NOT NULL,
	`state` text NOT NULL,
	`nonce` text NOT NULL,
	`manifestDigest` text NOT NULL,
	`objectClassesJson` text NOT NULL,
	`receiptJson` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lastAttemptAt` integer,
	`safeErrorCode` text,
	`updatedAt` integer NOT NULL,
	PRIMARY KEY(`requestId`, `placementKey`),
	FOREIGN KEY (`requestId`) REFERENCES `privacy_operation_requests`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `privacy_operation_targets_backlog_idx` ON `privacy_operation_targets` (`state`,`updatedAt`);--> statement-breakpoint
CREATE TABLE `security_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`accountId` text,
	`actorId` text NOT NULL,
	`actorKind` text NOT NULL,
	`action` text NOT NULL,
	`resourceKind` text NOT NULL,
	`resourceId` text,
	`justification` text,
	`correlationId` text NOT NULL,
	`policyVersion` text NOT NULL,
	`redactedMetadataJson` text NOT NULL,
	`occurredAt` integer NOT NULL,
	FOREIGN KEY (`accountId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `security_audit_events_account_time_idx` ON `security_audit_events` (`accountId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `security_audit_events_action_idx` ON `security_audit_events` (`action`,`occurredAt`);--> statement-breakpoint
CREATE TABLE `support_elevations` (
	`id` text PRIMARY KEY NOT NULL,
	`accountId` text NOT NULL,
	`operatorId` text NOT NULL,
	`scopeJson` text NOT NULL,
	`justification` text NOT NULL,
	`state` text DEFAULT 'requested' NOT NULL,
	`expiresAt` integer NOT NULL,
	`activatedAt` integer,
	`revokedAt` integer,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`accountId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `support_elevations_active_idx` ON `support_elevations` (`accountId`,`state`,`expiresAt`);--> statement-breakpoint
CREATE TABLE `usage_events` (
	`id` text PRIMARY KEY NOT NULL,
	`accountId` text NOT NULL,
	`userId` text,
	`capability` text NOT NULL,
	`quantity` text NOT NULL,
	`unit` text NOT NULL,
	`direction` text NOT NULL,
	`idempotencyKey` text NOT NULL,
	`reservationId` text,
	`runId` text,
	`jobId` text,
	`provider` text,
	`model` text,
	`placementJson` text NOT NULL,
	`pricingSnapshotId` text,
	`authoritative` integer DEFAULT false NOT NULL,
	`estimatorVersion` text,
	`adjustmentActorId` text,
	`adjustmentReason` text,
	`adjustmentEvidenceRef` text,
	`occurredAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`accountId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`reservationId`) REFERENCES `usage_reservations`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "usage_events_adjustment_metadata_check" CHECK("usage_events"."direction" <> 'adjust' or ("usage_events"."adjustmentActorId" is not null and "usage_events"."adjustmentReason" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `usage_events_idempotency_unique` ON `usage_events` (`accountId`,`idempotencyKey`);--> statement-breakpoint
CREATE INDEX `usage_events_period_idx` ON `usage_events` (`accountId`,`capability`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `usage_events_reservation_idx` ON `usage_events` (`reservationId`);--> statement-breakpoint
CREATE TABLE `usage_period_aggregates` (
	`accountId` text NOT NULL,
	`capability` text NOT NULL,
	`unit` text NOT NULL,
	`periodStartsAt` integer NOT NULL,
	`periodEndsAt` integer NOT NULL,
	`consumedQuantity` text DEFAULT '0' NOT NULL,
	`adjustedQuantity` text DEFAULT '0' NOT NULL,
	`finalEventOccurredAt` integer,
	`updatedAt` integer NOT NULL,
	PRIMARY KEY(`accountId`, `capability`, `periodStartsAt`, `periodEndsAt`),
	FOREIGN KEY (`accountId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `usage_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`accountId` text NOT NULL,
	`userId` text,
	`capability` text NOT NULL,
	`unit` text NOT NULL,
	`reservedQuantity` text NOT NULL,
	`consumedQuantity` text DEFAULT '0' NOT NULL,
	`releasedQuantity` text DEFAULT '0' NOT NULL,
	`status` text DEFAULT 'reserved' NOT NULL,
	`idempotencyKey` text NOT NULL,
	`decisionId` text NOT NULL,
	`entitlementSnapshotId` text NOT NULL,
	`placementJson` text NOT NULL,
	`runId` text,
	`jobId` text,
	`provider` text,
	`model` text,
	`pricingSnapshotId` text,
	`expiresAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`settledAt` integer,
	FOREIGN KEY (`accountId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`decisionId`) REFERENCES `entitlement_decisions`(`id`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `usage_reservations_idempotency_unique` ON `usage_reservations` (`accountId`,`capability`,`idempotencyKey`);--> statement-breakpoint
CREATE INDEX `usage_reservations_active_idx` ON `usage_reservations` (`accountId`,`capability`,`status`,`expiresAt`);--> statement-breakpoint
CREATE INDEX `usage_reservations_run_idx` ON `usage_reservations` (`accountId`,`runId`);--> statement-breakpoint
ALTER TABLE `user_service_keys` ADD `provider` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_service_keys` ADD `keyVersion` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `user_service_keys` ADD `scopesJson` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_service_keys` ADD `lastValidatedAt` integer;--> statement-breakpoint
ALTER TABLE `user_service_keys` ADD `revokedAt` integer;