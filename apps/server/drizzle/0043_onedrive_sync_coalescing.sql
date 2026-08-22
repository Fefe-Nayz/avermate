ALTER TABLE `content_connections` ADD `syncRequestedGeneration` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `content_connections` ADD `syncActiveJobId` text;