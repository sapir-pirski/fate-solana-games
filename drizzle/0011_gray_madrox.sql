ALTER TABLE `ai_usage` ADD `request_id` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
UPDATE `ai_usage` SET `request_id`='legacy:' || `id` WHERE `request_id`='legacy';--> statement-breakpoint
ALTER TABLE `ai_usage` ADD `response_id` text;--> statement-breakpoint
ALTER TABLE `ai_usage` ADD `round` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `ai_usage_created_idx` ON `ai_usage` (`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `ai_usage_response_uidx` ON `ai_usage` (`response_id`);
