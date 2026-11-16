import { expect, test, type Page } from "@playwright/test";

import { repairActivitiesPage } from "../../src/config/repair-activities";

async function position(page: Page) {
  return page.evaluate(() => {
    const top = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().top;
    return {
      scroll: window.scrollY,
      pagination: top(".repair-pagination"),
      preparation: top("#preparation"),
    };
  });
}

for (const viewport of [
  { width: 1350, height: 656 },
  { width: 800, height: 844 },
  { width: 390, height: 844 },
]) {
  test(`公开活动翻页保留滚动和分页位置 ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const pending: (() => void)[] = [];
    let failNext = false;
    await page.route("**/api/v1/repair-activities?*", async (route) => {
      const current = Number(new URL(route.request().url()).searchParams.get("page"));
      if (current > 1) await new Promise<void>((resolve) => pending.push(resolve));
      if (failNext) {
        failNext = false;
        await route.fulfill({
          status: 500,
          json: { success: false, error: { message: "翻页测试错误" } },
        });
        return;
      }
      await route.fulfill({
        json: {
          success: true,
          data: Array.from({ length: current === 3 ? 1 : 4 }, (_, index) => ({
            id: `pagination-${current}-${index}`,
            title: `测试活动 ${current}-${index + 1}`,
            location: "学 3-301 活动室",
            activityAt: "2026-11-21T06:00:00Z",
            endsAt: "2026-11-21T09:00:00Z",
            capacity: 10,
            registeredCount: 2,
            remaining: 8,
            status: "ENDED",
          })),
          meta: { pagination: { page: current, pageSize: 4, total: 9, totalPages: 3 } },
        },
      });
    });
    const list = page.locator(".activity-list--paged");
    const next = page.getByRole("button", { name: repairActivitiesPage.nextPage });
    const previous = page.getByRole("button", { name: repairActivitiesPage.previousPage });
    const counter = page.locator(".repair-pagination > span");
    const alert = page.locator(".page-alert [role='alert']");
    await page.goto("/repair-activities");
    await expect(counter).toHaveText("1 / 3");
    await page.evaluate(() => document.fonts.ready);
    await next.scrollIntoViewIfNeeded();
    const before = await position(page);
    const cardHeight = await list
      .locator(".activity-card")
      .first()
      .evaluate((card) => card.clientHeight);

    async function changePage(button: typeof next, target: number, fail = false) {
      failNext = fail;
      await button.click();
      await expect(list).toHaveAttribute("aria-busy", "true");
      await expect(next).toBeDisabled();
      await expect(previous).toBeDisabled();
      expect(await position(page)).toEqual(before);
      await expect.poll(() => pending.length).toBe(1);
      pending.shift()!();
      await expect(list).toHaveAttribute("aria-busy", "false");
      if (fail) await expect(alert).toContainText("翻页测试错误");
      else await expect(counter).toHaveText(`${target} / 3`);
      // 等待原实现的 smooth scroll 完成，检查异步滚动与即时布局变化。
      await page.waitForTimeout(700);
      expect(await position(page)).toEqual(before);
    }

    await changePage(next, 2, true);
    await expect(page.getByText("测试活动 1-1")).toHaveCount(1);
    await changePage(next, 2);
    await expect(alert).toHaveCount(0);
    await changePage(next, 3);
    await expect(list.locator(":scope > li")).toHaveCount(1);
    expect(await list.locator(".activity-card").evaluate((card) => card.clientHeight)).toBe(
      cardHeight,
    );
    await expect(next).toBeDisabled();
    await previous.focus();
    await previous.press("Enter");
    await expect(list).toHaveAttribute("aria-busy", "true");
    await expect.poll(() => pending.length).toBe(1);
    pending.shift()!();
    await expect(counter).toHaveText("2 / 3");
    await page.waitForTimeout(700);
    expect(await position(page)).toEqual(before);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
    await page.setViewportSize({ width: viewport.width === 390 ? 1350 : 390, height: 844 });
    await expect.poll(() => list.evaluate((element) => element.style.minHeight)).toBe("");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}
