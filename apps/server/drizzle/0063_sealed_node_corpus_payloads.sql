CREATE TABLE `corpus_payload_rewrite_leases` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`sourceId` text NOT NULL,
	`sourcePlacement` text NOT NULL,
	`sourceNodeId` text,
	`destinationPlacement` text NOT NULL,
	`destinationNodeId` text,
	`expiresAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`sourceId`) REFERENCES `content_sources`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "corpus_payload_rewrite_source_check" CHECK(("corpus_payload_rewrite_leases"."sourcePlacement" = 'core' and "corpus_payload_rewrite_leases"."sourceNodeId" is null)
        or ("corpus_payload_rewrite_leases"."sourcePlacement" = 'node' and "corpus_payload_rewrite_leases"."sourceNodeId" is not null)),
	CONSTRAINT "corpus_payload_rewrite_destination_check" CHECK(("corpus_payload_rewrite_leases"."destinationPlacement" = 'core' and "corpus_payload_rewrite_leases"."destinationNodeId" is null)
        or ("corpus_payload_rewrite_leases"."destinationPlacement" = 'node' and "corpus_payload_rewrite_leases"."destinationNodeId" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `corpus_payload_rewrite_source_unique` ON `corpus_payload_rewrite_leases` (`sourceId`);--> statement-breakpoint
CREATE INDEX `corpus_payload_rewrite_expiry_idx` ON `corpus_payload_rewrite_leases` (`expiresAt`);--> statement-breakpoint
DROP TRIGGER IF EXISTS content_chunks_immutable_update;--> statement-breakpoint
CREATE TRIGGER content_chunks_immutable_update
BEFORE UPDATE ON content_chunks
BEGIN
	SELECT CASE WHEN
		NEW.id IS NOT OLD.id
		OR NEW.versionId IS NOT OLD.versionId
		OR NEW.ordinal IS NOT OLD.ordinal
		OR NEW.tokenEstimate IS NOT OLD.tokenEstimate
		OR NEW.contentHash IS NOT OLD.contentHash
		OR NEW.locatorJson IS NOT OLD.locatorJson
		OR NEW.evidenceKind IS NOT OLD.evidenceKind
		OR NEW.createdAt IS NOT OLD.createdAt
		OR NOT EXISTS (
			SELECT 1
			FROM content_versions AS versions
			JOIN content_sources AS sources ON sources.id = versions.sourceId
			JOIN corpus_payload_rewrite_leases AS lease
				ON lease.sourceId = sources.id AND lease.userId = sources.userId
			WHERE versions.id = OLD.versionId
				AND lease.expiresAt >= unixepoch()
				AND lease.sourcePlacement = sources.placement
				AND (
					sources.placement != 'node'
					OR lease.sourceNodeId = sources.placementRef
				)
		)
		THEN RAISE(ABORT, 'content chunks are immutable') END;
END;
