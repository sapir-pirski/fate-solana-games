import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Append-only product audit log. It deliberately excludes IP addresses,
 * user-agent strings, secrets, and wallet signatures from metadata.
 */
export const eventLogs = sqliteTable(
  "event_logs",
  {
    id: text("id").primaryKey(),
    eventType: text("event_type").notNull(),
    category: text("category").notNull(),
    status: text("status").notNull().default("info"),
    sessionId: text("session_id"),
    walletAddress: text("wallet_address"),
    gameType: text("game_type"),
    gameId: text("game_id"),
    amountLamports: integer("amount_lamports"),
    transactionSignature: text("transaction_signature"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    schemaVersion: integer("schema_version").notNull().default(1),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("event_logs_created_at_idx").on(table.createdAt),
    index("event_logs_event_created_idx").on(table.eventType, table.createdAt),
    index("event_logs_wallet_created_idx").on(table.walletAddress, table.createdAt),
    index("event_logs_game_created_idx").on(table.gameType, table.gameId, table.createdAt),
    index("event_logs_tx_signature_idx").on(table.transactionSignature),
  ],
);

/** Canonical, replay-safe cursor for every observed program event. */
export const chainEvents = sqliteTable(
  "chain_events",
  {
    id: text("id").primaryKey(),
    signature: text("signature").notNull(),
    instructionIndex: integer("instruction_index").notNull(),
    eventIndex: integer("event_index").notNull(),
    slot: integer("slot").notNull(),
    blockTime: integer("block_time"),
    programId: text("program_id").notNull(),
    eventName: text("event_name").notNull(),
    payloadJson: text("payload_json").notNull(),
    commitment: text("commitment").notNull().default("confirmed"),
    ingestedAt: text("ingested_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("chain_events_position_uidx").on(table.signature, table.instructionIndex, table.eventIndex),
    index("chain_events_slot_idx").on(table.slot),
    index("chain_events_name_slot_idx").on(table.eventName, table.slot),
  ],
);

/** Query projection; chainEvents remains the source of truth. */
export const games = sqliteTable(
  "games",
  {
    address: text("address").primaryKey(),
    gameType: text("game_type").notNull(),
    numericId: text("numeric_id").notNull(),
    state: text("state").notNull(),
    creator: text("creator"),
    winner: text("winner"),
    wagerLamports: integer("wager_lamports").notNull().default(0),
    potLamports: integer("pot_lamports").notNull().default(0),
    payoutLamports: integer("payout_lamports").notNull().default(0),
    feeLamports: integer("fee_lamports").notNull().default(0),
    randomnessHex: text("randomness_hex"),
    openedAt: integer("opened_at"),
    expiresAt: integer("expires_at"),
    settledAt: integer("settled_at"),
    lastSignature: text("last_signature").notNull(),
    lastSlot: integer("last_slot").notNull(),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("games_type_numeric_id_uidx").on(table.gameType, table.numericId),
    index("games_type_state_idx").on(table.gameType, table.state),
    index("games_winner_idx").on(table.winner),
  ],
);

export const gameEntries = sqliteTable(
  "game_entries",
  {
    id: text("id").primaryKey(),
    gameAddress: text("game_address").notNull(),
    walletAddress: text("wallet_address").notNull(),
    role: text("role").notNull(),
    amountLamports: integer("amount_lamports").notNull(),
    signature: text("signature").notNull(),
    slot: integer("slot").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("game_entries_signature_wallet_uidx").on(table.signature, table.walletAddress, table.role),
    index("game_entries_game_idx").on(table.gameAddress, table.slot),
    index("game_entries_wallet_idx").on(table.walletAddress, table.slot),
  ],
);

export const transactionIntents = sqliteTable(
  "transaction_intents",
  {
    id: text("id").primaryKey(),
    walletAddress: text("wallet_address").notNull(),
    gameType: text("game_type").notNull(),
    gameAddress: text("game_address"),
    action: text("action").notNull(),
    amountLamports: integer("amount_lamports"),
    status: text("status").notNull(),
    signature: text("signature"),
    errorCode: text("error_code"),
    expiresAt: integer("expires_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("transaction_intents_signature_uidx").on(table.signature),
    index("transaction_intents_wallet_status_idx").on(table.walletAddress, table.status),
    index("transaction_intents_expiry_idx").on(table.expiresAt),
  ],
);

export const walletAuthChallenges = sqliteTable("wallet_auth_challenges", {
  id: text("id").primaryKey(), walletAddress: text("wallet_address").notNull(), nonceHash: text("nonce_hash").notNull(),
  message: text("message").notNull(), expiresAt: integer("expires_at").notNull(), usedAt: integer("used_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [index("wallet_auth_challenges_wallet_idx").on(table.walletAddress, table.expiresAt)]);

export const walletSessions = sqliteTable("wallet_sessions", {
  id: text("id").primaryKey(), tokenHash: text("token_hash").notNull(), walletAddress: text("wallet_address").notNull(),
  expiresAt: integer("expires_at").notNull(), lastSeenAt: integer("last_seen_at").notNull(), revokedAt: integer("revoked_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [uniqueIndex("wallet_sessions_token_uidx").on(table.tokenHash), index("wallet_sessions_wallet_idx").on(table.walletAddress, table.expiresAt)]);

export const transactionOperations = sqliteTable("transaction_operations", {
  id: text("id").primaryKey(), operationId: text("operation_id").notNull(), walletAddress: text("wallet_address").notNull(),
  gameType: text("game_type").notNull(), action: text("action").notNull(), status: text("status").notNull(),
  signature: text("signature"), errorCode: text("error_code"), errorMessage: text("error_message"), attempts: integer("attempts").notNull().default(0),
  lastValidBlockHeight: integer("last_valid_block_height"), expiresAt: integer("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [uniqueIndex("transaction_operations_operation_uidx").on(table.operationId), uniqueIndex("transaction_operations_signature_uidx").on(table.signature), index("transaction_operations_wallet_status_idx").on(table.walletAddress, table.status)]);

export const indexerCheckpoints = sqliteTable("indexer_checkpoints", {
  consumer: text("consumer").primaryKey(),
  lastSignature: text("last_signature"),
  lastSlot: integer("last_slot").notNull().default(0),
  status: text("status").notNull().default("healthy"),
  lastError: text("last_error"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const aiConversations = sqliteTable("ai_conversations", {
  id: text("id").primaryKey(), walletAddress: text("wallet_address"), title: text("title").notNull().default("FATE Copilot"),
  status: text("status").notNull().default("active"), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [index("ai_conversations_wallet_idx").on(table.walletAddress, table.updatedAt)]);

export const aiMessages = sqliteTable("ai_messages", {
  id: text("id").primaryKey(), conversationId: text("conversation_id").notNull(), role: text("role").notNull(), content: text("content").notNull(),
  model: text("model"), responseId: text("response_id"), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [index("ai_messages_conversation_idx").on(table.conversationId, table.createdAt)]);

export const aiToolCalls = sqliteTable("ai_tool_calls", {
  id: text("id").primaryKey(), conversationId: text("conversation_id").notNull(), callId: text("call_id").notNull(), toolName: text("tool_name").notNull(),
  argumentsJson: text("arguments_json").notNull(), resultJson: text("result_json"), status: text("status").notNull(), durationMs: integer("duration_ms"), errorCode: text("error_code"), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [uniqueIndex("ai_tool_calls_call_uidx").on(table.callId), index("ai_tool_calls_conversation_idx").on(table.conversationId, table.createdAt)]);

export const aiUsage = sqliteTable("ai_usage", {
  id: text("id").primaryKey(), conversationId: text("conversation_id"), walletHash: text("wallet_hash"), model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0), outputTokens: integer("output_tokens").notNull().default(0), reasoningTokens: integer("reasoning_tokens").notNull().default(0), cachedTokens: integer("cached_tokens").notNull().default(0), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [index("ai_usage_wallet_created_idx").on(table.walletHash, table.createdAt)]);

export const aiFeedback = sqliteTable("ai_feedback", {
  id: text("id").primaryKey(), messageId: text("message_id").notNull(), walletHash: text("wallet_hash"), rating: integer("rating").notNull(), reason: text("reason"), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [uniqueIndex("ai_feedback_message_wallet_uidx").on(table.messageId, table.walletHash)]);

export const aiEvaluations = sqliteTable("ai_evaluations", {
  id: text("id").primaryKey(), runId: text("run_id").notNull(), evaluator: text("evaluator").notNull(), score: integer("score").notNull(), detailsJson: text("details_json").notNull().default("{}"), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [index("ai_evaluations_run_idx").on(table.runId)]);

export const agentRuns = sqliteTable("agent_runs", {
  id: text("id").primaryKey(), agentType: text("agent_type").notNull(), walletAddress: text("wallet_address"), status: text("status").notNull(), inputJson: text("input_json").notNull(), outputJson: text("output_json"), errorCode: text("error_code"), startedAt: text("started_at").notNull().default(sql`CURRENT_TIMESTAMP`), completedAt: text("completed_at"),
}, table => [index("agent_runs_type_status_idx").on(table.agentType, table.status, table.startedAt)]);

export const agentCheckpoints = sqliteTable("agent_checkpoints", {
  id: text("id").primaryKey(), runId: text("run_id").notNull(), step: text("step").notNull(), stateJson: text("state_json").notNull(), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => [index("agent_checkpoints_run_idx").on(table.runId, table.createdAt)]);

export const agentAlerts = sqliteTable("agent_alerts", {
  id: text("id").primaryKey(), alertType: text("alert_type").notNull(), severity: text("severity").notNull(), status: text("status").notNull().default("open"), subject: text("subject").notNull(), evidenceJson: text("evidence_json").notNull(), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), resolvedAt: text("resolved_at"),
}, table => [index("agent_alerts_status_severity_idx").on(table.status, table.severity, table.createdAt)]);

export const responsiblePlayLimits = sqliteTable("responsible_play_limits", {
  walletAddress: text("wallet_address").primaryKey(), dailyLamports: integer("daily_lamports"), weeklyLamports: integer("weekly_lamports"), cooldownUntil: integer("cooldown_until"), selfExcludedUntil: integer("self_excluded_until"), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
