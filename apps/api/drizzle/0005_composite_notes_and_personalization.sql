ALTER TABLE `grades` ADD `is_composite` integer DEFAULT false NOT NULL;
ALTER TABLE `user_settings` ADD `custom_theme` text DEFAULT '{}' NOT NULL;

CREATE TABLE `grade_components` (
  `id` text PRIMARY KEY NOT NULL,
  `grade_id` text NOT NULL,
  `name` text NOT NULL,
  `value` integer NOT NULL,
  `out_of` integer NOT NULL,
  `coefficient` integer NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `user_id` text NOT NULL,
  `year_id` text NOT NULL,
  FOREIGN KEY (`grade_id`) REFERENCES `grades`(`id`) ON UPDATE cascade ON DELETE cascade,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
  FOREIGN KEY (`year_id`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE cascade
);
CREATE INDEX `grade_components_grade_id_idx` ON `grade_components` (`grade_id`);
CREATE INDEX `grade_components_user_id_idx` ON `grade_components` (`user_id`);
CREATE INDEX `grade_components_year_id_idx` ON `grade_components` (`year_id`);

CREATE TABLE `year_review_views` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `year_id` text NOT NULL,
  `review_key` text NOT NULL,
  `clicked_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
  FOREIGN KEY (`year_id`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE cascade
);
CREATE UNIQUE INDEX `year_review_views_user_year_key_idx` ON `year_review_views` (`user_id`, `year_id`, `review_key`);
CREATE INDEX `year_review_views_user_id_idx` ON `year_review_views` (`user_id`);
CREATE INDEX `year_review_views_year_id_idx` ON `year_review_views` (`year_id`);

CREATE TABLE `announcements` (
  `id` text PRIMARY KEY NOT NULL,
  `title` text NOT NULL,
  `message` text NOT NULL,
  `tone` text DEFAULT 'info' NOT NULL,
  `active` integer DEFAULT true NOT NULL,
  `starts_at` integer,
  `ends_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `created_by_user_id` text NOT NULL,
  FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
CREATE INDEX `announcements_active_idx` ON `announcements` (`active`);
CREATE INDEX `announcements_created_by_user_id_idx` ON `announcements` (`created_by_user_id`);

CREATE TABLE `announcement_views` (
  `id` text PRIMARY KEY NOT NULL,
  `announcement_id` text NOT NULL,
  `user_id` text NOT NULL,
  `viewed_at` integer NOT NULL,
  FOREIGN KEY (`announcement_id`) REFERENCES `announcements`(`id`) ON UPDATE cascade ON DELETE cascade,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
CREATE UNIQUE INDEX `announcement_views_announcement_user_idx` ON `announcement_views` (`announcement_id`, `user_id`);
CREATE INDEX `announcement_views_user_id_idx` ON `announcement_views` (`user_id`);
CREATE INDEX `announcement_views_announcement_id_idx` ON `announcement_views` (`announcement_id`);

CREATE TABLE `card_layouts` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `page` text NOT NULL,
  `cards` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
CREATE UNIQUE INDEX `card_layouts_user_page_idx` ON `card_layouts` (`user_id`, `page`);
CREATE INDEX `card_layouts_user_id_idx` ON `card_layouts` (`user_id`);
