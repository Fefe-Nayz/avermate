ALTER TABLE `assistant_attachments` ADD `frozenPayloadVersion` integer;--> statement-breakpoint
ALTER TABLE `assistant_attachments` ADD `frozenPayloadJson` text;--> statement-breakpoint
ALTER TABLE `assistant_attachments` ADD `frozenPayloadDigest` text;--> statement-breakpoint
ALTER TABLE `assistant_attachments` ADD `frozenSourceRevision` integer;