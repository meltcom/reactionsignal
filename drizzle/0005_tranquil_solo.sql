CREATE TABLE `discovery_notifications` (
	`performer_id` text NOT NULL,
	`video_id` text NOT NULL,
	`created_at` text NOT NULL,
	`source` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`reviewed_at` text,
	`reviewed_by` text,
	`note` text,
	PRIMARY KEY(`performer_id`, `video_id`)
);
--> statement-breakpoint
CREATE INDEX `discovery_notifications_status` ON `discovery_notifications` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `push_jobs` (
	`video_id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`received_at` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt` integer DEFAULT 0 NOT NULL,
	`processed_at` text,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `push_jobs_due` ON `push_jobs` (`status`,`next_attempt`);--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`channel_id` text PRIMARY KEY NOT NULL,
	`secret` text NOT NULL,
	`token` text NOT NULL,
	`callback` text NOT NULL,
	`requested_at` text NOT NULL,
	`pending_until` integer NOT NULL,
	`expires_at` integer DEFAULT 0 NOT NULL,
	`error` text
);
