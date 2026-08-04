import test from "node:test";
import assert from "node:assert/strict";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { enterJackpotTransaction } from "../../lib/solana/fate-client.ts";
import { decodeTransactionIntent, TransactionIntentError } from "../../lib/solana/transaction-intent.ts";

function unsignedBase64(transaction: Transaction) {
  return Buffer.from(transaction.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64");
}

function preparedJackpot(amountLamports = 250_000_000n) {
  const wallet = Keypair.generate();
  const program = Keypair.generate().publicKey;
  const transaction = enterJackpotTransaction({ programId: program.toBase58(), player: wallet.publicKey.toBase58(), roundId: 7n, amountLamports });
  transaction.feePayer = wallet.publicKey;
  transaction.recentBlockhash = Keypair.generate().publicKey.toBase58();
  return { wallet, program, transaction };
}

test("decodes the authoritative wager and action from an unsigned Solana message", async () => {
  const fixture = preparedJackpot();
  const intent = await decodeTransactionIntent({
    serializedTransactionBase64: unsignedBase64(fixture.transaction),
    walletAddress: fixture.wallet.publicKey.toBase58(),
    programId: fixture.program.toBase58(),
  });
  assert.equal(intent.gameType, "jackpot");
  assert.equal(intent.action, "enter_jackpot");
  assert.equal(intent.amountLamports, 250_000_000n);
  assert.match(intent.messageHash, /^[0-9a-f]{64}$/);
});

test("rejects an injected transfer even when the declared game metadata could look valid", async () => {
  const fixture = preparedJackpot();
  fixture.transaction.add(SystemProgram.transfer({ fromPubkey: fixture.wallet.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 }));
  await assert.rejects(
    decodeTransactionIntent({ serializedTransactionBase64: unsignedBase64(fixture.transaction), walletAddress: fixture.wallet.publicKey.toBase58(), programId: fixture.program.toBase58() }),
    (error: unknown) => error instanceof TransactionIntentError && ["INVALID_TRANSACTION_INSTRUCTION_COUNT", "INVALID_TRANSACTION_PROGRAM", "UNSUPPORTED_TRANSACTION_ACTION"].includes(error.code),
  );
});

test("rejects a transaction whose fee payer is not the authenticated wallet", async () => {
  const fixture = preparedJackpot();
  fixture.transaction.feePayer = Keypair.generate().publicKey;
  await assert.rejects(
    decodeTransactionIntent({ serializedTransactionBase64: unsignedBase64(fixture.transaction), walletAddress: fixture.wallet.publicKey.toBase58(), programId: fixture.program.toBase58() }),
    (error: unknown) => error instanceof TransactionIntentError && error.code === "INVALID_TRANSACTION_FEE_PAYER",
  );
});
