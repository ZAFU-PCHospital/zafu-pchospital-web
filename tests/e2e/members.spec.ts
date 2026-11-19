import { expect, test } from "@playwright/test";

import { loadSeed, login } from "./support";

test("管理员成员列表按姓名筛选并加载完整分页", async ({ page }) => {
  const seed = loadSeed();
  await login(page, seed.admin.qq, seed.admin.password);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "管理后台" })).toBeVisible();
  await page.goto("/admin/members");
  await expect(page.getByRole("heading", { name: "成员管理" })).toBeVisible();

  await page.getByRole("button", { name: "搜索", exact: true }).click();
  const query = page.getByLabel("姓名 / 昵称 / 学号 / 班级 / QQ / 手机号");
  await query.fill(seed.listPrefix);
  await query.press("Enter");

  await expect(page.getByText("当前筛选共 21 条")).toBeVisible();
  const rows = page.locator("table tbody tr");
  // 列表滚到底部会自动续页；结果不足一屏时也可以手动「加载更多」。
  // 自动续页与按钮点击可能竞争：按钮在 isVisible 后消失会导致 click 等待，
  // 这里允许点击失败，最终以行数断言兜底。
  const loadMore = page.getByRole("button", { name: "加载更多", exact: true });
  if (await loadMore.isVisible()) await loadMore.click({ timeout: 2_000 }).catch(() => {});
  await expect(rows).toHaveCount(21, { timeout: 15_000 });
  await expect(page.getByText("已全部加载")).toBeVisible();

  // 筛选/排序替换当前历史项：一次 Back 应离开列表，而不是回退到上一个筛选条件。
  await page.goBack();
  await expect(page).toHaveURL(/\/admin$/);
});

test("窄屏底部标签可读且品牌英文 eyebrow 收起", async ({ page }) => {
  const seed = loadSeed();
  await login(page, seed.admin.qq, seed.admin.password);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/members");
  await expect(page.getByRole("heading", { name: "成员管理" })).toBeVisible();

  const tab = await page
    .locator(".shell-tabbar__tab")
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        fontSize: Number.parseFloat(style.fontSize),
        height: element.getBoundingClientRect().height,
      };
    });
  expect(tab.fontSize).toBeGreaterThanOrEqual(12);
  expect(tab.height).toBeGreaterThanOrEqual(44);
  await expect(page.locator(".admin-nav__brand-en")).toBeHidden();
});
