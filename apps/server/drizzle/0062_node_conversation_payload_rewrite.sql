DROP TRIGGER IF EXISTS assistant_runs_links_insert;--> statement-breakpoint
CREATE TRIGGER assistant_runs_links_insert
BEFORE INSERT ON assistant_runs
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM assistant_threads t
    WHERE t.id = NEW.threadId AND t.userId = NEW.userId
  ) THEN RAISE(ABORT, 'assistant run thread is not owned') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM assistant_branches b
    WHERE b.id = NEW.branchId AND b.threadId = NEW.threadId
  ) THEN RAISE(ABORT, 'assistant run branch must belong to thread') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM assistant_messages m
    WHERE m.id = NEW.inputMessageId AND m.threadId = NEW.threadId
  ) THEN RAISE(ABORT, 'assistant run input must belong to thread') END;
  SELECT CASE WHEN NEW.parentRunId IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM assistant_runs r
    WHERE r.id = NEW.parentRunId AND r.threadId = NEW.threadId
  ) THEN RAISE(ABORT, 'assistant parent run must belong to thread') END;
END;--> statement-breakpoint
DROP TRIGGER IF EXISTS assistant_messages_immutable_update;--> statement-breakpoint
CREATE TRIGGER assistant_messages_immutable_update
BEFORE UPDATE ON assistant_messages
BEGIN
  SELECT CASE WHEN
    NEW.id IS NOT OLD.id
    OR NEW.threadId IS NOT OLD.threadId
    OR NEW.parentMessageId IS NOT OLD.parentMessageId
    OR NEW.role IS NOT OLD.role
    OR NEW.authorship IS NOT OLD.authorship
    OR NEW.status IS NOT OLD.status
    OR NEW.partsVersion IS NOT OLD.partsVersion
    OR NEW.createdByRunId IS NOT OLD.createdByRunId
    OR NEW.replacesMessageId IS NOT OLD.replacesMessageId
    OR NEW.createdAt IS NOT OLD.createdAt
    OR NOT EXISTS (
      SELECT 1
      FROM assistant_threads AS thread
      JOIN placement_migrations AS migration
        ON migration.accountId = thread.userId
      WHERE thread.id = OLD.threadId
        AND migration.resourceKind = 'conversations'
        AND migration.state = 'copying'
        AND json_extract(migration.sourcePlacementJson, '$.kind') = thread.placement
        AND (
          thread.placement != 'node'
          OR json_extract(migration.sourcePlacementJson, '$.nodeId') = thread.placementRef
        )
    )
    THEN RAISE(ABORT, 'assistant messages are immutable') END;
END;--> statement-breakpoint
DROP TRIGGER IF EXISTS assistant_run_events_immutable_update;--> statement-breakpoint
CREATE TRIGGER assistant_run_events_immutable_update
BEFORE UPDATE ON assistant_run_events
BEGIN
  SELECT CASE WHEN
    NEW.id IS NOT OLD.id
    OR NEW.runId IS NOT OLD.runId
    OR NEW.sequence IS NOT OLD.sequence
    OR NEW.eventId IS NOT OLD.eventId
    OR NEW.type IS NOT OLD.type
    OR NEW.terminal IS NOT OLD.terminal
    OR NEW.emittedAt IS NOT OLD.emittedAt
    OR NEW.persistedAt IS NOT OLD.persistedAt
    OR NOT EXISTS (
      SELECT 1
      FROM assistant_runs AS run
      JOIN assistant_threads AS thread ON thread.id = run.threadId
      JOIN placement_migrations AS migration
        ON migration.accountId = thread.userId
      WHERE run.id = OLD.runId
        AND migration.resourceKind = 'conversations'
        AND migration.state = 'copying'
        AND json_extract(migration.sourcePlacementJson, '$.kind') = thread.placement
        AND (
          thread.placement != 'node'
          OR json_extract(migration.sourcePlacementJson, '$.nodeId') = thread.placementRef
        )
    )
    THEN RAISE(ABORT, 'assistant run events are append-only') END;
END;
