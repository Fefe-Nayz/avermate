ALTER TABLE `social_groups` ADD `kind` text DEFAULT 'friends' NOT NULL;--> statement-breakpoint
ALTER TABLE `social_groups` ADD `comparedSubjectName` text;--> statement-breakpoint
ALTER TABLE `social_groups` ADD `showTrend` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `social_groups` ADD `showGradeCount` integer DEFAULT true NOT NULL;