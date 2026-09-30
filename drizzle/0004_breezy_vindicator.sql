ALTER TABLE `coverage_requests` ADD `performer_id` text;--> statement-breakpoint
ALTER TABLE `performers` ADD `official_url` text;--> statement-breakpoint
ALTER TABLE `performers` ADD `status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `performers` ADD `review_mode` text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE `performers` ADD `lookback_days` integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE `performers` ADD `discovery_enabled` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `performers` ADD `chat_enabled` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `performers` ADD `updated_at` text;