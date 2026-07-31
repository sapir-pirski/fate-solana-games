CREATE TABLE `chain_events` (
	`id` text PRIMARY KEY NOT NULL,
	`signature` text NOT NULL,
	`instruction_index` integer NOT NULL,
	`event_index` integer NOT NULL,
	`slot` integer NOT NULL,
	`block_time` integer,
	`program_id` text NOT NULL,
	`event_name` text NOT NULL,
	`payload_json` text NOT NULL,
	`commitment` text DEFAULT 'confirmed' NOT NULL,
	`ingested_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chain_events_position_uidx` ON `chain_events` (`signature`,`instruction_index`,`event_index`);--> statement-breakpoint
CREATE INDEX `chain_events_slot_idx` ON `chain_events` (`slot`);--> statement-breakpoint
CREATE INDEX `chain_events_name_slot_idx` ON `chain_events` (`event_name`,`slot`);--> statement-breakpoint
CREATE TABLE `game_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`game_address` text NOT NULL,
	`wallet_address` text NOT NULL,
	`role` text NOT NULL,
	`amount_lamports` integer NOT NULL,
	`signature` text NOT NULL,
	`slot` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_entries_signature_wallet_uidx` ON `game_entries` (`signature`,`wallet_address`,`role`);--> statement-breakpoint
CREATE INDEX `game_entries_game_idx` ON `game_entries` (`game_address`,`slot`);--> statement-breakpoint
CREATE INDEX `game_entries_wallet_idx` ON `game_entries` (`wallet_address`,`slot`);--> statement-breakpoint
CREATE TABLE `games` (
	`address` text PRIMARY KEY NOT NULL,
	`game_type` text NOT NULL,
	`numeric_id` text NOT NULL,
	`state` text NOT NULL,
	`creator` text,
	`winner` text,
	`wager_lamports` integer DEFAULT 0 NOT NULL,
	`pot_lamports` integer DEFAULT 0 NOT NULL,
	`payout_lamports` integer DEFAULT 0 NOT NULL,
	`fee_lamports` integer DEFAULT 0 NOT NULL,
	`randomness_hex` text,
	`opened_at` integer,
	`expires_at` integer,
	`settled_at` integer,
	`last_signature` text NOT NULL,
	`last_slot` integer NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `games_type_numeric_id_uidx` ON `games` (`game_type`,`numeric_id`);--> statement-breakpoint
CREATE INDEX `games_type_state_idx` ON `games` (`game_type`,`state`);--> statement-breakpoint
CREATE INDEX `games_winner_idx` ON `games` (`winner`);--> statement-breakpoint
CREATE TABLE `indexer_checkpoints` (
	`consumer` text PRIMARY KEY NOT NULL,
	`last_signature` text,
	`last_slot` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'healthy' NOT NULL,
	`last_error` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transaction_intents` (
	`id` text PRIMARY KEY NOT NULL,
	`wallet_address` text NOT NULL,
	`game_type` text NOT NULL,
	`game_address` text,
	`action` text NOT NULL,
	`amount_lamports` integer,
	`status` text NOT NULL,
	`signature` text,
	`error_code` text,
	`expires_at` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transaction_intents_signature_uidx` ON `transaction_intents` (`signature`);--> statement-breakpoint
CREATE INDEX `transaction_intents_wallet_status_idx` ON `transaction_intents` (`wallet_address`,`status`);--> statement-breakpoint
CREATE INDEX `transaction_intents_expiry_idx` ON `transaction_intents` (`expires_at`);