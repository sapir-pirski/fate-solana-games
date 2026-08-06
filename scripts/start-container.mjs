import { readFile, writeFile, chmod } from "node:fs/promises";
import { spawn } from "node:child_process";

const sourceConfig = new URL("../dist/server/wrangler.json", import.meta.url);
// Keep the generated file next to the source config because Wrangler resolves
// its entry point and asset paths relative to the config directory.
const runtimeConfig = new URL("../dist/server/.wrangler.runtime.json", import.meta.url).pathname;
const allowedVariables = [
  "APP_REVISION",
  "LOCAL_OBSERVABILITY_FIXTURES",
  "AUTOMATION_TOKEN",
  "RESTORE_MAX_BYTES",
  "RESTORE_MAX_ROWS",
  "PRIVACY_REQUEST_DEADLINE_DAYS",
  "PRIVACY_EXPORT_TTL_SECONDS",
  "AI_MAX_REQUESTS_PER_WALLET_DAY",
  "AI_MAX_TOKENS_PER_WALLET_DAY",
  "AI_PROVIDER_TIMEOUT_MS",
  "AI_MONTHLY_BUDGET_USD",
  "AI_INPUT_USD_PER_MILLION_TOKENS",
  "AI_CACHED_INPUT_USD_PER_MILLION_TOKENS",
  "AI_OUTPUT_USD_PER_MILLION_TOKENS",
  "COMPLIANCE_ALLOWED_COUNTRIES",
  "COMPLIANCE_BLOCKED_COUNTRIES",
  "FATE_PROGRAM_ID",
  "INDEXER_AUTH_TOKEN",
  "NEXT_PUBLIC_FATE_PROGRAM_ID",
  "NEXT_PUBLIC_SOLANA_CLUSTER",
  "NEXT_PUBLIC_SOLANA_RPC_URL",
  "NEXT_PUBLIC_SOLANA_RPC_URLS",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_SERVICE_NAME",
  "SOLANA_RPC_URL",
];

const config = JSON.parse(await readFile(sourceConfig, "utf8"));
config.vars ??= {};
for (const name of allowedVariables) {
  const value = process.env[name];
  if (value) config.vars[name] = value;
}

await writeFile(runtimeConfig, `${JSON.stringify(config)}\n`, { mode: 0o600 });
await chmod(runtimeConfig, 0o600);

const child = spawn(
  new URL("../node_modules/.bin/wrangler", import.meta.url).pathname,
  [
    "dev", "--config", runtimeConfig,
    "--ip", "0.0.0.0",
    "--port", process.env.PORT ?? "3000",
    "--persist-to", "/data",
    "--log-level", process.env.WRANGLER_LOG_LEVEL ?? "warn",
  ],
  { stdio: "inherit", env: process.env },
);

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
