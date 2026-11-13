import { test } from "@playwright/test";

import { scanA11y } from "./axe";
import { loadSeed, login } from "./support";

test("公开页面无障碍基线", async ({ page }) => {
  const seed = loadSeed();

  await page.goto("/");
  await page.locator("h1").first().waitFor();
  await scanA11y(page, "/");

  await page.goto("/login");
  await page.locator("#auth-qq").waitFor();
  await scanA11y(page, "/login");

  await page.goto("/repair-activities");
  await page.getByText(seed.activity.title).waitFor();
  await scanA11y(page, "/repair-activities");

  await page.goto(`/repair-activities/${seed.activity.id}`);
  await page.getByRole("heading", { name: seed.activity.title }).waitFor();
  await scanA11y(page, "/repair-activities/[id]");
});

test("管理后台无障碍基线", async ({ page }) => {
  const seed = loadSeed();
  await login(page, seed.admin.qq, seed.admin.password);
  await page.goto("/admin/members");
  await page.getByRole("heading", { name: "成员管理" }).waitFor();
  await page.locator("table tbody tr").first().waitFor();
  await scanA11y(page, "/admin/members");
});
