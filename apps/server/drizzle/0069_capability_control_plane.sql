CREATE TABLE `capability_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`operationId` text NOT NULL,
	`ordinal` integer NOT NULL,
	`offeringId` text NOT NULL,
	`requestDigest` text NOT NULL,
	`state` text DEFAULT 'reserved' NOT NULL,
	`providerRequestId` text,
	`credentialVersion` integer,
	`consentRevision` integer,
	`errorClass` text,
	`retryable` integer DEFAULT false NOT NULL,
	`ambiguous` integer DEFAULT false NOT NULL,
	`safeDiagnosticJson` text,
	`startedAt` integer NOT NULL,
	`providerDispatchedAt` integer,
	`acknowledgedAt` integer,
	`completedAt` integer,
	FOREIGN KEY (`operationId`) REFERENCES `capability_operations`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`offeringId`) REFERENCES `capability_offerings`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "capability_attempts_request_digest_check" CHECK(length("capability_attempts"."requestDigest") = 71 and substr("capability_attempts"."requestDigest", 1, 7) = 'sha256:' and substr("capability_attempts"."requestDigest", 8) not glob '*[^0-9a-f]*'),
	CONSTRAINT "capability_attempts_ordinal_check" CHECK("capability_attempts"."ordinal" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `capability_attempts_operation_ordinal_unique` ON `capability_attempts` (`operationId`,`ordinal`);--> statement-breakpoint
CREATE INDEX `capability_attempts_offering_state_idx` ON `capability_attempts` (`offeringId`,`state`,`startedAt`);--> statement-breakpoint
CREATE TABLE `capability_connection_secrets` (
	`id` text PRIMARY KEY NOT NULL,
	`connectionId` text NOT NULL,
	`slot` text NOT NULL,
	`custody` text NOT NULL,
	`sealedValue` text,
	`nodeSecretRef` text,
	`hint` text DEFAULT '' NOT NULL,
	`keyVersion` integer DEFAULT 1 NOT NULL,
	`scopesJson` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`lastValidatedAt` integer,
	`revokedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`connectionId`) REFERENCES `capability_provider_connections`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "capability_connection_secrets_custody_check" CHECK((
        ("capability_connection_secrets"."custody" = 'core-encrypted' and "capability_connection_secrets"."sealedValue" is not null and "capability_connection_secrets"."nodeSecretRef" is null)
        or ("capability_connection_secrets"."custody" = 'operator-env' and "capability_connection_secrets"."sealedValue" is null and "capability_connection_secrets"."nodeSecretRef" is null)
        or ("capability_connection_secrets"."custody" = 'node-local' and "capability_connection_secrets"."sealedValue" is null and "capability_connection_secrets"."nodeSecretRef" is not null)
      )),
	CONSTRAINT "capability_connection_secrets_version_check" CHECK("capability_connection_secrets"."keyVersion" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `capability_connection_secrets_slot_unique` ON `capability_connection_secrets` (`connectionId`,`slot`);--> statement-breakpoint
CREATE INDEX `capability_connection_secrets_status_idx` ON `capability_connection_secrets` (`connectionId`,`status`);--> statement-breakpoint
CREATE TABLE `capability_consents` (
	`id` text PRIMARY KEY NOT NULL,
	`ownerId` text NOT NULL,
	`connectionId` text NOT NULL,
	`capabilityKind` text NOT NULL,
	`disclosureRevision` text NOT NULL,
	`status` text DEFAULT 'granted' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`grantedAt` integer NOT NULL,
	`revokedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`connectionId`) REFERENCES `capability_provider_connections`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "capability_consents_revision_check" CHECK("capability_consents"."revision" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `capability_consents_identity_unique` ON `capability_consents` (`ownerId`,`connectionId`,`capabilityKind`,`disclosureRevision`);--> statement-breakpoint
CREATE INDEX `capability_consents_owner_status_idx` ON `capability_consents` (`ownerId`,`status`);--> statement-breakpoint
CREATE TABLE `capability_offering_health` (
	`offeringId` text PRIMARY KEY NOT NULL,
	`state` text DEFAULT 'unknown' NOT NULL,
	`lastSuccessAt` integer,
	`lastFailureAt` integer,
	`consecutiveFailures` integer DEFAULT 0 NOT NULL,
	`latencyP50Ms` integer,
	`latencyP95Ms` integer,
	`safeErrorCode` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`expiresAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`offeringId`) REFERENCES `capability_offerings`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "capability_offering_health_failures_check" CHECK("capability_offering_health"."consecutiveFailures" >= 0),
	CONSTRAINT "capability_offering_health_revision_check" CHECK("capability_offering_health"."revision" >= 1)
);
--> statement-breakpoint
CREATE INDEX `capability_offering_health_state_expiry_idx` ON `capability_offering_health` (`state`,`expiresAt`);--> statement-breakpoint
CREATE TABLE `capability_offerings` (
	`id` text PRIMARY KEY NOT NULL,
	`connectionId` text NOT NULL,
	`capabilityKind` text NOT NULL,
	`descriptorVersion` integer DEFAULT 1 NOT NULL,
	`descriptorJson` text NOT NULL,
	`descriptorDigest` text NOT NULL,
	`provider` text NOT NULL,
	`modelId` text NOT NULL,
	`modelRevision` text NOT NULL,
	`adapterRevision` text NOT NULL,
	`compatibilityKey` text,
	`status` text DEFAULT 'discovered' NOT NULL,
	`discoveredAt` integer NOT NULL,
	`expiresAt` integer,
	`lastHealthyAt` integer,
	`retiredAt` integer,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`connectionId`) REFERENCES `capability_provider_connections`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "capability_offerings_descriptor_version_check" CHECK("capability_offerings"."descriptorVersion" = 1),
	CONSTRAINT "capability_offerings_descriptor_digest_check" CHECK(length("capability_offerings"."descriptorDigest") = 71 and substr("capability_offerings"."descriptorDigest", 1, 7) = 'sha256:' and substr("capability_offerings"."descriptorDigest", 8) not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `capability_offerings_descriptor_digest_unique` ON `capability_offerings` (`connectionId`,`descriptorDigest`);--> statement-breakpoint
CREATE INDEX `capability_offerings_connection_status_idx` ON `capability_offerings` (`connectionId`,`status`);--> statement-breakpoint
CREATE INDEX `capability_offerings_kind_status_idx` ON `capability_offerings` (`capabilityKind`,`status`);--> statement-breakpoint
CREATE TABLE `capability_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`ownerId` text NOT NULL,
	`capabilityKind` text NOT NULL,
	`purpose` text NOT NULL,
	`inputDigest` text NOT NULL,
	`idempotencyKey` text NOT NULL,
	`policySnapshotJson` text NOT NULL,
	`policySnapshotDigest` text NOT NULL,
	`routePlanJson` text,
	`routePlanDigest` text,
	`state` text DEFAULT 'reserved' NOT NULL,
	`resultRefJson` text,
	`resultDigest` text,
	`safeErrorCode` text,
	`retryable` integer DEFAULT false NOT NULL,
	`ambiguous` integer DEFAULT false NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`completedAt` integer,
	CONSTRAINT "capability_operations_input_digest_check" CHECK(length("capability_operations"."inputDigest") = 71 and substr("capability_operations"."inputDigest", 1, 7) = 'sha256:' and substr("capability_operations"."inputDigest", 8) not glob '*[^0-9a-f]*'),
	CONSTRAINT "capability_operations_policy_digest_check" CHECK(length("capability_operations"."policySnapshotDigest") = 71 and substr("capability_operations"."policySnapshotDigest", 1, 7) = 'sha256:' and substr("capability_operations"."policySnapshotDigest", 8) not glob '*[^0-9a-f]*'),
	CONSTRAINT "capability_operations_revision_check" CHECK("capability_operations"."revision" >= 1),
	CONSTRAINT "capability_operations_route_pair_check" CHECK(("capability_operations"."routePlanJson" is null) = ("capability_operations"."routePlanDigest" is null)),
	CONSTRAINT "capability_operations_result_pair_check" CHECK(("capability_operations"."resultRefJson" is null) = ("capability_operations"."resultDigest" is null)),
	CONSTRAINT "capability_operations_route_digest_check" CHECK("capability_operations"."routePlanDigest" is null or (length("capability_operations"."routePlanDigest") = 71 and substr("capability_operations"."routePlanDigest", 1, 7) = 'sha256:' and substr("capability_operations"."routePlanDigest", 8) not glob '*[^0-9a-f]*')),
	CONSTRAINT "capability_operations_result_digest_check" CHECK("capability_operations"."resultDigest" is null or (length("capability_operations"."resultDigest") = 71 and substr("capability_operations"."resultDigest", 1, 7) = 'sha256:' and substr("capability_operations"."resultDigest", 8) not glob '*[^0-9a-f]*'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `capability_operations_owner_idempotency_unique` ON `capability_operations` (`ownerId`,`capabilityKind`,`idempotencyKey`);--> statement-breakpoint
CREATE INDEX `capability_operations_owner_state_idx` ON `capability_operations` (`ownerId`,`state`,`createdAt`);--> statement-breakpoint
CREATE TABLE `capability_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`ownerId` text NOT NULL,
	`scopeKind` text NOT NULL,
	`scopeId` text NOT NULL,
	`capabilityKind` text NOT NULL,
	`purposePattern` text NOT NULL,
	`mode` text NOT NULL,
	`primaryOfferingId` text,
	`fallbackOfferingIdsJson` text NOT NULL,
	`constraintsJson` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`deletedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`primaryOfferingId`) REFERENCES `capability_offerings`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "capability_policies_revision_check" CHECK("capability_policies"."revision" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `capability_policies_active_scope_unique` ON `capability_policies` (`ownerId`,`scopeKind`,`scopeId`,`capabilityKind`,`purposePattern`) WHERE "capability_policies"."deletedAt" is null;--> statement-breakpoint
CREATE INDEX `capability_policies_owner_kind_idx` ON `capability_policies` (`ownerId`,`capabilityKind`,`deletedAt`);--> statement-breakpoint
CREATE TABLE `capability_provider_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`ownerKind` text NOT NULL,
	`ownerId` text NOT NULL,
	`pluginId` text NOT NULL,
	`pluginVersion` text NOT NULL,
	`displayName` text NOT NULL,
	`placementKind` text NOT NULL,
	`placementRef` text NOT NULL,
	`placementJson` text NOT NULL,
	`configVersion` integer NOT NULL,
	`configJson` text NOT NULL,
	`configDigest` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`lastValidatedAt` integer,
	`deletedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	CONSTRAINT "capability_connections_revision_check" CHECK("capability_provider_connections"."revision" >= 1),
	CONSTRAINT "capability_connections_config_version_check" CHECK("capability_provider_connections"."configVersion" >= 1),
	CONSTRAINT "capability_connections_config_digest_check" CHECK(length("capability_provider_connections"."configDigest") = 71 and substr("capability_provider_connections"."configDigest", 1, 7) = 'sha256:' and substr("capability_provider_connections"."configDigest", 8) not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE INDEX `capability_connections_owner_status_idx` ON `capability_provider_connections` (`ownerKind`,`ownerId`,`status`);--> statement-breakpoint
CREATE INDEX `capability_connections_plugin_idx` ON `capability_provider_connections` (`pluginId`,`pluginVersion`);--> statement-breakpoint
CREATE TABLE `capability_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`operationId` text NOT NULL,
	`attemptId` text NOT NULL,
	`usageDigest` text NOT NULL,
	`usageJson` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`operationId`) REFERENCES `capability_operations`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`attemptId`) REFERENCES `capability_attempts`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "capability_usage_digest_check" CHECK(length("capability_usage"."usageDigest") = 71 and substr("capability_usage"."usageDigest", 1, 7) = 'sha256:' and substr("capability_usage"."usageDigest", 8) not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE INDEX `capability_usage_operation_idx` ON `capability_usage` (`operationId`,`createdAt`);--> statement-breakpoint
CREATE UNIQUE INDEX `capability_usage_attempt_unique` ON `capability_usage` (`attemptId`);--> statement-breakpoint
CREATE UNIQUE INDEX `capability_usage_operation_attempt_unique` ON `capability_usage` (`operationId`,`attemptId`);
