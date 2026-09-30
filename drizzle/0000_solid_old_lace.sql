CREATE TABLE `channels` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`uploads` text,
	`checked_at` text,
	`next_page` text,
	`scan_before` text,
	`scan_started` text
);
--> statement-breakpoint
CREATE TABLE `exclusions` (
	`performer_id` text NOT NULL,
	`video_id` text NOT NULL,
	`reason` text NOT NULL,
	PRIMARY KEY(`performer_id`, `video_id`)
);
--> statement-breakpoint
CREATE TABLE `matches` (
	`performer_id` text NOT NULL,
	`video_id` text NOT NULL,
	`status` text NOT NULL,
	`source` text NOT NULL,
	PRIMARY KEY(`performer_id`, `video_id`)
);
--> statement-breakpoint
CREATE TABLE `performers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`aliases` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`calls` integer DEFAULT 0 NOT NULL,
	`channels` integer DEFAULT 0 NOT NULL,
	`added` integer DEFAULT 0 NOT NULL,
	`detail` text
);
--> statement-breakpoint
CREATE INDEX `runs_started` ON `runs` (`started_at`);--> statement-breakpoint
CREATE TABLE `state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `videos` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`title` text NOT NULL,
	`published_at` text,
	`discovered_at` text,
	`checked_at` text,
	`format` text DEFAULT 'UNKNOWN' NOT NULL,
	`available` integer DEFAULT 1 NOT NULL
);
