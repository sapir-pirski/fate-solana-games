import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/auth/session", route => route.fulfill({ status: 401, contentType: "application/json", body: '{"authenticated":false}' }));
  await page.route("**/api/ai/status", route => route.fulfill({ status: 200, contentType: "application/json", body: '{"enabled":true}' }));
});

test("wallet actions remain active and labels do not overlap", async ({ page }) => {
  await page.goto("/");
  const chanceValue = page.locator(".chance-ring strong");
  const chanceLabel = page.locator(".chance-ring span");
  await expect(chanceValue).toBeVisible();
  await expect(chanceLabel).toBeVisible();
  await expect(chanceValue).toHaveText("0.0%");
  await chanceValue.scrollIntoViewIfNeeded();
  const valueBox = await chanceValue.boundingBox();
  const labelBox = await chanceLabel.boundingBox();
  expect(valueBox && labelBox && valueBox.y + valueBox.height <= labelBox.y).toBeTruthy();

  const presets = page.getByRole("group", { name: "Jackpot amount presets" });
  await presets.getByRole("button", { name: "0.10" }).click();
  await expect(presets.getByRole("button", { name: "0.10" })).toHaveAttribute("aria-pressed", "true");
  await presets.getByRole("button", { name: "1.00" }).click();
  await expect(presets.getByRole("button", { name: "1.00" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("No round indexed", { exact: true })).toBeVisible();
  await expect(page.getByText("FINALIZED", { exact: true })).toHaveCount(0);
  await expect(page.getByText("No fairness proof available", { exact: true })).toBeVisible();
  await expect(page.getByText("A7f3...9c2B", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Copy fairness proof" })).toHaveCount(0);
  await expect(page.getByText("No previous winner available", { exact: true })).toBeVisible();
  await expect(page.getByText("7cXq...2Kp9", { exact: true })).toHaveCount(0);
  await expect(page.getByText("12.84 SOL", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: /Connect wallet to enter/ }).click();
  const walletDialog = page.getByRole("dialog", { name: "Connect a wallet" });
  await expect(walletDialog).toBeVisible();
  await expect(walletDialog.getByRole("button", { name: "Continue in demo mode" })).toHaveCount(1);
  await walletDialog.getByRole("button", { name: "Close wallet picker" }).click();

  await expect(page.getByText("Transaction unavailable", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /View transaction/ })).toHaveCount(0);
});

test("coinflip empty state is readable and points to creation", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.route("**/api/indexer/games?type=coinflip", route => route.fulfill({ status: 200, contentType: "application/json", body: '{"games":[]}' }));
  await page.route("**/api/indexer/games?type=coinflip&state=settled", route => route.fulfill({ status: 200, contentType: "application/json", body: '{"games":[]}' }));
  await page.goto("/coinflip");
  await expect(page.getByText("NO OPEN FLIPS", { exact: true })).toBeVisible();
  const emptyState = page.locator(".flip-empty");
  await expect(emptyState.getByText("No open coinflips yet", { exact: true })).toBeVisible();
  const textBox = await emptyState.getByText("Create the first challenge and wait for another player to join.").boundingBox();
  expect(textBox && textBox.width > 180).toBeTruthy();
  const setupButton = emptyState.getByRole("link", { name: "Set up a coinflip" });
  const setupButtonBox = await setupButton.boundingBox();
  expect(setupButtonBox).toBeTruthy();
  await page.mouse.click(setupButtonBox!.x + setupButtonBox!.width / 2, setupButtonBox!.y + setupButtonBox!.height / 2);
  const setup = page.getByRole("dialog", { name: "Set up a coinflip" });
  await expect(setup).toBeVisible();
  const setupBox = await setup.boundingBox();
  expect(setupBox && setupBox.y >= 0 && setupBox.y + setupBox.height <= 1080).toBeTruthy();
  await expect(setup.locator("#coin-wager")).toBeFocused();
  await setup.getByRole("button", { name: "0.50" }).click();
  await expect(setup.locator("#coin-wager")).toHaveValue("0.50");
  await page.keyboard.press("Escape");
  await expect(setup).toBeHidden();
  await expect(page.getByText("No finalized flips indexed", { exact: true })).toBeVisible();
  await expect(page.getByText("3Qm8...pL0f", { exact: true })).toHaveCount(0);
  await expect(page.getByText("No fairness proof available", { exact: true })).toBeVisible();
  await expect(page.getByText("FINALIZED", { exact: true })).toHaveCount(0);
});

test("coinflip setup opens without JavaScript hydration", async ({ browser }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  await page.goto("/coinflip");
  await page.getByRole("link", { name: "Create a coinflip" }).click();
  await expect(page.locator("#coinflip-setup")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Set up a coinflip" })).toBeVisible();

  await context.close();
});

test("daily case history never shows sample rewards", async ({ page }) => {
  await page.goto("/daily-case");
  await expect(page.getByText("Connect wallet to view your opens", { exact: true })).toBeVisible();
  await expect(page.getByText("No fairness proof available", { exact: true })).toBeVisible();
  await expect(page.getByText("Yesterday", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Jul 29", { exact: true })).toHaveCount(0);
  await expect(page.getByText("LAST 3", { exact: true })).toHaveCount(0);
});

test("history explains the disconnected empty state", async ({ page }) => {
  await page.goto("/history");
  await expect(page.getByText("Connect wallet to view your history", { exact: true })).toBeVisible();
  await expect(page.getByText("Wallet required", { exact: true })).toBeVisible();
  await expect(page.getByText("Indexed games", { exact: true }).locator("..").getByText("—", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "All games" })).toBeDisabled();
  await expect(page.getByText("GAME", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Connect wallet", exact: true }).last().click();
  await expect(page.getByRole("dialog", { name: "Connect a wallet" })).toBeVisible();
});

test("fairness verifier validates Solana addresses inline", async ({ page }) => {
  await page.goto("/verify");
  const address = page.getByLabel("Game account address");
  const verify = page.getByRole("button", { name: "Verify fairness" });

  await expect(verify).toBeDisabled();
  await expect(page.getByText("Enter a Solana game account address to begin.")).toBeVisible();

  await address.fill("not-a-solana-address");
  await expect(address).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Enter a valid base58 Solana account address.")).toBeVisible();
  await expect(verify).toBeDisabled();

  await address.fill("11111111111111111111111111111111");
  await expect(address).toHaveAttribute("aria-invalid", "false");
  await expect(page.getByText("Valid Solana account address.")).toBeVisible();
  await expect(verify).toBeEnabled();

  await page.getByRole("button", { name: "Daily Case" }).click();
  await expect(page.getByRole("button", { name: "Daily Case" })).toHaveAttribute("aria-pressed", "true");
});

test("copilot floats without collision and safety lives in the footer", async ({ page }) => {
  await page.goto("/");
  const copilot = page.locator(".copilot-launcher");
  const safety = page.getByRole("button", { name: "Safety & privacy" });
  await expect(copilot).toBeVisible();
  await expect(copilot).toBeEnabled();
  await expect(copilot).toHaveCSS("position", "fixed");
  await expect(page.locator(".compliance-launcher")).toBeHidden();
  const copilotBox = await copilot.boundingBox();
  expect(copilotBox && copilotBox.width <= 50).toBeTruthy();
  expect(copilotBox && copilotBox.x >= 0 && copilotBox.x + copilotBox.width <= 1280).toBeTruthy();

  await copilot.click();
  await expect(page.getByRole("dialog", { name: "FATE Copilot" })).toBeVisible();
  await page.getByRole("button", { name: "Close Copilot" }).click();
  await safety.scrollIntoViewIfNeeded();
  await safety.click();
  await expect(page.getByRole("dialog", { name: "Eligibility and controls" })).toBeVisible();
});

test("copilot dismisses outside, wraps prompts, and offers retry on provider failure", async ({ page }) => {
  let attempts = 0;
  await page.route("**/api/ai/chat", route => { attempts += 1; return attempts === 1 ? route.fulfill({ status: 503, contentType: "application/json", body: '{"code":"AI_UNAVAILABLE","requestId":"test-request"}' }) : route.fulfill({ status: 200, contentType: "text/event-stream", body: 'event: meta\ndata: {"conversationId":"00000000-0000-4000-8000-000000000001"}\n\nevent: delta\ndata: {"delta":"Recovered in a clean conversation."}\n\nevent: done\ndata: {}\n\n' }); });
  await page.goto("/");
  const launcher = page.locator(".copilot-launcher");
  await launcher.click();
  const dialog = page.getByRole("dialog", { name: "FATE Copilot" });
  await expect(dialog).toBeVisible();
  const prompts = dialog.locator(".ai-prompts button");
  await expect(prompts).toHaveCount(3);
  for (const prompt of await prompts.all()) await expect(prompt).toBeInViewport();
  await prompts.first().click();
  await expect(dialog.getByText("Copilot is temporarily unavailable. Please retry.")).toBeVisible();
  await dialog.getByRole("button", { name: "Retry" }).click();
  await expect(dialog.getByText("Recovered in a clean conversation.")).toBeVisible();
  await expect(dialog.getByText("Copilot is temporarily unavailable. Please retry.")).toHaveCount(0);
  await expect(dialog.getByText("Explain Jackpot fairness", { exact: true })).toHaveCount(2);
  await page.getByRole("button", { name: "Dismiss Copilot" }).click({ position: { x: 4, y: 4 } });
  await expect(dialog).toBeHidden();
  await expect(launcher).toBeFocused();
  await launcher.click();
  await expect(dialog.getByText("Recovered in a clean conversation.")).toHaveCount(0);
  await expect(dialog.getByText("Explain Jackpot fairness", { exact: true })).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.evaluate(() => { sessionStorage.setItem("fate.ai.messages", '[{"id":"stale","role":"assistant","content":"stale failure"}]'); sessionStorage.setItem("fate.ai.conversation", "stale"); });
  await page.reload();
  await launcher.click();
  await expect(page.getByText("stale failure")).toHaveCount(0);
});
