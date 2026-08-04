CREATE TABLE `privacy_request_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`wallet_address` text NOT NULL,
	`payload_json` text NOT NULL,
	`checksum_sha256` text NOT NULL,
	`expires_at` integer NOT NULL,
	`downloaded_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `privacy_request_artifacts_request_uidx` ON `privacy_request_artifacts` (`request_id`);--> statement-breakpoint
CREATE INDEX `privacy_request_artifacts_wallet_expiry_idx` ON `privacy_request_artifacts` (`wallet_address`,`expires_at`);--> statement-breakpoint
CREATE TABLE `__new_privacy_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`wallet_address` text NOT NULL,
	`request_type` text NOT NULL,
	`status` text DEFAULT 'received' NOT NULL,
	`requested_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`due_at` integer NOT NULL,
	`reviewed_at` text,
	`completed_at` text,
	`reviewer_id` text,
	`decision_reason` text,
	`request_details_json` text DEFAULT '{}' NOT NULL,
	`result_summary_json` text DEFAULT '{}' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_privacy_requests` (`id`,`wallet_address`,`request_type`,`status`,`requested_at`,`due_at`,`completed_at`,`updated_at`)
SELECT `id`,`wallet_address`,`request_type`,`status`,`requested_at`,unixepoch(`requested_at`)+2592000,`completed_at`,COALESCE(`completed_at`,`requested_at`,CURRENT_TIMESTAMP) FROM `privacy_requests`;--> statement-breakpoint
DROP TABLE `privacy_requests`;--> statement-breakpoint
ALTER TABLE `__new_privacy_requests` RENAME TO `privacy_requests`;--> statement-breakpoint
CREATE INDEX `privacy_requests_wallet_created_idx` ON `privacy_requests` (`wallet_address`,`requested_at`);--> statement-breakpoint
CREATE INDEX `privacy_requests_status_due_idx` ON `privacy_requests` (`status`,`due_at`);
