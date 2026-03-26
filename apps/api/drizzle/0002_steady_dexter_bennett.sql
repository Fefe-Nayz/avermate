CREATE TABLE `user_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`theme` text DEFAULT 'system' NOT NULL,
	`language` text DEFAULT 'system' NOT NULL,
	`chart_settings` text DEFAULT '{"autoZoomYAxis":true,"showTrendLine":false,"trendLineSubdivisions":1}' NOT NULL,
	`seasonal_themes_enabled` integer DEFAULT true NOT NULL,
	`seasonal_theme` text DEFAULT 'none' NOT NULL,
	`haptics_enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
