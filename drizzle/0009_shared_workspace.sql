-- Keep every work, chapter, draft, snapshot and soft-delete marker intact.
-- Only normalize the former browser workspace association.
UPDATE `projects` SET `workspace_id` = 'shared' WHERE `workspace_id` <> 'shared';
