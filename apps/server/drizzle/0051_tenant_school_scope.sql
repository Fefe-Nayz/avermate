DROP INDEX `sync_connections_remote_scope_unique`;--> statement-breakpoint
-- Older fallbacks embedded the exact editable local date range. Collapse them
-- to the school-year start so a one-day edit cannot create a second link for
-- the same pupil. If legacy data already contains such duplicates, retain the
-- live credentialed projection (and its grade authority when applicable),
-- then the most recently updated one. Leave every other projection
-- reconnectable rather than deleting any user data.
WITH `ranked_school_links` AS (
  SELECT
    `id`,
    row_number() OVER (
      PARTITION BY
        `userId`,
        `provider`,
        `baseUrl`,
        `remoteStudentId`,
        CASE
          WHEN `remoteAcademicYearId` LIKE 'scope:____-%'
            THEN 'school-year:' || substr(`remoteAcademicYearId`, 7, 4)
          ELSE `remoteAcademicYearId`
        END
      ORDER BY
        CASE
          WHEN `sealedCredentials` IS NOT NULL AND `status` = 'active' AND `gradesAuthority` = 1 THEN 0
          WHEN `sealedCredentials` IS NOT NULL AND `status` = 'active' THEN 1
          WHEN `sealedCredentials` IS NOT NULL AND `status` = 'error' AND `gradesAuthority` = 1 THEN 2
          WHEN `sealedCredentials` IS NOT NULL AND `status` = 'error' THEN 3
          WHEN `sealedCredentials` IS NOT NULL AND `gradesAuthority` = 1 THEN 4
          WHEN `sealedCredentials` IS NOT NULL THEN 5
          ELSE 6
        END,
        `updatedAt` DESC,
        `createdAt` DESC,
        `id`
    ) AS `position`
  FROM `sync_connections`
  WHERE
    `remoteStudentId` IS NOT NULL
    AND `remoteAcademicYearId` IS NOT NULL
)
UPDATE `sync_connections`
SET `remoteStudentId` = NULL
WHERE `id` IN (
  SELECT `id`
  FROM `ranked_school_links`
  WHERE `position` > 1
);--> statement-breakpoint
UPDATE `sync_connections`
SET `remoteAcademicYearId` = 'school-year:' || substr(`remoteAcademicYearId`, 7, 4)
WHERE `remoteAcademicYearId` LIKE 'scope:____-%';--> statement-breakpoint
CREATE UNIQUE INDEX `sync_connections_remote_scope_unique` ON `sync_connections` (`userId`,`provider`,`baseUrl`,`remoteStudentId`,`remoteAcademicYearId`) WHERE "sync_connections"."remoteStudentId" is not null and "sync_connections"."remoteAcademicYearId" is not null;
