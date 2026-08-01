import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/session", route => route.fulfill({ status: 401, contentType: "application/json", body: '{"authenticated":false}' }));
});

test("home and game views have no serious accessibility violations", async ({ page, isMobile }) => {
  await page.goto("/");
  const views = isMobile ? ["Jackpot"] : ["Jackpot", "Coinflip", "Daily Case", "History"];
  for (const view of views) {
    if (view !== "Jackpot") await page.locator(".desktop-nav").getByRole("button", { name: new RegExp(`^${view}`) }).click();
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations.filter(item => ["serious", "critical"].includes(item.impact ?? ""))).toEqual([]);
  }
});

test("keyboard users can skip content and close the wallet dialog", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Skip to game content" })).toBeFocused();
  await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Connect a wallet" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Connect a wallet" })).toBeHidden();
});

test("reduced motion removes continuous decorative animation", async ({ page, isMobile }) => {
  test.skip(Boolean(isMobile));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".particle-field")).toHaveCount(0);
  await page.locator(".desktop-nav").getByRole("button", { name: "Coinflip" }).click();
  await expect(page.locator(".webgl-stage")).toHaveCount(0);
  await expect(page.locator(".coin-face")).toBeVisible();
});
