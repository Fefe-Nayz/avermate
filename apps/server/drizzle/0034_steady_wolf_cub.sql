CREATE TABLE `study_document_exports` (
	`documentId` text NOT NULL,
	`revision` integer NOT NULL,
	`fileId` text NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	PRIMARY KEY(`documentId`, `revision`),
	FOREIGN KEY (`documentId`) REFERENCES `study_documents`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`fileId`) REFERENCES `files`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `study_document_exports_user_idx` ON `study_document_exports` (`userId`);--> statement-breakpoint
CREATE INDEX `study_document_exports_file_idx` ON `study_document_exports` (`fileId`);--> statement-breakpoint
CREATE TABLE `lecture_recordings` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'recording' NOT NULL,
	`recordedAt` integer NOT NULL,
	`durationMs` integer DEFAULT 0 NOT NULL,
	`error` text,
	`subjectId` text,
	`folderId` text,
	`yearId` text NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`subjectId`) REFERENCES `subjects`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`folderId`) REFERENCES `material_folders`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`yearId`) REFERENCES `years`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "lecture_recordings_status_check" CHECK("lecture_recordings"."status" in ('recording', 'uploaded', 'transcribing', 'ready', 'failed')),
	CONSTRAINT "lecture_recordings_duration_check" CHECK("lecture_recordings"."durationMs" >= 0 and "lecture_recordings"."durationMs" <= 14400000)
);
--> statement-breakpoint
CREATE INDEX `lecture_recordings_year_idx` ON `lecture_recordings` (`yearId`,`recordedAt`);--> statement-breakpoint
CREATE INDEX `lecture_recordings_user_idx` ON `lecture_recordings` (`userId`);--> statement-breakpoint
CREATE TABLE `recording_segments` (
	`id` text PRIMARY KEY NOT NULL,
	`recordingId` text NOT NULL,
	`seq` integer NOT NULL,
	`fileId` text NOT NULL,
	`startOffsetMs` integer NOT NULL,
	`durationMs` integer NOT NULL,
	`transcriptStatus` text DEFAULT 'pending' NOT NULL,
	`transcriptError` text,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`recordingId`) REFERENCES `lecture_recordings`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`fileId`) REFERENCES `files`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "recording_segments_seq_check" CHECK("recording_segments"."seq" >= 0 and "recording_segments"."seq" < 24),
	CONSTRAINT "recording_segments_offset_check" CHECK("recording_segments"."startOffsetMs" >= 0),
	CONSTRAINT "recording_segments_duration_check" CHECK("recording_segments"."durationMs" > 0 and "recording_segments"."durationMs" <= 900000 and "recording_segments"."startOffsetMs" + "recording_segments"."durationMs" <= 14400000),
	CONSTRAINT "recording_segments_status_check" CHECK("recording_segments"."transcriptStatus" in ('pending', 'ready', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recording_segments_recording_seq_unique` ON `recording_segments` (`recordingId`,`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `recording_segments_file_unique` ON `recording_segments` (`fileId`);--> statement-breakpoint
CREATE INDEX `recording_segments_user_idx` ON `recording_segments` (`userId`);--> statement-breakpoint
CREATE TABLE `recording_transcripts` (
	`recordingId` text PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	`segmentsVersion` integer DEFAULT 1 NOT NULL,
	`segmentsJson` text NOT NULL,
	`language` text,
	`provider` text NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`recordingId`) REFERENCES `lecture_recordings`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "recording_transcripts_version_check" CHECK("recording_transcripts"."segmentsVersion" = 1)
);
--> statement-breakpoint
CREATE INDEX `recording_transcripts_user_idx` ON `recording_transcripts` (`userId`);--> statement-breakpoint
ALTER TABLE `material_artifacts` ADD `runId` text;