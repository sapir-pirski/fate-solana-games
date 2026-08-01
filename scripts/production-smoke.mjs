const baseUrl = (process.env.BASE_URL || "https://fate-solana-games.sapirp.chatgpt.site").replace(/\/$/, "");

async function expectJson(path, predicate) {
  const response = await fetch(`${baseUrl}${path}`, { headers: { "user-agent": "fate-production-smoke/1" } });
  const body = await response.json().catch(() => null);
  if (!response.ok || !predicate(body)) throw new Error(`${path} failed (${response.status}): ${JSON.stringify(body)}`);
}

await expectJson("/api/health", (body) => body?.status === "ok" && body?.database?.status === "ok");
await expectJson("/api/ai/status", (body) => typeof body?.enabled === "boolean");
const page = await fetch(`${baseUrl}/legal`);
if (!page.ok || !(await page.text()).includes("Responsible Play")) throw new Error("Legal and responsible-play page is unavailable.");
console.log(JSON.stringify({ status: "ok", baseUrl, checkedAt: new Date().toISOString() }));
