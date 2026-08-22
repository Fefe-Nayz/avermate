-- Existing connections stored the capability set that was active when they
-- were created. Grade publication is now fully managed, so upgrade those rows
-- instead of making every user disconnect and re-enter school credentials.
UPDATE `sync_connections`
SET
  `capabilities` = json_insert(`capabilities`, '$[#]', 'grades'),
  `updatedAt` = unixepoch()
WHERE
  `provider` IN ('ecoledirecte', 'pronote', 'skolengo')
  AND json_valid(`capabilities`)
  AND NOT EXISTS (
    SELECT 1
    FROM json_each(`sync_connections`.`capabilities`)
    WHERE json_each.value = 'grades'
  );
