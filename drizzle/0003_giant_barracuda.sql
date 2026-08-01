CREATE TABLE `background_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`queue` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 8 NOT NULL,
	`available_at` integer NOT NULL,
	`lease_owner` text,
	`lease_expires_at` integer,
	`last_error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `background_jobs_dedupe_uidx` ON `background_jobs` (`queue`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `background_jobs_claim_idx` ON `background_jobs` (`queue`,`status`,`available_at`);--> statement-breakpoint
CREATE TABLE `compliance_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`wallet_hash` text NOT NULL,
	`event_type` text NOT NULL,
	`decision` text NOT NULL,
	`reason` text,
	`evidence_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `compliance_audit_wallet_created_idx` ON `compliance_audit_events` (`wallet_hash`,`created_at`);--> statement-breakpoint
CREATE TABLE `compliance_profiles` (
	`wallet_address` text PRIMARY KEY NOT NULL,
	`country_code` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`jurisdiction_status` text DEFAULT 'unreviewed' NOT NULL,
	`sanctions_status` text DEFAULT 'not_screened' NOT NULL,
	`age_attested_at` integer,
	`terms_version` text,
	`privacy_version` text,
	`risk_version` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `compliance_profiles_status_idx` ON `compliance_profiles` (`status`,`jurisdiction_status`);--> statement-breakpoint
CREATE TABLE `distributed_leases` (
	`name` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `privacy_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`wallet_address` text NOT NULL,
	`request_type` text NOT NULL,
	`status` text DEFAULT 'received' NOT NULL,
	`requested_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `privacy_requests_wallet_created_idx` ON `privacy_requests` (`wallet_address`,`requested_at`);--> statement-breakpoint
CREATE TABLE `rate_limit_buckets` (
	`key` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`subject_hash` text NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rate_limit_buckets_expiry_idx` ON `rate_limit_buckets` (`expires_at`);--> statement-breakpoint
CREATE TABLE `response_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`expires_at` integer NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `response_cache_expiry_idx` ON `response_cache` (`expires_at`);--> statement-breakpoint
CREATE TABLE `transaction_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`wallet_address` text NOT NULL,
	`game_type` text NOT NULL,
	`action` text NOT NULL,
	`status` text NOT NULL,
	`signature` text,
	`error_code` text,
	`error_message` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_valid_block_height` integer,
	`expires_at` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transaction_operations_operation_uidx` ON `transaction_operations` (`operation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `transaction_operations_signature_uidx` ON `transaction_operations` (`signature`);--> statement-breakpoint
CREATE INDEX `transaction_operations_wallet_status_idx` ON `transaction_operations` (`wallet_address`,`status`);--> statement-breakpoint
CREATE TABLE `wallet_auth_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`wallet_address` text NOT NULL,
	`nonce_hash` text NOT NULL,
	`message` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `wallet_auth_challenges_wallet_idx` ON `wallet_auth_challenges` (`wallet_address`,`expires_at`);--> statement-breakpoint
CREATE TABLE `wallet_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`wallet_address` text NOT NULL,
	`expires_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`revoked_at` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wallet_sessions_token_uidx` ON `wallet_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `wallet_sessions_wallet_idx` ON `wallet_sessions` (`wallet_address`,`expires_at`);
