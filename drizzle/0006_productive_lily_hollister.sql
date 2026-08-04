DROP INDEX `game_entries_signature_wallet_uidx`;--> statement-breakpoint
ALTER TABLE `game_entries` ADD `event_index` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `game_entries_event_uidx` ON `game_entries` (`signature`,`event_index`,`role`,`wallet_address`);