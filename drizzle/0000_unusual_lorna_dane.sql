CREATE TABLE `event_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`category` text NOT NULL,
	`status` text DEFAULT 'info' NOT NULL,
	`session_id` text,
	`wallet_address` text,
	`game_type` text,
	`game_id` text,
	`amount_lamports` integer,
	`transaction_signature` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `event_logs_created_at_idx` ON `event_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `event_logs_event_created_idx` ON `event_logs` (`event_type`,`created_at`);--> statement-breakpoint
CREATE INDEX `event_logs_wallet_created_idx` ON `event_logs` (`wallet_address`,`created_at`);--> statement-breakpoint
CREATE INDEX `event_logs_game_created_idx` ON `event_logs` (`game_type`,`game_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `event_logs_tx_signature_idx` ON `event_logs` (`transaction_signature`);