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

export const indexerCheckpoints = sqliteTable("indexer_checkpoints", {
  consumer: text("consumer").primaryKey(),
  lastSignature: text("last_signature"),
  lastSlot: integer("last_slot").notNull().default(0),
  status: text("status").notNull().default("healthy"),
  lastError: text("last_error"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
