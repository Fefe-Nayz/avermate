PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_lecture_recordings` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'recording' NOT NULL,
	`recordedAt` integer NOT NULL,
	`durationMs` integer DEFAULT 0 NOT NULL,
	`error` text,
	`transcriptionRunId` text,
	`subjectId` text,
	`folderId` text,
	`calendarEventId` text,
	`timetableOccurrenceId` text,
	`yearId` text NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`subjectId`) REFERENCES `subjects`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`folderId`) REFERENCES `material_folders`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`calendarEventId`) REFERENCES `calendar_events`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`timetableOccurrenceId`) REFERENCES `timetable_occurrences`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`yearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "lecture_recordings_status_check" CHECK("__new_lecture_recordings"."status" in ('recording', 'uploaded', 'transcribing', 'ready', 'failed', 'deleting')),
	CONSTRAINT "lecture_recordings_duration_check" CHECK("__new_lecture_recordings"."durationMs" >= 0 and "__new_lecture_recordings"."durationMs" <= 14400000),
	CONSTRAINT "lecture_recordings_planning_target_check" CHECK("__new_lecture_recordings"."calendarEventId" is null or "__new_lecture_recordings"."timetableOccurrenceId" is null)
);
--> statement-breakpoint
INSERT INTO `__new_lecture_recordings`("id", "title", "status", "recordedAt", "durationMs", "error", "transcriptionRunId", "subjectId", "folderId", "yearId", "userId", "createdAt", "updatedAt") SELECT "id", "title", "status", "recordedAt", "durationMs", "error", "transcriptionRunId", "subjectId", "folderId", "yearId", "userId", "createdAt", "updatedAt" FROM `lecture_recordings`;--> statement-breakpoint
DROP TABLE `lecture_recordings`;--> statement-breakpoint
ALTER TABLE `__new_lecture_recordings` RENAME TO `lecture_recordings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `lecture_recordings_year_idx` ON `lecture_recordings` (`yearId`,`recordedAt`);--> statement-breakpoint
CREATE INDEX `lecture_recordings_user_idx` ON `lecture_recordings` (`userId`);--> statement-breakpoint
CREATE INDEX `lecture_recordings_calendar_event_idx` ON `lecture_recordings` (`calendarEventId`);--> statement-breakpoint
CREATE INDEX `lecture_recordings_timetable_occurrence_idx` ON `lecture_recordings` (`timetableOccurrenceId`);
