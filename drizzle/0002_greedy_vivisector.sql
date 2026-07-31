CREATE TABLE `agent_alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`alert_type` text NOT NULL,
	`severity` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`subject` text NOT NULL,
	`evidence_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`resolved_at` text
);
--> statement-breakpoint
CREATE INDEX `agent_alerts_status_severity_idx` ON `agent_alerts` (`status`,`severity`,`created_at`);--> statement-breakpoint
CREATE TABLE `agent_checkpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`step` text NOT NULL,
	`state_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_checkpoints_run_idx` ON `agent_checkpoints` (`run_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_type` text NOT NULL,
	`wallet_address` text,
	`status` text NOT NULL,
	`input_json` text NOT NULL,
	`output_json` text,
	`error_code` text,
	`started_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `agent_runs_type_status_idx` ON `agent_runs` (`agent_type`,`status`,`started_at`);--> statement-breakpoint
CREATE TABLE `ai_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`wallet_address` text,
	`title` text DEFAULT 'FATE Copilot' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_conversations_wallet_idx` ON `ai_conversations` (`wallet_address`,`updated_at`);--> statement-breakpoint
CREATE TABLE `ai_evaluations` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`evaluator` text NOT NULL,
	`score` integer NOT NULL,
	`details_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_evaluations_run_idx` ON `ai_evaluations` (`run_id`);--> statement-breakpoint
CREATE TABLE `ai_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`wallet_hash` text,
	`rating` integer NOT NULL,
	`reason` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_feedback_message_wallet_uidx` ON `ai_feedback` (`message_id`,`wallet_hash`);--> statement-breakpoint
CREATE TABLE `ai_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`model` text,
	`response_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_messages_conversation_idx` ON `ai_messages` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ai_tool_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`call_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`arguments_json` text NOT NULL,
	`result_json` text,
	`status` text NOT NULL,
	`duration_ms` integer,
	`error_code` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_tool_calls_call_uidx` ON `ai_tool_calls` (`call_id`);--> statement-breakpoint
CREATE INDEX `ai_tool_calls_conversation_idx` ON `ai_tool_calls` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ai_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text,
	`wallet_hash` text,
	`model` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`reasoning_tokens` integer DEFAULT 0 NOT NULL,
	`cached_tokens` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_usage_wallet_created_idx` ON `ai_usage` (`wallet_hash`,`created_at`);--> statement-breakpoint
CREATE TABLE `responsible_play_limits` (
	`wallet_address` text PRIMARY KEY NOT NULL,
	`daily_lamports` integer,
	`weekly_lamports` integer,
	`cooldown_until` integer,
	`self_excluded_until` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
