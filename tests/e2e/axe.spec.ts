import { expect, test, type Page } from "@playwright/test";

import { AXE_THEMES, scanA11y, type AxeTheme } from "./axe";
import { loadSeed, login } from "./support";

// 与 src/lib/theme.ts 的 THEME_STORAGE_KEY 一致；Playwright 侧不引入带 @/ 别名的模块。
const THEME_STORAGE_KEY = "zafu-pchospital:theme-mode";

async function gotoThemed(page: Page, path: string, theme: AxeTheme): Promise<void> {
  await page.goto(path);
  await expect(page.locator("html")).toHaveAttribute("data-mode", theme);
}

for (const theme of AXE_THEMES) {
  test(`公开页面无障碍基线（${theme}）`, async ({ browser, baseURL }) => {
    const seed = loadSeed();
    // 关闭入场动画：否则 axe 可能扫到元素仍在淡入的半透明状态，基线会随扫描时机漂移。
    const context = await browser.newContext({ baseURL, reducedMotion: "reduce" });
    await context.addInitScript(({ key, mode }) => window.localStorage.setItem(key, mode), {
      key: THEME_STORAGE_KEY,
      mode: theme,
    });
    const page = await context.newPage();
    try {
      await gotoThemed(page, "/", theme);
      await page.locator("h1").first().waitFor();
      await scanA11y(page, "/", theme);

      await gotoThemed(page, "/login", theme);
      await page.locator("#auth-qq").waitFor();
      await scanA11y(page, "/login", theme);

      await gotoThemed(page, "/repair-activities", theme);
      await page.getByText(seed.activity.title).waitFor();
      await scanA11y(page, "/repair-activities", theme);

      await gotoThemed(page, `/repair-activities/${seed.activity.id}`, theme);
      await page.getByRole("heading", { name: seed.activity.title }).waitFor();
      await scanA11y(page, "/repair-activities/[id]", theme);
    } finally {
      await context.close();
    }
  });

  test(`管理后台无障碍基线（${theme}）`, async ({ browser, baseURL }) => {
    const seed = loadSeed();
    const context = await browser.newContext({ baseURL, reducedMotion: "reduce" });
    await context.addInitScript(({ key, mode }) => window.localStorage.setItem(key, mode), {
      key: THEME_STORAGE_KEY,
      mode: theme,
    });
    const page = await context.newPage();
    try {
      await login(page, seed.admin.qq, seed.admin.password);
      await gotoThemed(page, "/admin/members", theme);
      await page.getByRole("heading", { name: "成员管理" }).waitFor();
      await page.locator("table tbody tr").first().waitFor();
      await scanA11y(page, "/admin/members", theme);
    } finally {
      await context.close();
    }
  });
}
