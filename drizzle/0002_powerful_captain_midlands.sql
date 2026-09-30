CREATE TABLE `abuse_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`target` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `abuse_status` ON `abuse_reports` (`status`);--> statement-breakpoint
CREATE TABLE `blocks` (
	`user_id` text NOT NULL,
	`target` text NOT NULL,
	PRIMARY KEY(`user_id`, `target`)
);
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`room` text NOT NULL,
	`user_id` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'visible' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `chat_room_date` ON `chat_messages` (`room`,`created_at`);--> statement-breakpoint
CREATE INDEX `chat_user_date` ON `chat_messages` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `comment_likes` (
	`user_id` text NOT NULL,
	`comment_id` text NOT NULL,
	PRIMARY KEY(`user_id`, `comment_id`)
);
--> statement-breakpoint
CREATE TABLE `follows` (
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`target` text NOT NULL,
	PRIMARY KEY(`user_id`, `kind`, `target`)
);
--> statement-breakpoint
CREATE TABLE `mutes` (
	`user_id` text PRIMARY KEY NOT NULL,
	`until` text NOT NULL,
	`reason` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`settings` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reputation_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`amount` integer NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reputation_user` ON `reputation_events` (`user_id`);--> statement-breakpoint
CREATE TABLE `room_members` (
	`user_id` text NOT NULL,
	`room` text NOT NULL,
	`last_read` text NOT NULL,
	`seen_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `room`)
);
--> statement-breakpoint
CREATE TABLE `saved_views` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`settings` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `views_user` ON `saved_views` (`user_id`);--> statement-breakpoint
CREATE TABLE `watch` (
	`user_id` text NOT NULL,
	`video_id` text NOT NULL,
	`status` text NOT NULL,
	`favorite` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `video_id`)
);
--> statement-breakpoint
ALTER TABLE `contributions` ADD `parent_id` text;