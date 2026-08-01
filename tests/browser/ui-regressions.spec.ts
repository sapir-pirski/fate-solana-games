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
  await chanceValue.scrollIntoViewIfNeeded();
  const valueBox = await chanceValue.boundingBox();
  const labelBox = await chanceLabel.boundingBox();
  expect(valueBox && labelBox && valueBox.y + valueBox.height <= labelBox.y).toBeTruthy();

  await page.getByRole("button", { name: /Connect wallet to enter/ }).click();
  const walletDialog = page.getByRole("dialog", { name: "Connect a wallet" });
  await expect(walletDialog).toBeVisible();
  await expect(walletDialog.getByRole("button", { name: "Continue in demo mode" })).toHaveCount(1);
  await walletDialog.getByRole("button", { name: "Close wallet picker" }).click();

  await expect(page.getByText("Transaction unavailable", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /View transaction/ })).toHaveCount(0);
});

test("floating controls stay compact and collision-free", async ({ page }) => {
  await page.goto("/");
  const copilot = page.locator(".copilot-launcher");
  const compliance = page.locator(".compliance-launcher");
  await expect(copilot).toBeVisible();
  await expect(compliance).toBeVisible({ timeout: 15_000 });
  const copilotBox = await copilot.boundingBox();
  const complianceBox = await compliance.boundingBox();
  await expect(copilot).toHaveCSS("position", "fixed");
  await expect(compliance).toHaveCSS("position", "fixed");
  expect(copilotBox && copilotBox.width <= 50).toBeTruthy();
  expect(copilotBox && copilotBox.x >= 0 && copilotBox.x + copilotBox.width <= 1280).toBeTruthy();
  expect(complianceBox && complianceBox.x >= 0 && complianceBox.x + complianceBox.width <= 1280).toBeTruthy();
  const overlap = copilotBox && complianceBox
    ? !(copilotBox.x + copilotBox.width <= complianceBox.x || complianceBox.x + complianceBox.width <= copilotBox.x || copilotBox.y + copilotBox.height <= complianceBox.y || complianceBox.y + complianceBox.height <= copilotBox.y)
    : true;
  expect(overlap).toBe(false);
});
