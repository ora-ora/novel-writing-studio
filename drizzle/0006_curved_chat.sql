CREATE TABLE `characters` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`role` text DEFAULT '' NOT NULL,
	`goal` text DEFAULT '' NOT NULL,
	`traits` text DEFAULT '' NOT NULL,
	`relationships` text DEFAULT '' NOT NULL,
	`secret` text DEFAULT '' NOT NULL,
	`arc` text DEFAULT '' NOT NULL,
	`from_chapter` integer,
	`until_chapter` integer,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_characters_project` ON `characters` (`project_id`);--> statement-breakpoint
ALTER TABLE `projects` ADD `mainline` text DEFAULT '' NOT NULL;