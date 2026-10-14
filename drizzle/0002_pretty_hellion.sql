CREATE TABLE `generation_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`target_id` text,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `generation_quota` (
	`day` text NOT NULL,
	`workspace_id` text NOT NULL,
	`calls` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`day`, `workspace_id`)
);
--> statement-breakpoint
CREATE TABLE `lore_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`category` text DEFAULT 'rule' NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`from_chapter` integer,
	`until_chapter` integer,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `project_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`reason` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `chapters` ADD `memory` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `workspace_id` text DEFAULT 'legacy' NOT NULL;