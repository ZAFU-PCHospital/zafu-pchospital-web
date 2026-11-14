import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const seedFile = resolve(process.env.E2E_SEED_FILE ?? "tests/e2e/.artifacts/seed.json");

/**
 * 夹具在独立 tsx 进程里写 / 清测试库：生成的 Prisma 客户端是 ESM，
 * 不能直接进入 Playwright 的 CJS 转译单元（原因见 `e2e-db.ts` 头部）。
 */
function run(mode: "seed" | "cleanup"): void {
  execFileSync(process.execPath, ["--import", "tsx", "tests/e2e/e2e-db.ts"], {
    stdio: "inherit",
    env: { ...process.env, E2E_MODE: mode, E2E_SEED_FILE: seedFile },
  });
}

export default async function globalSetup() {
  mkdirSync(dirname(seedFile), { recursive: true });
  run("seed");
  return async () => {
    run("cleanup");
  };
}
