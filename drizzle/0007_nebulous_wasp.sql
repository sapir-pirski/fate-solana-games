ALTER TABLE `transaction_operations` ADD `amount_lamports` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `transaction_operations` ADD `game_address` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `transaction_operations` ADD `program_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `transaction_operations` ADD `message_hash` text DEFAULT '' NOT NULL;