ALTER TABLE `social_groups` ADD `classDeclarationVersion` text;--> statement-breakpoint
ALTER TABLE `social_groups` ADD `classDeclaredAt` integer;--> statement-breakpoint
ALTER TABLE `social_groups` ADD `classDeclaredByUserId` text REFERENCES users(id);