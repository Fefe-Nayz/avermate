CREATE TABLE `planner_items` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text DEFAULT 'task' NOT NULL,
	`title` text NOT NULL,
	`notes` text,
	`startsAt` integer,
	`endsAt` integer,
	`allDay` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'todo' NOT NULL,
	`completedAt` integer,
	`subjectId` text,
	`sortOrder` integer DEFAULT 0 NOT NULL,
	`yearId` text NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`subjectId`) REFERENCES `subjects`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`yearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `planner_items_year_starts_idx` ON `planner_items` (`yearId`,`startsAt`);--> statement-breakpoint
CREATE INDEX `planner_items_user_id_idx` ON `planner_items` (`userId`);