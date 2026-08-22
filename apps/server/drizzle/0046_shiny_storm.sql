ALTER TABLE `material_documents` ADD `deletedBatchId` text;--> statement-breakpoint
ALTER TABLE `material_folders` ADD `deletedBatchId` text;--> statement-breakpoint
ALTER TABLE `study_documents` ADD `deletedBatchId` text;--> statement-breakpoint
ALTER TABLE `lecture_recordings` ADD `deletedBatchId` text;