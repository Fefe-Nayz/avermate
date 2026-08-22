PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_assistant_tool_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`name` text NOT NULL,
	`endpointUrl` text NOT NULL,
	`endpointOrigin` text NOT NULL,
	`placement` text NOT NULL,
	`placementRef` text,
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
	CONSTRAINT "assistant_tool_sources_placement_check" CHECK(("__new_assistant_tool_sources"."placement" = 'hosted-core' and "__new_assistant_tool_sources"."placementRef" is null) or ("__new_assistant_tool_sources"."placement" = 'node' and "__new_assistant_tool_sources"."placementRef" is not null)),
	CONSTRAINT "assistant_tool_sources_auth_check" CHECK("__new_assistant_tool_sources"."authKind" in ('none', 'bearer', 'api-key')),
	CONSTRAINT "assistant_tool_sources_credential_check" CHECK(("__new_assistant_tool_sources"."authKind" = 'none' and "__new_assistant_tool_sources"."sealedCredential" is null and "__new_assistant_tool_sources"."credentialHint" is null) or ("__new_assistant_tool_sources"."authKind" <> 'none' and "__new_assistant_tool_sources"."sealedCredential" is not null)),
	CONSTRAINT "assistant_tool_sources_status_check" CHECK("__new_assistant_tool_sources"."status" in ('review-required', 'enabled', 'disabled', 'unavailable')),
	CONSTRAINT "assistant_tool_sources_digest_check" CHECK(length("__new_assistant_tool_sources"."catalogDigest") = 64),
	CONSTRAINT "assistant_tool_sources_revision_check" CHECK("__new_assistant_tool_sources"."catalogRevision" >= 1)
);
--> statement-breakpoint
INSERT INTO `__new_assistant_tool_sources`("id", "userId", "name", "endpointUrl", "endpointOrigin", "placement", "placementRef", "authKind", "sealedCredential", "credentialHint", "status", "catalogJson", "catalogDigest", "catalogRevision", "lastCheckedAt", "lastError", "createdAt", "updatedAt")
SELECT "id", "userId", "name", "endpointUrl", "endpointOrigin", "placement",
	CASE WHEN "placement" = 'node' THEN 'legacy-unbound:' || "id" ELSE NULL END,
	"authKind", "sealedCredential", "credentialHint",
	CASE WHEN "placement" = 'node' THEN 'unavailable' ELSE "status" END,
	"catalogJson", "catalogDigest", "catalogRevision", "lastCheckedAt",
	CASE WHEN "placement" = 'node' THEN 'NODE_MCP_BINDING_MIGRATION_REQUIRED' ELSE "lastError" END,
	"createdAt", "updatedAt"
FROM `assistant_tool_sources`;--> statement-breakpoint
DROP TABLE `assistant_tool_sources`;--> statement-breakpoint
ALTER TABLE `__new_assistant_tool_sources` RENAME TO `assistant_tool_sources`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_tool_sources_user_url_unique` ON `assistant_tool_sources` (`userId`,`endpointUrl`);--> statement-breakpoint
CREATE INDEX `assistant_tool_sources_user_status_idx` ON `assistant_tool_sources` (`userId`,`status`);
