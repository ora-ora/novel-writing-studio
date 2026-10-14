CREATE TABLE `chapters` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`position` integer NOT NULL,
	`title` text DEFAULT '未命名章节' NOT NULL,
	`synopsis` text DEFAULT '' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`outline_revision` integer DEFAULT 1 NOT NULL,
	`body_outline_revision` integer,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_chapters_project_position` ON `chapters` (`project_id`,`position`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`premise` text DEFAULT '' NOT NULL,
	`genre` text DEFAULT '' NOT NULL,
	`style` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL
);
