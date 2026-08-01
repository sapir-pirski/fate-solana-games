import { FateIndexer } from "./worker.ts";

const databaseUrl = process.env.DATABASE_URL;
const programId = process.env.FATE_PROGRAM_ID;
if (!databaseUrl || !programId) throw new Error("DATABASE_URL and FATE_PROGRAM_ID are required.");
const indexer = new FateIndexer({ databaseUrl, programId, cluster: process.env.SOLANA_CLUSTER ?? "devnet", rpcUrls: (process.env.SOLANA_RPC_URLS ?? process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com").split(",").map(value => value.trim()).filter(Boolean), expectedGenesisHash: process.env.SOLANA_GENESIS_HASH, pollMs: Number(process.env.INDEXER_POLL_MS ?? 15_000), healthPort: Number(process.env.INDEXER_HEALTH_PORT ?? 9464) });
const command = process.argv[2] ?? "run";
if (command === "run") {
  const stop = await indexer.start();
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => void stop().finally(() => process.exit(0)));
} else {
  await indexer.initialize();
  if (command === "once") await indexer.cycle();
  else if (command === "rebuild") await indexer.store.rebuildProjections();
  else if (command === "retry-failures") console.log(JSON.stringify({ replayed: await indexer.replayFailures() }));
  else if (command === "status") console.log(JSON.stringify(await indexer.store.status(), null, 2));
  else throw new Error(`Unknown indexer command: ${command}`);
  await indexer.store.close();
}
