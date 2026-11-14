import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Page } from "@playwright/test";

import type { E2ESeed } from "./types";

const seedFile = resolve(process.env.E2E_SEED_FILE ?? "tests/e2e/.artifacts/seed.json");

export function loadSeed(): E2ESeed {
  return JSON.parse(readFileSync(seedFile, "utf8")) as E2ESeed;
}

/** 用真实登录表单建立会话；后续页面导航由调用方决定。 */
export async function login(page: Page, qq: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("QQ 号").fill(qq);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 });
}
