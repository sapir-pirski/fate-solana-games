import { PublicKey } from "@solana/web3.js";

const baseUrl = (process.env.BASE_URL || "https://fate-solana-games.sapirp.chatgpt.site").replace(/\/$/, "");
const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const programId = new PublicKey(process.env.FATE_PROGRAM_ID || "Fg6PaFpoGXkYsidMpWxqSWY4vF8zqRkMnJx9QpMvdWvZ");
const [configPda] = PublicKey.findProgramAddressSync([new TextEncoder().encode("config")], programId);
const blockers = [];
const checks = [];

async function check(name, operation) {
  try { const evidence = await operation(); checks.push({ name, status: "passed", evidence }); return evidence; }
  catch (error) { const message = error instanceof Error ? error.message : String(error); checks.push({ name, status: "failed", evidence: message }); blockers.push(`${name}: ${message}`); return null; }
}
async function rpc(method, params = []) {
  const response = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
  const body = await response.json(); if (body.error) throw new Error(body.error.message); return body.result;
}

await check("public application health", async () => {
  const response = await fetch(`${baseUrl}/api/health`); const body = await response.json();
  if (!response.ok || body.status !== "ok" || body.network !== "devnet" || body.database?.status !== "ok") throw new Error(`unhealthy response: ${JSON.stringify(body)}`);
  return { network: body.network, database: body.database };
});
await check("Solana devnet RPC", async () => {
  const health = await rpc("getHealth"); if (health !== "ok") throw new Error(`unexpected health: ${health}`); return { health };
});
const program = await check("program deployed and executable", async () => {
  const result = await rpc("getAccountInfo", [programId.toBase58(), { encoding: "base64", commitment: "finalized" }]);
  if (!result.value) throw new Error(`no finalized account exists at ${programId.toBase58()}`);
  if (!result.value.executable) throw new Error("program account is not executable");
  return { address: programId.toBase58(), owner: result.value.owner, executable: result.value.executable, slot: result.context.slot };
});
if (program) await check("configuration PDA initialized", async () => {
  const result = await rpc("getAccountInfo", [configPda.toBase58(), { encoding: "base64", commitment: "finalized" }]);
  if (!result.value) throw new Error(`config PDA ${configPda.toBase58()} is not initialized`);
  if (result.value.owner !== programId.toBase58()) throw new Error(`config PDA owner is ${result.value.owner}`);
  return { address: configPda.toBase58(), owner: result.value.owner, slot: result.context.slot };
});
else blockers.push("configuration PDA and authority topology cannot be verified before program deployment");

const report = { format: "fate-devnet-acceptance-v1", status: blockers.length ? "blocked" : "ready-for-transactional-tests", generatedAt: new Date().toISOString(), baseUrl, rpcUrl, programId: programId.toBase58(), configPda: configPda.toBase58(), checks, blockers };
console.log(JSON.stringify(report, null, 2));
if (blockers.length) process.exitCode = 1;
