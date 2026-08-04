ALTER TABLE `ai_conversations` ADD `owner_key` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
UPDATE `ai_conversations` SET `owner_key`=CASE WHEN `wallet_address` IS NOT NULL THEN 'wallet:' || `wallet_address` ELSE 'legacy:' || `id` END WHERE `owner_key`='legacy';--> statement-breakpoint
CREATE INDEX `ai_conversations_owner_idx` ON `ai_conversations` (`owner_key`,`updated_at`);--> statement-breakpoint
ALTER TABLE `ai_messages` ADD `feedback_token_hash` text;
