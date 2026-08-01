import { readdir, stat } from "node:fs/promises";
import { join, basename } from "node:path";

const assetDir = join(process.cwd(), "dist", "client", "assets");
const files = await readdir(assetDir);
const javascript = await Promise.all(files.filter(file => file.endsWith(".js")).map(async file => ({ file, bytes: (await stat(join(assetDir, file))).size })));
const pageChunks = javascript.filter(({ file }) => file.startsWith("page-"));
const entryLimit = Number(process.env.FATE_ENTRY_CHUNK_BUDGET_KB ?? 350) * 1024;
const lazyLimit = Number(process.env.FATE_LAZY_CHUNK_BUDGET_KB ?? 1024) * 1024;
const failures = [
  ...pageChunks.filter(({ bytes }) => bytes > entryLimit).map(({ file, bytes }) => `${file}: ${(bytes / 1024).toFixed(1)} KiB exceeds entry budget`),
  ...javascript.filter(({ bytes }) => bytes > lazyLimit).map(({ file, bytes }) => `${file}: ${(bytes / 1024).toFixed(1)} KiB exceeds lazy-chunk budget`),
];
const largest = javascript.sort((a, b) => b.bytes - a.bytes).slice(0, 8);
console.log(largest.map(({ file, bytes }) => `${basename(file)} ${(bytes / 1024).toFixed(1)} KiB`).join("\n"));
if (failures.length) throw new Error(`Bundle budget failed:\n${failures.join("\n")}`);
console.log(`Bundle budgets passed: page <= ${entryLimit / 1024} KiB, any chunk <= ${lazyLimit / 1024} KiB.`);
