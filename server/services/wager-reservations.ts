const WAGER_ROLES = "'player','creator','joiner'";

export type SpendingSnapshot = {
  dailySpent: number;
  weeklySpent: number;
  dailyFinalized: number;
  weeklyFinalized: number;
  dailyReserved: number;
  weeklyReserved: number;
};

export type WagerReservation = {
  id: string;
  operationId: string;
  walletAddress: string;
  gameType: string;
  action: string;
  amountLamports: number;
  gameAddress: string;
  programId: string;
  messageHash: string;
  lastValidBlockHeight: number;
  reservedAt: number;
  expiresAt: number;
};

function cutoffs(now: number) {
  return { dayStart: now - 86_400, weekStart: now - 7 * 86_400 };
}

const spendingCtes = `
  WITH finalized AS (
    SELECT
      COALESCE(SUM(CASE WHEN occurred_at >= ? THEN amount_lamports ELSE 0 END), 0) AS daily_finalized,
      COALESCE(SUM(amount_lamports), 0) AS weekly_finalized
    FROM game_entries
    WHERE wallet_address = ?
      AND role IN (${WAGER_ROLES})
      AND amount_lamports > 0
      AND occurred_at >= ?
  ), reserved AS (
    SELECT
      COALESCE(SUM(CASE WHEN op.reserved_at >= ? THEN op.amount_lamports ELSE 0 END), 0) AS daily_reserved,
      COALESCE(SUM(op.amount_lamports), 0) AS weekly_reserved
    FROM transaction_operations AS op
    WHERE op.wallet_address = ?
      AND op.amount_lamports > 0
      AND op.reserved_at >= ?
      AND (
        op.status IN ('submitted','confirmed','unknown','finalized')
        OR (op.status IN ('draft','awaiting_signature','rejected') AND op.expires_at >= ?)
      )
      AND (
        op.signature IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM game_entries AS ge
          WHERE ge.signature = op.signature
            AND ge.wallet_address = op.wallet_address
            AND ge.role IN (${WAGER_ROLES})
            AND ge.amount_lamports > 0
        )
      )
  )`;

function spendingBindings(walletAddress: string, now: number) {
  const { dayStart, weekStart } = cutoffs(now);
  return [dayStart, walletAddress, weekStart, dayStart, walletAddress, weekStart, now] as const;
}

function integer(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export async function readSpendingSnapshot(db: D1Database, walletAddress: string, now = Math.floor(Date.now() / 1000)): Promise<SpendingSnapshot> {
  const row = await db.prepare(`${spendingCtes}
    SELECT
      finalized.daily_finalized,
      finalized.weekly_finalized,
      reserved.daily_reserved,
      reserved.weekly_reserved
    FROM finalized, reserved`)
    .bind(...spendingBindings(walletAddress, now))
    .first<Record<string, unknown>>();
  const dailyFinalized = integer(row?.daily_finalized);
  const weeklyFinalized = integer(row?.weekly_finalized);
  const dailyReserved = integer(row?.daily_reserved);
  const weeklyReserved = integer(row?.weekly_reserved);
  return {
    dailySpent: dailyFinalized + dailyReserved,
    weeklySpent: weeklyFinalized + weeklyReserved,
    dailyFinalized,
    weeklyFinalized,
    dailyReserved,
    weeklyReserved,
  };
}

export async function reserveWagerOperation(db: D1Database, operation: WagerReservation) {
  const bindings = spendingBindings(operation.walletAddress, operation.reservedAt);
  const result = await db.prepare(`${spendingCtes}
    INSERT OR IGNORE INTO transaction_operations (
      id, operation_id, wallet_address, game_type, action, status,
      amount_lamports, game_address, program_id, message_hash,
      reserved_at, last_valid_block_height, expires_at, attempts, updated_at
    )
    SELECT ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP
    FROM finalized, reserved
    WHERE (
      (SELECT daily_lamports FROM responsible_play_limits WHERE wallet_address = ?) IS NULL
      OR finalized.daily_finalized + reserved.daily_reserved + ?
        <= (SELECT daily_lamports FROM responsible_play_limits WHERE wallet_address = ?)
    )
    AND (
      (SELECT weekly_lamports FROM responsible_play_limits WHERE wallet_address = ?) IS NULL
      OR finalized.weekly_finalized + reserved.weekly_reserved + ?
        <= (SELECT weekly_lamports FROM responsible_play_limits WHERE wallet_address = ?)
    )`)
    .bind(
      ...bindings,
      operation.id, operation.operationId, operation.walletAddress, operation.gameType, operation.action,
      operation.amountLamports, operation.gameAddress, operation.programId, operation.messageHash,
      operation.reservedAt, operation.lastValidBlockHeight, operation.expiresAt,
      operation.walletAddress, operation.amountLamports, operation.walletAddress,
      operation.walletAddress, operation.amountLamports, operation.walletAddress,
    )
    .run();
  return { reserved: Number(result.meta.changes ?? 0) === 1 };
}
