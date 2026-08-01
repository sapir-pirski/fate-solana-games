export type GameKind = "jackpot" | "coinflip" | "daily_case";
export type GameState = "open" | "locked" | "settled" | "refunded" | "expired";

export type IndexedGame = {
  address: string;
  numericId: string;
  kind: GameKind;
  state: GameState;
  lastSlot: number;
  lastSignature: string;
};

export interface GameRepository {
  findByAddress(address: string): Promise<IndexedGame | null>;
  listByWallet(walletAddress: string): Promise<IndexedGame[]>;
  save(game: IndexedGame): Promise<void>;
}

export interface UnitOfWork {
  transaction<T>(work: () => Promise<T>): Promise<T>;
}
