ALTER TABLE `feedback` ADD `duplicateGroupKey` text;--> statement-breakpoint
CREATE INDEX `feedback_duplicate_group_idx` ON `feedback` (`duplicateGroupKey`,`lastSeenAt`);--> statement-breakpoint
ALTER TABLE `social_feature_flags` ADD `revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `social_reports` ADD `revision` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
INSERT OR IGNORE INTO `social_feature_flags`
  (`key`, `enabled`, `revision`, `createdAt`, `updatedAt`)
VALUES
  ('social-v1', 0, 1, unixepoch(), unixepoch());
--> statement-breakpoint
CREATE TRIGGER `social_invalidate_grades_insert`
AFTER INSERT ON `grades`
BEGIN
  UPDATE `social_groups`
  SET `revision` = `revision` + 1, `updatedAt` = unixepoch()
  WHERE `id` IN (
    SELECT `groupId` FROM `group_memberships`
    WHERE `sharedYearId` = NEW.`yearId` AND `state` = 'active'
  );
  DELETE FROM `social_aggregate_cache`
  WHERE `groupId` IN (
    SELECT `groupId` FROM `group_memberships`
    WHERE `sharedYearId` = NEW.`yearId` AND `state` = 'active'
  );
END;
--> statement-breakpoint
CREATE TRIGGER `social_invalidate_grades_update`
AFTER UPDATE ON `grades`
BEGIN
  UPDATE `social_groups`
  SET `revision` = `revision` + 1, `updatedAt` = unixepoch()
  WHERE `id` IN (
    SELECT `groupId` FROM `group_memberships`
    WHERE `sharedYearId` IN (OLD.`yearId`, NEW.`yearId`) AND `state` = 'active'
  );
  DELETE FROM `social_aggregate_cache`
  WHERE `groupId` IN (
    SELECT `groupId` FROM `group_memberships`
    WHERE `sharedYearId` IN (OLD.`yearId`, NEW.`yearId`) AND `state` = 'active'
  );
END;
--> statement-breakpoint
CREATE TRIGGER `social_invalidate_grades_delete`
AFTER DELETE ON `grades`
BEGIN
  UPDATE `social_groups`
  SET `revision` = `revision` + 1, `updatedAt` = unixepoch()
  WHERE `id` IN (
    SELECT `groupId` FROM `group_memberships`
    WHERE `sharedYearId` = OLD.`yearId` AND `state` = 'active'
  );
  DELETE FROM `social_aggregate_cache`
  WHERE `groupId` IN (
    SELECT `groupId` FROM `group_memberships`
    WHERE `sharedYearId` = OLD.`yearId` AND `state` = 'active'
  );
END;
--> statement-breakpoint
CREATE TRIGGER `social_invalidate_subjects_insert`
AFTER INSERT ON `subjects`
BEGIN
  UPDATE `social_groups`
  SET `revision` = `revision` + 1, `updatedAt` = unixepoch()
  WHERE `id` IN (
    SELECT `groupId` FROM `group_memberships`
    WHERE `sharedYearId` = NEW.`yearId` AND `state` = 'active'
  );
  DELETE FROM `social_aggregate_cache`
  WHERE `groupId` IN (
    SELECT `groupId` FROM `group_memberships`
    WHERE `sharedYearId` = NEW.`yearId` AND `state` = 'active'
  );
END;
--> statement-breakpoint
CREATE TRIGGER `social_invalidate_subjects_update`
AFTER UPDATE ON `subjects`
BEGIN
  UPDATE `social_groups`
  SET `revision` = `revision` + 1, `updatedAt` = unixepoch()
  WHERE `id` IN (
    SELECT `groupId` FROM `group_memberships`
    WHERE `sharedYearId` IN (OLD.`yearId`, NEW.`yearId`) AND `state` = 'active'
  );
  DELETE FROM `social_aggregate_cache`
  WHERE `groupId` IN (
    SELECT `groupId` FROM `group_memberships`
    WHERE `sharedYearId` IN (OLD.`yearId`, NEW.`yearId`) AND `state` = 'active'
  );
END;
--> statement-breakpoint
CREATE TRIGGER `social_invalidate_subjects_delete`
AFTER DELETE ON `subjects`
BEGIN
  UPDATE `social_groups`
  SET `revision` = `revision` + 1, `updatedAt` = unixepoch()
  WHERE `id` IN (
    SELECT `groupId` FROM `group_memberships`
    WHERE `sharedYearId` = OLD.`yearId` AND `state` = 'active'
  );
  DELETE FROM `social_aggregate_cache`
  WHERE `groupId` IN (
    SELECT `groupId` FROM `group_memberships`
    WHERE `sharedYearId` = OLD.`yearId` AND `state` = 'active'
  );
END;
--> statement-breakpoint
CREATE TRIGGER `social_invalidate_goals_insert`
AFTER INSERT ON `goals`
BEGIN
  UPDATE `social_groups`
  SET `revision` = `revision` + 1, `updatedAt` = unixepoch()
  WHERE `id` IN (
    SELECT `groupId` FROM `group_memberships`
    WHERE `sharedYearId` = NEW.`yearId` AND `state` = 'active'
  );
  DELETE FROM `social_aggregate_cache`
  WHERE `groupId` IN (
    SELECT `groupId` FROM `group_memberships`
    WHERE `sharedYearId` = NEW.`yearId` AND `state` = 'active'
  );
END;
--> statement-breakpoint
CREATE TRIGGER `social_invalidate_goals_update`
AFTER UPDATE ON `goals`
BEGIN
  UPDATE `social_groups`
  SET `revision` = `revision` + 1, `updatedAt` = unixepoch()
  WHERE `id` IN (
    SELECT `groupId` FROM `group_memberships`
    WHERE `sharedYearId` IN (OLD.`yearId`, NEW.`yearId`) AND `state` = 'active'
  );
  DELETE FROM `social_aggregate_cache`
  WHERE `groupId` IN (
    SELECT `groupId` FROM `group_memberships`
    WHERE `sharedYearId` IN (OLD.`yearId`, NEW.`yearId`) AND `state` = 'active'
  );
END;
--> statement-breakpoint
CREATE TRIGGER `social_invalidate_goals_delete`
AFTER DELETE ON `goals`
BEGIN
  UPDATE `social_groups`
  SET `revision` = `revision` + 1, `updatedAt` = unixepoch()
  WHERE `id` IN (
    SELECT `groupId` FROM `group_memberships`
    WHERE `sharedYearId` = OLD.`yearId` AND `state` = 'active'
  );
  DELETE FROM `social_aggregate_cache`
  WHERE `groupId` IN (
    SELECT `groupId` FROM `group_memberships`
    WHERE `sharedYearId` = OLD.`yearId` AND `state` = 'active'
  );
END;
--> statement-breakpoint
CREATE TRIGGER `social_invalidate_years_update`
BEFORE UPDATE ON `years`
BEGIN
  UPDATE `social_groups`
  SET `revision` = `revision` + 1, `updatedAt` = unixepoch()
  WHERE `id` IN (
    SELECT `groupId` FROM `group_memberships`
    WHERE `sharedYearId` = OLD.`id` AND `state` = 'active'
  );
  DELETE FROM `social_aggregate_cache`
  WHERE `groupId` IN (
    SELECT `groupId` FROM `group_memberships`
    WHERE `sharedYearId` = OLD.`id` AND `state` = 'active'
  );
END;
--> statement-breakpoint
CREATE TRIGGER `social_invalidate_years_delete`
BEFORE DELETE ON `years`
BEGIN
  UPDATE `social_groups`
  SET `revision` = `revision` + 1, `updatedAt` = unixepoch()
  WHERE `id` IN (
    SELECT `groupId` FROM `group_memberships`
    WHERE `sharedYearId` = OLD.`id` AND `state` = 'active'
  );
  DELETE FROM `social_aggregate_cache`
  WHERE `groupId` IN (
    SELECT `groupId` FROM `group_memberships`
    WHERE `sharedYearId` = OLD.`id` AND `state` = 'active'
  );
END;
