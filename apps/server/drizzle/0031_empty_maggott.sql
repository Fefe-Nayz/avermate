CREATE TABLE `material_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`documentId` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`content` text,
	`metaVersion` integer DEFAULT 1 NOT NULL,
	`metaJson` text,
	`error` text,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`documentId`) REFERENCES `material_documents`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `material_artifacts_doc_kind_unique` ON `material_artifacts` (`documentId`,`kind`);--> statement-breakpoint
CREATE INDEX `material_artifacts_user_idx` ON `material_artifacts` (`userId`);