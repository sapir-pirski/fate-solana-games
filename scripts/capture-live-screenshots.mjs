import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const publicBase = (process.env.FATE_SCREENSHOT_BASE_URL || "https://fate-solana-games.sapirp.chatgpt.site").replace(/\/$/, "");
const grafanaBase = (process.env.FATE_GRAFANA_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputRoot = path.resolve(process.env.FATE_SCREENSHOT_DIR || `artifacts/screenshots/${stamp}`);

function parseEnv(contents) {
  return Object.fromEntries(contents.split(/\r?\n/).filter(line => line && !line.startsWith("#") && line.includes("=")).map(line => {
    const separator = line.indexOf("=");
    return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
  }));
}

const localEnv = await readFile(path.resolve(process.env.FATE_LOCAL_ENV_FILE || "local.env"), "utf8").then(parseEnv).catch(() => ({}));
const grafanaUser = process.env.GRAFANA_ADMIN_USER || localEnv.GRAFANA_ADMIN_USER || "admin";
const grafanaPassword = process.env.GRAFANA_ADMIN_PASSWORD || localEnv.GRAFANA_ADMIN_PASSWORD;
if (!grafanaPassword) throw new Error("GRAFANA_ADMIN_PASSWORD is required in local.env or the process environment.");

const routes = [
  ["home", "/"],
  ["jackpot", "/jackpot"],
  ["coinflip", "/coinflip"],
  ["daily-case", "/daily-case"],
  ["history", "/history"],
  ["fairness-verifier", "/verify"],
  ["legal", "/legal"],
];
const dashboards = [
  ["fate-overview", "fate-operations", "fate-overview", 1120],
  ["fate-diagnostics", "fate-local", "fate-diagnostics", 1780],
  ["fate-ai-observability", "fate-ai", "fate-ai-llm-observability", 1420],
];
const manifest = { capturedAt: new Date().toISOString(), publicBase, grafanaBase, files: [], pageErrors: [] };

await mkdir(path.join(outputRoot, "web", "desktop"), { recursive: true });
await mkdir(path.join(outputRoot, "web", "mobile"), { recursive: true });
await mkdir(path.join(outputRoot, "grafana"), { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  for (const [device, viewport] of [["desktop", { width: 1440, height: 1000 }], ["mobile", { width: 430, height: 932 }]]) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, ignoreHTTPSErrors: false });
    const page = await context.newPage();
    page.on("pageerror", error => manifest.pageErrors.push({ device, message: error.message }));
    for (const [name, route] of routes) {
      const response = await page.goto(`${publicBase}${route}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      if (!response?.ok()) throw new Error(`${device} ${route} returned ${response?.status() ?? "no response"}`);
      await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});
      await page.waitForTimeout(1_200);
      const relative = path.join("web", device, `${name}.png`);
      await page.screenshot({ path: path.join(outputRoot, relative), fullPage: true, animations: "disabled" });
      manifest.files.push({ kind: "web", device, name, route, file: relative });
    }
    await context.close();
  }
} finally {
  await browser.close();
}

const authorization = `Basic ${Buffer.from(`${grafanaUser}:${grafanaPassword}`).toString("base64")}`;
for (const [name, uid, slug, height] of dashboards) {
  const url = `${grafanaBase}/render/d/${uid}/${slug}?from=now-6h&to=now&width=1920&height=${height}&kiosk`;
  const response = await fetch(url, { headers: { authorization }, signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Grafana ${uid} render failed (${response.status}): ${(await response.text()).slice(0, 180)}`);
  const relative = path.join("grafana", `${name}.png`);
  await writeFile(path.join(outputRoot, relative), Buffer.from(await response.arrayBuffer()));
  manifest.files.push({ kind: "grafana", name, uid, file: relative });
}

await writeFile(path.join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ status: "ok", outputRoot, screenshots: manifest.files.length, pageErrors: manifest.pageErrors.length }));
