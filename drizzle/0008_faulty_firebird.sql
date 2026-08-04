ALTER TABLE `game_entries` ADD `occurred_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `game_entries` SET `occurred_at`=COALESCE(CAST(strftime('%s',`created_at`) AS INTEGER),CAST(strftime('%s','now') AS INTEGER)) WHERE `occurred_at`=0;--> statement-breakpoint
CREATE INDEX `game_entries_wallet_occurred_idx` ON `game_entries` (`wallet_address`,`occurred_at`);--> statement-breakpoint
ALTER TABLE `transaction_operations` ADD `reserved_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `transaction_operations` SET `reserved_at`=COALESCE(CAST(strftime('%s',`created_at`) AS INTEGER),CAST(strftime('%s','now') AS INTEGER)) WHERE `reserved_at`=0;--> statement-breakpoint
CREATE INDEX `transaction_operations_wallet_reserved_idx` ON `transaction_operations` (`wallet_address`,`reserved_at`,`status`);
