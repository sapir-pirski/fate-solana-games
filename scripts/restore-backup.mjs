import { readFile } from "node:fs/promises";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const backupPath = args.find(argument => !argument.startsWith("--"));
const baseUrl = process.env.BASE_URL?.replace(/\/$/, "");
const token = process.env.AUTOMATION_TOKEN;

if (!backupPath || !baseUrl || !token) {
  console.error("Usage: BASE_URL=https://... AUTOMATION_TOKEN=... npm run db:restore -- backup.json [--apply]");
  process.exit(2);
}

const raw = await readFile(backupPath, "utf8");
const backup = JSON.parse(raw);
const checksum = backup?.checksum?.value;
if (typeof checksum !== "string" || !/^[0-9a-f]{64}$/.test(checksum)) throw new Error("Backup checksum is missing or invalid.");

const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
const dryRun = await fetch(`${baseUrl}/api/internal/restore?dryRun=true`, { method: "POST", headers, body: raw });
if (!dryRun.ok) throw new Error(`Restore validation failed (${dryRun.status}): ${await dryRun.text()}`);
console.log(await dryRun.text());

if (!apply) {
  console.log(`Dry run passed. To replace the database, rerun with --apply and RESTORE_CONFIRM_CHECKSUM=${checksum}.`);
  process.exit(0);
}
if (process.env.RESTORE_CONFIRM_CHECKSUM !== checksum) throw new Error("RESTORE_CONFIRM_CHECKSUM must exactly match the validated backup checksum.");

const restored = await fetch(`${baseUrl}/api/internal/restore?mode=replace`, {
  method: "POST",
  headers: { ...headers, "x-fate-restore-confirm": checksum },
  body: raw,
});
if (!restored.ok) throw new Error(`Restore failed (${restored.status}): ${await restored.text()}`);
console.log(await restored.text());
