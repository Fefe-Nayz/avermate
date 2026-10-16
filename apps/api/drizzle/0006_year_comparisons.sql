CREATE TABLE `year_comparisons` (
	`user_id` text NOT NULL,
	`year_id` text NOT NULL,
	`reference_year_id` text NOT NULL,
	`subject_map` text DEFAULT '{}' NOT NULL,
	`period_map` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `year_id`, `reference_year_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`year_id`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`reference_year_id`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `year_comparisons_year_id_idx` ON `year_comparisons` (`year_id`);--> statement-breakpoint
CREATE INDEX `year_comparisons_reference_year_id_idx` ON `year_comparisons` (`reference_year_id`);