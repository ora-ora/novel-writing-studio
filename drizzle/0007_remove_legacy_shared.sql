DELETE FROM `generation_drafts` WHERE `project_id` IN (SELECT `id` FROM `projects` WHERE `workspace_id`='legacy');--> statement-breakpoint
DELETE FROM `project_snapshots` WHERE `project_id` IN (SELECT `id` FROM `projects` WHERE `workspace_id`='legacy');--> statement-breakpoint
DELETE FROM `lore_cards` WHERE `project_id` IN (SELECT `id` FROM `projects` WHERE `workspace_id`='legacy');--> statement-breakpoint
DELETE FROM `characters` WHERE `project_id` IN (SELECT `id` FROM `projects` WHERE `workspace_id`='legacy');--> statement-breakpoint
DELETE FROM `chapters` WHERE `project_id` IN (SELECT `id` FROM `projects` WHERE `workspace_id`='legacy');--> statement-breakpoint
DELETE FROM `projects` WHERE `workspace_id`='legacy';
