import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
