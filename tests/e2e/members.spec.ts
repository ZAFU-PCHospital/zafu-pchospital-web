import { expect, test } from "@playwright/test";

import { loadSeed, login } from "./support";

test("管理员成员列表按姓名筛选并加载完整分页", async ({ page }) => {
  const seed = loadSeed();
  await login(page, seed.admin.qq, seed.admin.password);
  await page.goto("/admin/members");
  await expect(page.getByRole("heading", { name: "成员管理" })).toBeVisible();

  await page.getByRole("button", { name: "搜索", exact: true }).click();
  const query = page.getByLabel("姓名 / 昵称 / 学号 / 班级 / QQ / 手机号");
  await query.fill(seed.listPrefix);
  await query.press("Enter");

  await expect(page.getByText("当前筛选共 21 条")).toBeVisible();
  const rows = page.locator("table tbody tr");
  // 列表滚到底部会自动续页；结果不足一屏时也可以手动「加载更多」。
  const loadMore = page.getByRole("button", { name: "加载更多", exact: true });
  if (await loadMore.isVisible()) await loadMore.click();
  await expect(rows).toHaveCount(21);
  await expect(page.getByText("已全部加载")).toBeVisible();
});
