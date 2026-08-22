ALTER TABLE `material_documents` ADD `deletedBy` text;--> statement-breakpoint
ALTER TABLE `material_folders` ADD `deletedBy` text;--> statement-breakpoint
ALTER TABLE `content_connections` ADD `syncRevision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `study_documents` ADD `deletedBy` text;--> statement-breakpoint
ALTER TABLE `lecture_recordings` ADD `deletedBy` text;