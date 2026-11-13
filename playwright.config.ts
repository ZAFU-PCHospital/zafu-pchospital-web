import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

import { assertTestDatabase } from "./tests/integration/db-guard";

/**
 * 端到端冒烟与无障碍基线。
 *
 * 运行前提：`DATABASE_URL` 指向独立测试库（库名以 `_test` 结尾）。配置加载时先过
 * `assertTestDatabase()`，避免 `webServer` 里的构建 / 启动连到开发库。
 *
 * 本地 `.env` 只有找到时才加载；CI 由 workflow 直接注入环境变量。
 * `APP_BASE_URL` 必须与 `baseURL` 一致：登录、遥测等写接口都走 `assertSameOrigin()`。
 * 用 `localhost` 而不是 `127.0.0.1`：生产模式会话 Cookie 带 `Secure`，
 * Chromium 只对 localhost 的 http 页面放行。
 */
if (!process.env.DATABASE_URL) {
  for (const file of [".env.local", ".env"]) {
    if (existsSync(file)) {
      process.loadEnvFile(file);
      break;
    }
  }
}
assertTestDatabase();

const port = Number(process.env.E2E_PORT ?? "3311");
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  outputDir: "tests/e2e/.artifacts",
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never", outputFolder: "tests/e2e/.report" }]]
    : [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "zh-CN",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // 构建在这里完成：环境校验已经通过，构建与启动都只会看到测试库。
    command: `pnpm build:site && pnpm start --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: {
      APP_BASE_URL: baseURL,
      DATABASE_URL: process.env.DATABASE_URL!,
    },
  },
});
