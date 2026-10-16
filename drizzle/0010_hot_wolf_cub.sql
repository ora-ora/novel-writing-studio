CREATE TABLE `chapter_memories` (
	`chapter_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`body_revision` integer NOT NULL,
	`summary` text NOT NULL,
	`facts` text DEFAULT '' NOT NULL,
	`candidates` text DEFAULT '[]' NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `consistency_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`chapter_id` text,
	`run_id` text,
	`draft_hash` text NOT NULL,
	`findings` text NOT NULL,
	`resolutions` text DEFAULT '{}' NOT NULL,
	`stale` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `extraction_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`chapters` text NOT NULL,
	`status` text DEFAULT 'paused' NOT NULL,
	`completed` text DEFAULT '{}' NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`lease_owner` text DEFAULT '' NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `reference_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`chapter_id` text,
	`kind` text NOT NULL,
	`snapshot` text NOT NULL,
	`refs` text NOT NULL,
	`stale` integer DEFAULT 0 NOT NULL,
	`adopted` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_reference_project` ON `reference_runs` (`project_id`,`chapter_id`);--> statement-breakpoint
CREATE TABLE `setting_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`aliases` text DEFAULT '[]' NOT NULL,
	`content` text NOT NULL,
	`status` text DEFAULT 'candidate' NOT NULL,
	`hard` integer DEFAULT 0 NOT NULL,
	`reveal_position` integer,
	`source_chapter_id` text,
	`source_revision` integer,
	`evidence` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_setting_project` ON `setting_entries` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `setting_versions` (
	`entry_id` text NOT NULL,
	`version` integer NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`entry_id`, `version`)
);
--> statement-breakpoint
ALTER TABLE `chapters` ADD `body_revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `chapters` ADD `memory_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `book_outline` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `tags` text DEFAULT '' NOT NULL;
--> statement-breakpoint
UPDATE chapters SET memory_revision=body_revision WHERE memory<>'';
