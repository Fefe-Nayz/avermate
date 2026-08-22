DROP INDEX IF EXISTS `material_documents_file_unique`;--> statement-breakpoint
ALTER TABLE `material_documents` ADD `adoptionKey` text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `material_documents_file_idx` ON `material_documents` (`fileId`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_documents_adoption_key_unique` ON `material_documents` (`adoptionKey`);
