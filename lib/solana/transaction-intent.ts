import { PublicKey, SystemProgram, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { Buffer } from "buffer";
import type { GameAction, GameType } from "@/lib/transactions";

const CONFIG_SEED = Buffer.from("config");
const COINFLIP_SEED = Buffer.from("coinflip");
const COINFLIP_VAULT_SEED = Buffer.from("coinflip-vault");
const JACKPOT_VAULT_SEED = Buffer.from("jackpot-vault");
const DAILY_SEED = Buffer.from("daily");
const DAILY_VAULT_SEED = Buffer.from("daily-vault");
const RANDOMNESS_RECEIPT_SEED = Buffer.from("randomness-use");

const DISCRIMINATORS = {
  enter_jackpot: [74, 241, 109, 6, 202, 151, 119, 121],
  create_coinflip: [23, 66, 225, 208, 103, 207, 25, 225],
  join_coinflip: [79, 207, 215, 111, 215, 83, 146, 56],
  settle_coinflip: [69, 57, 200, 136, 7, 34, 236, 112],
  cancel_coinflip: [1, 62, 100, 241, 181, 60, 206, 52],
  refund_coinflip_timeout: [89, 126, 38, 216, 97, 114, 134, 164],
  initialize_daily_player: [242, 50, 30, 88, 112, 28, 220, 44],
  open_daily: [198, 234, 60, 101, 248, 143, 240, 87],
  settle_daily: [182, 216, 21, 52, 151, 70, 100, 126],
  cancel_daily_timeout: [192, 124, 232, 93, 228, 118, 128, 202],
} as const;

const ACTIONS = Object.entries(DISCRIMINATORS).filter(([name]) => name !== "initialize_daily_player") as Array<[GameAction, readonly number[]]>;
const MAX_SERIALIZED_TRANSACTION_BYTES = 4_096;

export type DecodedTransactionIntent = {
  gameType: GameType;
  action: GameAction;
  amountLamports: bigint | null;
  gameAddress: string;
  programId: string;
  messageHash: string;
};

export class TransactionIntentError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "TransactionIntentError";
  }
}

function fail(code: string, message: string): never {
  throw new TransactionIntentError(code, message);
}

function u64(value: bigint) {
  const data = Buffer.alloc(8);
  data.writeBigUInt64LE(value);
  return data;
}

function same(left: PublicKey, right: PublicKey) {
  return left.equals(right);
}

function expectKey(instruction: TransactionInstruction, index: number, expected: PublicKey, label: string) {
  const key = instruction.keys[index];
  if (!key || !same(key.pubkey, expected)) fail("INVALID_TRANSACTION_ACCOUNTS", `${label} is not the expected account.`);
}

function expectSigner(instruction: TransactionInstruction, index: number, wallet: PublicKey) {
  const key = instruction.keys[index];
  if (!key || !key.isSigner || !same(key.pubkey, wallet)) fail("INVALID_TRANSACTION_SIGNER", "The authenticated wallet is not the required game signer.");
}

function expectWritable(instruction: TransactionInstruction, index: number, label: string) {
  const key = instruction.keys[index];
  if (!key?.isWritable) fail("INVALID_TRANSACTION_ACCOUNTS", `${label} must be writable.`);
}

function exactInstruction(instruction: TransactionInstruction, program: PublicKey, keyCount: number, dataLength: number) {
  if (!same(instruction.programId, program)) fail("INVALID_TRANSACTION_PROGRAM", "The transaction contains an instruction for an unapproved program.");
  if (instruction.keys.length !== keyCount || instruction.data.length !== dataLength) fail("INVALID_TRANSACTION_LAYOUT", "The game instruction layout is not recognized.");
}

function actionFor(instruction: TransactionInstruction): GameAction | "initialize_daily_player" {
  if (instruction.data.length < 8) fail("INVALID_TRANSACTION_INSTRUCTION", "The transaction contains malformed instruction data.");
  const prefix = instruction.data.subarray(0, 8);
  if (Buffer.from(prefix).equals(Buffer.from(DISCRIMINATORS.initialize_daily_player))) return "initialize_daily_player";
  for (const [action, discriminator] of ACTIONS) if (Buffer.from(prefix).equals(Buffer.from(discriminator))) return action;
  return fail("UNSUPPORTED_TRANSACTION_ACTION", "The transaction contains an unsupported game action.");
}

function gameTypeFor(action: GameAction): GameType {
  if (action === "enter_jackpot") return "jackpot";
  if (action.includes("coinflip")) return "coinflip";
  return "daily";
}

function verifyAccounts(instruction: TransactionInstruction, action: GameAction, wallet: PublicKey, program: PublicKey) {
  const config = PublicKey.findProgramAddressSync([CONFIG_SEED], program)[0];
  const dailyVault = PublicKey.findProgramAddressSync([DAILY_VAULT_SEED], program)[0];
  let gameAddress: PublicKey;

  switch (action) {
    case "enter_jackpot": {
      exactInstruction(instruction, program, 5, 16);
      expectSigner(instruction, 0, wallet);
      expectKey(instruction, 1, config, "Configuration");
      gameAddress = instruction.keys[2].pubkey;
      const vault = PublicKey.findProgramAddressSync([JACKPOT_VAULT_SEED, gameAddress.toBuffer()], program)[0];
      expectKey(instruction, 3, vault, "Jackpot vault");
      expectKey(instruction, 4, SystemProgram.programId, "System program");
      break;
    }
    case "create_coinflip": {
      exactInstruction(instruction, program, 5, 33);
      expectSigner(instruction, 0, wallet);
      expectKey(instruction, 1, config, "Configuration");
      const id = Buffer.from(instruction.data).readBigUInt64LE(8);
      gameAddress = PublicKey.findProgramAddressSync([COINFLIP_SEED, u64(id)], program)[0];
      expectKey(instruction, 2, gameAddress, "Coinflip game");
      const vault = PublicKey.findProgramAddressSync([COINFLIP_VAULT_SEED, gameAddress.toBuffer()], program)[0];
      expectKey(instruction, 3, vault, "Coinflip vault");
      expectKey(instruction, 4, SystemProgram.programId, "System program");
      const side = instruction.data[16];
      if (side !== 0 && side !== 1) fail("INVALID_COINFLIP_SIDE", "The Coinflip side is invalid.");
      break;
    }
    case "join_coinflip": {
      exactInstruction(instruction, program, 7, 8);
      expectSigner(instruction, 0, wallet);
      expectKey(instruction, 1, config, "Configuration");
      gameAddress = instruction.keys[2].pubkey;
      const vault = PublicKey.findProgramAddressSync([COINFLIP_VAULT_SEED, gameAddress.toBuffer()], program)[0];
      expectKey(instruction, 3, vault, "Coinflip vault");
      const receipt = PublicKey.findProgramAddressSync([RANDOMNESS_RECEIPT_SEED, instruction.keys[4].pubkey.toBuffer()], program)[0];
      expectKey(instruction, 5, receipt, "Randomness receipt");
      expectKey(instruction, 6, SystemProgram.programId, "System program");
      break;
    }
    case "settle_coinflip": {
      exactInstruction(instruction, program, 8, 8);
      expectKey(instruction, 0, config, "Configuration");
      gameAddress = instruction.keys[1].pubkey;
      const vault = PublicKey.findProgramAddressSync([COINFLIP_VAULT_SEED, gameAddress.toBuffer()], program)[0];
      expectKey(instruction, 2, vault, "Coinflip vault");
      const receipt = PublicKey.findProgramAddressSync([RANDOMNESS_RECEIPT_SEED, instruction.keys[3].pubkey.toBuffer()], program)[0];
      expectKey(instruction, 4, receipt, "Randomness receipt");
      expectWritable(instruction, 4, "Randomness receipt");
      expectWritable(instruction, 7, "Receipt rent payer");
      break;
    }
    case "cancel_coinflip": {
      exactInstruction(instruction, program, 3, 8);
      expectSigner(instruction, 0, wallet);
      gameAddress = instruction.keys[1].pubkey;
      const vault = PublicKey.findProgramAddressSync([COINFLIP_VAULT_SEED, gameAddress.toBuffer()], program)[0];
      expectKey(instruction, 2, vault, "Coinflip vault");
      break;
    }
    case "refund_coinflip_timeout": {
      exactInstruction(instruction, program, 7, 8);
      gameAddress = instruction.keys[0].pubkey;
      const vault = PublicKey.findProgramAddressSync([COINFLIP_VAULT_SEED, gameAddress.toBuffer()], program)[0];
      expectKey(instruction, 1, vault, "Coinflip vault");
      const receipt = PublicKey.findProgramAddressSync([RANDOMNESS_RECEIPT_SEED, instruction.keys[4].pubkey.toBuffer()], program)[0];
      expectKey(instruction, 5, receipt, "Randomness receipt");
      expectWritable(instruction, 5, "Randomness receipt");
      expectKey(instruction, 6, instruction.keys[3].pubkey, "Receipt rent payer");
      expectWritable(instruction, 6, "Receipt rent payer");
      break;
    }
    case "open_daily": {
      exactInstruction(instruction, program, 6, 8);
      expectSigner(instruction, 0, wallet);
      expectKey(instruction, 1, config, "Configuration");
      gameAddress = PublicKey.findProgramAddressSync([DAILY_SEED, wallet.toBuffer()], program)[0];
      expectKey(instruction, 2, gameAddress, "Daily player");
      const receipt = PublicKey.findProgramAddressSync([RANDOMNESS_RECEIPT_SEED, instruction.keys[3].pubkey.toBuffer()], program)[0];
      expectKey(instruction, 4, receipt, "Randomness receipt");
      expectKey(instruction, 5, SystemProgram.programId, "System program");
      break;
    }
    case "settle_daily": {
      exactInstruction(instruction, program, 7, 8);
      expectKey(instruction, 0, config, "Configuration");
      gameAddress = PublicKey.findProgramAddressSync([DAILY_SEED, instruction.keys[4].pubkey.toBuffer()], program)[0];
      expectKey(instruction, 1, gameAddress, "Daily player");
      const receipt = PublicKey.findProgramAddressSync([RANDOMNESS_RECEIPT_SEED, instruction.keys[2].pubkey.toBuffer()], program)[0];
      expectKey(instruction, 3, receipt, "Randomness receipt");
      expectWritable(instruction, 3, "Randomness receipt");
      expectKey(instruction, 5, dailyVault, "Daily vault");
      expectKey(instruction, 6, instruction.keys[4].pubkey, "Receipt rent payer");
      expectWritable(instruction, 6, "Receipt rent payer");
      break;
    }
    case "cancel_daily_timeout": {
      exactInstruction(instruction, program, 5, 8);
      expectSigner(instruction, 0, wallet);
      gameAddress = PublicKey.findProgramAddressSync([DAILY_SEED, wallet.toBuffer()], program)[0];
      expectKey(instruction, 1, gameAddress, "Daily player");
      const receipt = PublicKey.findProgramAddressSync([RANDOMNESS_RECEIPT_SEED, instruction.keys[2].pubkey.toBuffer()], program)[0];
      expectKey(instruction, 3, receipt, "Randomness receipt");
      expectWritable(instruction, 3, "Randomness receipt");
      expectKey(instruction, 4, wallet, "Receipt rent payer");
      expectWritable(instruction, 4, "Receipt rent payer");
      break;
    }
  }
  return gameAddress.toBase58();
}

function verifyDailyInitializer(instruction: TransactionInstruction, wallet: PublicKey, program: PublicKey) {
  exactInstruction(instruction, program, 3, 8);
  expectSigner(instruction, 0, wallet);
  const daily = PublicKey.findProgramAddressSync([DAILY_SEED, wallet.toBuffer()], program)[0];
  expectKey(instruction, 1, daily, "Daily player");
  expectKey(instruction, 2, SystemProgram.programId, "System program");
}

function decodeBase64(value: string) {
  if (!value || value.length > Math.ceil(MAX_SERIALIZED_TRANSACTION_BYTES * 4 / 3) + 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    fail("INVALID_TRANSACTION_ENCODING", "The unsigned transaction is not valid base64.");
  }
  const bytes = Buffer.from(value, "base64");
  if (!bytes.length || bytes.length > MAX_SERIALIZED_TRANSACTION_BYTES || bytes.toString("base64") !== value) fail("INVALID_TRANSACTION_ENCODING", "The unsigned transaction encoding is not canonical.");
  return bytes;
}

async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Buffer.from(digest).toString("hex");
}

export async function decodeTransactionIntent(input: { serializedTransactionBase64: string; walletAddress: string; programId: string; requireUnsigned?: boolean }): Promise<DecodedTransactionIntent> {
  let transaction: Transaction;
  let wallet: PublicKey;
  let program: PublicKey;
  try {
    transaction = Transaction.from(decodeBase64(input.serializedTransactionBase64));
    wallet = new PublicKey(input.walletAddress);
    program = new PublicKey(input.programId);
  } catch (error) {
    if (error instanceof TransactionIntentError) throw error;
    return fail("INVALID_TRANSACTION", "The serialized Solana transaction cannot be decoded.");
  }
  if (!transaction.feePayer || !same(transaction.feePayer, wallet)) fail("INVALID_TRANSACTION_FEE_PAYER", "The authenticated wallet must be the transaction fee payer.");
  if (!transaction.recentBlockhash) fail("MISSING_BLOCKHASH", "The transaction must contain a recent blockhash before approval.");
  if (!transaction.signatures.some(item => same(item.publicKey, wallet))) fail("INVALID_TRANSACTION_SIGNER", "The authenticated wallet is not a required transaction signer.");
  if (input.requireUnsigned !== false && transaction.signatures.some(item => item.signature !== null)) fail("TRANSACTION_ALREADY_SIGNED", "Only an unsigned transaction can be approved.");
  if (!transaction.instructions.length || transaction.instructions.length > 2) fail("INVALID_TRANSACTION_INSTRUCTION_COUNT", "The transaction must contain exactly one game action.");

  const actions = transaction.instructions.map(actionFor);
  const actionable = actions.filter((action): action is GameAction => action !== "initialize_daily_player");
  if (actionable.length !== 1) fail("INVALID_TRANSACTION_ACTION_COUNT", "The transaction must contain exactly one game action.");
  const action = actionable[0];
  if (actions.includes("initialize_daily_player")) {
    if (actions.length !== 2 || actions[0] !== "initialize_daily_player" || action !== "open_daily") fail("INVALID_DAILY_INITIALIZER", "Daily player initialization is only allowed immediately before opening a Daily Case.");
    verifyDailyInitializer(transaction.instructions[0], wallet, program);
  }
  const instruction = transaction.instructions[transaction.instructions.length - 1];
  const gameAddress = verifyAccounts(instruction, action, wallet, program);
  const amountLamports = action === "enter_jackpot"
    ? Buffer.from(instruction.data).readBigUInt64LE(8)
    : action === "create_coinflip"
      ? Buffer.from(instruction.data).readBigUInt64LE(17)
      : action === "join_coinflip"
        ? null
        : 0n;
  if (amountLamports !== null && amountLamports > BigInt(Number.MAX_SAFE_INTEGER)) fail("WAGER_TOO_LARGE", "The wager exceeds the supported compliance range.");
  if ((action === "enter_jackpot" || action === "create_coinflip") && amountLamports === 0n) fail("INVALID_WAGER", "The decoded wager must be greater than zero.");
  return {
    gameType: gameTypeFor(action),
    action,
    amountLamports,
    gameAddress,
    programId: program.toBase58(),
    messageHash: await sha256Hex(transaction.serializeMessage()),
  };
}
