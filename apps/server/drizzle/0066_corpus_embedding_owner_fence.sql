CREATE TABLE `corpus_embedding_owner_states` (
	`userId` text PRIMARY KEY NOT NULL,
	`publicationEpoch` integer DEFAULT 0 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "corpus_embedding_owner_states_epoch_check" CHECK("corpus_embedding_owner_states"."publicationEpoch" >= 0)
);
